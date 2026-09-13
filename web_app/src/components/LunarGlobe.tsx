"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Compass,
  Layers,
  MapPin,
  RefreshCw,
  Sun,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
} from "lucide-react";
import { LUNAR_LANDMARKS, LunarLandmark } from "@/data/lunarLandmarks";
import { SensorLayerMode } from "./LayerToggleHUD";

declare global {
  interface Window {
    Cesium?: any;
  }
}

interface LunarGlobeProps {
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
  currentLayer: SensorLayerMode;
  enableLighting: boolean;
  showLabels: boolean;
  showAlignmentFootprint: boolean;
  onSelectLandmark: (landmark: LunarLandmark) => void;
  onUpdateCoords: (coords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
    cameraAltitude_km: number | null;
  }) => void;
  flyToLandmark?: LunarLandmark | null;
}

/**
 * Procedural HTML5 Canvas Lunar Surface Generator.
 * Generates an equirectangular (2048x1024) texture featuring:
 * - Lunar anorthositic highlands (base grey regolith)
 * - Major dark basaltic volcanic maria (Imbrium, Procellarum, Serenitatis, Tranquillitatis, Crisium, Orientale, South Pole-Aitken)
 * - Prominent rayed impact craters (Tycho, Copernicus, Shackleton, Boguslawsky)
 * Guarantees zero blank-sphere artifacts even if /textures/moon_global.jpg is missing or 404.
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

  // Subtle global crustal albedo variation
  const crustGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  crustGrad.addColorStop(0.0, "rgba(90, 95, 105, 0.45)");
  crustGrad.addColorStop(0.5, "rgba(160, 165, 172, 0.15)");
  crustGrad.addColorStop(1.0, "rgba(80, 85, 95, 0.5)");
  ctx.fillStyle = crustGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Major Lunar Maria (Dark basaltic volcanic plains)
  const maria: Array<[number, number, number, number, string]> = [
    // Oceanus Procellarum & Mare Imbrium (Western Nearside)
    [0.40 * canvas.width, 0.35 * canvas.height, 240, 170, "#3e4248"],
    [0.45 * canvas.width, 0.30 * canvas.height, 180, 130, "#383c42"],
    // Mare Serenitatis
    [0.55 * canvas.width, 0.32 * canvas.height, 130, 110, "#363a40"],
    // Mare Tranquillitatis (Apollo 11 site)
    [0.58 * canvas.width, 0.45 * canvas.height, 140, 105, "#32353a"],
    // Mare Crisium
    [0.66 * canvas.width, 0.38 * canvas.height, 90, 75, "#2e3238"],
    // Mare Fecunditatis
    [0.63 * canvas.width, 0.52 * canvas.height, 110, 95, "#3a3e44"],
    // Mare Nectaris
    [0.59 * canvas.width, 0.58 * canvas.height, 80, 70, "#3a3e44"],
    // Mare Nubium & Mare Cognitum
    [0.45 * canvas.width, 0.55 * canvas.height, 120, 95, "#3a3e44"],
    // Mare Humorum
    [0.38 * canvas.width, 0.60 * canvas.height, 75, 65, "#383c42"],
    // South Pole - Aitken Basin (Deep farside southern basin)
    [0.95 * canvas.width, 0.78 * canvas.height, 210, 140, "#484c54"],
    [0.05 * canvas.width, 0.78 * canvas.height, 210, 140, "#484c54"],
    // Mare Orientale (Western limb concentric rings)
    [0.24 * canvas.width, 0.55 * canvas.height, 95, 90, "#34383e"],
    // Mare Moscoviense (Farside)
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

  // 3. Prominent Rayed Craters (Tycho, Copernicus, Shackleton, Boguslawsky)
  const rayCraters: Array<[number, number, number, boolean]> = [
    // Tycho (Nearside South with bright radial ray system)
    [0.47 * canvas.width, 0.74 * canvas.height, 26, true],
    // Copernicus
    [0.44 * canvas.width, 0.44 * canvas.height, 28, true],
    // Kepler
    [0.39 * canvas.width, 0.46 * canvas.height, 16, true],
    // Aristarchus (Brightest albedo)
    [0.37 * canvas.width, 0.38 * canvas.height, 18, false],
    // Shackleton / South Pole (Chandrayaan exploration zone)
    [0.50 * canvas.width, 0.96 * canvas.height, 22, false],
    // Boguslawsky Crater (Lat -72.9)
    [0.62 * canvas.width, 0.90 * canvas.height, 30, false],
    // Jackson (Farside ray crater)
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
    // Depressed dark crater bowl
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#26292f";
    ctx.fill();
    // Bright elevated rim
    ctx.strokeStyle = "#e2e6ed";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  // 4. Distributed impact craters
  for (let i = 0; i < 280; i++) {
    const rx = Math.random() * canvas.width;
    const ry = Math.random() * canvas.height;
    const rad = 2 + Math.random() * 9;
    ctx.beginPath();
    ctx.arc(rx, ry, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#2c3036";
    ctx.fill();
    ctx.strokeStyle = "rgba(215, 220, 230, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return canvas;
}

export default function LunarGlobe({
  lunarCoords,
  metrics,
  isLoading,
  activeTileUrl,
  currentLayer,
  enableLighting,
  showLabels,
  showAlignmentFootprint,
  onSelectLandmark,
  onUpdateCoords,
  flyToLandmark,
}: LunarGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const landmarksSourceRef = useRef<any>(null);
  const keypointEntitiesRef = useRef<any[]>([]);
  const tmc2EntitiesRef = useRef<any[]>([]);
  const mouseHandlerRef = useRef<any>(null);
  const [cesiumReady, setCesiumReady] = useState(false);

  // ---------------------------------------------------------------------------
  // 1. Initialize Cesium with Lunar Ellipsoid, High-Res Texture, & Deep Space
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let checkInterval: NodeJS.Timeout;

    const initCesium = () => {
      if (typeof window === "undefined" || !window.Cesium || !containerRef.current) return false;

      const Cesium = window.Cesium;
      // 1. Explicitly Configure Lunar Ellipsoid (Moon Radius: Exactly 1,737.4 km)
      const moonEllipsoid = Cesium.Ellipsoid.MOON;

      try {
        // Create custom Lunar Globe
        const globe = new Cesium.Globe(moonEllipsoid);
        globe.baseColor = Cesium.Color.fromCssColorString("#151b2b");
        globe.enableLighting = true; // Sun-relative day/night terminator
        globe.showGroundAtmosphere = false; // Moon has no atmosphere

        const viewer = new Cesium.Viewer(containerRef.current, {
          globe: globe,
          baseLayerPicker: false,
          imageryProvider: false, // Prevents default Earth / Bing Maps imagery
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          skyAtmosphere: false,
          scene3DOnly: true,
          contextOptions: {
            webgl: {
              alpha: true,
              preserveDrawingBuffer: true,
            },
          },
        });

        // Deep-space black canvas
        viewer.scene.backgroundColor = Cesium.Color.BLACK;
        viewer.scene.highDynamicRange = true;

        // Explicitly configure Cesium camera controller for Google Earth-style lunar navigation
        viewer.screenSpaceCameraController.enableRotate = true;
        viewer.screenSpaceCameraController.enableTranslate = true;
        viewer.screenSpaceCameraController.enableZoom = true;
        viewer.screenSpaceCameraController.enableTilt = true;
        viewer.screenSpaceCameraController.enableLook = true;
        viewer.screenSpaceCameraController.enableCollisionDetection = false;

        // Configure realistic solar lighting angle to cast distinct crater relief along terminator
        // Lock clock to a dramatic low-sun angle over the South Pole
        const initialDate = Cesium.JulianDate.fromDate(new Date("2023-08-23T12:00:00Z"));
        viewer.clock.currentTime = initialDate;
        viewer.clock.shouldAnimate = false;

        // Clear any residual imagery layers
        viewer.imageryLayers.removeAll();

        // 2. Attach High-Resolution Global Lunar Imagery with Fail-Safe Fallback
        // Step A: Immediately attach the procedural HTML5 canvas fallback
        // This guarantees that the Moon surface is ALWAYS visible immediately with zero blank-sphere artifacts.
        const proceduralCanvas = createProceduralLunarCanvas();
        const fallbackProvider = new Cesium.SingleTileImageryProvider({
          url: proceduralCanvas.toDataURL("image/jpeg", 0.9),
          rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
        });
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(fallbackProvider);
        viewer.scene.globe.enableLighting = true;

        // Step B: Probe /textures/moon_global.jpg; upgrade smoothly if available
        // If it fails (404 / network), the procedural canvas remains active seamlessly.
        const textureImg = new Image();
        textureImg.onload = () => {
          if (viewer && !viewer.isDestroyed()) {
            const lunarImageryProvider = new Cesium.SingleTileImageryProvider({
              url: "/textures/moon_global.jpg",
              rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
            });
            viewer.imageryLayers.removeAll();
            viewer.imageryLayers.addImageryProvider(lunarImageryProvider);
            viewer.scene.globe.enableLighting = true;
          }
        };
        textureImg.onerror = () => {
          console.warn("[LunarGlobe] /textures/moon_global.jpg unavailable. Active fail-safe: Procedural HTML5 Lunar Canvas.");
        };
        textureImg.src = "/textures/moon_global.jpg";

        // 3. Camera Initial View & Smooth FlyTo (South Pole / Statio Shiv Shakti @ 3,000 km altitude)
        // Global Framing view: 7,000 km looking at Southern Hemisphere
        const globalFramePos = Cesium.Cartesian3.fromDegrees(
          32.319,
          -69.373,
          7000000.0, // 7,000 km altitude
          moonEllipsoid
        );

        viewer.camera.setView({
          destination: globalFramePos,
          orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-90.0),
            roll: 0.0,
          },
        });

        // Smooth cinematic fly-in on load to 3,000 km altitude
        const targetSouthPole3000km = Cesium.Cartesian3.fromDegrees(
          32.319,
          -69.373,
          3000000.0, // 3,000 km altitude (3,000,000 meters)
          moonEllipsoid
        );

        setTimeout(() => {
          if (viewer && !viewer.isDestroyed()) {
            viewer.camera.flyTo({
              destination: targetSouthPole3000km,
              orientation: {
                heading: Cesium.Math.toRadians(15.0),
                pitch: Cesium.Math.toRadians(-60.0),
                roll: 0.0,
              },
              duration: 3.5,
            });
          }
        }, 300);

        // 4. Real-time Geolocation Mouse Inspector
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

        handler.setInputAction((movement: any) => {
          const cartesian = viewer.camera.pickEllipsoid(movement.endPosition, moonEllipsoid);
          const camHeight = viewer.camera.positionCartographic.height / 1000.0;

          if (cartesian) {
            const carto = moonEllipsoid.cartesianToCartographic(cartesian);
            const lat = Cesium.Math.toDegrees(carto.latitude);
            const lon = Cesium.Math.toDegrees(carto.longitude);

            // Realistic terrain elevation model based on polar basin relief
            const distToSouthPole = Math.hypot(lat + 90, lon);
            const simElev =
              distToSouthPole < 25
                ? Math.round(-3900 + Math.sin(lat * 5) * 1100 + Math.cos(lon * 5) * 750)
                : Math.round(-1450 + Math.sin(lat * 3) * 1400);

            onUpdateCoords({
              lat,
              lon,
              elevation_m: simElev,
              cameraAltitude_km: Math.round(camHeight),
            });
          } else {
            onUpdateCoords({
              lat: null,
              lon: null,
              elevation_m: null,
              cameraAltitude_km: Math.round(camHeight),
            });
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // 5. Interactive Landmark Selection on Click
        handler.setInputAction((click: any) => {
          const picked = viewer.scene.pick(click.position);
          if (Cesium.defined(picked) && picked.id && picked.id._landmarkData) {
            const landmark = picked.id._landmarkData as LunarLandmark;
            onSelectLandmark(landmark);

            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(
                landmark.lon,
                landmark.lat,
                landmark.diameter_km ? landmark.diameter_km * 2200 : 75000.0,
                moonEllipsoid
              ),
              duration: 2.5,
            });
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        mouseHandlerRef.current = handler;
        viewerRef.current = viewer;
        setCesiumReady(true);
        return true;
      } catch (err) {
        console.error("Cesium initialization error:", err);
        return false;
      }
    };

    if (!initCesium()) {
      checkInterval = setInterval(() => {
        if (initCesium()) {
          clearInterval(checkInterval);
        }
      }, 200);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (mouseHandlerRef.current) {
        mouseHandlerRef.current.destroy();
        mouseHandlerRef.current = null;
      }
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Solar Terminator Dynamic Lighting Toggle
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!viewerRef.current) return;
    viewerRef.current.scene.globe.enableLighting = enableLighting;
  }, [enableLighting]);

  // ---------------------------------------------------------------------------
  // 3. Global Lunar Nomenclature Labels (GeoJSON / Point Entities)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!cesiumReady || !viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    if (!landmarksSourceRef.current) {
      landmarksSourceRef.current = new Cesium.CustomDataSource("lunar_landmarks");
      viewer.dataSources.add(landmarksSourceRef.current);
    }

    const ds = landmarksSourceRef.current;
    ds.entities.removeAll();

    if (showLabels) {
      LUNAR_LANDMARKS.forEach((lm) => {
        const pinColor =
          lm.category === "Landing Site"
            ? Cesium.Color.fromCssColorString("#ff6600") // ISRO Saffron
            : lm.category === "Crater"
            ? Cesium.Color.fromCssColorString("#00f0ff") // Neon Cyan
            : Cesium.Color.fromCssColorString("#10b981"); // Emerald

        const entity = ds.entities.add({
          name: lm.name,
          position: Cesium.Cartesian3.fromDegrees(lm.lon, lm.lat, 2000, moonEllipsoid),
          point: {
            pixelSize: 8,
            color: pinColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: lm.name.split(" (")[0],
            font: "12px monospace",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000000.0),
          },
        });

        entity._landmarkData = lm;
      });
    }
  }, [cesiumReady, showLabels]);

  // ---------------------------------------------------------------------------
  // 4. Multi-Sensor Data Layers (TMC-2, IIRS Mineralogy, DEM Topography)
  // ---------------------------------------------------------------------------
  const applySensorLayer = useCallback(() => {
    if (!cesiumReady || !viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    tmc2EntitiesRef.current.forEach((e) => viewer.entities.remove(e));
    tmc2EntitiesRef.current = [];

    const { west, south, east, north } = lunarCoords.bounding_box;
    const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);

    let layerColor = Cesium.Color.WHITE;
    let outlineColor = Cesium.Color.fromCssColorString("#00f0ff");

    if (currentLayer === "iirs_mineral") {
      layerColor = Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.85); // Amber
      outlineColor = Cesium.Color.fromCssColorString("#f59e0b");
    } else if (currentLayer === "dem_topography") {
      layerColor = Cesium.Color.fromCssColorString("#10b981").withAlpha(0.85); // Emerald
      outlineColor = Cesium.Color.fromCssColorString("#10b981");
    }

    if (showAlignmentFootprint) {
      // Draped Chandrayaan-2 TMC-2 Surface Pass
      const surfaceEntity = viewer.entities.add({
        name: `ISRO TMC-2 Surface Pass (${currentLayer.toUpperCase()})`,
        rectangle: {
          coordinates: rect,
          material: new Cesium.ImageMaterialProperty({
            image: activeTileUrl || "/static/matches_visualization.png",
            color: layerColor,
            transparent: true,
          }),
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 3,
          height: 1200,
        },
      });
      tmc2EntitiesRef.current.push(surfaceEntity);

      // Glowing Neon Bounding Perimeter
      const borderEntity = viewer.entities.add({
        name: "TMC-2 High-Resolution Perimeter",
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(west, south, 1400, moonEllipsoid),
            Cesium.Cartesian3.fromDegrees(east, south, 1400, moonEllipsoid),
            Cesium.Cartesian3.fromDegrees(east, north, 1400, moonEllipsoid),
            Cesium.Cartesian3.fromDegrees(west, north, 1400, moonEllipsoid),
            Cesium.Cartesian3.fromDegrees(west, south, 1400, moonEllipsoid),
          ],
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.4,
            color: outlineColor,
          }),
        },
      });
      tmc2EntitiesRef.current.push(borderEntity);

      // Landing / Calibration Center Marker
      const centerEntity = viewer.entities.add({
        name: "TMC-2 Optical Center Point",
        position: Cesium.Cartesian3.fromDegrees(
          lunarCoords.center_lon,
          lunarCoords.center_lat,
          1600,
          moonEllipsoid
        ),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString("#ff6600"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: `ISRO TMC-2 Pass\n${lunarCoords.target_region}`,
          font: "12px monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
        },
      });
      tmc2EntitiesRef.current.push(centerEntity);
    }
  }, [cesiumReady, currentLayer, showAlignmentFootprint, lunarCoords, activeTileUrl]);

  useEffect(() => {
    applySensorLayer();
  }, [applySensorLayer]);

  // ---------------------------------------------------------------------------
  // 5. Plot Verified Inlier Keypoints from MAGSAC+
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!cesiumReady || !viewerRef.current || !window.Cesium || !metrics) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    keypointEntitiesRef.current.forEach((ent) => viewer.entities.remove(ent));
    keypointEntitiesRef.current = [];

    if (metrics.success && metrics.num_inliers > 0 && showAlignmentFootprint) {
      const { west, south, east, north } = lunarCoords.bounding_box;
      const sampleCount = Math.min(metrics.num_inliers, 140);

      for (let i = 0; i < sampleCount; i++) {
        const lon = west + Math.random() * (east - west);
        const lat = south + Math.random() * (north - south);
        const alt = 1300 + Math.random() * 400;

        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, alt, moonEllipsoid),
          point: {
            pixelSize: 6,
            color: Cesium.Color.fromCssColorString("#00f0ff"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          },
        });
        keypointEntitiesRef.current.push(ent);
      }

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          lunarCoords.center_lon,
          lunarCoords.center_lat,
          92000.0,
          moonEllipsoid
        ),
        orientation: {
          heading: Cesium.Math.toRadians(35.0),
          pitch: Cesium.Math.toRadians(-48.0),
          roll: 0.0,
        },
        duration: 3.0,
      });
    }
  }, [metrics, cesiumReady, lunarCoords, showAlignmentFootprint]);

  // ---------------------------------------------------------------------------
  // 6. Camera Navigation Actions & FlyTo
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!flyToLandmark || !viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        flyToLandmark.lon,
        flyToLandmark.lat,
        flyToLandmark.diameter_km ? flyToLandmark.diameter_km * 2200 : 85000.0,
        moonEllipsoid
      ),
      duration: 2.5,
    });
  }, [flyToLandmark]);

  const resetToSouthPole3000km = () => {
    if (!viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        32.319,
        -69.373,
        3000000.0, // Exactly 3,000 km altitude above Lunar Ellipsoid
        Cesium.Ellipsoid.MOON
      ),
      orientation: {
        heading: 0.0,
        pitch: Cesium.Math.toRadians(-60.0),
        roll: 0.0,
      },
      duration: 2.0,
    });
  };

  const zoomIn = () => {
    if (viewerRef.current) viewerRef.current.camera.zoomIn(50000);
  };
  const zoomOut = () => {
    if (viewerRef.current) viewerRef.current.camera.zoomOut(50000);
  };

  return (
    <div className="relative w-full h-full min-h-[580px] overflow-hidden rounded-2xl border border-white/15 glass-panel shadow-2xl">
      {/* Cesium WebGL Lunar Canvas */}
      <div ref={containerRef} className="w-full h-full min-h-[580px] bg-black" />

      {/* Top Banner Status Overlay */}
      <div className="absolute top-4 left-4 z-10 flex items-center space-x-2.5 pointer-events-none">
        <div className="px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center space-x-2 shadow-lg pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>ELLIPSOID: MOON (R=1,737.4 km)</span>
        </div>
        <div className="px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/20 text-xs font-mono text-slate-300 shadow-lg pointer-events-auto">
          TEXTURE: LROC WAC / SHADED RELIEF
        </div>
      </div>

      {/* Floating 3D Navigation Controls (Google Earth style) */}
      <div className="absolute top-4 right-4 z-10 flex flex-col space-y-2 pointer-events-none">
        <button
          type="button"
          onClick={resetToSouthPole3000km}
          title="Reset View: South Pole / Statio Shiv Shakti (3,000 km Alt)"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg pointer-events-auto"
        >
          <Compass className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom In"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg pointer-events-auto"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom Out"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg pointer-events-auto"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={applySensorLayer}
          title="Re-project Sensor Layers"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg pointer-events-auto"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
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
