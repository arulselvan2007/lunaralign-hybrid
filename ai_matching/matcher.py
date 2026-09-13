#!/usr/bin/env python3
from __future__ import annotations
"""
LunarAlign-Hybrid: AI Feature Matching & Geometric Verification Engine
======================================================================
This module provides a production-ready feature extraction, deep matching,
and robust geometric verification pipeline tailored for multi-temporal,
high-resolution lunar satellite imagery (e.g., Chandrayaan-2 TMC-2 / OHRC,
and Lunar Reconnaissance Orbiter Camera Narrow Angle Camera - LROC NAC).

Key Technologies:
  1. Kornia LightGlue: Sparse deep matcher with adaptive computational graph
     pruning and positional attention, paired with DISK feature representations.
  2. OpenCV USAC_MAGSAC (MAGSAC+): State-of-the-art robust estimator for planar
     homography estimation via noise-scale marginalization and spatial graph-cut
     local optimization.
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import Tuple, Dict, Any, Optional

import numpy as np

# Lazy / Safe dependency checking
try:
    import cv2
except ImportError:
    cv2 = None

try:
    import torch
    import torchvision
    import kornia as K
    from kornia.feature import DISK, LightGlue
    no_grad = torch.no_grad
except ImportError:
    torch = None
    K = None

    def no_grad():
        def decorator(func):
            return func
        return decorator


class LunarMatcher:
    """
    Modular lunar terrain matching and geometric verification engine.

    Combines Kornia's LightGlue deep transformer matcher with OpenCV's
    USAC_MAGSAC (MAGSAC+) robust estimator for high-precision registration
    of satellite GeoTIFF tiles under challenging lunar surface conditions.
    """

    def __init__(
        self,
        device: str = "auto",
        feature_type: str = "disk",
        reproj_threshold: float = 3.0,
        confidence: float = 0.999,
        max_iters: int = 10000,
        max_keypoints: int = 2048,
    ) -> None:
        """
        Initialize the LunarMatcher pipeline.

        Args:
            device: Computing device ('auto', 'cpu', 'cuda', 'mps').
            feature_type: Local descriptor backbone ('disk' or 'superpoint').
            reproj_threshold: Maximum noise scale for MAGSAC+ marginalization (pixels).
            confidence: Verification confidence probability (e.g., 0.999 = 99.9%).
            max_iters: Maximum sampling iterations for USAC_MAGSAC consensus loop.
            max_keypoints: Maximum number of salient keypoints retained per tile (prevents OOM).
        """
        self._check_dependencies()

        # Configure computation device
        self.device = self._resolve_device(device)
        self.feature_type = feature_type.lower()
        self.reproj_threshold = float(reproj_threshold)
        self.confidence = float(confidence)
        self.max_iters = int(max_iters)
        self.max_keypoints = int(max_keypoints)

        print(f"[LunarMatcher] Initializing on device: {self.device}")
        print(f"[LunarMatcher] Feature Extractor: {self.feature_type.upper()} | Matcher: LightGlue (max_kpts={self.max_keypoints})")
        print(f"[LunarMatcher] Robust Estimator: USAC_MAGSAC (threshold={self.reproj_threshold}px, conf={self.confidence})")

        # Initialize deep models
        self.extractor = None
        self.matcher = None
        self._init_models()

    @staticmethod
    def _check_dependencies() -> None:
        """Verify that PyTorch, Kornia, and OpenCV are present in the environment."""
        missing = []
        if cv2 is None:
            missing.append("opencv-python")
        if torch is None or K is None:
            missing.extend(["torch", "torchvision", "kornia"])

        if missing:
            raise ImportError(
                f"Missing required dependencies: {', '.join(set(missing))}.\n"
                "Please install them using: pip install -r ai_matching/requirements.txt"
            )

    def _resolve_device(self, requested: str) -> torch.device:
        """Resolve PyTorch execution device with Apple Silicon MPS fallback."""
        if requested == "auto":
            if torch.cuda.is_available():
                return torch.device("cuda")
            elif torch.backends.mps.is_available():
                return torch.device("mps")
            else:
                return torch.device("cpu")
        elif requested == "mps":
            if torch.backends.mps.is_available():
                return torch.device("mps")
            print("[LunarMatcher] WARNING: MPS requested but not available. Falling back to CPU.")
            return torch.device("cpu")
        elif requested == "cuda":
            if torch.cuda.is_available():
                return torch.device("cuda")
            print("[LunarMatcher] WARNING: CUDA requested but not available. Falling back to CPU.")
            return torch.device("cpu")
        return torch.device("cpu")

    def _init_models(self) -> None:
        """Load pretrained DISK feature extractor and LightGlue matcher from Kornia."""
        try:
            if self.feature_type == "disk":
                self.extractor = DISK.from_pretrained("depth").to(self.device)
                self.matcher = LightGlue(features="disk").to(self.device)
            else:
                # Default fallback to DISK
                print(f"[LunarMatcher] Unsupported feature_type '{self.feature_type}'. Defaulting to DISK.")
                self.extractor = DISK.from_pretrained("depth").to(self.device)
                self.matcher = LightGlue(features="disk").to(self.device)

            self.extractor.eval()
            self.matcher.eval()
        except Exception as e:
            raise RuntimeError(
                f"Failed to load Kornia feature extractor or LightGlue weights: {e}\n"
                "Ensure internet connectivity for initial weight download or check your torch/kornia installation."
            ) from e

    def load_and_preprocess(self, image_path: str) -> Tuple[np.ndarray, torch.Tensor]:
        """
        Load a satellite GeoTIFF or standard image and convert it to a normalized PyTorch tensor.

        Handles 8-bit, 16-bit, and single/multi-band rasters gracefully. Normalizes
        dynamic range into [0.0, 1.0] to prevent gradient explosion or saturation
        in deep neural feature extraction layers.

        Args:
            image_path: Absolute or relative filesystem path to the image tile.

        Returns:
            raw_image: Original 2D/3D NumPy array for visualization.
            tensor: Preprocessed tensor of shape (1, 3, H, W) normalized to [0, 1].
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image tile not found at: {image_path}")

        # Load with unchanged bit-depth and channels
        img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError(f"OpenCV failed to decode image: {image_path}")

        raw_display = img.copy()

        # Handle grayscale vs multi-channel
        if len(img.shape) == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        elif len(img.shape) == 3 and img.shape[2] == 4:
            # Drop alpha / nodata band if present
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2RGB)
        elif len(img.shape) == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        # Normalize pixel values into [0.0, 1.0] float32
        if img.dtype == np.uint16:
            img_normalized = (img / 65535.0).astype(np.float32)
        elif img.dtype == np.uint8:
            img_normalized = (img / 255.0).astype(np.float32)
        elif np.issubdtype(img.dtype, np.floating):
            min_val, max_val = img.min(), img.max()
            if max_val > min_val:
                img_normalized = ((img - min_val) / (max_val - min_val)).astype(np.float32)
            else:
                img_normalized = np.zeros_like(img, dtype=np.float32)
        else:
            img_normalized = (img / float(np.iinfo(img.dtype).max)).astype(np.float32)

        # Convert to PyTorch Tensor: (H, W, C) -> (1, C, H, W)
        tensor = torch.from_numpy(img_normalized).permute(2, 0, 1).unsqueeze(0).to(self.device)
        return raw_display, tensor

    @no_grad()
    def extract_and_match(
        self,
        tensor_a: torch.Tensor,
        tensor_b: torch.Tensor,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Extract dense keypoints and descriptors, then perform deep matching with LightGlue.

        LightGlue utilizes positional self-attention and cross-attention between
        candidate keypoint graphs, with early-stopping mechanisms when confident
        assignments are reached.

        Args:
            tensor_a: Preprocessed tensor for Tile A of shape (1, 3, H, W).
            tensor_b: Preprocessed tensor for Tile B of shape (1, 3, H, W).

        Returns:
            pts_a: Matched keypoints in Tile A, shape (N, 2) as (x, y) coordinates.
            pts_b: Matched keypoints in Tile B, shape (N, 2) as (x, y) coordinates.
            confidences: Confidence assignment scores for each match in [0, 1], shape (N,).
        """
        h_a, w_a = tensor_a.shape[2], tensor_a.shape[3]
        h_b, w_b = tensor_b.shape[2], tensor_b.shape[3]

        # 1. Feature extraction via DISK
        features_a = self.extractor(tensor_a)[0]
        features_b = self.extractor(tensor_b)[0]

        kpts_a = features_a.keypoints  # (Na, 2)
        desc_a = features_a.descriptors  # (Na, D)
        kpts_b = features_b.keypoints  # (Nb, 2)
        desc_b = features_b.descriptors  # (Nb, D)

        # Filter top-K keypoints by detection score to prevent OOM in dense cross-attention
        if len(kpts_a) > self.max_keypoints:
            topk_a = torch.topk(features_a.detection_scores, self.max_keypoints).indices
            kpts_a = kpts_a[topk_a]
            desc_a = desc_a[topk_a]

        if len(kpts_b) > self.max_keypoints:
            topk_b = torch.topk(features_b.detection_scores, self.max_keypoints).indices
            kpts_b = kpts_b[topk_b]
            desc_b = desc_b[topk_b]

        if len(kpts_a) == 0 or len(kpts_b) == 0:
            print("[LunarMatcher] WARNING: Zero keypoints detected in one or both tiles.")
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0,))

        # 2. Package inputs for Kornia LightGlue
        data = {
            "image0": {
                "keypoints": kpts_a.unsqueeze(0),
                "descriptors": desc_a.unsqueeze(0),
                "image_size": torch.tensor([[h_a, w_a]], device=self.device),
            },
            "image1": {
                "keypoints": kpts_b.unsqueeze(0),
                "descriptors": desc_b.unsqueeze(0),
                "image_size": torch.tensor([[h_b, w_b]], device=self.device),
            },
        }

        # 3. LightGlue inference with automatic CPU fallback if MPS memory limit is hit
        try:
            out = self.matcher(data)
        except RuntimeError as e:
            if "out of memory" in str(e).lower() or "mps" in str(e).lower():
                print(f"[LunarMatcher] MPS memory warning ({e}). Falling back to CPU for LightGlue matching...")
                cpu_data = {
                    "image0": {
                        "keypoints": data["image0"]["keypoints"].cpu(),
                        "descriptors": data["image0"]["descriptors"].cpu(),
                        "image_size": data["image0"]["image_size"].cpu(),
                    },
                    "image1": {
                        "keypoints": data["image1"]["keypoints"].cpu(),
                        "descriptors": data["image1"]["descriptors"].cpu(),
                        "image_size": data["image1"]["image_size"].cpu(),
                    },
                }
                cpu_matcher = LightGlue(features=self.feature_type).to("cpu")
                cpu_matcher.eval()
                out = cpu_matcher(cpu_data)
            else:
                raise

        matches = out["matches"][0]  # (K, 2) indexing (idx_a, idx_b)
        scores = out["scores"][0]  # (K,)

        if len(matches) == 0:
            print("[LunarMatcher] WARNING: LightGlue returned zero matches.")
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0,))

        idx_a = matches[:, 0]
        idx_b = matches[:, 1]

        matched_pts_a = kpts_a[idx_a].detach().cpu().numpy()
        matched_pts_b = kpts_b[idx_b].detach().cpu().numpy()
        confidence_scores = scores.detach().cpu().numpy()

        return matched_pts_a, matched_pts_b, confidence_scores

    def verify_geometry(
        self,
        pts_a: np.ndarray,
        pts_b: np.ndarray,
    ) -> Dict[str, Any]:
        """
        Perform robust geometric verification via planar Homography using USAC_MAGSAC.

        Mathematical Superiority of MAGSAC+ over Standard RANSAC for Lunar Imagery:
        ---------------------------------------------------------------------------
        1. The Hard-Threshold Dilemma in Standard RANSAC:
           Standard RANSAC (Fischler & Bolles, 1981) evaluates hypothesis models using
           a rigid, binary indicator function:
               rho(r_i) = 1 if r_i <= tau else 0
           where r_i is the reprojection error and tau is a user-specified threshold.
           On lunar terrain, this assumption catastrophically degrades:
             - Illumination angles between multi-pass satellite captures (e.g., morning
               vs. afternoon sun) drastically cast elongated, variable crater shadows.
             - Crater rims possess extreme micro-topographical gradients and depth
               discontinuities relative to the surrounding planar maria or highlands.
             - Setting a strict threshold (e.g., tau = 1.0 px) prematurely rejects true
               lunar crater correspondences subject to parallax or uncompensated elevation;
               setting a relaxed threshold (e.g., tau = 5.0 px) permits incorrect matches
               along repetitive crater shadow boundaries and basaltic texture noise.

        2. Noise-Scale Marginalization in MAGSAC+ (Barath et al., 2020):
           MAGSAC+ (Marginalizing Sample Consensus) completely eliminates the dependency
           on a single manually-tuned threshold by treating the unknown measurement noise
           sigma as a continuous random variable over a domain [0, sigma_max].
           Under the assumption that reprojection errors follow a Chi-squared (Chi^2)
           residual distribution with degrees of freedom k (k=2 for 2D homography):
               P(r_i | sigma) = (2 * r_i / sigma^2) * exp(-r_i^2 / (2 * sigma^2))
           MAGSAC+ computes an inlier score by marginalizing out sigma analytically:
               Q(r_i) = int_{0}^{sigma_max} P(r_i | sigma) * P(sigma) d(sigma)
           This yields a continuous, smooth, non-parametric loss function where points
           are weighted proportionally to their marginal likelihood across all plausible
           noise levels.

        3. Spatial Coherence via Graph-Cut Local Optimization (GC-RANSAC):
           OpenCV's USAC_MAGSAC integrates Graph-Cut Local Optimization. Every time an
           improved homography model is proposed, it executes energy minimization over
           an adjacency graph constructed between nearby lunar surface keypoints.
           Because contiguous crater ejecta blankets and volcanic mare rilles exhibit
           smooth spatial continuity, graph-cut optimization guarantees spatial clustering
           of inliers, drastically outperforming random independent voting.

        4. Sub-Pixel Precision & Non-Parametric Scoring:
           Rather than merely counting cardinal inlier support, MAGSAC+ minimizes the
           marginal residual energy. This produces homographies with sub-pixel alignment
           accuracy, essential for high-precision lunar crater matching and co-registration.

        Args:
            pts_a: Matched keypoints in Tile A, shape (N, 2).
            pts_b: Matched keypoints in Tile B, shape (N, 2).

        Returns:
            Dictionary containing:
              - 'homography': 3x3 Homography matrix (np.ndarray or None)
              - 'inlier_mask': Boolean array of shape (N,) indicating confirmed inliers
              - 'num_tentative': Count of initial LightGlue matches
              - 'num_inliers': Count of verified USAC_MAGSAC inliers
              - 'inlier_ratio': Percentage of inliers (num_inliers / num_tentative)
              - 'mean_reprojection_error': Average residual error among inliers (pixels)
              - 'success': Boolean indicating if a valid homography was estimated
        """
        num_matches = len(pts_a)

        # Minimum points required for planar homography is 4
        if num_matches < 4:
            return {
                "homography": None,
                "inlier_mask": np.zeros(num_matches, dtype=bool),
                "num_tentative": num_matches,
                "num_inliers": 0,
                "inlier_ratio": 0.0,
                "mean_reprojection_error": float("inf"),
                "success": False,
                "reason": "Insufficient matches (< 4) to estimate homography.",
            }

        # Reshape for OpenCV API: (N, 1, 2) float32
        src_pts = pts_a.reshape(-1, 1, 2).astype(np.float32)
        dst_pts = pts_b.reshape(-1, 1, 2).astype(np.float32)

        # Execute cv2.findHomography with cv2.USAC_MAGSAC
        H, mask = cv2.findHomography(
            src_pts,
            dst_pts,
            method=cv2.USAC_MAGSAC,
            ransacReprojThreshold=self.reproj_threshold,
            maxIters=self.max_iters,
            confidence=self.confidence,
        )

        if H is None or mask is None:
            return {
                "homography": None,
                "inlier_mask": np.zeros(num_matches, dtype=bool),
                "num_tentative": num_matches,
                "num_inliers": 0,
                "inlier_ratio": 0.0,
                "mean_reprojection_error": float("inf"),
                "success": False,
                "reason": "USAC_MAGSAC failed to converge on a valid homography.",
            }

        inlier_mask = mask.ravel().astype(bool)
        num_inliers = int(np.sum(inlier_mask))
        inlier_ratio = float(num_inliers) / float(num_matches) if num_matches > 0 else 0.0

        # Compute inlier reprojection errors: || H * pts_a - pts_b ||
        mean_error = float("inf")
        if num_inliers >= 4:
            inlier_src = pts_a[inlier_mask]
            inlier_dst = pts_b[inlier_mask]

            # Transform source points via H
            ones = np.ones((len(inlier_src), 1), dtype=np.float32)
            src_homo = np.hstack([inlier_src, ones])  # (M, 3)
            proj_homo = (H @ src_homo.T).T  # (M, 3)

            # Perspective division: (x/z, y/z)
            eps = 1e-8
            z = proj_homo[:, 2:3]
            z = np.where(np.abs(z) < eps, eps, z)
            proj_pts = proj_homo[:, :2] / z

            # Euclidean residual distances
            residuals = np.linalg.norm(proj_pts - inlier_dst, axis=1)
            mean_error = float(np.mean(residuals))

        return {
            "homography": H,
            "inlier_mask": inlier_mask,
            "num_tentative": num_matches,
            "num_inliers": num_inliers,
            "inlier_ratio": inlier_ratio,
            "mean_reprojection_error": mean_error,
            "success": num_inliers >= 4,
            "reason": "Optimal homography estimated." if num_inliers >= 4 else "Degenerate inlier count.",
        }

    def visualize_matches(
        self,
        img_a: np.ndarray,
        img_b: np.ndarray,
        pts_a: np.ndarray,
        pts_b: np.ndarray,
        inlier_mask: np.ndarray,
        output_path: str,
    ) -> None:
        """
        Draw side-by-side match visualization with verified inliers (green) and outliers (red).
        """
        # Ensure 3-channel 8-bit images for drawing
        def to_uint8_rgb(im):
            if len(im.shape) == 2:
                im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
            elif len(im.shape) == 3 and im.shape[2] == 4:
                im = cv2.cvtColor(im, cv2.COLOR_BGRA2BGR)
            if im.dtype != np.uint8:
                im_norm = cv2.normalize(im, None, 0, 255, cv2.NORM_MINMAX)
                im = im_norm.astype(np.uint8)
            return im

        vis_a = to_uint8_rgb(img_a)
        vis_b = to_uint8_rgb(img_b)

        ha, wa = vis_a.shape[:2]
        hb, wb = vis_b.shape[:2]

        canvas_h = max(ha, hb)
        canvas_w = wa + wb
        canvas = np.zeros((canvas_h, canvas_w, 3), dtype=np.uint8)
        canvas[:ha, :wa] = vis_a
        canvas[:hb, wa : wa + wb] = vis_b

        # Draw matches: Green for MAGSAC+ inliers, Dim Red for outliers
        num_pts = len(pts_a)
        for i in range(num_pts):
            pt1 = (int(round(pts_a[i, 0])), int(round(pts_a[i, 1])))
            pt2 = (int(round(pts_b[i, 0])) + wa, int(round(pts_b[i, 1])))

            is_inlier = bool(inlier_mask[i]) if i < len(inlier_mask) else False
            color = (0, 235, 100) if is_inlier else (50, 50, 200)  # BGR
            thickness = 2 if is_inlier else 1

            if is_inlier:
                cv2.circle(canvas, pt1, 4, (0, 255, 0), -1)
                cv2.circle(canvas, pt2, 4, (0, 255, 0), -1)
                cv2.line(canvas, pt1, pt2, color, thickness, cv2.LINE_AA)
            elif num_pts <= 500:  # Only draw outliers if not cluttered
                cv2.line(canvas, pt1, pt2, color, 1, cv2.LINE_AA)

        # Draw legend / banner
        cv2.putText(
            canvas,
            f"Verified Inliers (MAGSAC+): {np.sum(inlier_mask)} / {num_pts}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 100),
            2,
            cv2.LINE_AA,
        )

        parent_dir = os.path.dirname(output_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        cv2.imwrite(output_path, canvas)
        print(f"[LunarMatcher] Visualization saved to: {output_path}")

    def match_tiles(
        self,
        tile_a_path: str,
        tile_b_path: str,
        output_viz: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        High-level orchestrator: Load tiles, run LightGlue matching, and verify via USAC_MAGSAC.

        Args:
            tile_a_path: Path to reference tile GeoTIFF.
            tile_b_path: Path to target tile GeoTIFF.
            output_viz: Optional path to save visual match verification plot.

        Returns:
            Dictionary with homography matrix, inlier counts, and metrics.
        """
        print(f"\n[LunarMatcher] Processing Tile A: {tile_a_path}")
        print(f"[LunarMatcher] Processing Tile B: {tile_b_path}")

        raw_a, tensor_a = self.load_and_preprocess(tile_a_path)
        raw_b, tensor_b = self.load_and_preprocess(tile_b_path)

        # 1. Feature extraction & LightGlue matching
        pts_a, pts_b, confidences = self.extract_and_match(tensor_a, tensor_b)
        print(f"[LunarMatcher] Tentative LightGlue matches: {len(pts_a)}")

        # 2. Robust geometric verification via USAC_MAGSAC
        results = self.verify_geometry(pts_a, pts_b)

        print("\n=======================================================")
        print("          GEOMETRIC VERIFICATION (USAC_MAGSAC)         ")
        print("=======================================================")
        print(f"Status:                     {'SUCCESS' if results['success'] else 'FAILED'}")
        print(f"Tentative Matches:          {results['num_tentative']}")
        print(f"Verified Inliers:           {results['num_inliers']}")
        print(f"Inlier Ratio:               {results['inlier_ratio'] * 100:.2f}%")
        if results["mean_reprojection_error"] != float("inf"):
            print(f"Mean Reprojection Error:    {results['mean_reprojection_error']:.3f} px")
        else:
            print("Mean Reprojection Error:    N/A")

        if results["homography"] is not None:
            print("\nEstimated 3x3 Homography Matrix (H):")
            np.set_printoptions(precision=6, suppress=True)
            print(results["homography"])
        print("=======================================================\n")

        # 3. Optional match visualization
        if output_viz and len(pts_a) > 0:
            self.visualize_matches(
                raw_a, raw_b, pts_a, pts_b, results["inlier_mask"], output_viz
            )

        return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="LunarAlign-Hybrid: AI Feature Matching (LightGlue) & Geometric Verification (USAC_MAGSAC)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--tile-a",
        type=str,
        required=True,
        help="Filesystem path to reference lunar GeoTIFF tile (e.g. data/tiles/chunk_x0_y0.tif)",
    )
    parser.add_argument(
        "--tile-b",
        type=str,
        required=True,
        help="Filesystem path to target lunar GeoTIFF tile to register against tile A",
    )
    parser.add_argument(
        "--output-viz",
        type=str,
        default=None,
        help="Path to save side-by-side visual match verification image (e.g., matches.png)",
    )
    parser.add_argument(
        "--output-json",
        type=str,
        default=None,
        help="Path to write registration metrics and homography matrix as JSON",
    )
    parser.add_argument(
        "--reproj-thresh",
        type=float,
        default=3.0,
        help="Maximum reprojection error threshold for USAC_MAGSAC marginalization (pixels)",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.999,
        help="Desired confidence probability for USAC_MAGSAC (0.0 to 1.0)",
    )
    parser.add_argument(
        "--max-iters",
        type=int,
        default=10000,
        help="Maximum sampling iterations for the USAC_MAGSAC solver",
    )
    parser.add_argument(
        "--max-kpts",
        type=int,
        default=2048,
        help="Maximum salient keypoints to retain per tile (prevents attention OOM)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["auto", "cpu", "cuda", "mps"],
        help="Hardware execution device for deep learning models",
    )

    args = parser.parse_args()

    matcher = LunarMatcher(
        device=args.device,
        feature_type="disk",
        reproj_threshold=args.reproj_thresh,
        confidence=args.confidence,
        max_iters=args.max_iters,
        max_keypoints=args.max_kpts,
    )

    results = matcher.match_tiles(
        tile_a_path=args.tile_a,
        tile_b_path=args.tile_b,
        output_viz=args.output_viz,
    )

    # Export metrics to JSON if requested
    if args.output_json:
        serializable = {
            "success": results["success"],
            "num_tentative": results["num_tentative"],
            "num_inliers": results["num_inliers"],
            "inlier_ratio": results["inlier_ratio"],
            "mean_reprojection_error": (
                results["mean_reprojection_error"]
                if results["mean_reprojection_error"] != float("inf")
                else None
            ),
            "homography": (
                results["homography"].tolist()
                if results["homography"] is not None
                else None
            ),
            "reason": results.get("reason", ""),
        }
        with open(args.output_json, "w") as f:
            json.dump(serializable, f, indent=2)
        print(f"[LunarMatcher] Metrics saved to JSON: {args.output_json}")

    return 0 if results["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
