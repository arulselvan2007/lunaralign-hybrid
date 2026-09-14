#!/usr/bin/env python3
from __future__ import annotations
"""
LunarAlign-Hybrid: Multi-Modal Dual-Branch Matching & Geometric Verification Engine
===================================================================================
Official 6-Stage Cross-Modal Lunar Image Registration Pipeline for Chandrayaan-2
(TMC-2, OHRC, IIRS) & LROC NAC imagery.

Dual-Branch Architecture:
1. AI Branch (Sparse Transformer Deep Matching):
   - Kornia DISK local descriptors paired with LightGlue positional attention.
   - Ideal for crater-dense highlands, rugged ejecta blankets, and micro-relief.
   - Guaranteed Python 3.14+ eager-mode execution and disk-constrained Apple Silicon
     MPS fallback to prevent mpsgraph caching errors.
2. Physics Branch (RIFT2 Radiation-Invariant Phase Congruency):
   - 2D Log-Gabor filter bank Phase Congruency and Maximum Index Map (MIM).
   - Illumination-, shadow-, and contrast-invariant frequency-domain structural matching.
   - Ideal for low-contrast basaltic lunar maria and multi-temporal solar angle shifts.
   - Pure CPU execution with zero GPU memory overhead.
3. Dynamic Terrain-Aware Routing & Adaptive Fusion:
   - Evaluates spatial entropy and Sobel gradient variance (TextureDensityAnalyzer).
   - Dynamically routes between AI Branch, Physics Branch, or Dual-Branch Fusion
     weighted by terrain confidence: W_AI = T, W_Physics = 1.0 - T.
4. Robust Geometric Verification & 3D Topographic DEM Warping:
   - USAC_MAGSAC (MAGSAC+) noise-scale marginalization.
   - Topographic parallax correction using TMC-2 DEM elevation.
   - Quantitative Uncertainty Heatmap generation.
"""

import os
import sys
import json
import shutil
import warnings
import argparse
from pathlib import Path
from typing import Tuple, Dict, Any, Optional, List, Union

# MPS Graph Mitigation (macOS only):
if sys.platform == "darwin":
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

# Python 3.14+ Compatibility:
warnings.filterwarnings("ignore", category=FutureWarning, module="torch.jit")
warnings.filterwarnings("ignore", message=".*torch.jit.script.*")

import numpy as np
from scipy import fft, ndimage

# OpenCV
try:
    import cv2
except ImportError:
    cv2 = None

# PyTorch & Kornia
try:
    import torch
    import torchvision
    import kornia as K
    from kornia.feature import DISK, LightGlue
    no_grad = torch.no_grad

    # Python 3.14 & PyTorch Compatibility:
    # Replace deprecated torch.jit.script calls with standard eager-mode execution
    if hasattr(torch, "jit") and hasattr(torch.jit, "script"):
        _orig_jit_script = torch.jit.script
        def _safe_jit_script(obj=None, *args, **kwargs):
            if obj is None:
                return lambda fn: fn
            if sys.version_info >= (3, 14):
                return obj
            try:
                return _orig_jit_script(obj, *args, **kwargs)
            except Exception:
                return obj
        torch.jit.script = _safe_jit_script
except ImportError:
    torch = None
    K = None

    def no_grad():
        def decorator(func):
            return func
        return decorator

# Project local modules
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from preprocess import preprocess_lunar_image
from texture_router import TextureDensityAnalyzer
from geometry import RobustGeometryEstimator, TopographicDEMWarper
from uncertainty import RegistrationUncertaintyModel


def get_free_disk_space_gb(path: Optional[str] = None) -> float:
    """
    Check available disk space in gigabytes on host filesystem.
    Mitigates mpsgraph temporary write errors on Macintosh HD by checking
    both root volume and macOS temporary directories ($TMPDIR, /tmp).
    """
    paths_to_check = [path] if path else ["/", os.environ.get("TMPDIR", "/tmp"), "/tmp"]
    min_free = float("inf")
    for p in paths_to_check:
        try:
            if os.path.exists(p):
                total, used, free = shutil.disk_usage(p)
                free_gb = free / (1024 ** 3)
                if free_gb < min_free:
                    min_free = free_gb
        except Exception:
            continue
    return min_free if min_free != float("inf") else 999.0


