#!/usr/bin/env python3
"""
LunarAlign-Hybrid: Multi-Temporal Satellite Registration Dashboard
==================================================================
Interactive Streamlit UI for planetary satellite imagery ingestion,
deep feature matching (Kornia LightGlue), and robust geometric verification
(USAC_MAGSAC / MAGSAC+).
"""

import os
import json
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any

import streamlit as st
from PIL import Image

# ------------------------------------------------------------------------------
# 1. Streamlit Page Configuration (Wide mode, Dark theme aesthetics)
# ------------------------------------------------------------------------------
st.set_page_config(
    page_title="LunarAlign-Hybrid: Multi-Temporal Satellite Registration",
    page_icon="🌙",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS styling for a modern planetary science dark cockpit aesthetic
st.markdown(
    """
    <style>
    /* Global styling */
    .main {
        background-color: #0b0f19;
        color: #e2e8f0;
    }
    /* Title banner */
    .title-banner {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        padding: 1.5rem 2rem;
        border-radius: 12px;
        border-left: 6px solid #38bdf8;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        margin-bottom: 2rem;
    }
    .title-banner h1 {
        margin: 0;
        font-size: 2.2rem;
        font-weight: 700;
        color: #f8fafc;
        letter-spacing: -0.02em;
    }
    .title-banner p {
        margin: 0.5rem 0 0 0;
        font-size: 1.05rem;
        color: #94a3b8;
    }
    /* Metric cards */
    [data-testid="stMetricValue"] {
        font-size: 1.9rem !important;
        font-weight: 700 !important;
        color: #38bdf8 !important;
    }
    /* Expander styling */
    .streamlit-expanderHeader {
        background-color: #1e293b !important;
        color: #f1f5f9 !important;
        border-radius: 8px;
        font-weight: 600;
    }
    /* Custom button */
    .stButton > button {
        background: linear-gradient(90deg, #0284c7 0%, #0369a1 100%);
        color: #ffffff;
        font-weight: 600;
        border: none;
        border-radius: 8px;
        padding: 0.65rem 1.5rem;
        transition: all 0.2s ease-in-out;
    }
    .stButton > button:hover {
        background: linear-gradient(90deg, #38bdf8 0%, #0284c7 100%);
        color: #ffffff;
        box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# Project paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
TILES_DIR = DATA_DIR / "tiles"
METRICS_PATH = DATA_DIR / "metrics.json"
VIZ_PATH = DATA_DIR / "matches_visualization.png"

# ------------------------------------------------------------------------------
# 2. Header Banner
# ------------------------------------------------------------------------------
st.markdown(
    """
    <div class="title-banner">
        <h1>🌙 LunarAlign-Hybrid: Multi-Temporal Satellite Registration</h1>
        <p>Sub-Pixel Lunar Terrain Alignment via Windowed GDAL Slicing, Kornia LightGlue, and USAC_MAGSAC</p>
    </div>
    """,
    unsafe_allow_html=True,
)

# ------------------------------------------------------------------------------
# 3. Sidebar: File Uploaders & Hyperparameters
# ------------------------------------------------------------------------------
st.sidebar.header("🛰️ Satellite Passes Configuration")

st.sidebar.markdown("**Input Imagery Mode**")
input_mode = st.sidebar.radio(
    "Select Input Source:",
    ("Use Existing Tile Dataset", "Upload Custom GeoTIFFs"),
    index=0,
)

tile_a_path: Optional[str] = None
tile_b_path: Optional[str] = None

if input_mode == "Upload Custom GeoTIFFs":
    st.sidebar.subheader("Upload Raster Tiles")
    uploaded_ref = st.sidebar.file_uploader(
        "Reference GeoTIFF (Pass 1)",
        type=["tif", "tiff", "png", "jpg"],
        key="ref_upload",
    )
    uploaded_tgt = st.sidebar.file_uploader(
        "Target GeoTIFF (Pass 2)",
        type=["tif", "tiff", "png", "jpg"],
        key="tgt_upload",
    )

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    if uploaded_ref is not None:
        ref_save_path = RAW_DIR / f"upload_ref_{uploaded_ref.name}"
        with open(ref_save_path, "wb") as f:
            f.write(uploaded_ref.getbuffer())
        tile_a_path = str(ref_save_path)
        st.sidebar.success(f"Loaded: {uploaded_ref.name}")

    if uploaded_tgt is not None:
        tgt_save_path = RAW_DIR / f"upload_tgt_{uploaded_tgt.name}"
        with open(tgt_save_path, "wb") as f:
            f.write(uploaded_tgt.getbuffer())
        tile_b_path = str(tgt_save_path)
        st.sidebar.success(f"Loaded: {uploaded_tgt.name}")

else:
    # Existing default tiles in data/tiles/
    default_a = TILES_DIR / "chunk_x0_y0.tif"
    default_b = TILES_DIR / "chunk_x1_y0.tif"

    if default_a.exists() and default_b.exists():
        tile_a_path = str(default_a)
        tile_b_path = str(default_b)
        st.sidebar.info("Using active tiles:\n- `data/tiles/chunk_x0_y0.tif`\n- `data/tiles/chunk_x1_y0.tif`")
    else:
        st.sidebar.warning("Default tiles not detected. Run ingestion first or upload tiles above.")

st.sidebar.markdown("---")
st.sidebar.subheader("⚙️ Algorithm Hyperparameters")

chunk_size = st.sidebar.select_slider(
    "Tile Slicing Window (px)",
    options=[512, 1024, 2048],
    value=1024,
    help="Dimension of square window for O(1) RAM streaming",
)

reproj_thresh = st.sidebar.slider(
    "MAGSAC+ Noise Scale (px)",
    min_value=1.0,
    max_value=10.0,
    value=3.0,
    step=0.5,
    help="Upper bound threshold for noise marginalization in USAC_MAGSAC",
)

max_kpts = st.sidebar.slider(
    "Max Keypoints per Tile",
    min_value=512,
    max_value=4096,
    value=2048,
    step=256,
    help="Top-K salient keypoints to retain for LightGlue attention",
)

device_choice = st.sidebar.selectbox(
    "Execution Device",
    options=["auto", "cpu", "mps", "cuda"],
    index=0,
)

# ------------------------------------------------------------------------------
# 4. Main Panel: Execution Trigger & Pipeline Orchestration
# ------------------------------------------------------------------------------
col_act1, col_act2 = st.columns([1, 4])

with col_act1:
    run_btn = st.button("🚀 Run Pipeline", use_container_width=True)

status_container = st.empty()

if run_btn:
    if not tile_a_path or not tile_b_path:
        st.error("Error: Please provide both Reference and Target GeoTIFFs.")
    else:
        with st.spinner("Executing LunarAlign-Hybrid Pipeline (GDAL Windowing + LightGlue + USAC_MAGSAC)..."):
            # Resolve Python virtual environment executable
            py_bin = PROJECT_ROOT / "sih_env" / "bin" / "python3"
            if not py_bin.exists():
                py_bin = Path("python3")

            matcher_py = PROJECT_ROOT / "ai_matching" / "matcher.py"

            cmd = [
                str(py_bin),
                str(matcher_py),
                "--tile-a", tile_a_path,
                "--tile-b", tile_b_path,
                "--output-viz", str(VIZ_PATH),
                "--output-json", str(METRICS_PATH),
                "--reproj-thresh", str(reproj_thresh),
                "--max-kpts", str(max_kpts),
                "--device", device_choice,
            ]

            try:
                proc = subprocess.run(
                    cmd,
                    cwd=str(PROJECT_ROOT),
                    capture_output=True,
                    text=True,
                    check=False,
                )

                if proc.returncode == 0:
                    status_container.success("✅ Multi-temporal registration completed successfully!")
                else:
                    status_container.error(f"Pipeline execution failed (Exit Code {proc.returncode}).")
                    with st.expander("Execution Error Logs", expanded=True):
                        st.code(proc.stderr or proc.stdout)
            except Exception as ex:
                status_container.error(f"Execution Error: {ex}")

# ------------------------------------------------------------------------------
# 5. Display Registration Metrics
# ------------------------------------------------------------------------------
if METRICS_PATH.exists():
    try:
        with open(METRICS_PATH, "r") as f:
            metrics_data: Dict[str, Any] = json.load(f)

        st.markdown("### 📊 Registration Performance Metrics")

        m1, m2, m3, m4 = st.columns(4)

        inlier_ratio = metrics_data.get("inlier_ratio", 0.0) * 100.0
        reproj_err = metrics_data.get("mean_reprojection_error")
        num_inliers = metrics_data.get("num_inliers", 0)
        num_tentative = metrics_data.get("num_tentative", 0)
        status_str = "SUCCESS" if metrics_data.get("success") else "FAILED"

        m1.metric("Inlier Ratio", f"{inlier_ratio:.2f}%", delta="USAC_MAGSAC Verified")
        m2.metric(
            "Mean Reprojection Error",
            f"{reproj_err:.3f} px" if reproj_err is not None else "N/A",
            delta="Sub-pixel Precision" if reproj_err and reproj_err < 1.0 else None,
        )
        m3.metric("Verified Matches", f"{num_inliers} / {num_tentative}")
        m4.metric("Registration Status", status_str)

        # Display estimated Homography Matrix
        if metrics_data.get("homography") is not None:
            H = metrics_data["homography"]
            with st.expander("🔍 Estimated 3x3 Projective Homography Matrix (H)", expanded=False):
                st.latex(
                    r"H = \begin{bmatrix}"
                    f"{H[0][0]:.6f} & {H[0][1]:.6f} & {H[0][2]:.6f} \\\\"
                    f"{H[1][0]:.6f} & {H[1][1]:.6f} & {H[1][2]:.6f} \\\\"
                    f"{H[2][0]:.6e} & {H[2][1]:.6e} & {H[2][2]:.6f}"
                    r"\end{bmatrix}"
                )
    except Exception as e:
        st.warning(f"Could not load metrics: {e}")

# ------------------------------------------------------------------------------
# 6. Display Visual Match Verification
# ------------------------------------------------------------------------------
if VIZ_PATH.exists():
    st.markdown("---")
    st.markdown("### 🗺️ Feature Correspondence & Inlier Verification")
    st.caption("Green lines indicate verified USAC_MAGSAC geometric inliers; red markers denote rejected outliers.")
    try:
        img = Image.open(VIZ_PATH)
        st.image(img, use_container_width=True, caption="Multi-temporal Planetary Correspondence Map")
    except Exception as e:
        st.error(f"Error loading visualization image: {e}")

# ------------------------------------------------------------------------------
# 7. Mathematical Explanation Expander: Why MAGSAC+ over Standard RANSAC
# ------------------------------------------------------------------------------
st.markdown("---")
with st.expander("📐 Mathematical Foundations: Why MAGSAC+ Outperforms Classic RANSAC for Lunar Shadow Rejection", expanded=False):
    st.markdown(
        r"""
### 1. The Hard-Threshold Dilemma in Standard RANSAC
Classic RANSAC (Fischler & Bolles, 1981) scores a candidate homography $H$ using a binary indicator step function:
$$\rho(r_i) = \begin{cases} 1, & r_i \le \tau \\ 0, & r_i > \tau \end{cases}$$
where $r_i = \|y_i - H x_i\|_2$ is the reprojection residual for point correspondence $(x_i, y_i)$, and $\tau$ is a rigid user-specified threshold.

**Planetary Challenge:** On lunar terrain (e.g. Chandrayaan-2 TMC-2 / OHRC and LROC NAC), satellite passes feature extreme illumination variations:
- Grazing low-sun elevation angles create elongated, variable shadows cast across crater floors.
- Crater rims possess high topological relief and micro-parallax discontinuities.
- A rigid $\tau$ either excludes valid crater rim correspondences ($\tau$ too strict) or admits false positives along repetitive basaltic shadow boundaries ($\tau$ too loose).

---

### 2. Continuous Noise-Scale Marginalization in MAGSAC+
MAGSAC+ (Barath et al., 2020) eliminates the manual threshold by treating the unknown measurement noise scale $\sigma$ as a continuous random variable over the domain $[0, \sigma_{\max}]$.

Assuming reprojection errors follow a $\chi^2$ distribution with $k=2$ degrees of freedom (2D image coordinates):
$$P(r_i \mid \sigma) = \frac{2 r_i}{\sigma^2} \exp\left(-\frac{r_i^2}{2 \sigma^2}\right)$$

MAGSAC+ marginalizes out $\sigma$ analytically:
$$Q(r_i) = \int_0^{\sigma_{\max}} P(r_i \mid \sigma) P(\sigma) \, d\sigma$$

This yields a smooth, non-parametric loss function where matches are scored proportionally to their continuous marginal likelihood, making shadow and noise rejection scale-invariant.

---

### 3. Graph-Cut Spatial Coherence (GC-RANSAC)
Within `cv2.USAC_MAGSAC`, candidate models trigger a **Graph-Cut Local Optimization**:
- An adjacency graph is constructed between neighboring lunar keypoints.
- Energy minimization enforces spatial clustering of correspondences along continuous crater ejecta blankets and rilles.
- Uncorrelated shadow noise clusters are robustly pruned, achieving reliable sub-pixel co-registration.
"""
    )
