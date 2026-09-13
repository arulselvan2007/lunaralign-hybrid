"use client";

import React from "react";
import {
  Layers,
  Sun,
  MapPin,
  Sparkles,
  Mountain,
  Flame,
  Camera,
  Info,
} from "lucide-react";

export type SensorLayerMode = "tmc2_ortho" | "iirs_mineral" | "dem_topography";

interface LayerToggleHUDProps {
  currentLayer: SensorLayerMode;
  onLayerChange: (layer: SensorLayerMode) => void;
  enableLighting: boolean;
  onToggleLighting: (enabled: boolean) => void;
  showLabels: boolean;
  onToggleLabels: (show: boolean) => void;
  showAlignmentFootprint: boolean;
  onToggleAlignment: (show: boolean) => void;
}

export default function LayerToggleHUD({
  currentLayer,
  onLayerChange,
  enableLighting,
  onToggleLighting,
  showLabels,
  onToggleLabels,
  showAlignmentFootprint,
  onToggleAlignment,
}: LayerToggleHUDProps) {
  return (
    <div className="rounded-2xl p-4 backdrop-blur-md bg-white/10 border border-white/20 shadow-2xl space-y-3.5">
      {/* HUD Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center space-x-2 text-slate-200">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-semibold uppercase tracking-wider">
            Multi-Sensor Data Passes
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
          ISRO PAYLOADS
        </span>
      </div>

      {/* Sensor Layer Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Layer 1: TMC-2 Ortho */}
        <button
          type="button"
          onClick={() => onLayerChange("tmc2_ortho")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "tmc2_ortho"
              ? "bg-cyan-500/20 border-cyan-400 shadow-md shadow-cyan-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Camera className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[9px] font-mono text-cyan-300">5m RES</span>
          </div>
          <div className="text-xs font-semibold">TMC-2 / OHRC</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            High-Res Panchromatic Ortho
          </div>
        </button>

        {/* Layer 2: IIRS Mineralogy */}
        <button
          type="button"
          onClick={() => onLayerChange("iirs_mineral")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "iirs_mineral"
              ? "bg-amber-500/20 border-amber-400 shadow-md shadow-amber-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[9px] font-mono text-amber-300">0.8-5.0 μm</span>
          </div>
          <div className="text-xs font-semibold">IIRS Mineral Map</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Fe²⁺ / Pyroxene / H₂O Ice
          </div>
        </button>

        {/* Layer 3: DEM Topography */}
        <button
          type="button"
          onClick={() => onLayerChange("dem_topography")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "dem_topography"
              ? "bg-emerald-500/20 border-emerald-400 shadow-md shadow-emerald-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Mountain className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[9px] font-mono text-emerald-300">LOLA DEM</span>
          </div>
          <div className="text-xs font-semibold">DEM Topography</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Colorized Elevation Heatmap
          </div>
        </button>
      </div>

      {/* Layer Description Legend */}
      <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-slate-300 flex items-start space-x-2">
        <Info className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div>
          {currentLayer === "tmc2_ortho" && (
            <span>
              <strong className="text-cyan-300">TMC-2 High-Res:</strong> Panchromatic stereoscopic
              strip resolving meter-scale crater rim boulder fields and micro-topography.
            </span>
          )}
          {currentLayer === "iirs_mineral" && (
            <span>
              <strong className="text-amber-300">IIRS Spectral:</strong> False-color composite
              highlighting <span className="text-red-400">Iron (Fe²⁺)</span>,{" "}
              <span className="text-green-400">Titanium Basalts</span>, and{" "}
              <span className="text-cyan-400">Hydroxyl / Water-Ice Cold Traps</span>.
            </span>
          )}
          {currentLayer === "dem_topography" && (
            <span>
              <strong className="text-emerald-300">LOLA Topography:</strong> Hypsometric gradient
              from <span className="text-blue-400">-9,000m (SPA Basin)</span> to{" "}
              <span className="text-red-400">+8,000m (Highland Peaks)</span>.
            </span>
          )}
        </div>
      </div>

      {/* Environment & Telemetry Toggles */}
      <div className="pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-xs font-mono">
        {/* Sun Lighting Toggle */}
        <button
          type="button"
          onClick={() => onToggleLighting(!enableLighting)}
          className={`px-3 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            enableLighting
              ? "bg-amber-500/20 border-amber-400 text-amber-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle dynamic lunar solar terminator line (day/night boundary)"
        >
          <Sun className="w-3.5 h-3.5" />
          <span>TERMINATOR</span>
        </button>

        {/* Landmarks Labels Toggle */}
        <button
          type="button"
          onClick={() => onToggleLabels(!showLabels)}
          className={`px-3 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            showLabels
              ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle interactive 3D crater and landing site labels"
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>LANDMARKS</span>
        </button>

        {/* Alignment Footprint Toggle */}
        <button
          type="button"
          onClick={() => onToggleAlignment(!showAlignmentFootprint)}
          className={`px-3 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            showAlignmentFootprint
              ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle TMC-2 match bounding box and 3D inlier keypoints"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>FOOTPRINT</span>
        </button>
      </div>
    </div>
  );
}
