"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Compass,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Mountain,
} from "lucide-react";

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
  onSelectLandmark?: (landmark: any) => void;
  onUpdateCoords?: (coords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
    cameraAltitude_km: number | null;
  }) => void;
  flyToLandmark?: any | null;
}

export interface LunarViewerRef {
  setOpacities: (opacities: Partial<LayerOpacities>) => void;
  flyTo: (lat?: number, lon?: number, distance?: number) => void;
  resetView: () => void;
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
 * - High-Res Subdivided Plane Terrain Geometry
 * - 0.85 Multiplier on Vertex Displacement for Deep Crater Rims and Peaks
 * - High-Contrast Grayscale Panchromatic Base (OHRC 0.25m)
 * - Harsh Neon Orange / Cyan / Lime False-Color Hyperspectral Mapping (IIRS 80m)
 * - Aggressive Translucent Crimson Red / Emerald Green Heatmap (MAGSAC++ Uncertainty)
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
      
      // Sample elevation from TMC-2 DEM displacement map
      vec4 normSample = texture2D(uNormalMap, uv);
      float height = dot(normSample.rgb, vec3(0.299, 0.587, 0.114));
      
      // Deep crater rims on the flat plane (0.85 displacement multiplier)
      float disp = (height - 0.45) * (uDisplacementScale * 0.85);
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

      // 2. Base OHRC Optical Layer: High-Contrast Sharp Grayscale Panchromatic
      float luma = dot(baseTex.rgb, vec3(0.299, 0.587, 0.114));
      float sharpLuma = smoothstep(0.08, 0.84, luma);
      sharpLuma = pow(sharpLuma, 1.15);
      vec3 ohrcPan = vec3(sharpLuma * 1.15);

      vec3 finalColor = vec3(0.02, 0.02, 0.02);
      finalColor = mix(finalColor, ohrcPan, clamp(uOpacityBase, 0.0, 1.0));

      // 3. IIRS Mineral: Harsh, Vibrant False-Color Mapping (Cyan/Orange Neon Overriding Base)
      // Structural proxy bands: 950nm pyroxene (Neon Orange), 1050nm olivine (Neon Lime), 1250nm plagioclase/ice (Electric Cyan)
      if (uOpacityMineral > 0.01) {
        vec3 neonPyroxene = vec3(1.0, 0.32, 0.0) * (mineralTex.r * 2.4 + 0.20);
        vec3 neonOlivine = vec3(0.20, 1.0, 0.05) * (mineralTex.g * 2.2 + 0.15);
        vec3 neonPlagioclase = vec3(0.0, 0.88, 1.0) * (mineralTex.b * 2.8 + 0.25);

        vec3 explosiveMineral = neonPyroxene * (mineralTex.r + 0.2) +
                                neonOlivine * (mineralTex.g + 0.15) +
                                neonPlagioclase * (mineralTex.b + 0.25);

        explosiveMineral = clamp(explosiveMineral * 1.45, 0.0, 1.0);
        float mineralFactor = clamp(uOpacityMineral * 1.35, 0.0, 1.0);
        finalColor = mix(finalColor, explosiveMineral, mineralFactor);
      }

      // 4. MAGSAC++ Uncertainty: Aggressive Translucent Red / Green Overlay
      // Electric Emerald (< 0.25 px high conf) vs Blazing Crimson Red (> 0.65 px uncertainty)
      if (uOpacityUncertainty > 0.01) {
        vec3 aggressiveOverlay;
        float uVal = uncertTex.r;
        float gVal = uncertTex.g;

        if (uVal > gVal * 0.85 || uVal > 0.35) {
          aggressiveOverlay = vec3(1.0, 0.02, 0.12) * (1.2 + uVal * 0.8);
        } else {
          aggressiveOverlay = vec3(0.0, 1.0, 0.35) * (1.1 + gVal * 0.6);
        }

        aggressiveOverlay = clamp(aggressiveOverlay, 0.0, 1.0);
        float overlayAlpha = clamp(uOpacityUncertainty * 0.85, 0.0, 0.92);
        finalColor = mix(finalColor, aggressiveOverlay, overlayAlpha);
      }

      // 5. Grazing Solar Terminator Lighting with Deep High-Relief Shadows
      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(uSunDirection);
      float rawDiff = dot(normal, lightDir);
      float diff = smoothstep(-0.05, 0.65, rawDiff);

      vec3 viewDir = normalize(vViewPosition);
      float costheta = max(dot(normal, viewDir), 0.001);
      float cosi = max(max(rawDiff, 0.0), 0.001);
      float lommel = cosi / (cosi + costheta);

