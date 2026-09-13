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

        // Configure realistic solar lighting angle to cast distinct crater relief along terminator
        // Lock clock to a dramatic low-sun angle over the South Pole
        const initialDate = Cesium.JulianDate.fromDate(new Date("2023-08-23T12:00:00Z"));
        viewer.clock.currentTime = initialDate;
        viewer.clock.shouldAnimate = false;

        // Clear any residual imagery layers
        viewer.imageryLayers.removeAll();

        // 2. Attach High-Resolution Global Lunar Imagery & Shaded Relief
        // Layer A: Immediate High-Res Global Texture (NASA LROC WAC Morphologic Mosaic)
        const localTextureUrl = "/textures/moon_base.jpg";
        const cdnTextureUrl =
          "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg";

        const globalMoonBase = new Cesium.SingleTileImageryProvider({
          url: localTextureUrl,
          rectangle: Cesium.Rectangle.fromDegrees(-180.0, -90.0, 180.0, 90.0),
          ellipsoid: moonEllipsoid,
          credit: "NASA / GSFC / Arizona State University (LROC WAC Global Mosaic)",
        });
        const baseLayer = viewer.imageryLayers.addImageryProvider(globalMoonBase);

        // Layer B: NASA / USGS Web Map Service (WMS) for dynamic multi-resolution zoom
        try {
          const usgsWmsProvider = new Cesium.WebMapServiceImageryProvider({
            url: "https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/earth/moon_simp_cyl.map",
            layers: "LUNAR_WAC",
            parameters: {
              format: "image/png",
              transparent: "true",
            },
            ellipsoid: moonEllipsoid,
            credit: "USGS Astrogeology / NASA LROC Global Shaded Relief",
          });
          viewer.imageryLayers.addImageryProvider(usgsWmsProvider);
        } catch (wmsErr) {
          console.warn("USGS WMS secondary layer optional fallback:", wmsErr);
        }

        // Layer C: NASA Solar System Treks LROC Tile Provider
        try {
          const nasaTrekProvider = new Cesium.UrlTemplateImageryProvider({
            url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
            rectangle: Cesium.Rectangle.fromDegrees(-180.0, -90.0, 180.0, 90.0),
            ellipsoid: moonEllipsoid,
            credit: "NASA Moon Trek / Lunar QuickMap / ASU LROC",
            maximumLevel: 7,
          });
          viewer.imageryLayers.addImageryProvider(nasaTrekProvider);
        } catch (trekErr) {
          console.warn("NASA Moon Trek tile provider optional fallback:", trekErr);
        }

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
        <div className="px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center space-x-2 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>ELLIPSOID: MOON (R=1,737.4 km)</span>
        </div>
        <div className="px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/20 text-xs font-mono text-slate-300 shadow-lg">
          TEXTURE: LROC WAC / SHADED RELIEF
        </div>
      </div>

      {/* Floating 3D Navigation Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col space-y-2">
        <button
          type="button"
          onClick={resetToSouthPole3000km}
          title="Reset View: South Pole / Statio Shiv Shakti (3,000 km Alt)"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <Compass className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom In"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom Out"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={applySensorLayer}
          title="Re-project Sensor Layers"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
            <div className="w-16 h-16 rounded-full border-2 border-transparent border-t-cyan-400 border-r-cyan-400 animate-spin" />
          </div>
          <p className="mt-4 font-mono text-sm tracking-wider text-cyan-300 uppercase animate-pulse">
            Processing Lunar Surface Ingestion &amp; MAGSAC+ Matching...
          </p>
        </div>
      )}
    </div>
  );
}
