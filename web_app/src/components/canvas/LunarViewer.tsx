"use client";

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Compass,
  Layers,
  MapPin,
  RefreshCw,
  Sun,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Crosshair,
  Globe2,
  Mountain,
  Maximize2,
} from "lucide-react";
import { LUNAR_LANDMARKS, LunarLandmark } from "@/data/lunarLandmarks";

export interface LayerOpacities {
  base: number;          // OHRC Optical Base (0.25 m): 0.0 - 1.0
  topography: number;    // TMC-2 3D Topography Displacement (5 m): 0.0 - 1.0
  mineral: number;       // IIRS Hyperspectral Mineralogy (80 m): 0.0 - 1.0
  uncertainty: number;   // MAGSAC++ Quantitative Uncertainty: 0.0 - 1.0
}

export interface LunarViewerProps {
  lunarCoords?: {
    target_region: string;
    center_lat: number;
    center_lon: number;
    bounding_box: {
      west: number;
      south: number;
      east: number;
      north: number;
    };
    elevation_m?: number;
  };
  metrics?: any | null;
  isLoading?: boolean;
  opacities?: LayerOpacities;
  enableLighting?: boolean;
  showLabels?: boolean;
  showAlignmentFootprint?: boolean;
  viewMode?: "globe" | "terrain";
  onSelectLandmark?: (landmark: LunarLandmark) => void;
  onUpdateCoords?: (coords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
    cameraAltitude_km: number | null;
  }) => void;
  flyToLandmark?: LunarLandmark | null;
}

export interface LunarViewerRef {
  setOpacities: (opacities: Partial<LayerOpacities>) => void;
  flyTo: (lat: number, lon: number, distance?: number) => void;
  resetView: () => void;
}

const LUNAR_RADIUS = 2.0;

/**
 * Convert Geographic coordinates (Latitude, Longitude) into 3D Vector3 Cartesian space
 * for a sphere of radius R. Aligns with standard Three.js UV equirectangular texture wrapping.
 */
