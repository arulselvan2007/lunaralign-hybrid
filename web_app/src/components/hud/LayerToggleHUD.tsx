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
  Sliders,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { LayerOpacities } from "../canvas/LunarViewer";

export type SensorLayerMode =
  | "ohrc_framing"
  | "tmc2_ortho"
  | "iirs_mineral"
  | "dem_topography";

interface LayerToggleHUDProps {
  opacities: LayerOpacities;
  onOpacityChange: (layer: keyof LayerOpacities, value: number) => void;
  onSetAllOpacities?: (opacities: LayerOpacities) => void;
  enableLighting: boolean;
  onToggleLighting: (enabled: boolean) => void;
  showLabels: boolean;
  onToggleLabels: (show: boolean) => void;
  showAlignmentFootprint: boolean;
  onToggleAlignment: (show: boolean) => void;
  // Backward compatibility with legacy sensor selection
  currentLayer?: SensorLayerMode;
  onLayerChange?: (layer: SensorLayerMode) => void;
}

export default function LayerToggleHUD({
  opacities,
  onOpacityChange,
  onSetAllOpacities,
  enableLighting,
  onToggleLighting,
  showLabels,
  onToggleLabels,
  showAlignmentFootprint,
  onToggleAlignment,
  currentLayer = "tmc2_ortho",
  onLayerChange,
}: LayerToggleHUDProps) {
  // Preset configurations
  const applyPreset = (preset: "fusion" | "ohrc" | "mineral" | "uncertainty") => {
    if (!onSetAllOpacities) return;
    if (preset === "fusion") {
      onSetAllOpacities({ base: 1.0, topography: 0.7, mineral: 0.65, uncertainty: 0.0 });
    } else if (preset === "ohrc") {
      onSetAllOpacities({ base: 1.0, topography: 0.2, mineral: 0.0, uncertainty: 0.0 });
    } else if (preset === "mineral") {
      onSetAllOpacities({ base: 0.6, topography: 0.5, mineral: 0.95, uncertainty: 0.0 });
    } else if (preset === "uncertainty") {
      onSetAllOpacities({ base: 0.8, topography: 0.5, mineral: 0.0, uncertainty: 0.85 });
    }
  };

  return (
    <div className="rounded-2xl p-4 backdrop-blur-xl bg-slate-950/80 border border-white/15 shadow-2xl space-y-4 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
        <div className="flex items-center space-x-2 text-slate-200">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono font-semibold uppercase tracking-wider">
            Multi-Layer Draping &amp; Relief HUD
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-500/40">
          CHANDRAYAAN-2 TRIPLE SENSOR
        </span>
      </div>

      {/* Preset Quick-Buttons */}
      <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono">
        <button
          type="button"
          onClick={() => applyPreset("fusion")}
          className="px-2 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 text-cyan-300 transition-all text-center"
        >
          Fusion
        </button>
        <button
          type="button"
          onClick={() => applyPreset("ohrc")}
          className="px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-400/40 text-purple-300 transition-all text-center"
        >
          OHRC 0.25m
        </button>
        <button
          type="button"
          onClick={() => applyPreset("mineral")}
          className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 transition-all text-center"
        >
          IIRS 80m
        </button>
        <button
          type="button"
          onClick={() => applyPreset("uncertainty")}
          className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/40 text-rose-300 transition-all text-center"
        >
          MAGSAC++
        </button>
      </div>

      {/* Layer Opacity Sliders (0% - 100%) */}
      <div className="space-y-3 pt-1">
        {/* Layer 1: OHRC Optical Base */}
        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-purple-500/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Camera className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-semibold text-purple-200">OHRC Optical Base</span>
              <span className="text-[10px] font-mono text-slate-400">(0.25 m Nadir)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-purple-300 font-bold">
                {Math.round(opacities.base * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onOpacityChange("base", opacities.base > 0 ? 0 : 1)}
                className="text-slate-400 hover:text-white"
                title="Toggle layer visibility"
              >
                {opacities.base > 0 ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacities.base}
            onChange={(e) => onOpacityChange("base", parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
          />
        </div>

        {/* Layer 2: TMC-2 3D Topography Elevation */}
        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-cyan-500/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Mountain className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-cyan-200">TMC-2 3D Topography</span>
              <span className="text-[10px] font-mono text-slate-400">(5.0 m DEM Relief)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-cyan-300 font-bold">
                {Math.round(opacities.topography * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onOpacityChange("topography", opacities.topography > 0 ? 0 : 0.75)}
                className="text-slate-400 hover:text-white"
                title="Toggle topography displacement"
              >
                {opacities.topography > 0 ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacities.topography}
            onChange={(e) => onOpacityChange("topography", parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Layer 3: IIRS Mineral Composition */}
        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-amber-500/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-amber-200">IIRS Mineral Composition</span>
              <span className="text-[10px] font-mono text-slate-400">(80 m Hyperspectral)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-amber-300 font-bold">
                {Math.round(opacities.mineral * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onOpacityChange("mineral", opacities.mineral > 0 ? 0 : 0.85)}
                className="text-slate-400 hover:text-white"
                title="Toggle mineral layer"
              >
                {opacities.mineral > 0 ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacities.mineral}
            onChange={(e) => onOpacityChange("mineral", parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Layer 4: MAGSAC++ Registration Uncertainty */}
        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-rose-500/30 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold text-rose-200">MAGSAC++ Uncertainty</span>
              <span className="text-[10px] font-mono text-slate-400">(Geometric Error)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-rose-300 font-bold">
                {Math.round(opacities.uncertainty * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onOpacityChange("uncertainty", opacities.uncertainty > 0 ? 0 : 0.85)}
                className="text-slate-400 hover:text-white"
                title="Toggle uncertainty heatmap"
              >
                {opacities.uncertainty > 0 ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacities.uncertainty}
            onChange={(e) => onOpacityChange("uncertainty", parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
          />
        </div>
      </div>

      {/* Environmental & View Toggles */}
      <div className="pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-xs font-mono">
        <button
          type="button"
          onClick={() => onToggleLighting(!enableLighting)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            enableLighting
              ? "bg-amber-500/20 border-amber-400 text-amber-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle dynamic solar terminator illumination"
        >
          <Sun className="w-3.5 h-3.5" />
          <span>TERMINATOR</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleLabels(!showLabels)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            showLabels
              ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle 3D interactive lunar landmark pins"
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>LANDMARKS</span>
        </button>

        <button
          type="button"
          onClick={() => onToggleAlignment(!showAlignmentFootprint)}
          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-center space-x-1.5 transition-colors ${
            showAlignmentFootprint
              ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
              : "bg-slate-900/60 border-white/10 text-slate-400 hover:text-slate-200"
          }`}
          title="Toggle registration sector boundary & tie-point inliers"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>INLIERS</span>
        </button>
      </div>
    </div>
  );
}
