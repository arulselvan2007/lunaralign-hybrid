#!/usr/bin/env python3
"""
LunarAlign-Hybrid: Terrain-Aware Dynamic Routing Engine
======================================================
Stage 2 of the 6-Stage Cross-Modal Lunar Image Registration Pipeline
for Chandrayaan-2 (TMC-2, OHRC, IIRS).

Capabilities:
1. Spatial Entropy Analysis:
   Quantifies gray-level probability distribution disorder via Shannon entropy:
   H = - sum(p_i * log2(p_i)).
2. Sobel Gradient Magnitude Variance:
   Computes local directional edge response and structural sharpness variance
   to distinguish crater rims and boulder ejecta from smooth basaltic maria.
3. Dynamic Dispatch Decision:
   - High Texture / Rugged Highlands (T >= 0.35):
     Routes to AI Branch (LightGlue + DISK) for sparse transformer attention.
   - Low Texture / Basaltic Lunar Maria (T < 0.20):
     Routes to Physics Branch (Phase Congruency / RIFT2) for illumination-invariant
     frequency-domain matching.
   - Transitional / Hybrid Plains (0.20 <= T < 0.35):
     Routes to Dual-Branch Fusion with adaptive confidence weighting.
"""

from typing import Tuple, Dict, Any, Union, Optional
import os
import sys
import json
import argparse
from pathlib import Path
import numpy as np
import cv2