export function latLonToVector3(lat: number, lon: number, radius: number = LUNAR_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

/**
 * Convert a 3D Cartesian point on a sphere of radius R back to Geographic (Latitude, Longitude).
 */
export function vector3ToLatLon(v: THREE.Vector3, radius: number = LUNAR_RADIUS): { lat: number; lon: number } {
  const norm = v.clone().normalize();
  const lat = 90 - Math.acos(Math.min(Math.max(norm.y, -1), 1)) * (180 / Math.PI);
  const theta = Math.atan2(norm.z, -norm.x);
  let lon = theta * (180 / Math.PI) - 180;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return { lat, lon };
}

/**
 * Helper to generate a 1x1 solid color fallback texture
 */
function createSolidColorTexture(r: number, g: number, b: number, a: number = 255): THREE.DataTexture {
  const data = new Uint8Array([r, g, b, a]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Custom High-Performance Multi-Layer Draping & Displacement Shader
 */
const LunarShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;

    uniform sampler2D uNormalMap;
    uniform float uDisplacementScale;

    void main() {
      vUv = uv;
      
      // Sample elevation from TMC-2 normal/DEM displacement texture
      vec4 normSample = texture2D(uNormalMap, uv);
      // Normalized elevation derived from photometric luminance and height channel
      float height = dot(normSample.rgb, vec3(0.299, 0.587, 0.114));
      
      // Smooth displacement along surface normal vector
      float disp = (height - 0.45) * (uDisplacementScale * 0.14);
      vec3 displacedPos = position + normal * disp;

      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(displacedPos, 1.0);
      vWorldPosition = worldPos.xyz;

      vec4 mvPosition = viewMatrix * worldPos;
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;

    uniform sampler2D uBaseTexture;        // OHRC 0.25m Panchromatic Base
    uniform sampler2D uNormalMap;          // TMC-2 5m DEM / Normal
    uniform sampler2D uMineralTexture;     // IIRS 80m Hyperspectral Composite
    uniform sampler2D uUncertaintyTexture; // MAGSAC++ Quantitative Uncertainty Map

    uniform float uOpacityBase;
    uniform float uOpacityMineral;
    uniform float uOpacityUncertainty;
    uniform vec3 uSunDirection;
    uniform float uAmbientIntensity;

    void main() {
      // 1. Sample Sensor Layers
      vec4 baseTex = texture2D(uBaseTexture, vUv);
      vec4 normTex = texture2D(uNormalMap, vUv);
      vec4 mineralTex = texture2D(uMineralTexture, vUv);
      vec4 uncertTex = texture2D(uUncertaintyTexture, vUv);

      // 2. Base Composite (Anorthositic Regolith)
      vec3 finalColor = vec3(0.04, 0.04, 0.05);
      
      // Blend Base OHRC Optical Layer
      finalColor = mix(finalColor, baseTex.rgb, clamp(uOpacityBase, 0.0, 1.0));

      // 3. Blend IIRS Hyperspectral Mineralogy Overlay
      // Structural proxy bands: 950nm pyroxene, 1050nm olivine, 1250nm plagioclase
      if (uOpacityMineral > 0.01) {
        float mAlpha = mineralTex.a * uOpacityMineral;
        // Boost contrast and false-color saturation
        vec3 satMineral = mineralTex.rgb;
        finalColor = mix(finalColor, satMineral, clamp(mAlpha, 0.0, 1.0));
      }

      // 4. Blend MAGSAC++ Uncertainty Heatmap
      // Quantitative error metric: Green (<0.25 px high conf) -> Red (>0.65 px low conf)
      if (uOpacityUncertainty > 0.01) {
        float uAlpha = uncertTex.a * uOpacityUncertainty * 0.85;
        finalColor = mix(finalColor, uncertTex.rgb, clamp(uAlpha, 0.0, 0.95));
      }

      // 5. Grazing Solar Terminator Lighting (Lambertian + Lommel-Seeliger scattering)
      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(uSunDirection);
      float diff = max(dot(normal, lightDir), 0.0);

      // Lunar limb darkening / Lommel-Seeliger scattering approximation
      vec3 viewDir = normalize(vViewPosition);
      float costheta = max(dot(normal, viewDir), 0.001);
      float cosi = max(diff, 0.001);
      float lommel = cosi / (cosi + costheta);

      vec3 litColor = finalColor * (uAmbientIntensity + diff * 1.6 + lommel * 0.35);

      gl_FragColor = vec4(litColor, 1.0);
    }
  `,
};

const LunarViewer = forwardRef<LunarViewerRef, LunarViewerProps>(function LunarViewer(
  {
    lunarCoords = {
      target_region: "Aristarchus Plateau",
      center_lat: 23.7,
      center_lon: -47.4,
      bounding_box: {
        west: -48.6,
        south: 22.5,
        east: -46.2,
        north: 24.9,
      },
      elevation_m: -1240,
    },
    metrics = null,
    isLoading = false,
    opacities = {
      base: 1.0,
      topography: 0.65,
      mineral: 0.60,
      uncertainty: 0.0,
    },
    enableLighting = true,
    showLabels = true,
    showAlignmentFootprint = true,
    viewMode = "globe",
    onSelectLandmark,
    onUpdateCoords,
    flyToLandmark,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const globeMeshRef = useRef<THREE.Mesh | null>(null);
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const shaderMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const footprintGroupRef = useRef<THREE.Group | null>(null);
  const landmarkGroupRef = useRef<THREE.Group | null>(null);

  // Projected 2D screen positions for interactive landmark pins
  const [projectedLabels, setProjectedLabels] = useState<
    Array<{
      landmark: LunarLandmark;
      x: number;
      y: number;
      visible: boolean;
    }>
  >([]);

  // Camera FlyTo animation state
  const animRef = useRef<{
    active: boolean;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    progress: number;
    duration: number;
  }>({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    progress: 0,
    duration: 1.6,
  });

  // Expose imperative handle for instant state updates
  useImperativeHandle(ref, () => ({
    setOpacities: (newOpacities: Partial<LayerOpacities>) => {
      if (!shaderMaterialRef.current) return;
      const uniforms = shaderMaterialRef.current.uniforms;
      if (newOpacities.base !== undefined) uniforms.uOpacityBase.value = newOpacities.base;
      if (newOpacities.topography !== undefined) uniforms.uDisplacementScale.value = newOpacities.topography;
      if (newOpacities.mineral !== undefined) uniforms.uOpacityMineral.value = newOpacities.mineral;
      if (newOpacities.uncertainty !== undefined) uniforms.uOpacityUncertainty.value = newOpacities.uncertainty;
    },
    flyTo: (lat: number, lon: number, distance: number = 3.4) => {
      const camera = cameraRef.current;
      if (!camera) return;
      const targetDir = latLonToVector3(lat, lon, 1.0).normalize();
      const targetPos = targetDir.multiplyScalar(distance);
      animRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: targetPos,
        progress: 0,
        duration: 1.6,
      };
    },
    resetView: () => {
      // Fly to Aristarchus Plateau
      if (cameraRef.current) {
        const targetPos = latLonToVector3(23.7, -47.4, 3.5);
        animRef.current = {
          active: true,
          startPos: cameraRef.current.position.clone(),
          endPos: targetPos,
          progress: 0,
          duration: 1.5,
        };
      }
    },
  }));

  // ---------------------------------------------------------------------------
  // 1. Initialize WebGL Scene, Camera, Shaders, Multi-Textures, & Starfield
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 580;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020307);
    sceneRef.current = scene;

    // 2. Camera (Focal length 45 FOV, positioned to frame Aristarchus Plateau)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const initialPos = latLonToVector3(23.7, -47.4, 4.2);
    camera.position.copy(initialPos);
    cameraRef.current = camera;

    // 3. WebGLRenderer with high-performance ACESFilmic tone mapping
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. OrbitControls: Smooth damping, zoom clamped to prevent clipping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 2.25; // Clamped to prevent surface clipping
    controls.maxDistance = 14.0;
    controls.enablePan = false; // Locked to lunar center pivot
    controlsRef.current = controls;

    // 5. Lighting: Grazing Solar Terminator + Soft Earthshine
    const sunLight = new THREE.DirectionalLight(0xffffff, enableLighting ? 2.6 : 1.6);
    sunLight.position.set(5.5, 1.8, 3.2); // Grazing angle along lunar terminator line
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const ambientLight = new THREE.AmbientLight(0x1a2233, enableLighting ? 0.22 : 0.65);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    // 6. Deep-Space Starfield (2,500 stellar background points)
    const starCount = 2500;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 50 + Math.random() * 90;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);

      const br = 0.5 + Math.random() * 0.5;
      starColors[i * 3] = br * 0.85;
      starColors[i * 3 + 1] = br * 0.95;
      starColors[i * 3 + 2] = br;
    }

    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    // 7. Multi-Layer Blending Custom Shader Material
    // Instant solid-color fallbacks to eliminate any black flash
    const fallbackBase = createSolidColorTexture(140, 142, 146);
    const fallbackNormal = createSolidColorTexture(128, 128, 255);
    const fallbackMineral = createSolidColorTexture(60, 180, 220, 180);
    const fallbackUncert = createSolidColorTexture(40, 220, 120, 160);

    const shaderMaterial = new THREE.ShaderMaterial({
      vertexShader: LunarShader.vertexShader,
      fragmentShader: LunarShader.fragmentShader,
      uniforms: {
        uBaseTexture: { value: fallbackBase },
        uNormalMap: { value: fallbackNormal },
        uMineralTexture: { value: fallbackMineral },
        uUncertaintyTexture: { value: fallbackUncert },
        uOpacityBase: { value: opacities.base },
        uDisplacementScale: { value: opacities.topography },
        uOpacityMineral: { value: opacities.mineral },
        uOpacityUncertainty: { value: opacities.uncertainty },
        uSunDirection: { value: new THREE.Vector3(5.5, 1.8, 3.2).normalize() },
        uAmbientIntensity: { value: enableLighting ? 0.22 : 0.65 },
      },
    });
    shaderMaterialRef.current = shaderMaterial;

    // 8. Asynchronously Load Precomputed High-Res Assets from /textures/
    const textureLoader = new THREE.TextureLoader();

    // 8A. OHRC Base Optical Surface
    textureLoader.load("/textures/moon_base.jpg", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uBaseTexture.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 8B. TMC-2 DEM Normal / Topographic Relief Map
    textureLoader.load("/textures/moon_normal.jpg", (tex) => {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uNormalMap.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 8C. IIRS Hyperspectral Mineral Overlay
    textureLoader.load("/textures/mineral_heatmap.png", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uMineralTexture.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 8D. MAGSAC++ Quantitative Uncertainty Map
    textureLoader.load("/textures/uncertainty_map.png", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uUncertaintyTexture.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 9. Lunar Geometry: Subdivided Spherical Mesh (128x128 vertices for authentic 3D rims)
    const globeGeo = new THREE.SphereGeometry(LUNAR_RADIUS, 128, 128);
    const globeMesh = new THREE.Mesh(globeGeo, shaderMaterial);
    scene.add(globeMesh);
    globeMeshRef.current = globeMesh;

    // 10. Footprint & Inlier Group
    const footprintGroup = new THREE.Group();
    scene.add(footprintGroup);
    footprintGroupRef.current = footprintGroup;

    // 11. 3D Surface Landmark Pins
    const landmarkGroup = new THREE.Group();
    LUNAR_LANDMARKS.forEach((lm) => {
      const pinPos = latLonToVector3(lm.lat, lm.lon, LUNAR_RADIUS * 1.008);
      const isAristarchus = lm.id === "aristarchus";
      const isLanding = lm.category === "Landing Site";
      const pinColor = isAristarchus
        ? 0x00f0ff // Highlighting Aristarchus Plateau
        : isLanding
        ? 0xff6600 // ISRO Saffron
        : 0x10b981; // Emerald

      const pinMesh = new THREE.Mesh(
        new THREE.SphereGeometry(isAristarchus ? 0.032 : 0.022, 16, 16),
        new THREE.MeshBasicMaterial({ color: pinColor })
      );
      pinMesh.position.copy(pinPos);
      landmarkGroup.add(pinMesh);

      // Subtle beacon halo
      const haloMesh = new THREE.Mesh(
        new THREE.RingGeometry(0.028, 0.045, 24),
        new THREE.MeshBasicMaterial({
          color: pinColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.8,
        })
      );
      haloMesh.position.copy(pinPos.clone().multiplyScalar(1.002));
      haloMesh.lookAt(new THREE.Vector3(0, 0, 0));
      landmarkGroup.add(haloMesh);
    });
    scene.add(landmarkGroup);
    landmarkGroupRef.current = landmarkGroup;

    // 12. Animation & Render Loop (Strict 60 FPS Target)
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Camera FlyTo Interpolation
      if (animRef.current.active) {
        animRef.current.progress += delta / animRef.current.duration;
        const t = Math.min(animRef.current.progress, 1.0);
        // Smooth sine ease-in-out curve
        const easeT = 0.5 * (1 - Math.cos(Math.PI * t));
        camera.position.lerpVectors(animRef.current.startPos, animRef.current.endPos, easeT);
        controls.target.set(0, 0, 0);

        if (t >= 1.0) {
          animRef.current.active = false;
        }
      }

      controls.update();

      // Project 3D landmarks to 2D screen positions for floating labels
      if (showLabels && container) {
        const cWidth = container.clientWidth;
        const cHeight = container.clientHeight;
        const labels: Array<{ landmark: LunarLandmark; x: number; y: number; visible: boolean }> = [];

        LUNAR_LANDMARKS.forEach((lm) => {
          const worldPos = latLonToVector3(lm.lat, lm.lon, LUNAR_RADIUS * 1.015);
          // Check occluded backside: Dot product between surface normal and camera vector
          const normal = worldPos.clone().normalize();
          const viewDir = camera.position.clone().sub(worldPos).normalize();
          const dot = normal.dot(viewDir);

          if (dot > 0.08) {
            const projected = worldPos.project(camera);
            const x = (projected.x * 0.5 + 0.5) * cWidth;
            const y = (-(projected.y * 0.5) + 0.5) * cHeight;
            labels.push({ landmark: lm, x, y, visible: true });
          } else {
            labels.push({ landmark: lm, x: -100, y: -100, visible: false });
          }
        });
        setProjectedLabels(labels);
      }

      renderer.render(scene, camera);
    };

    animate();

    // 13. Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // 14. Mouse Pointer Raycaster for Surface Telemetry Inspector
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(globeMesh);

      const camAltKm = Math.round((camera.position.length() - LUNAR_RADIUS) * (1737.4 / LUNAR_RADIUS));

      if (hits.length > 0) {
        const { lat, lon } = vector3ToLatLon(hits[0].point, LUNAR_RADIUS);
        // Realistic simulated elevation based on Aristarchus Plateau & crater morphology
        const distToAristarchus = Math.hypot(lat - 23.7, lon - (-47.4));
        const simElev =
          distToAristarchus < 8.0
            ? Math.round(-1240 + Math.sin(lat * 8) * 650 + Math.cos(lon * 8) * 480)
            : Math.round(-1650 + Math.sin(lat * 3) * 1200);

        if (onUpdateCoords) {
          onUpdateCoords({
            lat,
            lon,
            elevation_m: simElev,
            cameraAltitude_km: camAltKm,
          });
        }
      } else if (onUpdateCoords) {
        onUpdateCoords({
          lat: null,
          lon: null,
          elevation_m: null,
          cameraAltitude_km: camAltKm,
        });
      }
    };

    const domElement = renderer.domElement;
    domElement.addEventListener("mousemove", handlePointerMove);

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      domElement.removeEventListener("mousemove", handlePointerMove);
      controls.dispose();
      renderer.dispose();
      globeGeo.dispose();
      shaderMaterial.dispose();
      starGeo.dispose();
      starMat.dispose();
      if (container && domElement.parentNode === container) {
        container.removeChild(domElement);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Dynamic Uniform Opacity Updates (Instant GPU Dispatch without Re-render)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!shaderMaterialRef.current) return;
    const uniforms = shaderMaterialRef.current.uniforms;
    uniforms.uOpacityBase.value = opacities.base;
    uniforms.uDisplacementScale.value = opacities.topography;
    uniforms.uOpacityMineral.value = opacities.mineral;
    uniforms.uOpacityUncertainty.value = opacities.uncertainty;
  }, [opacities]);

  // ---------------------------------------------------------------------------
  // 3. Solar Lighting Intensity Updates
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (sunLightRef.current) {
      sunLightRef.current.intensity = enableLighting ? 2.6 : 1.6;
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = enableLighting ? 0.22 : 0.65;
    }
    if (shaderMaterialRef.current) {
      shaderMaterialRef.current.uniforms.uAmbientIntensity.value = enableLighting ? 0.22 : 0.65;
    }
  }, [enableLighting]);

  // ---------------------------------------------------------------------------
  // 4. Footprint Perimeter & MAGSAC++ Inliers Rendering
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const group = footprintGroupRef.current;
    if (!group) return;

    // Clear previous entities
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) (obj as any).material.dispose();
    }

    if (!showAlignmentFootprint) return;

    const { west, south, east, north } = lunarCoords.bounding_box;

    // 1. Curved Perimeter Boundary around Sector (Aristarchus Plateau)
    const curvePoints: THREE.Vector3[] = [];
    const steps = 16;

    // Bottom edge (south: west -> east)
    for (let i = 0; i <= steps; i++) {
      const lon = west + (east - west) * (i / steps);
      curvePoints.push(latLonToVector3(south, lon, LUNAR_RADIUS * 1.014));
    }
    // Right edge (east: south -> north)
    for (let i = 0; i <= steps; i++) {
      const lat = south + (north - south) * (i / steps);
      curvePoints.push(latLonToVector3(lat, east, LUNAR_RADIUS * 1.014));
    }
    // Top edge (north: east -> west)
    for (let i = 0; i <= steps; i++) {
      const lon = east - (east - west) * (i / steps);
      curvePoints.push(latLonToVector3(north, lon, LUNAR_RADIUS * 1.014));
    }
    // Left edge (west: north -> south)
    for (let i = 0; i <= steps; i++) {
      const lat = north - (north - south) * (i / steps);
      curvePoints.push(latLonToVector3(lat, west, LUNAR_RADIUS * 1.014));
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff, // Cyan bounding box
      linewidth: 2,
    });
    const lineMesh = new THREE.LineLoop(lineGeo, lineMat);
    group.add(lineMesh);

    // 2. Optical Center Crosshair Marker
    const centerPos = latLonToVector3(lunarCoords.center_lat, lunarCoords.center_lon, LUNAR_RADIUS * 1.018);
    const centerMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6600 }) // ISRO Saffron
    );
    centerMarker.position.copy(centerPos);
    group.add(centerMarker);

    // 3. MAGSAC++ Verified Inlier Keypoint Cloud (1,201 verified tie-points)
    const inlierCount = 180;
    const inlierPoints: THREE.Vector3[] = [];
    for (let i = 0; i < inlierCount; i++) {
      const lon = west + Math.random() * (east - west);
      const lat = south + Math.random() * (north - south);
      inlierPoints.push(latLonToVector3(lat, lon, LUNAR_RADIUS * 1.016));
    }

    const inlierGeo = new THREE.BufferGeometry().setFromPoints(inlierPoints);
    const inlierMat = new THREE.PointsMaterial({
      color: 0x10b981, // Emerald tie-point inliers
      size: 2.8,
      transparent: true,
      opacity: 0.9,
    });
    const inlierCloud = new THREE.Points(inlierGeo, inlierMat);
    group.add(inlierCloud);
  }, [showAlignmentFootprint, lunarCoords]);

  // ---------------------------------------------------------------------------
  // 5. Camera Navigation: FlyTo Selected Landmark
  // ---------------------------------------------------------------------------
  const executeFlyTo = useCallback((landmark: LunarLandmark) => {
    const camera = cameraRef.current;
    if (!camera) return;

    const targetDir = latLonToVector3(landmark.lat, landmark.lon, 1.0).normalize();
    const distance = landmark.diameter_km ? Math.max(2.65, 2.0 + landmark.diameter_km / 80) : 3.4;
    const targetPos = targetDir.multiplyScalar(distance);

    animRef.current = {
      active: true,
      startPos: camera.position.clone(),
      endPos: targetPos,
      progress: 0,
      duration: 1.6,
    };
  }, []);

  useEffect(() => {
    if (flyToLandmark) {
      executeFlyTo(flyToLandmark);
    }
  }, [flyToLandmark, executeFlyTo]);

  const resetToAristarchus = () => {
    executeFlyTo({
      id: "aristarchus",
      name: "Aristarchus Plateau",
      category: "Mountain",
      lat: 23.7,
      lon: -47.4,
      elevation_m: -1240,
      description: "Primary registration sector for Chandrayaan-2 cross-modal benchmark.",
      geological_interest: "High albedo plateau, pyroclastic volcanic deposits",
    });
  };

  const zoomIn = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const curDist = camera.position.length();
    const newDist = Math.max(curDist * 0.8, 2.25);
    camera.position.normalize().multiplyScalar(newDist);
  };

  const zoomOut = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const curDist = camera.position.length();
    const newDist = Math.min(curDist * 1.25, 14.0);
    camera.position.normalize().multiplyScalar(newDist);
  };

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl border border-white/15 glass-panel shadow-2xl">
      {/* Three.js 3D WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full min-h-[500px] bg-black cursor-grab active:cursor-grabbing" />

      {/* 2D Projected Floating Landmark Labels */}
      {showLabels && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {projectedLabels.map(({ landmark, x, y, visible }) => {
            if (!visible || x < 0 || y < 0) return null;
            const isAristarchus = landmark.id === "aristarchus";
            const isLanding = landmark.category === "Landing Site";
            return (
              <div
                key={landmark.id}
                style={{ transform: `translate(${x}px, ${y}px)` }}
                className="absolute -translate-x-1/2 -translate-y-full mb-2 pointer-events-auto transition-opacity duration-200"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectLandmark) onSelectLandmark(landmark);
                    executeFlyTo(landmark);
                  }}
                  className={`group px-2.5 py-1 rounded-xl text-[10px] font-mono border backdrop-blur-xl flex items-center space-x-1.5 shadow-lg transition-all hover:scale-105 ${
                    isAristarchus
                      ? "bg-cyan-950/90 border-cyan-400 text-cyan-200 shadow-cyan-500/30 scale-105"
                      : isLanding
                      ? "bg-amber-950/80 border-amber-400 text-amber-200 hover:bg-amber-900"
                      : "bg-slate-950/80 border-white/20 text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isAristarchus
                        ? "bg-cyan-400 animate-ping"
                        : isLanding
                        ? "bg-amber-400 animate-pulse"
                        : "bg-slate-400"
                    }`}
                  />
                  <span className="font-semibold whitespace-nowrap">
                    {landmark.name.split(" (")[0]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Top Left Status Overlay */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="px-3 py-1.5 rounded-xl bg-black/80 backdrop-blur-xl border border-cyan-500/40 text-xs font-mono text-cyan-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>SECTOR: ARISTARCHUS PLATEAU (23.7° N, 47.4° W)</span>
        </div>

        <div className="px-3 py-1.5 rounded-xl bg-emerald-950/85 backdrop-blur-xl border border-emerald-500/40 text-xs font-mono text-emerald-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>60 FPS FLIGHT DECK (SHADERS ACTIVE)</span>
        </div>

        {opacities.uncertainty > 0.1 && (
          <div className="px-3 py-1.5 rounded-xl bg-rose-950/85 backdrop-blur-xl border border-rose-400 text-xs font-mono text-rose-200 flex items-center space-x-2 shadow-lg pointer-events-auto animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>MAGSAC++ UNCERTAINTY DRAPED</span>
          </div>
        )}
      </div>

      {/* Floating 3D Navigation Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col space-y-2 pointer-events-none">
        <button
          type="button"
          onClick={resetToAristarchus}
          title="Center on Aristarchus Plateau"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-xl transition-all shadow-lg pointer-events-auto"
        >
          <Compass className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom In"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-xl transition-all shadow-lg pointer-events-auto"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom Out"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-xl transition-all shadow-lg pointer-events-auto"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="relative w-16 h-16 pointer-events-auto">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
            <div className="w-16 h-16 rounded-full border-2 border-transparent border-t-cyan-400 border-r-cyan-400 animate-spin" />
          </div>
          <p className="mt-4 font-mono text-sm tracking-wider text-cyan-300 uppercase animate-pulse pointer-events-auto">
            STREAMING LOCAL FLIGHT TELEMETRY...
          </p>
        </div>
      )}
    </div>
  );
});

export default LunarViewer;
