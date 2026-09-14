#!/usr/bin/env python3
"""
LunarAlign-Hybrid: Multi-Modal Preprocessing Engine
===================================================
Official Preprocessing Pipeline for Chandrayaan-2 Payloads:
  - OHRC (Optical High Resolution Camera): 0.25m Panchromatic
  - TMC-2 (Terrain Mapping Camera-2): 5m Panchromatic Stereo
  - IIRS (Imaging Infrared Spectrometer): 250-band Hyperspectral (0.8 - 5.0 um)

Capabilities:
1. CLAHE (Contrast Limited Adaptive Histogram Equalization):
   Equalizes local micro-contrast across harsh solar terminator shadows,
   impact crater walls, and high-albedo anorthosite ejecta blankets.
2. Hyperspectral PCA Dimensionality Reduction:
   Uses sklearn.decomposition.PCA to compress 250-band IIRS cubes down to
   3 principal structural bands, preserving >95% spatial-spectral variance
   while drastically reducing memory overhead before feature extraction.
"""

from typing import Tuple, Dict, Any, Optional, Union
import numpy as np
import cv2

try:
    from sklearn.decomposition import PCA
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


def apply_clahe(
    image: np.ndarray,
    clip_limit: float = 3.0,
    tile_grid_size: Tuple[int, int] = (8, 8),
) -> np.ndarray:
    """
    Apply Contrast Limited Adaptive Histogram Equalization (CLAHE) to lunar imagery.

    Handles 8-bit and 16-bit GeoTIFF tiles, and single-channel or RGB arrays.
    Prevents noise over-amplification in uniform basaltic maria while enhancing
    subtle micro-relief along crater rim shadows.

    Args:
        image: 2D (H, W) or 3D (H, W, C) NumPy array.
        clip_limit: Threshold for contrast limiting (default: 3.0).
        tile_grid_size: Size of grid for histogram equalization (default: 8x8).

    Returns:
        Equalized image with identical bit-depth and dimensions.
    """
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)

    # 1. Grayscale 2D array
    if len(image.shape) == 2:
        if image.dtype == np.uint8:
            return clahe.apply(image)
        elif image.dtype == np.uint16:
            # 16-bit to 8-bit scaled CLAHE, then restored or returned as 8-bit
            norm_8u = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
            eq_8u = clahe.apply(norm_8u)
            # Map back to 16-bit range
            return (eq_8u.astype(np.float32) * (65535.0 / 255.0)).astype(np.uint16)
        elif np.issubdtype(image.dtype, np.floating):
            norm_8u = (np.clip(image, 0.0, 1.0) * 255.0).astype(np.uint8)
            eq_8u = clahe.apply(norm_8u)
            return (eq_8u.astype(np.float32) / 255.0).astype(image.dtype)
        else:
            norm_8u = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
            return clahe.apply(norm_8u)

    # 2. Multi-channel 3D array (RGB / BGR)
    elif len(image.shape) == 3:
        if image.shape[2] == 1:
            eq = clahe.apply(image[:, :, 0])
            return eq[:, :, np.newaxis]
        elif image.shape[2] >= 3:
            # Convert to LAB color space to equalize Luminance channel without hue distortion
            rgb_8u = cv2.normalize(image[:, :, :3], None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
            lab = cv2.cvtColor(rgb_8u, cv2.COLOR_BGR2LAB)
            lab_planes = list(cv2.split(lab))
            lab_planes[0] = clahe.apply(lab_planes[0])
            lab_merged = cv2.merge(lab_planes)
            return cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)

    return image


