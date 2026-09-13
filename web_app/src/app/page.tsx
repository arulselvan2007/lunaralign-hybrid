"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import VideoBackground from "@/components/VideoBackground";
import ControlPanel from "@/components/ControlPanel";
import LayerToggleHUD, { SensorLayerMode } from "@/components/LayerToggleHUD";
import GeolocationInspector from "@/components/GeolocationInspector";
import TelemetryHUD from "@/components/TelemetryHUD";
import LandmarkDetailDrawer from "@/components/LandmarkDetailDrawer";
import { LunarLandmark } from "@/data/lunarLandmarks";
import { Moon, Satellite, Sparkles, Terminal, Activity } from "lucide-react";

// Dynamically import LunarGlobe with ssr: false since Cesium requires window and WebGL
const LunarGlobe = dynamic(() => import("@/components/LunarGlobe"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[580px] rounded-2xl glass-panel flex flex-col items-center justify-center text-cyan-400 font-mono text-sm space-y-3">
      <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      <span>INITIALIZING CESIUMJS 3D LUNAR ENVIRONMENT...</span>
    </div>
  ),
});

export default function LunarAlignMissionControl() {
  const [tiles, setTiles] = useState<Array<{ filename: string; relative_path: string; size_bytes: number }>>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [activeVizUrl, setActiveVizUrl] = useState<string | null>("/static/matches_visualization.png");
  const [backendOnline, setBackendOnline] = useState(false);

  // Multi-Sensor & Visual Environment State
  const [currentLayer, setCurrentLayer] = useState<SensorLayerMode>("tmc2_ortho");
  const [enableLighting, setEnableLighting] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showAlignmentFootprint, setShowAlignmentFootprint] = useState(true);

  // Selected Landmark for Telemetry Drawer & Camera Fly-To
  const [selectedLandmark, setSelectedLandmark] = useState<LunarLandmark | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<LunarLandmark | null>(null);

  // Real-time Mouse-over Coordinates Inspector
  const [cursorCoords, setCursorCoords] = useState<{
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
  }>({
    lat: -72.9,
    lon: 43.2,
    elevation_m: -1850,
  });
  const [cameraAltitude_km, setCameraAltitude_km] = useState<number | null>(380);

  // Simulated Boguslawsky Crater / South Pole-Aitken Basin Coordinates
  const [lunarCoords, setLunarCoords] = useState({
    target_region: "Boguslawsky Crater / Lunar South Pole",
    center_lat: -72.9,
    center_lon: 43.2,
    bounding_box: {
      west: 42.5,
      south: -73.5,
      east: 43.9,
      north: -72.3,
    },
    elevation_m: -1850,
  });

  // Fetch initial tiles and metrics from FastAPI backend
  const fetchBackendData = async () => {
    try {
      const healthRes = await fetch("/api/health");
      if (healthRes.ok) {
        setBackendOnline(true);
      }

      const tilesRes = await fetch("/api/tiles");
      if (tilesRes.ok) {
        const data = await tilesRes.json();
        setTiles(data);
      }

      const metricsRes = await fetch("/api/metrics");
      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setMetrics(data);
      }
    } catch (err) {
      setBackendOnline(false);
    }
  };

  useEffect(() => {
    fetchBackendData();
    const interval = setInterval(fetchBackendData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Trigger Matcher (LightGlue + USAC_MAGSAC)
  const handleRunMatch = async (params: {
    tile_a: string;
    tile_b: string;
    reproj_thresh: number;
    max_kpts: number;
    device: string;
  }) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Alignment failed.");
      }

      const matchData = await res.json();
      setMetrics(matchData);
      if (matchData.viz_url) {
        setActiveVizUrl(`${matchData.viz_url}?t=${Date.now()}`);
      }
      if (matchData.simulated_lunar_coords) {
        setLunarCoords(matchData.simulated_lunar_coords);
      }
    } catch (err: any) {
      alert(`Alignment error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger C++ Ingestion
  const handleRunIngest = async () => {
    setIngesting(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_path: "data/raw/lunar_test.tif",
          output_dir: "data/tiles",
          chunk_size: 1024,
          dry_run: false,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Ingestion failed.");
      }

      await fetchBackendData();
    } catch (err: any) {
      alert(`Ingestion error: ${err.message}`);
    } finally {
      setIngesting(false);
    }
  };

  // Landmark Selection Handlers
  const handleSelectLandmark = (landmark: LunarLandmark) => {
    setSelectedLandmark(landmark);
    setFlyToTarget(landmark);
  };

  const handleUpdateCoords = (coords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
    cameraAltitude_km: number | null;
  }) => {
    if (coords.lat !== null) {
      setCursorCoords({
        lat: coords.lat,
        lon: coords.lon,
        elevation_m: coords.elevation_m,
      });
    }
    if (coords.cameraAltitude_km !== null) {
      setCameraAltitude_km(coords.cameraAltitude_km);
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden flex flex-col justify-between bg-black text-slate-100">
      {/* 1. Full-Screen Orbital Video & Starry Deep-Space Canvas */}
      <VideoBackground />

      {/* 2. Mission Control Header Bar */}
      <header className="relative z-20 px-5 py-3 backdrop-blur-md bg-black/50 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/30 via-sky-600/30 to-indigo-600/30 border border-cyan-400/40 shadow-lg shadow-cyan-500/20">
            <Moon className="w-5 h-5 text-cyan-300 animate-pulse-slow" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold tracking-tight text-white flex items-center space-x-1.5">
                <span>LunarAlign-Hybrid</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  MISSION CONTROL
                </span>
              </h1>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Google Earth for the Moon • ISRO Chandrayaan-2 TMC-2 Surface Intelligence
            </p>
          </div>
        </div>

        {/* Global Telemetry Badges */}
        <div className="flex items-center space-x-3 font-mono text-xs">
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1 rounded-lg bg-black/50 border border-white/10 text-slate-300">
            <Satellite className="w-3.5 h-3.5 text-cyan-400" />
            <span>ORBIT: 100 km CIRCULAR POLAR</span>
          </div>

          <div
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-[11px] border ${
              backendOnline
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                : "bg-amber-950/60 border-amber-500/40 text-amber-300"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                backendOnline ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
            />
            <span>FASTAPI: {backendOnline ? "PORT 8000 ONLINE" : "CONNECTING..."}</span>
          </div>
        </div>
      </header>

      {/* 3. Central Application Space */}
      <div className="relative z-10 flex-1 p-4 lg:p-5 flex flex-col lg:flex-row gap-4 overflow-hidden">
        {/* Left Side: Spacecraft Control Panel & Multi-Sensor Layer HUD */}
        <div className="w-full lg:w-[410px] flex-shrink-0 flex flex-col space-y-4 overflow-y-auto pr-1">
          <ControlPanel
            tiles={tiles}
            onRunMatch={handleRunMatch}
            onRunIngest={handleRunIngest}
            isLoading={isLoading}
            ingesting={ingesting}
          />

          <LayerToggleHUD
            currentLayer={currentLayer}
            onLayerChange={setCurrentLayer}
            enableLighting={enableLighting}
            onToggleLighting={setEnableLighting}
            showLabels={showLabels}
            onToggleLabels={setShowLabels}
            showAlignmentFootprint={showAlignmentFootprint}
            onToggleAlignment={setShowAlignmentFootprint}
          />
        </div>

        {/* Right Side: 3D Lunar Globe, Geolocation Inspector, & Telemetry HUD */}
        <section className="flex-1 flex flex-col space-y-3 min-w-0 h-full overflow-y-auto pr-1">
          {/* 3D Cesium Lunar Globe */}
          <div className="flex-1 min-h-[460px] relative">
            <LunarGlobe
              lunarCoords={lunarCoords}
              metrics={metrics}
              isLoading={isLoading}
              activeTileUrl={activeVizUrl}
              currentLayer={currentLayer}
              enableLighting={enableLighting}
              showLabels={showLabels}
              showAlignmentFootprint={showAlignmentFootprint}
              onSelectLandmark={handleSelectLandmark}
              onUpdateCoords={handleUpdateCoords}
              flyToLandmark={flyToTarget}
            />
          </div>

          {/* Real-time Geolocation Inspector & Quick-Jump Landmark Rail */}
          <GeolocationInspector
            currentCoords={cursorCoords}
            cameraAltitude_km={cameraAltitude_km}
            onSelectLandmark={handleSelectLandmark}
            selectedLandmarkId={selectedLandmark?.id}
          />

          {/* Telemetry HUD Panel */}
          <TelemetryHUD metrics={metrics} vizUrl={activeVizUrl} />
        </section>
      </div>

      {/* 4. Landmark Detail Drawer (Slide-over on landmark click) */}
      <LandmarkDetailDrawer
        landmark={selectedLandmark}
        onClose={() => setSelectedLandmark(null)}
        onFlyTo={(lm) => setFlyToTarget(lm)}
      />

      {/* 5. Footer Telemetry Bar */}
      <footer className="relative z-20 px-5 py-2 backdrop-blur-md bg-black/70 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center space-x-3">
          <span>COORDINATE SYSTEM: LUNAR IAU2000</span>
          <span className="hidden md:inline">•</span>
          <span className="hidden md:inline">DATUM: MOON SPHERE (R=1,737.4 km)</span>
          <span className="hidden md:inline">•</span>
          <span className="hidden md:inline">SOLAR TERMINATOR: {enableLighting ? "ENABLED" : "STATIC"}</span>
        </div>
        <div className="flex items-center space-x-1.5 text-cyan-400">
          <Sparkles className="w-3.5 h-3.5" />
          <span>USAC_MAGSAC SUB-PIXEL MARGINALIZATION ACTIVE</span>
        </div>
      </footer>
    </main>
  );
}
