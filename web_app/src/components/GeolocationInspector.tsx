"use client";

import React from "react";
import {
  Compass,
  Crosshair,
  Globe2,
  Navigation,
  Sun,
  Moon,
  Layers,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { LUNAR_LANDMARKS, LunarLandmark } from "@/data/lunarLandmarks";

interface GeolocationInspectorProps {
  currentCoords: {
    lat: number | null;
    lon: number | null;
    elevation_m: number | null;
  };
  cameraAltitude_km: number | null;
  onSelectLandmark: (landmark: LunarLandmark) => void;
  selectedLandmarkId?: string | null;
}

export default function GeolocationInspector({
  currentCoords,
  cameraAltitude_km,
  onSelectLandmark,
  selectedLandmarkId,
}: GeolocationInspectorProps) {
  // Format coordinate strings into deg/min/sec or decimal
  const formatCoord = (val: number | null, isLat: boolean) => {
    if (val === null || isNaN(val)) return "--° --' --\"";
    const hemi = isLat ? (val >= 0 ? "N" : "S") : val >= 0 ? "E" : "W";
    const abs = Math.abs(val);
    const deg = Math.floor(abs);
    const min = Math.floor((abs - deg) * 60);
    const sec = Math.floor(((abs - deg) * 60 - min) * 60);
    return `${deg}° ${min}' ${sec}" ${hemi} (${val.toFixed(4)}°)`;
  };

  return (
    <div className="flex flex-col space-y-3">
      {/* Real-time Cursor Coordinates HUD */}
      <div className="rounded-2xl p-3.5 backdrop-blur-md bg-white/10 border border-white/20 shadow-xl flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
        {/* Latitude */}
        <div className="flex items-center space-x-2">
          <Crosshair className="w-4 h-4 text-cyan-400 animate-spin-slow" />
          <div>
            <div className="text-[10px] text-slate-400 uppercase">LUNAR LATITUDE</div>
            <div className="text-sm font-bold text-cyan-300">
              {formatCoord(currentCoords.lat, true)}
            </div>
          </div>
        </div>

        {/* Longitude */}
        <div className="flex items-center space-x-2">
          <Globe2 className="w-4 h-4 text-cyan-400" />
          <div>
            <div className="text-[10px] text-slate-400 uppercase">LUNAR LONGITUDE</div>
            <div className="text-sm font-bold text-cyan-300">
              {formatCoord(currentCoords.lon, false)}
            </div>
          </div>
        </div>

        {/* Elevation */}
        <div className="flex items-center space-x-2">
          <Navigation className="w-4 h-4 text-emerald-400" />
          <div>
            <div className="text-[10px] text-slate-400 uppercase">TOPOGRAPHY ELEVATION</div>
            <div className="text-sm font-bold text-emerald-300">
              {currentCoords.elevation_m !== null
                ? `${currentCoords.elevation_m >= 0 ? "+" : ""}${currentCoords.elevation_m.toLocaleString()} m`
                : "-1,850 m (Datum R=1,737.4 km)"}
            </div>
          </div>
        </div>

        {/* Camera Eye Altitude */}
        {cameraAltitude_km !== null && (
          <div className="hidden sm:flex items-center space-x-2 border-l border-white/10 pl-4">
            <Compass className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[10px] text-slate-400 uppercase">ORBIT ALTITUDE</div>
              <div className="text-sm font-bold text-amber-300">
                {cameraAltitude_km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick-Jump Lunar Landmark Rail */}
      <div className="rounded-2xl p-3 backdrop-blur-md bg-black/40 border border-white/10 shadow-lg">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center space-x-1.5 text-xs font-mono text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold uppercase tracking-wider">
              Quick-Jump Planetary Coordinates
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">CLICK TO FLY</span>
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-thin">
          {LUNAR_LANDMARKS.map((landmark) => {
            const isSelected = selectedLandmarkId === landmark.id;
            return (
              <button
                key={landmark.id}
                type="button"
                onClick={() => onSelectLandmark(landmark)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center space-x-1.5 border ${
                  isSelected
                    ? "bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-500/30 scale-105"
                    : "bg-slate-900/60 border-white/10 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    landmark.category === "Landing Site"
                      ? "bg-amber-400"
                      : landmark.category === "Crater"
                      ? "bg-cyan-400"
                      : "bg-emerald-400"
                  }`}
                />
                <span className="truncate max-w-[140px]">{landmark.name.split(" (")[0]}</span>
                <ChevronRight className="w-3 h-3 opacity-60" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
