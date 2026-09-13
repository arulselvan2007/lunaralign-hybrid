"use client";

import React from "react";
import {
  X,
  Compass,
  MapPin,
  Flame,
  Activity,
  Calendar,
  Layers,
  ChevronRight,
} from "lucide-react";
import { LunarLandmark } from "@/data/lunarLandmarks";

interface LandmarkDetailDrawerProps {
  landmark: LunarLandmark | null;
  onClose: () => void;
  onFlyTo: (landmark: LunarLandmark) => void;
}

export default function LandmarkDetailDrawer({
  landmark,
  onClose,
  onFlyTo,
}: LandmarkDetailDrawerProps) {
  if (!landmark) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-md w-full animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="rounded-2xl p-5 backdrop-blur-xl bg-slate-950/90 border border-cyan-500/40 shadow-2xl shadow-cyan-950/60 text-xs space-y-3 relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between pb-2 border-b border-white/10">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                {landmark.category.toUpperCase()}
              </span>
              {landmark.mission && (
                <span className="text-[10px] font-mono text-amber-400">
                  {landmark.mission.split(" (")[0]}
                </span>
              )}
            </div>
            <h3 className="text-base font-bold text-white mt-1">{landmark.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Spatial Coordinates Grid */}
        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-white/10 font-mono text-[11px]">
          <div>
            <span className="text-[10px] text-slate-500 block">LATITUDE</span>
            <span className="font-bold text-cyan-300">{landmark.lat.toFixed(3)}°</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">LONGITUDE</span>
            <span className="font-bold text-cyan-300">{landmark.lon.toFixed(3)}°</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block">ELEVATION</span>
            <span className="font-bold text-emerald-300">{landmark.elevation_m}m</span>
          </div>
          {landmark.diameter_km && (
            <div className="col-span-3 pt-1 border-t border-white/5 flex justify-between text-slate-400">
              <span>Diameter: {landmark.diameter_km} km</span>
              {landmark.depth_km && <span>Depth: {landmark.depth_km} km</span>}
            </div>
          )}
        </div>

        {/* Description */}
        <p className="text-slate-300 leading-relaxed text-[11px]">{landmark.description}</p>

        {/* Spectral Profile */}
        {landmark.spectral_profile && (
          <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] space-y-1">
            <div className="flex items-center space-x-1.5 text-amber-400 font-mono text-[10px] uppercase font-semibold">
              <Flame className="w-3.5 h-3.5" />
              <span>IIRS Spectral Signature</span>
            </div>
            <p className="text-amber-200/90 text-[10px]">{landmark.spectral_profile}</p>
          </div>
        )}

        {/* Geological Relevance */}
        <div className="text-[11px] text-slate-400 leading-normal border-t border-white/10 pt-2">
          <span className="text-slate-300 font-semibold">Geological Significance: </span>
          {landmark.geological_interest}
        </div>

        {/* Fly-To Button */}
        <button
          type="button"
          onClick={() => onFlyTo(landmark)}
          className="w-full py-2 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white font-semibold text-xs transition-all shadow-lg flex items-center justify-center space-x-2"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Center & Orbit Landmark in 3D</span>
        </button>
      </div>
    </div>
  );
}