      vec3 litColor = finalColor * (uAmbientIntensity + diff * 1.85 + lommel * 0.40);

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
    viewMode = "terrain",
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
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const shaderMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);

  // Isometric default camera angle
  const defaultCamPos = useRef(new THREE.Vector3(0, 2.5, 3.5));

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
    endPos: new THREE.Vector3(0, 2.5, 3.5),
    progress: 0,
    duration: 1.2,
  });

  // Expose imperative handle for parent component
  useImperativeHandle(ref, () => ({
    setOpacities: (newOpacities: Partial<LayerOpacities>) => {
      if (!shaderMaterialRef.current) return;
      const uniforms = shaderMaterialRef.current.uniforms;
      if (newOpacities.base !== undefined) uniforms.uOpacityBase.value = newOpacities.base;
      if (newOpacities.topography !== undefined) uniforms.uDisplacementScale.value = newOpacities.topography;
      if (newOpacities.mineral !== undefined) uniforms.uOpacityMineral.value = newOpacities.mineral;
      if (newOpacities.uncertainty !== undefined) uniforms.uOpacityUncertainty.value = newOpacities.uncertainty;
    },
    flyTo: (_lat?: number, _lon?: number, _distance?: number) => {
      const camera = cameraRef.current;
      if (!camera) return;
      animRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: defaultCamPos.current.clone(),
        progress: 0,
        duration: 1.2,
      };
    },
    resetView: () => {
      const camera = cameraRef.current;
      if (!camera) return;
      animRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: defaultCamPos.current.clone(),
        progress: 0,
        duration: 1.2,
      };
    },
  }));

  // ---------------------------------------------------------------------------
  // 1. Initialize WebGL Scene, Camera, 3D Plane Geometry, Shaders, & Controls
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

    // 2. Camera (Angled isometric view looking down at 3D surface plane)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.copy(defaultCamPos.current);
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
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. OrbitControls: Panning allowed, clamped zoom
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 0.5;
    controls.maxDistance = 10.0;
    controls.target.set(0, 0, 0);
    controls.enablePan = true;
    controlsRef.current = controls;

    // 5. Lighting: Grazing Solar Terminator + Soft Earthshine
    const sunLight = new THREE.DirectionalLight(0xffffff, enableLighting ? 2.8 : 1.6);
    sunLight.position.set(4.0, 3.5, 3.0);
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const ambientLight = new THREE.AmbientLight(0x1a2233, enableLighting ? 0.20 : 0.65);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    // 6. Deep-Space Starfield (2,000 background points)
    const starCount = 2000;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 40 + Math.random() * 60;
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
      opacity: 0.75,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    // 7. Multi-Layer Blending Custom Shader Material with DoubleSide Backface Culling Prevention
    const fallbackBase = createSolidColorTexture(140, 142, 146);
    const fallbackNormal = createSolidColorTexture(128, 128, 255);
    const fallbackMineral = createSolidColorTexture(60, 180, 220, 180);
    const fallbackUncert = createSolidColorTexture(40, 220, 120, 160);

    const shaderMaterial = new THREE.ShaderMaterial({
      vertexShader: LunarShader.vertexShader,
      fragmentShader: LunarShader.fragmentShader,
      side: THREE.DoubleSide,
      uniforms: {
        uBaseTexture: { value: fallbackBase },
        uNormalMap: { value: fallbackNormal },
        uMineralTexture: { value: fallbackMineral },
        uUncertaintyTexture: { value: fallbackUncert },
        uOpacityBase: { value: opacities.base },
        uDisplacementScale: { value: opacities.topography },
        uOpacityMineral: { value: opacities.mineral },
        uOpacityUncertainty: { value: opacities.uncertainty },
        uSunDirection: { value: new THREE.Vector3(4.0, 3.5, 3.0).normalize() },
        uAmbientIntensity: { value: enableLighting ? 0.20 : 0.65 },
      },
    });
    shaderMaterialRef.current = shaderMaterial;

    // 8. Load Precomputed High-Res Assets with ClampToEdgeWrapping
    const textureLoader = new THREE.TextureLoader();

    // 8A. OHRC Base Optical Surface
    textureLoader.load("/textures/moon_base.jpg", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uBaseTexture.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 8B. TMC-2 DEM Normal / Topographic Relief Map
    textureLoader.load("/textures/moon_normal.jpg", (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
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
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
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
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (shaderMaterialRef.current) {
        shaderMaterialRef.current.uniforms.uUncertaintyTexture.value = tex;
        shaderMaterialRef.current.needsUpdate = true;
      }
    });

    // 9. Highly Subdivided 3D Terrain Plane (4x4 units, 512x512 segments)
    const terrainGeo = new THREE.PlaneGeometry(4, 4, 512, 512);
    terrainGeo.rotateX(-Math.PI / 2); // Lay plane flat in XZ space
    const terrainMesh = new THREE.Mesh(terrainGeo, shaderMaterial);
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    // 10. Animation & Render Loop (Strict 60 FPS Target)
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
        const easeT = 0.5 * (1 - Math.cos(Math.PI * t));
        camera.position.lerpVectors(animRef.current.startPos, animRef.current.endPos, easeT);
        controls.target.set(0, 0, 0);

        if (t >= 1.0) {
          animRef.current.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    // 11. Resize Observer
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

    // 12. Local Raycaster Coordinate Mapping: Maps Plane [-2, 2] X/Z to Sector Bounding Box
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(terrainMesh);

      const camAltKm = Math.round(camera.position.distanceTo(controls.target) * 25);

      if (hits.length > 0) {
        const hitPt = hits[0].point;
        // Plane is width=4 (-2 to +2), height=4 (-2 to +2)
        // hitPt.x: -2 (West) to +2 (East)
        // hitPt.z: -2 (North) to +2 (South)
        const u = THREE.MathUtils.clamp((hitPt.x + 2.0) / 4.0, 0.0, 1.0);
        const v = THREE.MathUtils.clamp((hitPt.z + 2.0) / 4.0, 0.0, 1.0);

        const bb = lunarCoords.bounding_box;
        const lon = bb.west + (bb.east - bb.west) * u;
        const lat = bb.north - (bb.north - bb.south) * v;

        // Elevation simulated from displacement Y relief
        const elev = Math.round((lunarCoords.elevation_m || -1240) + hitPt.y * 1400);

        if (onUpdateCoords) {
          onUpdateCoords({
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4)),
            elevation_m: elev,
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

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      domElement.removeEventListener("mousemove", handlePointerMove);
      controls.dispose();
      renderer.dispose();
      terrainGeo.dispose();
      shaderMaterial.dispose();
      starGeo.dispose();
      starMat.dispose();
      if (container && domElement.parentNode === container) {
        container.removeChild(domElement);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Dynamic Uniform Opacity Updates
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
      sunLightRef.current.intensity = enableLighting ? 2.8 : 1.6;
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = enableLighting ? 0.20 : 0.65;
    }
    if (shaderMaterialRef.current) {
      shaderMaterialRef.current.uniforms.uAmbientIntensity.value = enableLighting ? 0.20 : 0.65;
    }
  }, [enableLighting]);

  // ---------------------------------------------------------------------------
  // 4. Reset & Navigation Handlers
  // ---------------------------------------------------------------------------
  const resetToIsometricView = () => {
    const camera = cameraRef.current;
    if (!camera) return;
    animRef.current = {
      active: true,
      startPos: camera.position.clone(),
      endPos: defaultCamPos.current.clone(),
      progress: 0,
      duration: 1.2,
    };
  };

  const zoomIn = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const curDist = camera.position.distanceTo(controls.target);
    const newDist = Math.max(curDist * 0.75, 0.5);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(newDist)));
  };

  const zoomOut = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const curDist = camera.position.distanceTo(controls.target);
    const newDist = Math.min(curDist * 1.3, 10.0);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target.clone().add(dir.multiplyScalar(newDist)));
  };

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl border border-white/15 glass-panel shadow-2xl">
      <div ref={containerRef} className="w-full h-full min-h-[500px] bg-black cursor-grab active:cursor-grabbing" />

      {/* Top Left Status Overlay */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="px-3 py-1.5 rounded-xl bg-black/80 backdrop-blur-xl border border-cyan-500/40 text-xs font-mono text-cyan-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <Mountain className="w-3.5 h-3.5 text-cyan-400" />
          <span>3D SURFACE TERRAIN INSPECTOR (5 km² ARISTARCHUS PATCH)</span>
        </div>

        <div className="px-3 py-1.5 rounded-xl bg-emerald-950/85 backdrop-blur-xl border border-emerald-500/40 text-xs font-mono text-emerald-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>512×512 HIGH-RES PLANE MESH (ZERO STRETCH)</span>
        </div>

        {opacities.uncertainty > 0.1 && (
          <div className="px-3 py-1.5 rounded-xl bg-rose-950/85 backdrop-blur-xl border border-rose-400 text-xs font-mono text-rose-200 flex items-center space-x-2 shadow-lg pointer-events-auto animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>MAGSAC++ UNCERTAINTY ACTIVE</span>
          </div>
        )}
      </div>

      {/* Floating 3D Navigation Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col space-y-2 pointer-events-none">
        <button
          type="button"
          onClick={resetToIsometricView}
          title="Reset to Angled Isometric Terrain View"
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