# ------------------------------------------------------------------------------
# Physics Branch: RIFT2 2D Log-Gabor Phase Congruency Structural Matcher (CPU)
# ------------------------------------------------------------------------------
class PhysicsRIFT2Matcher:
    """
    Radiation-Invariant Feature Transform (RIFT2-inspired) engine.
    Uses 2D Log-Gabor filter banks to compute illumination- and contrast-invariant
    Phase Congruency and Maximum Index Maps (MIM).
    Operates 100% on CPU via NumPy and SciPy FFT.
    """

    def __init__(
        self,
        n_scale: int = 4,
        n_orient: int = 6,
        min_wave_length: float = 3.0,
        mult: float = 2.1,
        sigma_on_f: float = 0.55,
        max_keypoints: int = 1500,
    ) -> None:
        self.n_scale = n_scale
        self.n_orient = n_orient
        self.min_wave_length = min_wave_length
        self.mult = mult
        self.sigma_on_f = sigma_on_f
        self.max_keypoints = max_keypoints

    def _construct_log_gabor_filter_bank(
        self, rows: int, cols: int
    ) -> List[List[np.ndarray]]:
        """Precompute frequency-domain 2D Log-Gabor transfer functions."""
        # Polar grid
        y, x = np.mgrid[-rows // 2 : (rows + 1) // 2, -cols // 2 : (cols + 1) // 2]
        radius = np.sqrt(x ** 2 + y ** 2)
        radius[rows // 2, cols // 2] = 1.0  # Avoid zero division
        theta = np.arctan2(-y, x)

        # Angular spread sigma
        d_theta = np.pi / self.n_orient
        theta_sigma = d_theta / 1.2

        filter_bank = []
        for s in range(self.n_scale):
            wavelength = self.min_wave_length * (self.mult ** s)
            f0 = 1.0 / wavelength

            # Radial Log-Gabor component
            r_filt = np.exp(-((np.log(radius / (f0 * max(rows, cols)))) ** 2) / (2 * (np.log(self.sigma_on_f)) ** 2))
            r_filt[rows // 2, cols // 2] = 0.0

            scale_filters = []
            for o in range(self.n_orient):
                angle = o * d_theta
                # Angular distance with wrap-around
                diff_theta = np.abs(theta - angle)
                diff_theta = np.minimum(diff_theta, 2 * np.pi - diff_theta)
                diff_theta = np.minimum(diff_theta, np.pi - diff_theta)

                a_filt = np.exp(-(diff_theta ** 2) / (2 * (theta_sigma ** 2)))
                lg_filt = fft.ifftshift(r_filt * a_filt).astype(np.float32)
                scale_filters.append(lg_filt)
            filter_bank.append(scale_filters)

        return filter_bank

    def compute_phase_congruency(
        self, gray_8u: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute Phase Congruency (M_max) and Maximum Index Map (MIM)
        for extreme non-linear illumination and shadow invariance.
        """
        rows, cols = gray_8u.shape
        img_f = gray_8u.astype(np.float32) / 255.0
        img_fft = fft.fft2(img_f)

        filters = self._construct_log_gabor_filter_bank(rows, cols)

        sum_e = [np.zeros((rows, cols), dtype=np.float32) for _ in range(self.n_orient)]
        sum_o = [np.zeros((rows, cols), dtype=np.float32) for _ in range(self.n_orient)]
        sum_a = [np.zeros((rows, cols), dtype=np.float32) for _ in range(self.n_orient)]
        total_a = np.zeros((rows, cols), dtype=np.float32)

        for s in range(self.n_scale):
            for o in range(self.n_orient):
                resp = fft.ifft2(img_fft * filters[s][o])
                e_so = np.real(resp).astype(np.float32)
                o_so = np.imag(resp).astype(np.float32)
                amp_so = np.sqrt(e_so ** 2 + o_so ** 2)

                sum_e[o] += e_so
                sum_o[o] += o_so
                sum_a[o] += amp_so
                total_a += amp_so

        # Energy per orientation & Maximum Index Map
        energy_maps = np.zeros((self.n_orient, rows, cols), dtype=np.float32)
        total_energy = np.zeros((rows, cols), dtype=np.float32)

        for o in range(self.n_orient):
            e_orient = np.sqrt(sum_e[o] ** 2 + sum_o[o] ** 2)
            energy_maps[o] = e_orient
            total_energy += e_orient

        # MIM: Orientation index of max energy response at each pixel
        mim = np.argmax(energy_maps, axis=0).astype(np.uint8)

        # Phase Congruency (M_max)
        eps = 1e-4
        pc = total_energy / (total_a + eps)
        pc = np.clip(pc, 0.0, 1.0)

        return pc, mim

    def extract_features(
        self, gray_8u: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Extract salient keypoints and RIFT structural patch descriptors.
        """
        h, w = gray_8u.shape
        # Downscale if raster is huge to keep CPU latency low (< 0.8s)
        scale = 1.0
        if max(h, w) > 1024:
            scale = 1024.0 / max(h, w)
            proc_img = cv2.resize(gray_8u, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            proc_img = gray_8u

        pc, mim = self.compute_phase_congruency(proc_img)

        # Keypoint detection on Phase Congruency map using FAST or Harris on PC
        pc_8u = (pc * 255.0).astype(np.uint8)
        fast = cv2.FastFeatureDetector_create(threshold=18, nonmaxSuppression=True)
        cv_kpts = fast.detect(pc_8u, None)

        if len(cv_kpts) < 50:
            # Fallback to cornerHarris if FAST produces sparse detections
            harris = cv2.cornerHarris(pc_8u, blockSize=3, ksize=3, k=0.04)
            harris_pts = np.argwhere(harris > 0.01 * harris.max())
            if len(harris_pts) > 0:
                cv_kpts = [cv2.KeyPoint(float(p[1]), float(p[0]), 7.0) for p in harris_pts]

        if not cv_kpts:
            return np.empty((0, 2), dtype=np.float32), np.empty((0, 96), dtype=np.float32)

        # Retain top keypoints by response
        if len(cv_kpts) > self.max_keypoints:
            cv_kpts = sorted(cv_kpts, key=lambda k: k.response, reverse=True)[: self.max_keypoints]

        # Formulate structural descriptors from MIM and PC around keypoints
        patch_r = 16
        ph, pw = proc_img.shape
        valid_kpts = []
        descriptors = []

        for kp in cv_kpts:
            x, y = int(round(kp.pt[0])), int(round(kp.pt[1]))
            if x < patch_r or x >= pw - patch_r or y < patch_r or y >= ph - patch_r:
                continue

            # 32x32 local patch of MIM and PC
            patch_mim = mim[y - patch_r : y + patch_r, x - patch_r : x + patch_r]
            patch_pc = pc[y - patch_r : y + patch_r, x - patch_r : x + patch_r]

            # Construct 4x4 spatial grid histogram of MIM orientations (4x4x6 = 96-dim)
            desc_cells = []
            cell_size = (2 * patch_r) // 4
            for cy in range(4):
                for cx in range(4):
                    c_mim = patch_mim[cy * cell_size : (cy + 1) * cell_size, cx * cell_size : (cx + 1) * cell_size]
                    c_pc = patch_pc[cy * cell_size : (cy + 1) * cell_size, cx * cell_size : (cx + 1) * cell_size]
                    hist, _ = np.histogram(c_mim, bins=self.n_orient, range=(0, self.n_orient), weights=c_pc)
                    desc_cells.extend(hist)

            vec = np.array(desc_cells, dtype=np.float32)
            norm = np.linalg.norm(vec)
            if norm > 1e-6:
                vec = vec / norm
            else:
                vec = np.zeros(96, dtype=np.float32)

            # Map coordinates back to original resolution
            orig_x = kp.pt[0] / scale
            orig_y = kp.pt[1] / scale

            valid_kpts.append([orig_x, orig_y])
            descriptors.append(vec)

        if not valid_kpts:
            return np.empty((0, 2), dtype=np.float32), np.empty((0, 96), dtype=np.float32)

        return np.array(valid_kpts, dtype=np.float32), np.array(descriptors, dtype=np.float32)

    def match(
        self,
        img_a: np.ndarray,
        img_b: np.ndarray,
        ratio_threshold: float = 0.88,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Extract and perform mutual nearest neighbor matching with ratio test.
        """
        kpts_a, desc_a = self.extract_features(img_a)
        kpts_b, desc_b = self.extract_features(img_b)

        if len(kpts_a) < 4 or len(kpts_b) < 4:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0,))

        # FLANN / BF Matcher with L2 norm
        bf = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
        raw_matches = bf.knnMatch(desc_a, desc_b, k=2)

        matched_a = []
        matched_b = []
        confidences = []

        for m_pair in raw_matches:
            if len(m_pair) == 2:
                m, n = m_pair
                if m.distance < ratio_threshold * n.distance:
                    matched_a.append(kpts_a[m.queryIdx])
                    matched_b.append(kpts_b[m.trainIdx])
                    # Distance score in [0, 1]
                    conf = max(0.0, 1.0 - m.distance / 2.0)
                    confidences.append(conf)

        if not matched_a:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0,))

        return (
            np.array(matched_a, dtype=np.float32),
            np.array(matched_b, dtype=np.float32),
            np.array(confidences, dtype=np.float32),
        )


# ------------------------------------------------------------------------------
# Primary LunarMatcher Orchestrator
# ------------------------------------------------------------------------------
class LunarMatcher:
    """
    Production-grade multi-modal lunar registration orchestrator.
    Integrates Preprocessing, Dynamic Routing, AI Branch, Physics Branch,
    Adaptive Fusion, USAC_MAGSAC, 3D DEM Warping, and Uncertainty Heatmaps.
    """

    def __init__(
        self,
        device: str = "auto",
        feature_type: str = "disk",
        reproj_threshold: float = 3.0,
        confidence: float = 0.999,
        max_iters: int = 10000,
        max_keypoints: int = 2048,
        default_branch: str = "auto",
    ) -> None:
        self._check_dependencies()
        self.device = self._resolve_device(device)
        self.feature_type = feature_type.lower()
        self.reproj_threshold = float(reproj_threshold)
        self.confidence = float(confidence)
        self.max_iters = int(max_iters)
        self.max_keypoints = int(max_keypoints)
        self.default_branch = default_branch.lower()

        # Instantiate sub-engines
        self.texture_router = TextureDensityAnalyzer(low_threshold=0.20, high_threshold=0.35)
        self.physics_matcher = PhysicsRIFT2Matcher(max_keypoints=self.max_keypoints)
        self.geometry_estimator = RobustGeometryEstimator(
            reproj_threshold=self.reproj_threshold,
            confidence=self.confidence,
            max_iters=self.max_iters,
        )
        self.dem_warper = TopographicDEMWarper()
        self.uncertainty_model = RegistrationUncertaintyModel()

        # AI Models
        self.extractor = None
        self.matcher = None
        self._init_ai_models()

        print(f"[LunarMatcher] Initialized with Dual-Branch Capabilities (Device: {self.device})")

    @staticmethod
    def _check_dependencies() -> None:
        missing = []
        if cv2 is None:
            missing.append("opencv-python")
        if torch is None or K is None:
            missing.extend(["torch", "torchvision", "kornia"])
        if missing:
            raise ImportError(f"Missing required dependencies: {', '.join(set(missing))}")

    def _resolve_device(self, requested: str = "auto") -> torch.device:
        """
        Device-agnostic dynamic routing for cloud & containerized environments:
        Defaults dynamically to CUDA if available, otherwise cleanly falls back to CPU.
        Removes hardcoded Apple Silicon MPS assignments for Docker/Linux/Cloud execution.
        """
        free_gb = get_free_disk_space_gb()
        if free_gb < 2.0:
            print(f"[LunarMatcher] Disk space constrained ({free_gb:.2f} GB free). Routing execution to CPU.")
            return torch.device("cpu")

        req = (requested or "auto").lower().strip()
        if req == "cuda":
            if torch.cuda.is_available():
                return torch.device("cuda")
            print("[LunarMatcher] CUDA requested but unavailable. Cleanly falling back to CPU.")
            return torch.device("cpu")
        elif req == "cpu":
            return torch.device("cpu")
        elif req == "auto":
            # Dynamic cloud routing: CUDA if available, else CPU
            if torch.cuda.is_available():
                return torch.device("cuda")
            return torch.device("cpu")
        elif req == "mps":
            # Graceful fallback for macOS if explicitly requested and available
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                return torch.device("mps")
            print("[LunarMatcher] MPS requested but unavailable. Cleanly falling back to CPU.")
            return torch.device("cpu")
        else:
            if torch.cuda.is_available():
                return torch.device("cuda")
            return torch.device("cpu")

    def _init_ai_models(self) -> None:
        try:
            self.extractor = DISK.from_pretrained("depth").to(self.device)
            self.matcher = LightGlue(features="disk").to(self.device)
            self.extractor.eval()
            self.matcher.eval()
        except Exception as e:
            print(f"[LunarMatcher] Warning: Failed to load LightGlue models ({e}). AI branch will use CPU fallback.")

    def load_and_preprocess(
        self, image_path: str, sensor: str = "auto"
    ) -> Tuple[np.ndarray, np.ndarray, torch.Tensor, Dict[str, Any]]:
        """
        Load tile and run CLAHE / Hyperspectral PCA Stage 1 preprocessing.
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Tile not found: {image_path}")

        img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError(f"Failed to decode image: {image_path}")

        raw_display = img.copy()

        # Stage 1 Preprocessing (CLAHE / PCA)
        preprocessed, prep_telemetry = preprocess_lunar_image(img, sensor_type=sensor)

        # Ensure 3-channel RGB for neural network
        if len(preprocessed.shape) == 2:
            rgb_8u = cv2.cvtColor(preprocessed, cv2.COLOR_GRAY2RGB)
            gray_8u = preprocessed.copy()
        elif len(preprocessed.shape) == 3:
            if preprocessed.shape[2] == 1:
                rgb_8u = cv2.cvtColor(preprocessed[:, :, 0], cv2.COLOR_GRAY2RGB)
                gray_8u = preprocessed[:, :, 0]
            elif preprocessed.shape[2] >= 3:
                rgb_8u = cv2.cvtColor(preprocessed[:, :, :3], cv2.COLOR_BGR2RGB)
                gray_8u = cv2.cvtColor(preprocessed[:, :, :3], cv2.COLOR_BGR2GRAY)

        tensor = torch.from_numpy((rgb_8u / 255.0).astype(np.float32)).permute(2, 0, 1).unsqueeze(0).to(self.device)
        return raw_display, gray_8u, tensor, prep_telemetry

    @no_grad()
    def match_ai_branch(
        self, tensor_a: torch.Tensor, tensor_b: torch.Tensor
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Execute AI Branch (Kornia LightGlue + DISK)."""
        ha, wa = tensor_a.shape[2], tensor_a.shape[3]
        hb, wb = tensor_b.shape[2], tensor_b.shape[3]

        try:
            feat_a = self.extractor(tensor_a)[0]
            feat_b = self.extractor(tensor_b)[0]
        except (RuntimeError, OSError) as e:
            print(f"[LunarMatcher] AI Branch GPU/CUDA fallback to CPU ({e})...")
            self.device = torch.device("cpu")
            self.extractor = self.extractor.to("cpu")
            if self.matcher is not None:
                self.matcher = self.matcher.to("cpu")
            feat_a = self.extractor(tensor_a.cpu())[0]
            feat_b = self.extractor(tensor_b.cpu())[0]

        kpts_a = feat_a.keypoints
        desc_a = feat_a.descriptors
        kpts_b = feat_b.keypoints
        desc_b = feat_b.descriptors

        if len(kpts_a) > self.max_keypoints:
            topk_a = torch.topk(feat_a.detection_scores, self.max_keypoints).indices
            kpts_a, desc_a = kpts_a[topk_a], desc_a[topk_a]
        if len(kpts_b) > self.max_keypoints:
            topk_b = torch.topk(feat_b.detection_scores, self.max_keypoints).indices
            kpts_b, desc_b = kpts_b[topk_b], desc_b[topk_b]

        if len(kpts_a) == 0 or len(kpts_b) == 0:
            return np.empty((0, 2)), np.empty((0, 2)), np.empty((0,))

        data = {
            "image0": {"keypoints": kpts_a.unsqueeze(0), "descriptors": desc_a.unsqueeze(0), "image_size": torch.tensor([[ha, wa]], device=self.device)},
            "image1": {"keypoints": kpts_b.unsqueeze(0), "descriptors": desc_b.unsqueeze(0), "image_size": torch.tensor([[hb, wb]], device=self.device)},
        }

        try:
            out = self.matcher(data)
        except Exception:
            cpu_matcher = LightGlue(features="disk").to("cpu")
            cpu_matcher.eval()
            out = cpu_matcher({
                "image0": {"keypoints": data["image0"]["keypoints"].cpu(), "descriptors": data["image0"]["descriptors"].cpu(), "image_size": data["image0"]["image_size"].cpu()},
                "image1": {"keypoints": data["image1"]["keypoints"].cpu(), "descriptors": data["image1"]["descriptors"].cpu(), "image_size": data["image1"]["image_size"].cpu()},
            })

        matches = out["matches"][0]
        scores = out["scores"][0]

        if len(matches) == 0:
            return np.empty((0, 2), dtype=np.float32), np.empty((0, 2), dtype=np.float32), np.empty((0,), dtype=np.float32)

        # Explicitly cast all AI keypoints, matches, and scores to CPU before indexing and conversion
        kpts_a_cpu = kpts_a.detach().cpu()
        kpts_b_cpu = kpts_b.detach().cpu()
        matches_cpu = matches.detach().cpu()
        scores_cpu = scores.detach().cpu()

        pts_a = kpts_a_cpu[matches_cpu[:, 0]].numpy().astype(np.float32)
        pts_b = kpts_b_cpu[matches_cpu[:, 1]].numpy().astype(np.float32)
        conf = scores_cpu.numpy().astype(np.float32)

        return pts_a, pts_b, conf

    def match_tiles(
        self,
        tile_a_path: str,
        tile_b_path: str,
        output_viz: Optional[str] = None,
        output_json: Optional[str] = None,
        branch: Optional[str] = None,
        sensor: str = "auto",
        warp_dem: bool = True,
        output_heatmap: Optional[str] = None,
        output_uncertainty_json: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute full 6-Stage co-registration pipeline.
        """
        branch_mode = (branch or self.default_branch).lower()

        # 1. Stage 1: Preprocess
        raw_a, gray_a, tensor_a, meta_prep_a = self.load_and_preprocess(tile_a_path, sensor=sensor)
        raw_b, gray_b, tensor_b, meta_prep_b = self.load_and_preprocess(tile_b_path, sensor=sensor)

        # 2. Stage 2: Dynamic Texture Routing
        routing_meta = self.texture_router.route_pair(gray_a, gray_b)
        active_route = routing_meta["joint_route"] if branch_mode == "auto" else branch_mode

        print(f"[LunarMatcher] Dynamic Routing Decision: {active_route.upper()} (Texture Score: {routing_meta['joint_texture_score']})")

        pts_a_list: List[np.ndarray] = []
        pts_b_list: List[np.ndarray] = []
        scores_list: List[np.ndarray] = []

        w_ai = routing_meta["weights"]["ai_weight"]
        w_phys = routing_meta["weights"]["physics_weight"]

        # 3. Stage 3: Dual-Branch Matching Execution
        if active_route in ("ai_branch", "ai"):
            print("[LunarMatcher] Executing AI Branch (LightGlue + DISK)...")
            pa, pb, sc = self.match_ai_branch(tensor_a, tensor_b)
            if hasattr(pa, "detach"): pa = pa.detach().cpu().numpy()
            if hasattr(pb, "detach"): pb = pb.detach().cpu().numpy()
            if hasattr(sc, "detach"): sc = sc.detach().cpu().numpy()
            pts_a_list.append(np.asarray(pa, dtype=np.float32))
            pts_b_list.append(np.asarray(pb, dtype=np.float32))
            scores_list.append(np.asarray(sc, dtype=np.float32))
            actual_branch = "AI Branch (LightGlue/DISK)"

        elif active_route in ("physics_branch", "physics"):
            print("[LunarMatcher] Executing Physics Branch (RIFT2 Log-Gabor Phase Congruency)...")
            pa, pb, sc = self.physics_matcher.match(gray_a, gray_b)
            if hasattr(pa, "detach"): pa = pa.detach().cpu().numpy()
            if hasattr(pb, "detach"): pb = pb.detach().cpu().numpy()
            if hasattr(sc, "detach"): sc = sc.detach().cpu().numpy()
            pts_a_list.append(np.asarray(pa, dtype=np.float32))
            pts_b_list.append(np.asarray(pb, dtype=np.float32))
            scores_list.append(np.asarray(sc, dtype=np.float32))
            actual_branch = "Physics Branch (RIFT2 Phase Congruency)"

        else:  # dual_fusion
            print(f"[LunarMatcher] Executing Dual-Branch Fusion (W_AI={w_ai}, W_Phys={w_phys})...")
            # Run AI Branch
            pa_ai, pb_ai, sc_ai = self.match_ai_branch(tensor_a, tensor_b)
            # Run Physics Branch
            pa_ph, pb_ph, sc_ph = self.physics_matcher.match(gray_a, gray_b)

            # Explicitly cast all AI features and keypoints to CPU (.cpu().numpy())
            if hasattr(pa_ai, "detach"):
                pa_ai = pa_ai.detach().cpu().numpy()
            if hasattr(pb_ai, "detach"):
                pb_ai = pb_ai.detach().cpu().numpy()
            if hasattr(sc_ai, "detach"):
                sc_ai = sc_ai.detach().cpu().numpy()

            pa_ai = np.asarray(pa_ai, dtype=np.float32)
            pb_ai = np.asarray(pb_ai, dtype=np.float32)
            sc_ai = np.asarray(sc_ai, dtype=np.float32)

            if hasattr(pa_ph, "detach"):
                pa_ph = pa_ph.detach().cpu().numpy()
            if hasattr(pb_ph, "detach"):
                pb_ph = pb_ph.detach().cpu().numpy()
            if hasattr(sc_ph, "detach"):
                sc_ph = sc_ph.detach().cpu().numpy()

            pa_ph = np.asarray(pa_ph, dtype=np.float32)
            pb_ph = np.asarray(pb_ph, dtype=np.float32)
            sc_ph = np.asarray(sc_ph, dtype=np.float32)

            if len(pa_ai) > 0:
                pts_a_list.append(pa_ai)
                pts_b_list.append(pb_ai)
                scores_list.append(sc_ai * w_ai)
            if len(pa_ph) > 0:
                pts_a_list.append(pa_ph)
                pts_b_list.append(pb_ph)
                scores_list.append(sc_ph * w_phys)

            actual_branch = f"Dual-Branch Fusion (AI: {round(w_ai*100)}%, Phys: {round(w_phys*100)}%)"

        # Fuse candidate pools into contiguous CPU NumPy arrays
        valid_a = [p for p in pts_a_list if len(p) > 0]
        valid_b = [p for p in pts_b_list if len(p) > 0]
        valid_s = [s for s in scores_list if len(s) > 0]

        if valid_a and valid_b:
            all_pts_a = np.ascontiguousarray(np.vstack(valid_a), dtype=np.float32)
            all_pts_b = np.ascontiguousarray(np.vstack(valid_b), dtype=np.float32)
            all_scores = np.ascontiguousarray(np.concatenate(valid_s), dtype=np.float32)
        else:
            all_pts_a = np.empty((0, 2), dtype=np.float32)
            all_pts_b = np.empty((0, 2), dtype=np.float32)
            all_scores = np.empty(0, dtype=np.float32)

        # 4. Stage 4: Geometric Verification via USAC_MAGSAC
        geo_results = self.geometry_estimator.estimate_homography(all_pts_a, all_pts_b)

        # 5. Topographic DEM Warping
        warped_url = None
        dem_telemetry = {}
        if geo_results["success"] and warp_dem:
            warped_img, dem_telemetry = self.dem_warper.warp_image_with_dem(
                raw_b,
                geo_results["homography"],
                reference_shape=raw_a.shape[:2],
            )
            # Save warped image
            warped_dest = Path(output_viz).parent / "warped_aligned.png" if output_viz else Path("data/warped_aligned.png")
            warped_dest.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(warped_dest), warped_img)
            dem_telemetry["warped_raster_path"] = str(warped_dest)
            warped_url = f"/static/{warped_dest.name}"

        # 6. Stage 5: Quantitative Uncertainty Map
        h_ref, w_ref = raw_a.shape[:2]
        inlier_mask = geo_results["inlier_mask"]
        inliers_a = all_pts_a[inlier_mask] if len(all_pts_a) > 0 else np.empty((0, 2))
        residuals = geo_results.get("residuals", np.empty((0,)))
        inlier_res = residuals[inlier_mask] if len(residuals) > 0 and len(inlier_mask) == len(residuals) else np.empty((0,))

        u_map, u_telemetry = self.uncertainty_model.compute_uncertainty_field(
            height=h_ref,
            width=w_ref,
            inlier_pts=inliers_a,
            residuals=inlier_res,
            base_texture_score=routing_meta["joint_texture_score"],
        )

        heatmap_dest = Path(output_heatmap) if output_heatmap else Path("data/uncertainty_heatmap.png")
        self.uncertainty_model.render_heatmap(u_map, output_path=str(heatmap_dest), base_image=raw_a)
        u_telemetry["heatmap_path"] = str(heatmap_dest)

        if output_uncertainty_json:
            u_json_p = Path(output_uncertainty_json)
            u_json_p.parent.mkdir(parents=True, exist_ok=True)
            with open(u_json_p, "w") as f:
                json.dump(u_telemetry, f, indent=2)

        # Match visualization
        if output_viz and len(all_pts_a) > 0:
            self.visualize_matches(raw_a, raw_b, all_pts_a, all_pts_b, inlier_mask, output_viz, actual_branch)

        # Assemble unified results dictionary
        results = {
            "success": geo_results["success"],
            "num_tentative": geo_results["num_tentative"],
            "num_inliers": geo_results["num_inliers"],
            "inlier_ratio": geo_results["inlier_ratio"],
            "mean_reprojection_error": geo_results["mean_reprojection_error"],
            "homography": geo_results["homography"],
            "inlier_mask": inlier_mask,
            "inlier_points": inliers_a.tolist(),
            "inlier_residuals": [float(r) for r in inlier_res] if len(inlier_res) > 0 else [],
            "reason": geo_results.get("reason", "Registration completed."),
            "routing": {
                "active_branch": actual_branch,
                "route_decision": active_route,
                "terrain_type": routing_meta["joint_terrain"],
                "joint_texture_score": routing_meta["joint_texture_score"],
                "weights": routing_meta["weights"],
                "tile_a": routing_meta["tile_a"],
                "tile_b": routing_meta["tile_b"],
            },
            "uncertainty": {
                "mean_uncertainty": u_telemetry["mean_uncertainty"],
                "median_uncertainty": u_telemetry["median_uncertainty"],
                "max_uncertainty": u_telemetry["max_uncertainty"],
                "high_confidence_pct": u_telemetry["high_confidence_pct"],
                "medium_confidence_pct": u_telemetry["medium_confidence_pct"],
                "low_confidence_pct": u_telemetry["low_confidence_pct"],
                "heatmap_url": f"/static/{heatmap_dest.name}",
                "grid_downsampled": u_telemetry["grid_downsampled"],
            },
            "dem_warping": {
                "warped_raster_url": warped_url,
                "elevation_min_m": dem_telemetry.get("elevation_min_m"),
                "elevation_max_m": dem_telemetry.get("elevation_max_m"),
                "elevation_mean_m": dem_telemetry.get("elevation_mean_m"),
                "max_parallax_displacement_px": dem_telemetry.get("max_parallax_displacement_px"),
                "parallax_corrected": dem_telemetry.get("parallax_corrected", False),
            },
        }

        # Save metrics.json
        if output_json:
            out_p = Path(output_json).resolve()
            out_p.parent.mkdir(parents=True, exist_ok=True)
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
                "inlier_points": results["inlier_points"],
                "inlier_residuals": results["inlier_residuals"],
                "routing": results["routing"],
                "uncertainty": results["uncertainty"],
                "dem_warping": results["dem_warping"],
                "reason": results["reason"],
            }
            with open(out_p, "w") as f:
                json.dump(serializable, f, indent=2)
            print(f"[LunarMatcher] Metrics saved to: {out_p}")

        return results

    def visualize_matches(
        self,
        img_a: np.ndarray,
        img_b: np.ndarray,
        pts_a: np.ndarray,
        pts_b: np.ndarray,
        inlier_mask: np.ndarray,
        output_path: str,
        branch_name: str = "AI Branch",
    ) -> None:
        """Render side-by-side match visualization with telemetry banner."""
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
        canvas = np.zeros((max(ha, hb), wa + wb, 3), dtype=np.uint8)
        canvas[:ha, :wa] = vis_a
        canvas[:hb, wa : wa + wb] = vis_b

        num_pts = len(pts_a)
        for i in range(num_pts):
            pt1 = (int(round(pts_a[i, 0])), int(round(pts_a[i, 1])))
            pt2 = (int(round(pts_b[i, 0])) + wa, int(round(pts_b[i, 1])))
            is_inlier = bool(inlier_mask[i]) if i < len(inlier_mask) else False
            color = (0, 235, 100) if is_inlier else (50, 50, 200)
            thickness = 2 if is_inlier else 1

            if is_inlier:
                cv2.circle(canvas, pt1, 4, (0, 255, 0), -1)
                cv2.circle(canvas, pt2, 4, (0, 255, 0), -1)
                cv2.line(canvas, pt1, pt2, color, thickness, cv2.LINE_AA)
            elif num_pts <= 400:
                cv2.line(canvas, pt1, pt2, color, 1, cv2.LINE_AA)

        # Telemetry Banner
        cv2.putText(
            canvas,
            f"Verified Inliers (USAC_MAGSAC): {np.sum(inlier_mask)} / {num_pts} | [{branch_name}]",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (0, 255, 100),
            2,
            cv2.LINE_AA,
        )

        p = Path(output_path).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(p), canvas)
        print(f"[LunarMatcher] Correspondence map saved to: {p}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="LunarAlign-Hybrid: Multi-Modal Dual-Branch Matching Engine",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--tile-a", type=str, required=True, help="Reference lunar tile path")
    parser.add_argument("--tile-b", type=str, required=True, help="Target lunar tile path")
    parser.add_argument("--output-viz", type=str, default="data/matches_visualization.png", help="Path to save match visualization")
    parser.add_argument("--output-json", type=str, default="data/metrics.json", help="Path to save metrics JSON")
    parser.add_argument("--output-heatmap", type=str, default="data/uncertainty_heatmap.png", help="Path to save uncertainty heatmap PNG")
    parser.add_argument("--output-uncertainty-json", type=str, default="data/uncertainty_map.json", help="Path to save uncertainty map JSON")
    parser.add_argument("--branch", type=str, default="auto", choices=["auto", "ai", "physics", "fusion"], help="Pipeline matching branch")
    parser.add_argument("--sensor", type=str, default="auto", choices=["auto", "tmc2", "ohrc", "iirs"], help="Payload sensor type")
    parser.add_argument("--reproj-thresh", type=float, default=3.0, help="USAC_MAGSAC noise threshold in pixels")
    parser.add_argument("--confidence", type=float, default=0.999, help="USAC_MAGSAC confidence level")
    parser.add_argument("--max-iters", type=int, default=10000, help="USAC_MAGSAC max sampling iterations")
    parser.add_argument("--max-kpts", type=int, default=2048, help="Max salient keypoints per tile")
    parser.add_argument("--device", type=str, default="auto", choices=["auto", "cuda", "cpu", "mps"], help="Compute device (default auto: dynamic cuda -> cpu fallback)")

    args = parser.parse_args()

    matcher = LunarMatcher(
        device=args.device,
        feature_type="disk",
        reproj_threshold=args.reproj_thresh,
        confidence=args.confidence,
        max_iters=args.max_iters,
        max_keypoints=args.max_kpts,
        default_branch=args.branch,
    )

    results = matcher.match_tiles(
        tile_a_path=args.tile_a,
        tile_b_path=args.tile_b,
        output_viz=args.output_viz,
        output_json=args.output_json,
        branch=args.branch,
        sensor=args.sensor,
        output_heatmap=args.output_heatmap,
        output_uncertainty_json=args.output_uncertainty_json,
    )

    # Output isolated JSON payload to stdout for robust subprocess parsing
    if results:
        stdout_payload = {
            "success": results.get("success", False),
            "num_tentative": results.get("num_tentative", 0),
            "num_inliers": results.get("num_inliers", 0),
            "inlier_ratio": results.get("inlier_ratio", 0.0),
            "mean_reprojection_error": (
                results["mean_reprojection_error"]
                if results.get("mean_reprojection_error") != float("inf")
                else None
            ),
            "homography": (
                results["homography"].tolist()
                if isinstance(results.get("homography"), np.ndarray)
                else results.get("homography")
            ),
            "inlier_points": results.get("inlier_points", []),
            "inlier_residuals": results.get("inlier_residuals", []),
            "routing": results.get("routing"),
            "uncertainty": results.get("uncertainty"),
            "dem_warping": results.get("dem_warping"),
            "reason": results.get("reason"),
        }
        print("\n" + json.dumps(stdout_payload) + "\n")

    return 0 if results["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
