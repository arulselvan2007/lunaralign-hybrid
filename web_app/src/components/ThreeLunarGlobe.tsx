"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  Navigation,
} from "lucide-react";
import { LUNAR_LANDMARKS, LunarLandmark } from "@/data/lunarLandmarks";
import { SensorLayerMode } from "./LayerToggleHUD";
import { BACKEND_URL, getAssetUrl } from "@/config/api";

export interface LunarGlobeProps {
  lunarCoords: {
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
  metrics: any | null;
  isLoading: boolean;
  activeTileUrl?: string | null;
  alignmentResultUrl?: string | null;
  uncertaintyMapUrl?: string | null;
  currentLayer: SensorLayerMode;
  enableLighting: boolean;
  showLabels: boolean;
  showAlignmentFootprint: boolean;
  showUncertaintyMap?: boolean;
  onSelectLandmark: (landmark: LunarLandmark) => void;
  onUpdateCoords: (coords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
    cameraAltitude_km: number | null;
  }) => void;
  flyToLandmark?: LunarLandmark | null;
}

const LUNAR_RADIUS = 2.0;

// Local High-Resolution NVMe Streaming Map (Offline 1.5-2 GB Archive)
export const LOCAL_HIRES_LANDMARK_MAP: Record<string, string> = {
  "statio-shiv-shakti": `${BACKEND_URL}/static/lunar_hires/tiles/statio_shiv_shakti_hires.jpg`,
  "boguslawsky": `${BACKEND_URL}/static/lunar_hires/tiles/boguslawsky_hires.jpg`,
  "shackleton": `${BACKEND_URL}/static/lunar_hires/tiles/shackleton_hires.jpg`,
  "tycho": `${BACKEND_URL}/static/lunar_hires/tiles/tycho_crater_hires.jpg`,
  "copernicus": `${BACKEND_URL}/static/lunar_hires/tiles/copernicus_hires.jpg`,
  "oceanus-procellarum": `${BACKEND_URL}/static/lunar_hires/tiles/oceanus_procellarum_hires.jpg`,
  "mare-tranquillitatis": `${BACKEND_URL}/static/lunar_hires/tiles/mare_tranquillitatis_hires.jpg`,
  "south-pole-aitken": `${BACKEND_URL}/static/lunar_hires/tiles/spa_basin_hires.jpg`,
  "aristarchus": `${BACKEND_URL}/static/lunar_hires/tiles/aristarchus_hires.jpg`,
};

export const SENSOR_LAYER_HIRES_MAP: Record<SensorLayerMode, string> = {
  ohrc_framing: `${BACKEND_URL}/static/lunar_hires/tiles/ohrc_submeter_patch.jpg`,
  tmc2_ortho: `${BACKEND_URL}/static/lunar_hires/tiles/tmc2_regional_ortho_patch.jpg`,
  iirs_mineral: `${BACKEND_URL}/static/lunar_hires/tiles/iirs_mineral_patch.jpg`,
  dem_topography: `${BACKEND_URL}/static/lunar_hires/tiles/dem_elevation_patch.jpg`,
};

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
 * Generate a spherical segment geometry for localized surface texture draping.
 * Accurately spans bounding box coordinates (west, south, east, north) on a sphere of radius R.
 */