class TextureDensityAnalyzer:
    """
    Analyzes terrain texture density, spatial frequency entropy, and gradient variance
    across lunar surface rasters.
    """

    def __init__(
        self,
        low_threshold: float = 0.20,
        high_threshold: float = 0.35,
    ) -> None:
        """
        Initialize the TextureDensityAnalyzer.

        Args:
            low_threshold: Threshold below which tiles are routed to Physics Branch.
            high_threshold: Threshold above which tiles are routed to AI Branch.
        """
        self.low_threshold = float(low_threshold)
        self.high_threshold = float(high_threshold)

    @staticmethod
    def _to_gray_8u(image: Union[str, Path, np.ndarray]) -> np.ndarray:
        """Helper to ensure input is a single-channel 8-bit array."""
        if isinstance(image, (str, Path)):
            p = str(image)
            if not os.path.exists(p):
                raise FileNotFoundError(f"Tile image not found at: {p}")
            img = cv2.imread(p, cv2.IMREAD_UNCHANGED)
            if img is None:
                raise ValueError(f"Failed to read image at: {p}")
        else:
            img = image

        if len(img.shape) == 3:
            if img.shape[2] == 4:
                img = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
            elif img.shape[2] >= 3:
                img = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
            elif img.shape[2] == 1:
                img = img[:, :, 0]

        if img.dtype != np.uint8:
            img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)

        return img

    @staticmethod
    def compute_spatial_entropy(gray_8u: np.ndarray, bins: int = 256) -> float:
        """
        Calculate normalized Shannon spatial entropy over pixel intensity distribution.
        Normalized into [0.0, 1.0] where 1.0 indicates maximum tonal dispersion.
        """
        hist = cv2.calcHist([gray_8u], [0], None, [bins], [0, 256]).ravel()
        total_pixels = gray_8u.size
        if total_pixels == 0:
            return 0.0

        p = hist / total_pixels
        p_non_zero = p[p > 0.0]
        entropy = -np.sum(p_non_zero * np.log2(p_non_zero))

        # Max entropy for 256 bins is log2(256) = 8.0
        max_entropy = np.log2(bins)
        norm_entropy = float(entropy / max_entropy)
        return float(np.clip(norm_entropy, 0.0, 1.0))

    @staticmethod
    def compute_gradient_variance(gray_8u: np.ndarray) -> Tuple[float, float]:
        """
        Compute Sobel gradient magnitude variance and mean edge energy.
        High values indicate crater rims, boulder fields, and rilles.
        """
        # Sobel derivatives (32-bit float for numerical stability)
        gx = cv2.Sobel(gray_8u, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray_8u, cv2.CV_32F, 0, 1, ksize=3)

        magnitude = cv2.magnitude(gx, gy)
        mean_mag = float(np.mean(magnitude))
        var_mag = float(np.var(magnitude))

        # Normalized gradient score mapped through smooth non-linear saturation
        # Characteristic lunar gradient variance scales from ~50 (smooth mare) to > 800 (rugged rim)
        norm_grad = float(1.0 - np.exp(-var_mag / 350.0))
        return norm_grad, var_mag

    def analyze(self, image: Union[str, Path, np.ndarray]) -> Dict[str, Any]:
        """
        Full texture density analysis returning composite score and metrics.
        """
        gray = self._to_gray_8u(image)
        norm_entropy = self.compute_spatial_entropy(gray)
        norm_grad, raw_var = self.compute_gradient_variance(gray)

        # Composite Texture Density Score T in [0, 1]
        # Weights: 45% spatial entropy, 55% gradient sharpness variance
        texture_score = float(np.clip(0.45 * norm_entropy + 0.55 * norm_grad, 0.0, 1.0))

        # Determine Terrain Classification
        if texture_score >= self.high_threshold:
            terrain_type = "highlands"
            route = "ai_branch"
            desc = "Crater-rich highlands / rugged ejecta detected. Routed to AI Branch (LightGlue / DISK)."
        elif texture_score < self.low_threshold:
            terrain_type = "maria"
            route = "physics_branch"
            desc = "Low-contrast smooth lunar mare detected. Routed to Physics Branch (Phase Congruency / RIFT2)."
        else:
            terrain_type = "transitional"
            route = "dual_fusion"
            desc = "Transitional lunar terrain detected. Routed to Adaptive Dual-Branch Fusion."

        # Adaptive Confidence Weights
        ai_weight = float(np.clip(texture_score, 0.05, 0.95))
        physics_weight = float(round(1.0 - ai_weight, 4))

        return {
            "route": route,
            "terrain_type": terrain_type,
            "texture_score": round(texture_score, 4),
            "spatial_entropy": round(norm_entropy, 4),
            "gradient_variance": round(raw_var, 2),
            "gradient_score": round(norm_grad, 4),
            "weights": {
                "ai_weight": round(ai_weight, 4),
                "physics_weight": physics_weight,
            },
            "description": desc,
            "thresholds": {
                "low": self.low_threshold,
                "high": self.high_threshold,
            },
        }

    def route_pair(
        self,
        tile_a: Union[str, Path, np.ndarray],
        tile_b: Union[str, Path, np.ndarray],
    ) -> Dict[str, Any]:
        """
        Evaluate a stereo / multi-temporal tile pair and determine joint routing decision.
        """
        meta_a = self.analyze(tile_a)
        meta_b = self.analyze(tile_b)

        # Pair composite score: min of both or average
        avg_score = float(round((meta_a["texture_score"] + meta_b["texture_score"]) / 2.0, 4))
        min_score = min(meta_a["texture_score"], meta_b["texture_score"])

        # If either tile is featureless mare, dual-branch or physics must be engaged
        if min_score < self.low_threshold:
            joint_route = "physics_branch"
            joint_terrain = "maria"
            desc = "At least one tile exhibits featureless basaltic mare. Engaging Physics Branch for illumination invariance."
        elif avg_score >= self.high_threshold:
            joint_route = "ai_branch"
            joint_terrain = "highlands"
            desc = "High structural density across both tiles. Engaging AI Branch (LightGlue / DISK)."
        else:
            joint_route = "dual_fusion"
            joint_terrain = "transitional"
            desc = "Intermediate terrain density. Engaging Adaptive Dual-Branch Fusion."

        ai_weight = float(np.clip(avg_score, 0.05, 0.95))
        physics_weight = float(round(1.0 - ai_weight, 4))

        return {
            "joint_route": joint_route,
            "joint_terrain": joint_terrain,
            "joint_texture_score": avg_score,
            "min_texture_score": min_score,
            "weights": {
                "ai_weight": round(ai_weight, 4),
                "physics_weight": physics_weight,
            },
            "tile_a": meta_a,
            "tile_b": meta_b,
            "description": desc,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="LunarAlign-Hybrid: Terrain-Aware Dynamic Routing Engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--tile", type=str, help="Single tile path to analyze")
    parser.add_argument("--tile-a", type=str, help="Reference tile path for pair analysis")
    parser.add_argument("--tile-b", type=str, help="Target tile path for pair analysis")
    parser.add_argument("--low-thresh", type=float, default=0.20, help="Low texture threshold")
    parser.add_argument("--high-thresh", type=float, default=0.35, help="High texture threshold")
    parser.add_argument("--output-json", type=str, help="Optional output JSON path")

    args = parser.parse_args()
    analyzer = TextureDensityAnalyzer(
        low_threshold=args.low_thresh,
        high_threshold=args.high_thresh,
    )

    if args.tile:
        result = analyzer.analyze(args.tile)
    elif args.tile_a and args.tile_b:
        result = analyzer.route_pair(args.tile_a, args.tile_b)
    else:
        parser.print_help()
        return 1

    print(json.dumps(result, indent=2))

    if args.output_json:
        out_path = Path(args.output_json).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"[TextureRouter] Output saved to: {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
