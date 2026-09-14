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

export type SensorLayerMode =
  | "ohrc_framing"
  | "tmc2_ortho"
  | "iirs_mineral"
  | "dem_topography";

interface LayerToggleHUDProps {
  currentLayer: SensorLayerMode;
  onLayerChange: (layer: SensorLayerMode) => void;
  enableLighting: boolean;
  onToggleLighting: (enabled: boolean) => void;
  showLabels: boolean;
  onToggleLabels: (show: boolean) => void;
  showAlignmentFootprint: boolean;
  onToggleAlignment: (show: boolean) => void;
  showUncertaintyMap: boolean;
  onToggleUncertainty: (show: boolean) => void;
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
  showUncertaintyMap,
  onToggleUncertainty,
}: LayerToggleHUDProps) {
  return (
    <div className="rounded-2xl p-4 backdrop-blur-xl bg-white/10 border border-white/20 shadow-2xl space-y-3.5">
      {/* HUD Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center space-x-2 text-slate-200">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-semibold uppercase tracking-wider">
            Decoupled Sensor Layers
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
          ISRO PAYLOADS
        </span>
      </div>

      {/* Sensor Layer Buttons: 4 Analytical Modes */}
      <div className="grid grid-cols-2 gap-2">
        {/* Layer 1: OHRC High-Resolution Framing */}
        <button
          type="button"
          onClick={() => onLayerChange("ohrc_framing")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "ohrc_framing"
              ? "bg-purple-500/25 border-purple-400 shadow-md shadow-purple-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Camera className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[9px] font-mono text-purple-300 font-semibold">0.25m PAN</span>
          </div>
          <div className="text-xs font-semibold">OHRC Framing</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Boulders &amp; Rim Shadows
          </div>
        </button>

        {/* Layer 2: TMC-2 Stereo Regional Ortho */}
        <button
          type="button"
          onClick={() => onLayerChange("tmc2_ortho")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "tmc2_ortho"
              ? "bg-cyan-500/25 border-cyan-400 shadow-md shadow-cyan-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[9px] font-mono text-cyan-300 font-semibold">5m DEM TINT</span>
          </div>
          <div className="text-xs font-semibold">TMC-2 Ortho</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Hypsometric Hillshade
          </div>
        </button>

        {/* Layer 3: IIRS Mineralogy */}
        <button
          type="button"
          onClick={() => onLayerChange("iirs_mineral")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "iirs_mineral"
              ? "bg-amber-500/25 border-amber-400 shadow-md shadow-amber-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[9px] font-mono text-amber-300 font-semibold">80m HYPERSPEC</span>
          </div>
          <div className="text-xs font-semibold">IIRS Mineralogy</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Cyan Ice / Orange Basalts
          </div>
        </button>

        {/* Layer 4: DEM Topography */}
        <button
          type="button"
          onClick={() => onLayerChange("dem_topography")}
          className={`p-2.5 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between ${
            currentLayer === "dem_topography"
              ? "bg-emerald-500/25 border-emerald-400 shadow-md shadow-emerald-500/20 text-white"
              : "bg-black/30 border-white/10 text-slate-300 hover:bg-white/5"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <Mountain className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[9px] font-mono text-emerald-300 font-semibold">LOLA ELEV</span>
          </div>
          <div className="text-xs font-semibold">DEM Topography</div>
          <div className="text-[10px] text-slate-400 line-clamp-1">
            Hypsometric Heatmap
          </div>
        </button>
      </div>

      {/* Layer Description Legend */}
      <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-slate-300 flex items-start space-x-2">
        <Info className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div>
          {currentLayer === "ohrc_framing" && (
            <span>
              <strong className="text-purple-300">OHRC 0.25m High-Resolution Framing:</strong> High-contrast sharpened panchromatic grayscale imaging sub-meter boulder fields, micro-craters, and razor-sharp shadow-casting rim boundaries.
            </span>
          )}
          {currentLayer === "tmc2_ortho" && (
            <span>
              <strong className="text-cyan-300">TMC-2 5m Stereo Ortho &amp; DEM:</strong> 3D Hillshade with hypsometric elevation tint (blue &rarr; green &rarr; brown &rarr; white) mapping regional stereo macro-topography.
            </span>
          )}
          {currentLayer === "iirs_mineral" && (
            <span>
              <strong className="text-amber-300">IIRS 80m Hyperspectral Mineralogy:</strong> Saturated band-ratio composite distinguishing{" "}
              <span className="text-cyan-400 font-semibold">cryogenic water-ice cold traps</span>,{" "}
              <span className="text-orange-400 font-semibold">Fe²⁺/Ti basaltic volcanism</span>, and{" "}
              <span className="text-lime-400 font-semibold">anorthosite highlands</span>.
            </span>
          )}
          {currentLayer === "dem_topography" && (
            <span>
              <strong className="text-emerald-300">LOLA DEM Topography:</strong> Continuous hypsometric elevation colormap from deep basin floors (-9,000m) to peak crater rims (+8,000m).
            </span>
          )}
        </div>
      </div>

      {/* Environment & Telemetry Toggles */}
      <div className="pt-2 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        {/* Sun Lighting Toggle */}
        <button
          type="button"
          onClick={() => onToggleLighting(!enableLighting)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1 transition-colors ${
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
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1 transition-colors ${
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
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1 transition-colors ${
            showAlignmentFootprint
              ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle TMC-2 match bounding box and 3D inlier keypoints"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>FOOTPRINT</span>
        </button>

        {/* Uncertainty Heatmap Toggle */}
        <button
          type="button"
          onClick={() => onToggleUncertainty(!showUncertaintyMap)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1 transition-colors ${
            showUncertaintyMap
              ? "bg-rose-500/25 border-rose-400 text-rose-200 shadow-sm shadow-rose-500/30"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle quantitative registration uncertainty heatmap projection (Green: <0.25, Red: >0.65)"
        >
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>UNCERTAINTY</span>
        </button>
      </div>
    </div>
  );
}