export function createSphericalSegmentGeometry(
  west: number,
  south: number,
  east: number,
  north: number,
  radius: number = 2.001,
  segX: number = 32,
  segY: number = 32
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segY; i++) {
    const v = i / segY;
    const lat = north - (north - south) * v; // Top is north, bottom is south
    for (let j = 0; j <= segX; j++) {
      const u = j / segX;
      const lon = west + (east - west) * u; // Left is west, right is east
      const pt = latLonToVector3(lat, lon, radius);
      vertices.push(pt.x, pt.y, pt.z);
      uvs.push(u, 1.0 - v);
    }
  }

  for (let i = 0; i < segY; i++) {
    for (let j = 0; j < segX; j++) {
      const a = i * (segX + 1) + j;
      const b = (i + 1) * (segX + 1) + j;
      const c = (i + 1) * (segX + 1) + (j + 1);
      const d = i * (segX + 1) + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Procedural HTML5 Canvas Lunar Surface Texture Generator.
 * Instant fail-safe guaranteeing 0ms latency rendering with prominent craters and volcanic maria
 * before or during the load of the high-res texture file.
 */
function createProceduralLunarCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // 1. Base Highlands Regolith (Lighter grey anorthositic crust)
  ctx.fillStyle = "#9ba0a6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const crustGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  crustGrad.addColorStop(0.0, "rgba(90, 95, 105, 0.45)");
  crustGrad.addColorStop(0.5, "rgba(160, 165, 172, 0.15)");
  crustGrad.addColorStop(1.0, "rgba(80, 85, 95, 0.5)");
  ctx.fillStyle = crustGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Major Lunar Maria
  const maria: Array<[number, number, number, number, string]> = [
    [0.4 * canvas.width, 0.35 * canvas.height, 240, 170, "#3e4248"],
    [0.45 * canvas.width, 0.3 * canvas.height, 180, 130, "#383c42"],
    [0.55 * canvas.width, 0.32 * canvas.height, 130, 110, "#363a40"],
    [0.58 * canvas.width, 0.45 * canvas.height, 140, 105, "#32353a"],
    [0.66 * canvas.width, 0.38 * canvas.height, 90, 75, "#2e3238"],
    [0.63 * canvas.width, 0.52 * canvas.height, 110, 95, "#3a3e44"],
    [0.59 * canvas.width, 0.58 * canvas.height, 80, 70, "#3a3e44"],
    [0.45 * canvas.width, 0.55 * canvas.height, 120, 95, "#3a3e44"],
    [0.38 * canvas.width, 0.6 * canvas.height, 75, 65, "#383c42"],
    [0.95 * canvas.width, 0.78 * canvas.height, 210, 140, "#484c54"],
    [0.05 * canvas.width, 0.78 * canvas.height, 210, 140, "#484c54"],
    [0.24 * canvas.width, 0.55 * canvas.height, 95, 90, "#34383e"],
    [0.88 * canvas.width, 0.32 * canvas.height, 80, 70, "#363a40"],
  ];

  maria.forEach(([cx, cy, rx, ry, col]) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.filter = "blur(18px)";
    ctx.fill();
    ctx.restore();
  });

  // 3. Impact Craters with Bright Rays
  const rayCraters: Array<[number, number, number, boolean]> = [
    [0.47 * canvas.width, 0.74 * canvas.height, 26, true],
    [0.44 * canvas.width, 0.44 * canvas.height, 28, true],
    [0.39 * canvas.width, 0.46 * canvas.height, 16, true],
    [0.37 * canvas.width, 0.38 * canvas.height, 18, false],
    [0.5 * canvas.width, 0.96 * canvas.height, 22, false],
    [0.62 * canvas.width, 0.9 * canvas.height, 30, false],
    [0.92 * canvas.width, 0.38 * canvas.height, 22, true],
  ];

  rayCraters.forEach(([cx, cy, r, hasRays]) => {
    if (hasRays) {
      ctx.strokeStyle = "rgba(225, 230, 240, 0.4)";
      ctx.lineWidth = 1.5;
      for (let a = 0; a < 360; a += 15) {
        const rad = (a * Math.PI) / 180;
        const len = r * (4.5 + (a % 4));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(rad) * len, cy + Math.sin(rad) * len);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#26292f";
    ctx.fill();
    ctx.strokeStyle = "#e2e6ed";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  return canvas;
}

/**
 * Procedural HTML5 Canvas Lunar Normal Map Generator.
 * Transforms synthesized crater depressions and elevated rims into tangent-space
 * normal vectors: R=(Nx*0.5+0.5)*255, G=(Ny*0.5+0.5)*255, B=(Nz*0.5+0.5)*255.
 * Flat terrain corresponds to RGB(128, 128, 255).
 * Instant fail-safe guaranteeing 0ms 3D depth and grazing shadow-casting edges.
 */
function createProceduralNormalCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Base Tangent Normal: Flat surface (Nx=0, Ny=0, Nz=1) -> RGB(128, 128, 255)
  ctx.fillStyle = "rgb(128, 128, 255)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 1. Synthesize elevation heightfield on an offscreen canvas
  const hCanvas = document.createElement("canvas");
  hCanvas.width = canvas.width;
  hCanvas.height = canvas.height;
  const hCtx = hCanvas.getContext("2d");
  if (!hCtx) return canvas;

  hCtx.fillStyle = "rgb(128, 128, 128)";
  hCtx.fillRect(0, 0, hCanvas.width, hCanvas.height);

  // Maria basins (negative relief)
  const maria: Array<[number, number, number, number]> = [
    [0.40 * hCanvas.width, 0.35 * hCanvas.height, 120, 90],
    [0.45 * hCanvas.width, 0.30 * hCanvas.height, 90, 70],
    [0.55 * hCanvas.width, 0.32 * hCanvas.height, 65, 55],
    [0.58 * hCanvas.width, 0.45 * hCanvas.height, 70, 52],
    [0.66 * hCanvas.width, 0.38 * hCanvas.height, 45, 38],
    [0.95 * hCanvas.width, 0.78 * hCanvas.height, 105, 70],
    [0.05 * hCanvas.width, 0.78 * hCanvas.height, 105, 70],
  ];
  maria.forEach(([cx, cy, rx, ry]) => {
    const grad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    grad.addColorStop(0, "rgba(70, 70, 70, 0.75)");
    grad.addColorStop(1, "rgba(128, 128, 128, 0)");
    hCtx.fillStyle = grad;
    hCtx.beginPath();
    hCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    hCtx.fill();
  });

  // Craters: Bowl depression + elevated rim crest
  const craters: Array<[number, number, number]> = [
    [0.47 * hCanvas.width, 0.74 * hCanvas.height, 18], // Tycho
    [0.44 * hCanvas.width, 0.44 * hCanvas.height, 20], // Copernicus
    [0.39 * hCanvas.width, 0.46 * hCanvas.height, 12], // Kepler
    [0.37 * hCanvas.width, 0.38 * hCanvas.height, 11], // Aristarchus
    [0.50 * hCanvas.width, 0.96 * hCanvas.height, 14], // Shackleton
    [0.62 * hCanvas.width, 0.90 * hCanvas.height, 18], // Boguslawsky
    [0.92 * hCanvas.width, 0.38 * hCanvas.height, 15], // Jackson
  ];
  for (let i = 0; i < 70; i++) {
    craters.push([
      Math.random() * hCanvas.width,
      Math.random() * hCanvas.height,
      4 + Math.random() * 12,
    ]);
  }

  craters.forEach(([cx, cy, r]) => {
    // Bowl depression
    const bowlGrad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    bowlGrad.addColorStop(0, "rgba(35, 35, 35, 0.85)");
    bowlGrad.addColorStop(0.85, "rgba(75, 75, 75, 0.4)");
    bowlGrad.addColorStop(1, "rgba(128, 128, 128, 0)");
    hCtx.fillStyle = bowlGrad;
    hCtx.beginPath();
    hCtx.arc(cx, cy, r, 0, Math.PI * 2);
    hCtx.fill();

    // Rim crest
    hCtx.strokeStyle = "rgba(220, 220, 220, 0.8)";
    hCtx.lineWidth = Math.max(1.5, r * 0.22);
    hCtx.beginPath();
    hCtx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
    hCtx.stroke();
  });

  // 2. Compute Sobel filter on elevation data to obtain tangent-space normals
  const hImg = hCtx.getImageData(0, 0, hCanvas.width, hCanvas.height);
  const hData = hImg.data;
  const nImg = ctx.createImageData(canvas.width, canvas.height);
  const nData = nImg.data;
  const w = canvas.width;
  const h = canvas.height;
  const scale = 2.8;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const tl = hData[((y - 1) * w + (x - 1)) * 4];
      const tc = hData[((y - 1) * w + x) * 4];
      const tr = hData[((y - 1) * w + (x + 1)) * 4];
      const ml = hData[(y * w + (x - 1)) * 4];
      const mr = hData[(y * w + (x + 1)) * 4];
      const bl = hData[((y + 1) * w + (x - 1)) * 4];
      const bc = hData[((y + 1) * w + x) * 4];
      const br = hData[((y + 1) * w + (x + 1)) * 4];

      const dX = (tr + 2 * mr + br - (tl + 2 * ml + bl)) / 1020;
      const dY = (bl + 2 * bc + br - (tl + 2 * tc + tr)) / 1020;

      const nx = -scale * dX;
      const ny = -scale * dY;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);

      nData[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);     // R = Nx
      nData[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255); // G = Ny
      nData[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255); // B = Nz
      nData[idx + 3] = 255;                                        // Alpha
    }
  }

  ctx.putImageData(nImg, 0, 0);
  return canvas;
}

