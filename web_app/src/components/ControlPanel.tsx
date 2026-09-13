"use client";

import React, { useState } from "react";
import {
  Play,
  RotateCw,
  Sliders,
  Layers,
  Sparkles,
  Cpu,
  CheckCircle2,
  AlertCircle,
  FileImage,
} from "lucide-react";

interface ControlPanelProps {
  tiles: Array<{ filename: string; relative_path: string; size_bytes: number }>;
  onRunMatch: (params: {
    tile_a: string;
    tile_b: string;
    reproj_thresh: number;
    max_kpts: number;
    device: string;
  }) => Promise<void>;
  onRunIngest: () => Promise<void>;
  isLoading: boolean;
  ingesting: boolean;
}

export default function ControlPanel({
  tiles,
  onRunMatch,
  onRunIngest,
  isLoading,
  ingesting,
}: ControlPanelProps) {
  const [selectedTileA, setSelectedTileA] = useState("data/tiles/chunk_x0_y0.tif");
  const [selectedTileB, setSelectedTileB] = useState("data/tiles/chunk_x1_y0.tif");
  const [reprojThresh, setReprojThresh] = useState(3.0);
  const [maxKpts, setMaxKpts] = useState(2048);
  const [device, setDevice] = useState("auto");
  const [activeTab, setActiveTab] = useState<"align" | "ingest">("align");

  const handleMatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRunMatch({
      tile_a: selectedTileA,
      tile_b: selectedTileB,
      reproj_thresh: reprojThresh,
      max_kpts: maxKpts,
      device: device,
    });
  };

  return (
    <aside className="w-full lg:w-[420px] flex-shrink-0 flex flex-col space-y-4">
      {/* Flight Control Cockpit Panel */}
      <div className="rounded-2xl p-5 backdrop-blur-md bg-white/10 border border-white/20 shadow-2xl relative overflow-hidden">
        {/* Subtle scan-line laser effect */}
        <div className="scan-line" />

        {/* Panel Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Sliders className="w-4 h-4" />
            </span>
            <h2 className="font-semibold text-sm tracking-wide uppercase text-slate-100">
              Orbital Control Interface
            </h2>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/80 text-cyan-400 border border-cyan-500/40">
            CHANDRAYAAN-2 TMC-2
          </span>
        </div>

        {/* Mode Tabs */}
        <div className="grid grid-cols-2 gap-2 mt-4 p-1 bg-black/40 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("align")}
            className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "align"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Deep Alignment (LightGlue)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ingest")}
            className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
              activeTab === "ingest"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            C++ Windowed Slicing
          </button>
        </div>

        {/* Form Body */}
        {activeTab === "align" ? (
          <form onSubmit={handleMatchSubmit} className="space-y-4 mt-4">
            {/* Tile A (Reference) */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1.5 flex items-center justify-between">
                <span>PASS 1 (REFERENCE TILE)</span>
                <span className="text-[10px] text-cyan-400">1024x1024 px</span>
              </label>
              <div className="relative">
                <select
                  value={selectedTileA}
                  onChange={(e) => setSelectedTileA(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-slate-900/80 border border-white/15 text-slate-200 focus:outline-none focus:border-cyan-400 transition-colors"
                >
                  {tiles.length > 0 ? (
                    tiles.map((t) => (
                      <option key={t.filename} value={t.relative_path}>
                        {t.filename} ({(t.size_bytes / 1024).toFixed(0)} KB)
                      </option>
                    ))
                  ) : (
                    <option value="data/tiles/chunk_x0_y0.tif">chunk_x0_y0.tif (Default)</option>
                  )}
                </select>
              </div>
            </div>

            {/* Tile B (Target) */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1.5 flex items-center justify-between">
                <span>PASS 2 (TARGET TILE)</span>
                <span className="text-[10px] text-cyan-400">Co-Registration Pass</span>
              </label>
              <div className="relative">
                <select
                  value={selectedTileB}
                  onChange={(e) => setSelectedTileB(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl bg-slate-900/80 border border-white/15 text-slate-200 focus:outline-none focus:border-cyan-400 transition-colors"
                >
                  {tiles.length > 0 ? (
                    tiles.map((t) => (
                      <option key={t.filename} value={t.relative_path}>
                        {t.filename} ({(t.size_bytes / 1024).toFixed(0)} KB)
                      </option>
                    ))
                  ) : (
                    <option value="data/tiles/chunk_x1_y0.tif">chunk_x1_y0.tif (Default)</option>
                  )}
                </select>
              </div>
            </div>

            {/* Hyperparameters */}
            <div className="pt-2 border-t border-white/10 space-y-3">
              {/* MAGSAC+ Noise Threshold */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-300">USAC_MAGSAC NOISE SCALE</span>
                  <span className="text-cyan-400">{reprojThresh} px</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.5"
                  value={reprojThresh}
                  onChange={(e) => setReprojThresh(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Max Keypoints */}
              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-300">MAX KEYPOINTS (DISK)</span>
                  <span className="text-cyan-400">{maxKpts}</span>
                </div>
                <input
                  type="range"
                  min="512"
                  max="4096"
                  step="256"
                  value={maxKpts}
                  onChange={(e) => setMaxKpts(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Hardware Device */}
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">EXECUTION DEVICE</label>
                <select
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-slate-900/80 border border-white/15 text-slate-200 focus:outline-none focus:border-cyan-400"
                >
                  <option value="auto">Auto (MPS / CUDA / CPU)</option>
                  <option value="cpu">CPU (High Stability)</option>
                  <option value="mps">Apple Silicon MPS</option>
                  <option value="cuda">NVIDIA CUDA</option>
                </select>
              </div>
            </div>

            {/* Premium "Align & Project" Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full relative group overflow-hidden rounded-xl p-[1px] focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300"
              >
                {/* Glowing neon animated border */}
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-sky-500 to-indigo-500 rounded-xl transition-all duration-500 group-hover:opacity-100 opacity-80 blur-sm group-hover:blur-md" />
                <div className="relative px-5 py-3 rounded-xl bg-slate-950/90 hover:bg-slate-900/90 text-white flex items-center justify-center space-x-2 transition-all duration-200">
                  {isLoading ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin text-cyan-400" />
                      <span className="text-sm font-semibold tracking-wide uppercase text-cyan-300">
                        Running MAGSAC+...
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                      <span className="text-sm font-semibold tracking-wide uppercase">
                        Align & Project 3D
                      </span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </form>
        ) : (
          /* C++ Ingestion Tab */
          <div className="mt-4 space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Trigger the high-performance C++ GDAL slicing engine. Loads large Chandrayaan-2 TMC-2
              GeoTIFFs and outputs 1024x1024 georeferenced chunks with bounded $O(1)$ memory usage.
            </p>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10 text-xs font-mono space-y-1">
              <div className="text-slate-400">Input Source: data/raw/lunar_test.tif</div>
              <div className="text-slate-400">Tile Target: data/tiles/</div>
              <div className="text-cyan-400 font-semibold">Memory Ceiling: ~1.00 MB / chunk</div>
            </div>
            <button
              type="button"
              onClick={onRunIngest}
              disabled={ingesting}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-white/20 text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {ingesting ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Slicing Raster...</span>
                </>
              ) : (
                <>
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span>Execute C++ Ingestion</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Dataset & Mission Specs Badge */}
      <div className="rounded-2xl p-4 backdrop-blur-md bg-white/5 border border-white/10 shadow-lg text-xs space-y-2">
        <div className="flex items-center justify-between text-slate-300 font-mono">
          <span className="flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>MISSION STATUS</span>
          </span>
          <span className="text-emerald-400 font-semibold">ORBITAL SYNCHRONIZED</span>
        </div>
        <div className="text-[11px] text-slate-400 leading-normal">
          ISRO Chandrayaan-2 Terrain Mapping Camera-2 (TMC-2) operates in the 0.5–0.85 μm spectral
          band at 5m spatial resolution, covering high-relief polar crater basins.
        </div>
      </div>
    </aside>
  );
}
