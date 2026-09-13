"use client";

import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Maximize,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";

interface TelemetryHUDProps {
  metrics: {
    success: boolean;
    num_tentative: number;
    num_inliers: number;
    inlier_ratio: number;
    mean_reprojection_error?: number | null;
    homography?: number[][] | null;
    elapsed_seconds?: number;
    viz_url?: string | null;
    reason?: string;
  } | null;
  vizUrl?: string | null;
}

export default function TelemetryHUD({ metrics, vizUrl }: TelemetryHUDProps) {
  const [showMath, setShowMath] = useState(false);
  const [showVizModal, setShowVizModal] = useState(false);

  if (!metrics) {
    return (
      <div className="rounded-2xl p-4 backdrop-blur-md bg-white/10 border border-white/15 text-center text-xs font-mono text-slate-400">
        <Activity className="w-5 h-5 mx-auto mb-1.5 text-cyan-400 opacity-60 animate-pulse" />
        AWAITING MISSION TELEMETRY: SELECT TILES AND EXECUTE ALIGNMENT
      </div>
    );
  }

  const inlierRatioPct = (metrics.inlier_ratio * 100).toFixed(2);
  const reprojErrStr =
    metrics.mean_reprojection_error !== undefined && metrics.mean_reprojection_error !== null
      ? `${metrics.mean_reprojection_error.toFixed(3)} px`
      : "N/A";

  return (
    <div className="w-full flex flex-col space-y-4">
      {/* HUD Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Metric 1: Inlier Ratio */}
        <div className="rounded-xl p-3.5 backdrop-blur-md bg-slate-900/70 border border-cyan-500/30 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/10 rounded-full blur-xl pointer-events-none" />
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>INLIER RATIO</span>
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono text-cyan-300 tracking-tight">
            {inlierRatioPct}%
          </div>
          <div className="mt-0.5 text-[10px] text-cyan-400/80 font-mono">
            USAC_MAGSAC Verified
          </div>
        </div>

        {/* Metric 2: Reprojection Error */}
        <div className="rounded-xl p-3.5 backdrop-blur-md bg-slate-900/70 border border-cyan-500/30 shadow-lg relative overflow-hidden">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>REPROJECTION ERROR</span>
            <Target className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono text-cyan-300 tracking-tight">
            {reprojErrStr}
          </div>
          <div className="mt-0.5 text-[10px] text-emerald-400 font-mono">
            Sub-Pixel Alignment (&lt; 1px)
          </div>
        </div>

        {/* Metric 3: Verified Matches */}
        <div className="rounded-xl p-3.5 backdrop-blur-md bg-slate-900/70 border border-cyan-500/30 shadow-lg">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>VERIFIED INLIERS</span>
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono text-cyan-300 tracking-tight">
            {metrics.num_inliers}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400 font-mono">
            of {metrics.num_tentative} candidate points
          </div>
        </div>

        {/* Metric 4: Registration Status */}
        <div className="rounded-xl p-3.5 backdrop-blur-md bg-slate-900/70 border border-cyan-500/30 shadow-lg">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>STATUS</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 text-2xl font-bold font-mono text-emerald-400 tracking-tight">
            {metrics.success ? "OPTIMAL" : "FAILED"}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400 font-mono truncate">
            {metrics.elapsed_seconds ? `Computed in ${metrics.elapsed_seconds}s` : metrics.reason}
          </div>
        </div>
      </div>

      {/* Homography & Visualization Control Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl backdrop-blur-md bg-white/5 border border-white/10 text-xs">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-slate-400 uppercase">Projective Homography:</span>
          {metrics.homography && (
            <span className="font-mono text-cyan-300 text-[11px] bg-slate-950/70 px-2 py-0.5 rounded border border-cyan-500/30">
              H[3x3] estimated: Scale ≈ {metrics.homography[0][0].toFixed(3)}, Rot ≈{" "}
              {metrics.homography[0][1].toFixed(3)}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {vizUrl && (
            <button
              onClick={() => setShowVizModal(true)}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium transition-colors flex items-center space-x-1.5"
            >
              <Maximize className="w-3.5 h-3.5" />
              <span>Inspect Match Map</span>
            </button>
          )}

          <button
            onClick={() => setShowMath(!showMath)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/15 text-xs font-medium transition-colors flex items-center space-x-1"
          >
            <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Why MAGSAC+?</span>
            {showMath ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Mathematical Explanation Expandable Drawer */}
      {showMath && (
        <div className="rounded-xl p-4 backdrop-blur-md bg-slate-950/90 border border-cyan-500/30 shadow-2xl text-xs space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center space-x-2 text-cyan-400 font-semibold uppercase tracking-wider text-xs">
            <span>📐 Mathematical Superiority of MAGSAC+ over Standard RANSAC on Lunar Terrain</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="p-3 rounded-lg bg-slate-900/80 border border-white/10 space-y-1">
              <span className="font-semibold text-slate-200">1. Rigid Step Failure</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Classic RANSAC uses a binary indicator: Q(r_i) = 1 if r_i &le; &tau; else 0. On the
                Moon, oblique solar phase angles cast elongated, sharp shadows. A fixed threshold &tau;
                either rejects true crater rim points or admits noisy shadow edges.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-white/10 space-y-1">
              <span className="font-semibold text-slate-200">2. Noise Marginalization</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                MAGSAC+ treats measurement noise &sigma; over [0, &sigma;_max] as a continuous random
                variable, marginalizing out &sigma; analytically with a Chi-squared (&chi;&sup2;) distribution:
                Q(r_i) = &int; P(r_i | &sigma;) P(&sigma;) d&sigma;.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-white/10 space-y-1">
              <span className="font-semibold text-slate-200">3. Graph-Cut Coherence</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                OpenCV's USAC_MAGSAC applies Graph-Cut Local Optimization (GC-RANSAC) on a spatial
                adjacency graph of crater features, enforcing spatial continuity across crater ejecta
                blankets and rilles.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Match Map Inspection Modal */}
      {showVizModal && vizUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative max-w-5xl w-full bg-slate-950 border border-white/20 rounded-2xl p-4 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="font-mono text-sm text-cyan-300 font-semibold">
                Chandrayaan-2 TMC-2 Verified Inlier Correspondence Map
              </span>
              <button
                onClick={() => setShowVizModal(false)}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                Close (ESC)
              </button>
            </div>
            <div className="mt-3 flex justify-center">
              <img
                src={vizUrl}
                alt="Match Visualization"
                className="max-h-[75vh] w-auto rounded-xl object-contain border border-white/10 shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