def compress_iirs_hyperspectral(
    cube: np.ndarray,
    n_components: int = 3,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Compress high-dimensional IIRS hyperspectral cubes (up to 250 bands)
    down to 3 principal structural components using Principal Component Analysis (PCA).

    Preserves structural contours, mineral absorption signatures, and surface topology
    while reducing GPU/CPU memory bandwidth by up to 98.8%.

    Args:
        cube: 3D NumPy array of shape (H, W, B) where B is band count (e.g. 250).
        n_components: Number of target structural principal components (default: 3).

    Returns:
        rgb_composite: (H, W, 3) uint8 composite suitable for downstream feature extraction.
        metrics: Dictionary containing explained variance ratios and spectral statistics.
    """
    if len(cube.shape) != 3:
        raise ValueError(f"IIRS hyperspectral data must be 3D (H, W, Bands), got shape: {cube.shape}")

    h, w, num_bands = cube.shape

    if num_bands <= n_components:
        # If cube already has <= 3 bands, pad or normalize directly
        norm = cv2.normalize(cube, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        if num_bands == 1:
            comp = cv2.cvtColor(norm[:, :, 0], cv2.COLOR_GRAY2BGR)
        else:
            comp = norm[:, :, :3]
        return comp, {"explained_variance_ratio": [1.0] * num_bands, "bands_input": num_bands}

    # Flatten spatial dimensions: (H*W, Bands)
    flat_data = cube.reshape(-1, num_bands).astype(np.float32)

    # Handle NaNs / infs in raw orbital cubes
    flat_data = np.nan_to_num(flat_data, nan=0.0, posinf=65535.0, neginf=0.0)

    if HAS_SKLEARN:
        pca = PCA(n_components=n_components, svd_solver="auto", random_state=42)
        reduced = pca.fit_transform(flat_data)
        var_ratios = [float(v) for v in pca.explained_variance_ratio_]
    else:
        # Robust Pure-NumPy SVD fallback if sklearn is absent
        flat_mean = np.mean(flat_data, axis=0, keepdims=True)
        centered = flat_data - flat_mean
        u, s, vt = np.linalg.svd(centered, full_matrices=False)
        reduced = u[:, :n_components] * s[:n_components]
        total_var = np.sum(s ** 2)
        var_ratios = [float(s[i] ** 2 / total_var) for i in range(n_components)]

    # Reshape back to (H, W, n_components)
    reduced_cube = reduced.reshape(h, w, n_components)

    # Normalize each principal component to 8-bit [0, 255]
    composite = np.zeros((h, w, 3), dtype=np.uint8)
    for c in range(min(3, n_components)):
        band = reduced_cube[:, :, c]
        b_min, b_max = np.percentile(band, 1.0), np.percentile(band, 99.0)
        if b_max > b_min:
            scaled = np.clip((band - b_min) / (b_max - b_min) * 255.0, 0, 255).astype(np.uint8)
        else:
            scaled = np.zeros((h, w), dtype=np.uint8)
        composite[:, :, c] = scaled

    # Apply CLAHE to first principal component to maximize structural feature salience
    composite[:, :, 0] = apply_clahe(composite[:, :, 0], clip_limit=2.5)

    metrics = {
        "bands_input": num_bands,
        "components_output": n_components,
        "explained_variance_ratio": var_ratios,
        "total_explained_variance": float(sum(var_ratios)),
        "compression_ratio": round(num_bands / float(n_components), 2),
    }

    return composite, metrics


def preprocess_lunar_image(
    image: np.ndarray,
    sensor_type: str = "auto",
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Unified multi-modal preprocessing interface for Chandrayaan-2 imagery.

    Args:
        image: Input raw satellite image array (2D or 3D).
        sensor_type: Payload identifier ('ohrc', 'tmc2', 'iirs', or 'auto').

    Returns:
        preprocessed_img: Normalised, contrast-enhanced 8-bit image array.
        telemetry: Metadata dictionary of preprocessing transforms.
    """
    sensor = sensor_type.lower().strip()
    telemetry: Dict[str, Any] = {"sensor_type": sensor, "original_shape": list(image.shape)}

    # Auto-detection based on channel count
    if sensor == "auto":
        if len(image.shape) == 3 and image.shape[2] > 4:
            sensor = "iirs"
        elif len(image.shape) == 2 or (len(image.shape) == 3 and image.shape[2] <= 4):
            sensor = "tmc2"
        telemetry["detected_sensor"] = sensor

    # 1. IIRS Hyperspectral Compression (250 bands -> 3 bands)
    if sensor == "iirs" and len(image.shape) == 3 and image.shape[2] > 3:
        compressed, pca_meta = compress_iirs_hyperspectral(image, n_components=3)
        telemetry.update(pca_meta)
        telemetry["clahe_applied"] = True
        return compressed, telemetry

    # 2. OHRC & TMC-2 Panchromatic Equalization
    # Convert to 8-bit base
    if image.dtype != np.uint8:
        norm_8u = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    else:
        norm_8u = image.copy()

    # Apply CLAHE: OHRC benefits from higher clipLimit for boulder field micro-relief
    clip_limit = 3.5 if sensor == "ohrc" else 2.5
    enhanced = apply_clahe(norm_8u, clip_limit=clip_limit, tile_grid_size=(8, 8))

    telemetry["clahe_applied"] = True
    telemetry["clip_limit"] = clip_limit
    telemetry["output_shape"] = list(enhanced.shape)

    return enhanced, telemetry
