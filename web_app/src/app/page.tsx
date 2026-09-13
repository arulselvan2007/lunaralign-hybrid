"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import VideoBackground from "@/components/VideoBackground";
import ControlPanel from "@/components/ControlPanel";
import TelemetryHUD from "@/components/TelemetryHUD";
import { Moon, Orbit, Satellite, Sparkles, Terminal } from "lucide-react";

// Dynamically import LunarGlobe with ssr: false since Cesium requires window and WebGL
const LunarGlobe = dynamic(() => import("@/components/LunarGlobe"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[600px] rounded-2xl glass-panel flex flex-col items-center justify-center text-cyan-400 font-mono text-sm space-y-3">
      <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      <span>INITIALIZING CESIUMJS LUNAR GLOBE ENGINE...</span>
    </div>
  ),
});

export default function LunarAlignApp() {
  const [tiles, setTiles] = useState<Array<{ filename: string; relative_path: string; size_bytes: number }>>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [activeVizUrl, setActiveVizUrl] = useState<string | null>("/static/matches_visualization.png");
  const [backendOnline, setBackendOnline] = useState(false);

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
      console.warn("Backend offline or waiting for uvicorn boot:", err);
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
      alert(`Pipeline error: ${err.message}`);
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

  return (
    <main className="relative w-screen h-screen overflow-hidden flex flex-col justify-between">
      {/* 1. Full-Screen Chandrayaan-2 Video Background */}
      <VideoBackground />

      {/* 2. Top Navigation Bar */}
      <header className="relative z-20 px-6 py-3.5 backdrop-blur-md bg-black/40 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500/30 to-sky-600/30 border border-cyan-400/40 shadow-lg shadow-cyan-500/20">
            <Moon className="w-5 h-5 text-cyan-300" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold tracking-tight text-white flex items-center space-x-1.5">
                <span>LunarAlign-Hybrid</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  v2.0
                </span>
              </h1>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Google Maps for the Moon • ISRO Chandrayaan-2 TMC-2 Surface Intelligence
            </p>
          </div>
        </div>

        {/* Status Indicators */}
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
            <span>FASTAPI: {backendOnline ? "ONLINE (PORT 8000)" : "CONNECTING..."}</span>
          </div>
        </div>
      </header>

      {/* 3. Central Application Space */}
      <div className="relative z-10 flex-1 p-4 lg:p-6 flex flex-col lg:flex-row gap-5 overflow-hidden">
        {/* Left: Spacecraft Control Panel */}
        <ControlPanel
          tiles={tiles}
          onRunMatch={handleRunMatch}
          onRunIngest={handleRunIngest}
          isLoading={isLoading}
          ingesting={ingesting}
        />

        {/* Right: 3D Cesium Lunar Globe & Telemetry HUD */}
        <section className="flex-1 flex flex-col space-y-4 min-w-0 h-full overflow-y-auto pr-1">
          {/* 3D Lunar Globe Container */}
          <div className="flex-1 min-h-[460px]">
            <LunarGlobe
              lunarCoords={lunarCoords}
              metrics={metrics}
              isLoading={isLoading}
              activeTileUrl={activeVizUrl}
            />
          </div>

          {/* Telemetry HUD Panel */}
          <TelemetryHUD metrics={metrics} vizUrl={activeVizUrl} />
        </section>
      </div>

      {/* 4. Footer Telemetry Bar */}
      <footer className="relative z-20 px-6 py-2 backdrop-blur-md bg-black/60 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center space-x-4">
          <span>COORDINATE SYSTEM: LUNAR IAU2000</span>
          <span className="hidden md:inline">|</span>
          <span className="hidden md:inline">GEODETIC DATUM: MOON SPHERE (R=1737.4 km)</span>
        </div>
        <div className="flex items-center space-x-2 text-cyan-400">
          <Sparkles className="w-3.5 h-3.5" />
          <span>MAGSAC+ NON-PARAMETRIC SHADOW REJECTION ACTIVE</span>
        </div>
      </footer>
    </main>
  );
}