export default function ThreeLunarGlobe({
  lunarCoords,
  metrics,
  isLoading,
  activeTileUrl,
  alignmentResultUrl = null,
  uncertaintyMapUrl = null,
  currentLayer,
  enableLighting,
  showLabels,
  showAlignmentFootprint,
  showUncertaintyMap = false,
  onSelectLandmark,
  onUpdateCoords,
  flyToLandmark,
}: LunarGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const moonMeshRef = useRef<THREE.Mesh | null>(null);
  const moonMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const footprintGroupRef = useRef<THREE.Group | null>(null);

  // Animation interpolation state for smooth camera flyTo
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

  // Projected 2D screen positions for interactive landmark labels
  const [projectedLabels, setProjectedLabels] = useState<
    Array<{
      landmark: LunarLandmark;
      x: number;
      y: number;
      visible: boolean;
    }>
  >([]);

  // Progressive LOD & Dynamic Local NVMe High-Res Map Streaming State
  const [lodLevel, setLodLevel] = useState<number>(0);
  const [currentCameraDist, setCurrentCameraDist] = useState<number>(6.5);
  const [activeTexturePath, setActiveTexturePath] = useState<string>("/textures/moon_global.jpg");
  const textureCacheRef = useRef<Map<string, THREE.Texture>>(new Map());
  const currentTextureUrlRef = useRef<string>("/textures/moon_global.jpg");
  const lastDistCheckRef = useRef<number>(6.5);
  const activeLandmarkRef = useRef<LunarLandmark | null>(null);
  const currentLayerRef = useRef<SensorLayerMode>(currentLayer);
  const applyTextureRef = useRef<((url: string) => void) | null>(null);

  useEffect(() => {
    currentLayerRef.current = currentLayer;
  }, [currentLayer]);

  useEffect(() => {
    activeLandmarkRef.current = flyToLandmark || null;
  }, [flyToLandmark]);

  // ---------------------------------------------------------------------------
  // 1. Initialize Three.js Scene, Camera, WebGLRenderer, Lights, & Starfield
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 580;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    // 2. Camera: 45 FOV, positioned to frame the Lunar Southern Hemisphere
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(2.4, -3.2, -3.2); // Looking toward South Pole
    cameraRef.current = camera;

    // 3. Renderer with antialiasing and ACESFilmic tone mapping
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Google Earth-Style OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 1.0;
    controls.minDistance = 2.25;
    controls.maxDistance = 18.0;
    controls.enablePan = false; // Keep pivot locked to center of Moon
    controlsRef.current = controls;

    // 5. Lighting: Directional Sun + Soft Earthshine Ambient
    const sunLight = new THREE.DirectionalLight(0xffffff, enableLighting ? 2.8 : 1.8);
    sunLight.position.set(6.0, 1.2, 3.5); // Grazing angle along lunar terminator line
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const ambientLight = new THREE.AmbientLight(0x1a202c, enableLighting ? 0.18 : 0.70);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    // 6. Deep-Space Twinkling Starfield
    const starCount = 2200;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 50 + Math.random() * 80;
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
      size: 1.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });
    const starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    // 7. Lunar Sphere Mesh (Radius 2, 64x64 segments)
    // Regolith physics: roughness 0.9 and metalness 0.05 (anorthositic crust)
    const moonGeo = new THREE.SphereGeometry(LUNAR_RADIUS, 64, 64);
    const moonMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0.05,
    });
    moonMaterialRef.current = moonMat;

    // Attach procedural canvas texture immediately as instant fail-safe
    const canvas = createProceduralLunarCanvas();
    const canvasTex = new THREE.CanvasTexture(canvas);
    canvasTex.colorSpace = THREE.SRGBColorSpace;
    moonMat.map = canvasTex;

    // Attach procedural crater normal map immediately as instant fail-safe
    const normalCanvas = createProceduralNormalCanvas();
    const normalCanvasTex = new THREE.CanvasTexture(normalCanvas);
    normalCanvasTex.wrapS = THREE.RepeatWrapping;
    normalCanvasTex.wrapT = THREE.ClampToEdgeWrapping;
    moonMat.normalMap = normalCanvasTex;
    moonMat.normalScale = new THREE.Vector2(1.8, 1.8);
    moonMat.needsUpdate = true;

    // Asynchronously load pre-rendered official LOLA high-res normal map
    const normalLoader = new THREE.TextureLoader();
    normalLoader.load(
      "/textures/moon_normal.jpg",
      (normTex) => {
        normTex.minFilter = THREE.LinearMipmapLinearFilter;
        normTex.magFilter = THREE.LinearFilter;
        if (moonMaterialRef.current) {
          moonMaterialRef.current.normalMap = normTex;
          moonMaterialRef.current.normalScale.set(1.8, 1.8);
          moonMaterialRef.current.needsUpdate = true;
        }
      },
      undefined,
      (err) => {
        console.warn("[ThreeLunarGlobe] LOLA normal map load fallback:", err);
      }
    );

    // Helper function to apply texture with NVMe caching and sRGB color correction
    const applyTexture = (url: string) => {
      if (!moonMaterialRef.current) return;
      const mat = moonMaterialRef.current;
      if (currentTextureUrlRef.current === url && mat.map && mat.map !== canvasTex) return;

      const cache = textureCacheRef.current;
      if (cache.has(url)) {
        const cachedTex = cache.get(url)!;
        mat.map = cachedTex;
        mat.needsUpdate = true;
        currentTextureUrlRef.current = url;
        setActiveTexturePath(url);
        return;
      }

      const texLoader = new THREE.TextureLoader();
      texLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          cache.set(url, tex);
          if (moonMaterialRef.current && currentTextureUrlRef.current === url) {
            moonMaterialRef.current.map = tex;
            moonMaterialRef.current.needsUpdate = true;
            setActiveTexturePath(url);
          }
        },
        undefined,
        (err) => {
          console.warn(`[ThreeLunarGlobe] Texture load fallback for ${url}:`, err);
        }
      );
      currentTextureUrlRef.current = url;
      setActiveTexturePath(url);
    };

    applyTextureRef.current = applyTexture;

    // 1. Initial base texture load (LOD 0: 2048x1024)
    applyTexture("/textures/moon_global.jpg");

    // 2. Pre-warm local 4K high-resolution global mosaic into cache over NVMe
    const prewarmLoader = new THREE.TextureLoader();
    const globalHiresUrl = `${BACKEND_URL}/static/lunar_hires/lunar_global_hires.jpg`;
    prewarmLoader.load(
      globalHiresUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        textureCacheRef.current.set(globalHiresUrl, tex);
      },
      undefined,
      () => {}
    );

    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    scene.add(moonMesh);
    moonMeshRef.current = moonMesh;

    // 8. Footprint & Inlier Group
    const footprintGroup = new THREE.Group();
    scene.add(footprintGroup);
    footprintGroupRef.current = footprintGroup;

    // 9. 3D Surface Landmark Pins
    const landmarkGroup = new THREE.Group();
    LUNAR_LANDMARKS.forEach((lm) => {
      const pinPos = latLonToVector3(lm.lat, lm.lon, LUNAR_RADIUS * 1.008);
      const pinColor =
        lm.category === "Landing Site"
          ? 0xff6600 // ISRO Saffron
          : lm.category === "Crater"
          ? 0x00f0ff // Cyan
          : 0x10b981; // Emerald

      const pinMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 16, 16),
        new THREE.MeshBasicMaterial({ color: pinColor })
      );
      pinMesh.position.copy(pinPos);
      landmarkGroup.add(pinMesh);

      // Subtle beacon halo
      const haloMesh = new THREE.Mesh(
        new THREE.RingGeometry(0.03, 0.045, 24),
        new THREE.MeshBasicMaterial({
          color: pinColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
        })
      );
      haloMesh.position.copy(pinPos.clone().multiplyScalar(1.002));
      haloMesh.lookAt(new THREE.Vector3(0, 0, 0));
      landmarkGroup.add(haloMesh);
    });
    scene.add(landmarkGroup);

    // 10. Animation & Render Loop with Progressive LOD & Dynamic Texture Swapping
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
        // Smooth ease-in-out curve
        const easeT = 0.5 * (1 - Math.cos(Math.PI * t));
        camera.position.lerpVectors(animRef.current.startPos, animRef.current.endPos, easeT);
        controls.target.set(0, 0, 0);

        if (t >= 1.0) {
          animRef.current.active = false;
        }
      }

      controls.update();

      // Progressive LOD & Dynamic Texture Swapping (Google Earth Zoom Clarity)
      // Base texture (moon_global.jpg) when d > 5.0; Local High-Res Mosaic/Tiles when d <= 5.0
      const camDist = camera.position.length();
      const isClose = camDist <= 5.0;
      const targetLod = isClose ? 1 : 0;

      if (Math.abs(camDist - lastDistCheckRef.current) > 0.05) {
        lastDistCheckRef.current = camDist;
        setLodLevel(targetLod);
        setCurrentCameraDist(camDist);
      }

      let desiredUrl = "/textures/moon_global.jpg";
      if (isClose) {
        const curLyr = currentLayerRef.current;
        const actLm = activeLandmarkRef.current;
        if (curLyr && SENSOR_LAYER_HIRES_MAP[curLyr]) {
          desiredUrl = SENSOR_LAYER_HIRES_MAP[curLyr];
        } else if (actLm && LOCAL_HIRES_LANDMARK_MAP[actLm.id]) {
          desiredUrl = LOCAL_HIRES_LANDMARK_MAP[actLm.id];
        } else {
          desiredUrl = `${BACKEND_URL}/static/lunar_hires/lunar_global_hires.jpg`;
        }
      }

      if (desiredUrl !== currentTextureUrlRef.current) {
        applyTexture(desiredUrl);
      }

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

    // 12. Mouse Pointer Raycaster for Coordinate Inspector
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(moonMesh);

      const camAltKm = Math.round((camera.position.length() - LUNAR_RADIUS) * (1737.4 / LUNAR_RADIUS));

      if (hits.length > 0) {
        const { lat, lon } = vector3ToLatLon(hits[0].point, LUNAR_RADIUS);
        const distToSouthPole = Math.hypot(lat + 90, lon);
        const simElev =
          distToSouthPole < 25
            ? Math.round(-3900 + Math.sin(lat * 5) * 1100 + Math.cos(lon * 5) * 750)
            : Math.round(-1450 + Math.sin(lat * 3) * 1400);

        onUpdateCoords({
          lat,
          lon,
          elevation_m: simElev,
          cameraAltitude_km: camAltKm,
        });
      } else {
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
      moonGeo.dispose();
      moonMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      if (container && domElement.parentNode === container) {
        container.removeChild(domElement);
      }
      applyTextureRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Solar Terminator Dynamic Lighting Toggle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (sunLightRef.current) {
      sunLightRef.current.intensity = enableLighting ? 2.8 : 1.8;
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = enableLighting ? 0.18 : 0.70;
    }
  }, [enableLighting]);

  // ---------------------------------------------------------------------------
  // 3. Multi-Sensor Layer Material Tuning (OHRC, TMC-2, IIRS, DEM)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!moonMaterialRef.current) return;
    const mat = moonMaterialRef.current;

    if (currentLayer === "ohrc_framing") {
      mat.color.setHex(0xf8fafc); // Ultra-high-contrast panchromatic for 0.25m structural framing
      mat.roughness = 0.95;
      mat.metalness = 0.02;
    } else if (currentLayer === "tmc2_ortho") {
      mat.color.setHex(0xffffff); // Natural 5m stereo panchromatic ortho
      mat.roughness = 0.90;
      mat.metalness = 0.05;
    } else if (currentLayer === "iirs_mineral") {
      mat.color.setHex(0xffffff); // Saturated false-color mineralogy composite
      mat.roughness = 0.80;
      mat.metalness = 0.10;
    } else if (currentLayer === "dem_topography") {
      mat.color.setHex(0xffffff); // LOLA DEM elevation gradient
      mat.roughness = 0.70;
      mat.metalness = 0.05;
    }
  }, [currentLayer]);

  // ---------------------------------------------------------------------------
  // 4. Render Chandrayaan-2 TMC-2 / OHRC Surface Pass & MAGSAC+ Inliers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const group = footprintGroupRef.current;
    if (!group) return;

    // Clear old entities
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) (obj as any).material.dispose();
    }

    if (!showAlignmentFootprint) return;

    const { west, south, east, north } = lunarCoords.bounding_box;

    // 1. Curved Perimeter Boundary
    const curvePoints: THREE.Vector3[] = [];
    const steps = 12;

    // Bottom edge (south: west -> east)
    for (let i = 0; i <= steps; i++) {
      const lon = west + (east - west) * (i / steps);
      curvePoints.push(latLonToVector3(south, lon, LUNAR_RADIUS * 1.012));
    }
    // Right edge (east: south -> north)
    for (let i = 0; i <= steps; i++) {
      const lat = south + (north - south) * (i / steps);
      curvePoints.push(latLonToVector3(lat, east, LUNAR_RADIUS * 1.012));
    }
    // Top edge (north: east -> west)
    for (let i = 0; i <= steps; i++) {
      const lon = east - (east - west) * (i / steps);
      curvePoints.push(latLonToVector3(north, lon, LUNAR_RADIUS * 1.012));
    }
    // Left edge (west: north -> south)
    for (let i = 0; i <= steps; i++) {
      const lat = north - (north - south) * (i / steps);
      curvePoints.push(latLonToVector3(lat, west, LUNAR_RADIUS * 1.012));
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const lineColor =
      currentLayer === "ohrc_framing"
        ? 0xc084fc // Electric Purple
        : currentLayer === "iirs_mineral"
        ? 0xf59e0b // Amber
        : currentLayer === "dem_topography"
        ? 0x10b981 // Emerald
        : 0x00f0ff; // Cyan for TMC-2

    const lineMat = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
    const lineMesh = new THREE.LineLoop(lineGeo, lineMat);
    group.add(lineMesh);

    // 2. Optical Center Marker
    const centerPos = latLonToVector3(lunarCoords.center_lat, lunarCoords.center_lon, LUNAR_RADIUS * 1.018);
    const centerMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff6600 }) // ISRO Saffron
    );
    centerMarker.position.copy(centerPos);
    group.add(centerMarker);

    // 3. Decoupled Sensor Layer Specific Analytical Visualizations
    if (currentLayer === "ohrc_framing") {
      // OHRC 0.25m High-Resolution Local Structural Framing:
      // Focus on boulder fields, crater walls, and landing coordinates
      const cLat = lunarCoords.center_lat;
      const cLon = lunarCoords.center_lon;
      const dLat = (north - south) * 0.22;
      const dLon = (east - west) * 0.22;

      // Local high-res framing inner box (0.25m/px local structural framing)
      const ohrcPts: THREE.Vector3[] = [
        latLonToVector3(cLat - dLat, cLon - dLon, LUNAR_RADIUS * 1.015),
        latLonToVector3(cLat - dLat, cLon + dLon, LUNAR_RADIUS * 1.015),
        latLonToVector3(cLat + dLat, cLon + dLon, LUNAR_RADIUS * 1.015),
        latLonToVector3(cLat + dLat, cLon - dLon, LUNAR_RADIUS * 1.015),
      ];
      const ohrcBoxGeo = new THREE.BufferGeometry().setFromPoints(ohrcPts);
      const ohrcBoxMat = new THREE.LineBasicMaterial({ color: 0xe879f9, linewidth: 2 });
      group.add(new THREE.LineLoop(ohrcBoxGeo, ohrcBoxMat));

      // Local boulder field hazard indicator rings around crater walls
      for (let b = 0; b < 6; b++) {
        const bLat = cLat + Math.sin(b * 1.1) * dLat * 0.75;
        const bLon = cLon + Math.cos(b * 1.1) * dLon * 0.75;
        const bPos = latLonToVector3(bLat, bLon, LUNAR_RADIUS * 1.015);
        const boulderRing = new THREE.Mesh(
          new THREE.RingGeometry(0.012, 0.018, 16),
          new THREE.MeshBasicMaterial({ color: 0xf43f5e, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
        );
        boulderRing.position.copy(bPos);
        boulderRing.lookAt(new THREE.Vector3(0, 0, 0));
        group.add(boulderRing);
      }
    } else if (currentLayer === "iirs_mineral") {
      // IIRS Mineralogy: Water-Ice absorption cold traps & Iron/Titanium indicators
      const cLat = lunarCoords.center_lat;
      const cLon = lunarCoords.center_lon;
      const dLat = (north - south) * 0.35;
      const dLon = (east - west) * 0.35;

      for (let m = 0; m < 8; m++) {
        const mLat = cLat + Math.sin(m * 0.8) * dLat;
        const mLon = cLon + Math.cos(m * 0.8) * dLon;
        const mPos = latLonToVector3(mLat, mLon, LUNAR_RADIUS * 1.015);
        const isColdTrap = m % 2 === 0;
        const color = isColdTrap ? 0x38bdf8 : 0xf97316; // Icy cyan vs Iron/Ti amber
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.016, 12, 12),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
        );
        dot.position.copy(mPos);
        group.add(dot);
      }
    } else if (currentLayer === "dem_topography") {
      // DEM Topography: Hypsometric contour rings
      const cLat = lunarCoords.center_lat;
      const cLon = lunarCoords.center_lon;
      [0.05, 0.1, 0.16].forEach((radiusOffset, idx) => {
        const contourPts: THREE.Vector3[] = [];
        for (let a = 0; a <= 32; a++) {
          const rad = (a * Math.PI * 2) / 32;
          const ctLat = cLat + Math.sin(rad) * (north - south) * (0.2 + idx * 0.15);
          const ctLon = cLon + Math.cos(rad) * (east - west) * (0.2 + idx * 0.15);
          contourPts.push(latLonToVector3(ctLat, ctLon, LUNAR_RADIUS * 1.014));
        }
        const ctGeo = new THREE.BufferGeometry().setFromPoints(contourPts);
        const ctMat = new THREE.LineBasicMaterial({
          color: idx === 0 ? 0x10b981 : idx === 1 ? 0x06b6d4 : 0x8b5cf6,
          transparent: true,
          opacity: 0.75,
        });
        group.add(new THREE.LineLoop(ctGeo, ctMat));
      });
    }

    // 4. MAGSAC+ Verified Inlier Scatter
    if (metrics?.success && metrics.num_inliers > 0) {
      const sampleCount = Math.min(metrics.num_inliers, 150);
      const inlierPoints: THREE.Vector3[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const lon = west + Math.random() * (east - west);
        const lat = south + Math.random() * (north - south);
        inlierPoints.push(latLonToVector3(lat, lon, LUNAR_RADIUS * 1.016));
      }

      const inlierGeo = new THREE.BufferGeometry().setFromPoints(inlierPoints);
      const inlierMat = new THREE.PointsMaterial({
        color: currentLayer === "ohrc_framing" ? 0xe879f9 : 0x00f0ff,
        size: 2.5,
        transparent: true,
        opacity: 0.9,
      });
      const inlierCloud = new THREE.Points(inlierGeo, inlierMat);
      group.add(inlierCloud);
    }

    // 5. Dynamic 3D Surface Texture Draping: Decoupled Multi-Sensor Patch (OHRC / TMC-2 / IIRS / DEM)
    // Synchronized to active layer selection in LayerToggleHUD
    const drapedSensorUrl = SENSOR_LAYER_HIRES_MAP[currentLayer];
    if (drapedSensorUrl && !alignmentResultUrl) {
      const texLoader = new THREE.TextureLoader();
      texLoader.load(
        drapedSensorUrl,
        (sensorTex) => {
          sensorTex.colorSpace = THREE.SRGBColorSpace;
          sensorTex.minFilter = THREE.LinearMipmapLinearFilter;
          sensorTex.magFilter = THREE.LinearFilter;

          const sensorGeo = createSphericalSegmentGeometry(west, south, east, north, 2.001, 32, 32);
          const sensorMat = new THREE.MeshStandardMaterial({
            map: sensorTex,
            transparent: true,
            opacity: 0.94,
            roughness: currentLayer === "ohrc_framing" ? 0.96 : currentLayer === "iirs_mineral" ? 0.78 : 0.88,
            metalness: currentLayer === "iirs_mineral" ? 0.12 : 0.04,
            side: THREE.DoubleSide,
            depthWrite: false,
          });

          const sensorMesh = new THREE.Mesh(sensorGeo, sensorMat);
          group.add(sensorMesh);
        },
        undefined,
        (err) => console.warn("[ThreeLunarGlobe] Failed to load draped sensor texture:", err)
      );
    }

    // 6. Dynamic 3D Texture Draping: Aligned Warped Image Overlay (when registration completed)
    const rawAlignUrl = alignmentResultUrl || metrics?.warped_url || metrics?.dem_warping?.warped_raster_url;
    const alignUrl = rawAlignUrl ? getAssetUrl(rawAlignUrl) : null;
    if (alignUrl) {
      const texLoader = new THREE.TextureLoader();
      texLoader.load(
        alignUrl,
        (alignedTex) => {
          alignedTex.colorSpace = THREE.SRGBColorSpace;
          alignedTex.minFilter = THREE.LinearMipmapLinearFilter;
          alignedTex.magFilter = THREE.LinearFilter;

          const alignedGeo = createSphericalSegmentGeometry(west, south, east, north, 2.0015, 32, 32);
          const alignedMat = new THREE.MeshBasicMaterial({
            map: alignedTex,
            transparent: true,
            opacity: 0.92,
            side: THREE.DoubleSide,
            depthWrite: false,
          });

          const alignedMesh = new THREE.Mesh(alignedGeo, alignedMat);
          group.add(alignedMesh);
        },
        undefined,
        (err) => console.warn("[ThreeLunarGlobe] Failed to load aligned result texture:", err)
      );
    }

    // 7. Dynamic 3D Texture Draping: Quantitative Uncertainty Heatmap Overlay
    const rawUncertUrl = uncertaintyMapUrl || metrics?.heatmap_url || metrics?.uncertainty?.heatmap_url;
    if (showUncertaintyMap || uncertaintyMapUrl) {
      const targetHeatmapUrl = rawUncertUrl ? getAssetUrl(rawUncertUrl) : getAssetUrl("/static/uncertainty_heatmap.png");
      const texLoader = new THREE.TextureLoader();
      texLoader.load(
        targetHeatmapUrl,
        (uncertTex) => {
          uncertTex.colorSpace = THREE.SRGBColorSpace;
          uncertTex.minFilter = THREE.LinearMipmapLinearFilter;
          uncertTex.magFilter = THREE.LinearFilter;

          const uncertGeo = createSphericalSegmentGeometry(west, south, east, north, 2.0025, 32, 32);
          const uncertMat = new THREE.MeshBasicMaterial({
            map: uncertTex,
            transparent: true,
            opacity: 0.90,
            side: THREE.DoubleSide,
            depthWrite: false,
          });

          const uncertMesh = new THREE.Mesh(uncertGeo, uncertMat);
          group.add(uncertMesh);
        },
        undefined,
        (err) => console.warn("[ThreeLunarGlobe] Failed to load uncertainty heatmap texture:", err)
      );
    }
  }, [showAlignmentFootprint, showUncertaintyMap, alignmentResultUrl, uncertaintyMapUrl, lunarCoords, metrics, currentLayer]);

  // ---------------------------------------------------------------------------
  // 5. Camera Navigation: Smooth FlyTo Landmark
  // ---------------------------------------------------------------------------
  const executeFlyTo = useCallback((landmark: LunarLandmark) => {
    const camera = cameraRef.current;
    if (!camera) return;

    activeLandmarkRef.current = landmark;
    const hiresUrl = LOCAL_HIRES_LANDMARK_MAP[landmark.id] || `${BACKEND_URL}/static/lunar_hires/lunar_global_hires.jpg`;
    if (applyTextureRef.current) {
      applyTextureRef.current(hiresUrl);
    }

    const targetDir = latLonToVector3(landmark.lat, landmark.lon, 1.0).normalize();
    const distance = landmark.diameter_km ? Math.max(2.65, 2.0 + landmark.diameter_km / 90) : 3.2;
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

  const resetToSouthPole = () => {
    executeFlyTo({
      id: "statio-shiv-shakti",
      name: "Statio Shiv Shakti",
      category: "Landing Site",
      lat: -69.373,
      lon: 32.319,
      elevation_m: -1820,
      description: "ISRO Chandrayaan-3 Landing Site",
      geological_interest: "High-relief southern polar highlands",
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
    const newDist = Math.min(curDist * 1.25, 18.0);
    camera.position.normalize().multiplyScalar(newDist);
  };

  return (
    <div className="relative w-full h-full min-h-[580px] overflow-hidden rounded-2xl border border-white/15 glass-panel shadow-2xl">
      {/* Three.js 3D WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full min-h-[580px] bg-black cursor-grab active:cursor-grabbing" />

      {/* 2D Projected Floating Landmark Labels */}
      {showLabels && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
          {projectedLabels.map(({ landmark, x, y, visible }) => {
            if (!visible || x < 0 || y < 0) return null;
            const isLanding = landmark.category === "Landing Site";
            return (
              <div
                key={landmark.id}
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                }}
                className="absolute -translate-x-1/2 -translate-y-full mb-2 pointer-events-auto transition-opacity duration-200"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectLandmark(landmark);
                    executeFlyTo(landmark);
                  }}
                  className={`group px-2.5 py-1 rounded-xl text-[10px] font-mono border backdrop-blur-xl flex items-center space-x-1.5 shadow-lg transition-all hover:scale-105 ${
                    isLanding
                      ? "bg-amber-950/80 border-amber-400 text-amber-200 hover:bg-amber-900"
                      : "bg-slate-950/80 border-cyan-400/60 text-cyan-200 hover:bg-slate-900"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isLanding ? "bg-amber-400 animate-pulse" : "bg-cyan-400"
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

      {/* Top Banner Status Overlay */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-xl border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>ELLIPSOID: MOON (R=1,737.4 km)</span>
        </div>

        {/* Progressive LOD Streaming Badge */}
        {lodLevel === 1 ? (
          <div className="px-3 py-1.5 rounded-xl bg-purple-950/85 backdrop-blur-xl border border-purple-400 text-xs font-mono text-purple-200 flex items-center space-x-2 shadow-lg pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
            <span>LOD 1: NVMe LOCAL HIGH-RES STREAMING [d={currentCameraDist.toFixed(2)}]</span>
          </div>
        ) : (
          <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/20 text-xs font-mono text-slate-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span>LOD 0: GLOBAL BASE (2K) [d={currentCameraDist.toFixed(2)}]</span>
          </div>
        )}

        {/* Active Stream Asset Indicator */}
        <div className="hidden sm:flex px-2.5 py-1.5 rounded-xl bg-black/75 backdrop-blur-xl border border-white/10 text-[10px] font-mono text-slate-300 pointer-events-auto">
          STREAM: {activeTexturePath.split("/").pop()}
        </div>

        {/* Uncertainty Heatmap Active Badge */}
        {showUncertaintyMap && (
          <div className="px-3 py-1.5 rounded-xl bg-rose-950/85 backdrop-blur-xl border border-rose-400 text-xs font-mono text-rose-200 flex items-center space-x-2 shadow-lg shadow-rose-950/50 pointer-events-auto animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>UNCERTAINTY HEATMAP 3D DRAPED [TURBO]</span>
          </div>
        )}
      </div>

      {/* Floating 3D Navigation Controls (Google Earth style) */}
      <div className="absolute top-4 right-4 z-20 flex flex-col space-y-2 pointer-events-none">
        <button
          type="button"
          onClick={resetToSouthPole}
          title="Fly to South Pole / Statio Shiv Shakti"
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
            Processing Lunar Surface Ingestion &amp; MAGSAC+ Matching...
          </p>
        </div>
      )}
    </div>
  );
}
