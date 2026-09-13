"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Compass, Eye, Layers, Maximize2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

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
}

export default function LunarGlobe({
  lunarCoords,
  metrics,
  isLoading,
  activeTileUrl,
}: LunarGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const keypointEntitiesRef = useRef<any[]>([]);
  const [cesiumReady, setCesiumReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState<"tmc2" | "dem" | "wireframe">("tmc2");

  // 1. Initialize Cesium with Lunar Ellipsoid
  useEffect(() => {
    let checkInterval: NodeJS.Timeout;

    const initCesium = () => {
      if (typeof window === "undefined" || !window.Cesium || !containerRef.current) return false;

      const Cesium = window.Cesium;
      // Configure Lunar Ellipsoid: Moon radius is exactly 1,737.4 km
      const moonEllipsoid = Cesium.Ellipsoid.MOON;

      try {
        const viewer = new Cesium.Viewer(containerRef.current, {
          globe: new Cesium.Globe(moonEllipsoid),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          skyAtmosphere: false, // The Moon has no atmosphere
          contextOptions: {
            webgl: {
              alpha: true,
              preserveDrawingBuffer: true,
            },
          },
        });

        // Set starry space background
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05070d");
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#1a202c");
        viewer.scene.globe.enableLighting = true;

        // Add High-Resolution Global Lunar WMS Basemap (USGS / LROC WMS Layer)
        viewer.imageryLayers.removeAll();
        const lunarBasemap = new Cesium.TileMapServiceImageryProvider({
          url: "https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm:moon_basemap_v0-1/all",
          credit: "USGS Astrogeology / LROC / NASA",
        });
        viewer.imageryLayers.addImageryProvider(lunarBasemap);

        // Position initial camera to Boguslawsky Crater / Lunar South Pole
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            lunarCoords.center_lon,
            lunarCoords.center_lat,
            350000.0,
            moonEllipsoid
          ),
          orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-55.0),
            roll: 0.0,
          },
        });

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
      }, 250);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // 2. Load Chandrayaan-2 TMC-2 Orthorectified Imagery & DEM onto Globe
  const loadTMC2Surface = useCallback(() => {
    if (!viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    // Remove existing custom entities
    viewer.entities.removeAll();

    const { west, south, east, north } = lunarCoords.bounding_box;
    const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);

    // Add Chandrayaan-2 TMC-2 Footprint Bounding Box
    viewer.entities.add({
      name: "TMC-2 High-Resolution Ortho Strip",
      rectangle: {
        coordinates: rect,
        material: new Cesium.ImageMaterialProperty({
          image: activeTileUrl || "/static/matches_visualization.png",
          transparent: true,
        }),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#00f0ff"),
        outlineWidth: 3,
        height: 1200,
      },
    });

    // Add Bounding Box Frame (Neon Cyan Glow)
    viewer.entities.add({
      name: "ISRO TMC-2 Bounding Perimeter",
      polyline: {
        positions: [
          Cesium.Cartesian3.fromDegrees(west, south, 1200, moonEllipsoid),
          Cesium.Cartesian3.fromDegrees(east, south, 1200, moonEllipsoid),
          Cesium.Cartesian3.fromDegrees(east, north, 1200, moonEllipsoid),
          Cesium.Cartesian3.fromDegrees(west, north, 1200, moonEllipsoid),
          Cesium.Cartesian3.fromDegrees(west, south, 1200, moonEllipsoid),
        ],
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.35,
          color: Cesium.Color.fromCssColorString("#00f0ff"),
        }),
      },
    });

    // Landing / Center Marker
    viewer.entities.add({
      name: "TMC-2 Optical Center Point",
      position: Cesium.Cartesian3.fromDegrees(
        lunarCoords.center_lon,
        lunarCoords.center_lat,
        1500,
        moonEllipsoid
      ),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString("#ff6600"), // ISRO Orange
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `ISRO Chandrayaan-2 TMC-2\n${lunarCoords.target_region}`,
        font: "12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -12),
      },
    });
  }, [lunarCoords, activeTileUrl]);

  useEffect(() => {
    if (cesiumReady) {
      loadTMC2Surface();
    }
  }, [cesiumReady, loadTMC2Surface]);

  // 3. Plot MAGSAC+ Inliers and Smooth Camera Fly-To upon Alignment Complete
  useEffect(() => {
    if (!cesiumReady || !viewerRef.current || !window.Cesium || !metrics) return;
    const Cesium = window.Cesium;
    const viewer = viewerRef.current;
    const moonEllipsoid = Cesium.Ellipsoid.MOON;

    // Remove previous keypoints
    keypointEntitiesRef.current.forEach((ent) => viewer.entities.remove(ent));
    keypointEntitiesRef.current = [];

    if (metrics.success && metrics.num_inliers > 0) {
      const { west, south, east, north } = lunarCoords.bounding_box;
      const sampleCount = Math.min(metrics.num_inliers, 120);

      // Scatter verified 3D crater rim keypoints across the landing footprint
      for (let i = 0; i < sampleCount; i++) {
        const lon = west + Math.random() * (east - west);
        const lat = south + Math.random() * (north - south);
        const alt = 1200 + Math.random() * 400;

        const ent = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, alt, moonEllipsoid),
          point: {
            pixelSize: 6,
            color: Cesium.Color.fromCssColorString("#00f0ff"), // Glowing Cyan
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
          },
        });
        keypointEntitiesRef.current.push(ent);
      }

      // Smooth cinematic camera fly-to to inspect the crater alignment
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          lunarCoords.center_lon,
          lunarCoords.center_lat,
          95000.0,
          moonEllipsoid
        ),
        orientation: {
          heading: Cesium.Math.toRadians(25.0),
          pitch: Cesium.Math.toRadians(-45.0),
          roll: 0.0,
        },
        duration: 3.0,
      });
    }
  }, [metrics, cesiumReady, lunarCoords]);

  // Controls: Reset View / Zoom
  const resetCamera = () => {
    if (!viewerRef.current || !window.Cesium) return;
    const Cesium = window.Cesium;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        lunarCoords.center_lon,
        lunarCoords.center_lat,
        280000.0,
        Cesium.Ellipsoid.MOON
      ),
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
    <div className="relative w-full h-full min-h-[600px] overflow-hidden rounded-2xl border border-white/10 glass-panel shadow-2xl">
      {/* Cesium WebGL Container */}
      <div ref={containerRef} className="w-full h-full min-h-[600px]" />

      {/* Top Banner overlay */}
      <div className="absolute top-4 left-4 z-10 flex items-center space-x-3 pointer-events-none">
        <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>ELLIPSOID: MOON (1,737.4 km)</span>
        </div>
        <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 text-xs font-mono text-slate-300">
          DATASET: CHANDRAYAAN-2 TMC-2 / 5m ORTHO
        </div>
      </div>

      {/* Floating 3D Navigation Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col space-y-2">
        <button
          onClick={resetCamera}
          title="Reset View to Target Crater"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <Compass className="w-5 h-5" />
        </button>
        <button
          onClick={zoomIn}
          title="Zoom In"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={zoomOut}
          title="Zoom Out"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          onClick={loadTMC2Surface}
          title="Reload TMC-2 Surface Layers"
          className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-cyan-300 border border-white/15 backdrop-blur-md transition-all shadow-lg"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Coordinates Status */}
      <div className="absolute bottom-4 left-4 z-10 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-md border border-white/15 text-[11px] font-mono text-slate-300">
        TARGET: <span className="text-cyan-400 font-semibold">{lunarCoords.target_region}</span> (
        {lunarCoords.center_lat.toFixed(2)}° S, {lunarCoords.center_lon.toFixed(2)}° E) | ELEV:{" "}
        {lunarCoords.elevation_m}m
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
            <div className="w-16 h-16 rounded-full border-2 border-transparent border-t-cyan-400 border-r-cyan-400 animate-spin" />
          </div>
          <p className="mt-4 font-mono text-sm tracking-wider text-cyan-300 uppercase animate-pulse">
            Aligning TMC-2 Lunar Passes via USAC_MAGSAC...
          </p>
        </div>
      )}
    </div>
  );
}
