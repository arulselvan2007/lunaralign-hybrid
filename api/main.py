#!/usr/bin/env python3
"""
LunarAlign-Hybrid: FastAPI Server
=================================
RESTful Backend API for Chandrayaan-2 TMC-2 / Lunar Satellite Ingestion,
Deep Feature Matching (LightGlue), and Geometric Verification (USAC_MAGSAC).
"""

import os
import sys
import json
import time
import shutil
import traceback
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Project Root Resolution (Strict Absolute Path Anchoring)
ROOT_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT_DIR  # Alias for backward compatibility
DATA_DIR = ROOT_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
TILES_DIR = DATA_DIR / "tiles"
CORE_INGEST_BIN = ROOT_DIR / "core_ingestion" / "ingest_geotiff"
MATCHER_SCRIPT = ROOT_DIR / "ai_matching" / "matcher.py"
PYTHON_BIN = ROOT_DIR / "sih_env" / "bin" / "python3"
if not PYTHON_BIN.exists():
    PYTHON_BIN = Path(sys.executable)

DEFAULT_METRICS_JSON = DATA_DIR / "metrics.json"
DEFAULT_VIZ_PNG = DATA_DIR / "matches_visualization.png"

# Ensure essential directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)
TILES_DIR.mkdir(parents=True, exist_ok=True)


def resolve_file_path(path_str: str, default_dir: Path) -> Path:
    """
    Resolve any incoming path string to a strict absolute Path.
    Handles:
    - Absolute paths: '/Users/.../data/tiles/chunk_x0_y0.tif'
    - Relative to project root: 'data/tiles/chunk_x0_y0.tif'
    - Relative to default_dir: 'chunk_x0_y0.tif'
    - Web static URLs: '/static/tiles/chunk_x0_y0.tif'
    """
    if not path_str:
        return default_dir

    cleaned = path_str.strip()
    if cleaned.startswith("/static/tiles/"):
        cleaned = cleaned.replace("/static/tiles/", "")
        return (TILES_DIR / cleaned).resolve()
    elif cleaned.startswith("/static/raw/"):
        cleaned = cleaned.replace("/static/raw/", "")
        return (RAW_DIR / cleaned).resolve()
    elif cleaned.startswith("/static/"):
        cleaned = cleaned.replace("/static/", "")
        return (DATA_DIR / cleaned).resolve()

    p = Path(cleaned)
    if p.is_absolute() and p.exists():
        return p.resolve()

    candidate_root = (ROOT_DIR / cleaned).resolve()
    if candidate_root.exists():
        return candidate_root

    candidate_default = (default_dir / cleaned).resolve()
    if candidate_default.exists():
        return candidate_default

    candidate_name = (default_dir / p.name).resolve()
    if candidate_name.exists():
        return candidate_name

    return candidate_root


def resolve_output_path(path_str: str, default_path: Path) -> Path:
    """
    Resolve output paths to a strictly absolute path and ensure parent directories exist.
    """
    if not path_str:
        default_path.parent.mkdir(parents=True, exist_ok=True)
        return default_path.resolve()

    cleaned = path_str.strip()
    if cleaned.startswith("/static/"):
        cleaned = cleaned.replace("/static/", "")
        out = (DATA_DIR / cleaned).resolve()
    else:
        p = Path(cleaned)
        if p.is_absolute():
            out = p.resolve()
        elif "/" in cleaned or "\\" in cleaned:
            out = (ROOT_DIR / cleaned).resolve()
        else:
            out = (DATA_DIR / cleaned).resolve()

    out.parent.mkdir(parents=True, exist_ok=True)
    return out

# Initialize FastAPI Application
app = FastAPI(
    title="LunarAlign-Hybrid API",
    description="Planetary Satellite Registration & 3D Topography Backend (Chandrayaan-2 TMC-2 / LROC NAC)",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS Middleware (Enable Next.js client access)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Static Files for direct asset retrieval
app.mount("/static", StaticFiles(directory=str(DATA_DIR)), name="static")


# ------------------------------------------------------------------------------
# Request & Response Schemas
# ------------------------------------------------------------------------------
class IngestRequest(BaseModel):
    input_path: str = Field(
        default="data/raw/lunar_test.tif",
        description="Path relative to project root or absolute path of raw GeoTIFF",
    )
    output_dir: str = Field(
        default="data/tiles",
        description="Target directory for 1024x1024 sliced chunks",
    )
    chunk_size: int = Field(
        default=1024,
        ge=256,
        le=4096,
        description="Square window pixel dimensions for O(1) RAM streaming",
    )
    dry_run: bool = Field(
        default=False,
        description="Inspect metadata without writing files to disk",
    )


class IngestResponse(BaseModel):
    success: bool
    message: str
    elapsed_seconds: float
    output_dir: str
    chunks_created: List[str]
    log_output: str


class MatchRequest(BaseModel):
    tile_a: str = Field(
        default="data/tiles/chunk_x0_y0.tif",
        description="Path to reference lunar tile GeoTIFF",
    )
    tile_b: str = Field(
        default="data/tiles/chunk_x1_y0.tif",
        description="Path to target lunar tile GeoTIFF to co-register",
    )
    output_viz: str = Field(
        default="data/matches_visualization.png",
        description="Output destination for verification correspondence map",
    )
    output_json: str = Field(
        default="data/metrics.json",
        description="Output destination for computed registration metrics",
    )
    reproj_thresh: float = Field(
        default=3.0,
        ge=0.5,
        le=20.0,
        description="USAC_MAGSAC noise marginalization threshold (pixels)",
    )
    max_kpts: int = Field(
        default=2048,
        ge=256,
        le=8192,
        description="Maximum salient keypoints to retain per tile",
    )
    device: str = Field(
        default="auto",
        description="Target execution device ('auto', 'cpu', 'mps', 'cuda')",
    )


class MatchResponse(BaseModel):
    success: bool
    num_tentative: int
    num_inliers: int
    inlier_ratio: float
    mean_reprojection_error: Optional[float]
    homography: Optional[List[List[float]]]
    viz_url: Optional[str]
    metrics_url: Optional[str]
    reason: str
    elapsed_seconds: float
    simulated_lunar_coords: Dict[str, Any]


class TileInfo(BaseModel):
    filename: str
    relative_path: str
    static_url: str
    size_bytes: int
    modified_time: float


# ------------------------------------------------------------------------------
# REST Endpoints
# ------------------------------------------------------------------------------
@app.get("/", tags=["Health"])
@app.get("/api/health", tags=["Health"])
def health_check() -> Dict[str, Any]:
    """Health check endpoint indicating server readiness and binary status."""
    return {
        "status": "healthy",
        "service": "LunarAlign-Hybrid API",
        "version": "2.0.0",
        "core_ingestion_compiled": CORE_INGEST_BIN.exists(),
        "python_env": str(PYTHON_BIN),
        "data_root": str(DATA_DIR),
        "timestamp": time.time(),
    }


@app.get("/api/tiles", response_model=List[TileInfo], tags=["Imagery"])
def list_tiles() -> List[TileInfo]:
    """List all currently available 1024x1024 processed GeoTIFF tiles."""
    results = []
    if TILES_DIR.exists():
        for p in sorted(TILES_DIR.glob("*.tif*")):
            stat = p.stat()
            results.append(
                TileInfo(
                    filename=p.name,
                    relative_path=str(p.relative_to(PROJECT_ROOT)),
                    static_url=f"/static/tiles/{p.name}",
                    size_bytes=stat.st_size,
                    modified_time=stat.st_mtime,
                )
            )
    return results


@app.get("/api/raw-images", response_model=List[Dict[str, Any]], tags=["Imagery"])
def list_raw_images() -> List[Dict[str, Any]]:
    """List uncompressed raw input GeoTIFF scenes (Chandrayaan-2 TMC-2 / LROC)."""
    results = []
    if RAW_DIR.exists():
        for p in sorted(RAW_DIR.glob("*.tif*")):
            stat = p.stat()
            results.append(
                {
                    "filename": p.name,
                    "relative_path": str(p.relative_to(PROJECT_ROOT)),
                    "static_url": f"/static/raw/{p.name}",
                    "size_bytes": stat.st_size,
                    "size_mb": round(stat.st_size / (1024 * 1024), 2),
                    "modified_time": stat.st_mtime,
                }
            )
    return results


@app.post("/api/ingest", tags=["Pipeline"])
def run_ingestion(req: IngestRequest):
    """
    Execute the C++ memory-safe GDAL windowed slicing engine.
    Splits large lunar satellite scenes into 1024x1024 chunks with bounded RAM.
    """
    try:
        # Verify C++ binary existence; compile if needed
        if not CORE_INGEST_BIN.exists():
            compile_res = subprocess.run(
                ["make", "-C", str(ROOT_DIR / "core_ingestion"), "all"],
                cwd=str(ROOT_DIR),
                capture_output=True,
                text=True,
            )
            if compile_res.returncode != 0 or not CORE_INGEST_BIN.exists():
                err_msg = f"Failed to build core_ingestion binary:\n{compile_res.stderr or compile_res.stdout}"
                print(f"[API ERROR] {err_msg}", file=sys.stderr)
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"detail": err_msg, "error": err_msg, "success": False},
                )

        # Resolve input path to strict absolute path
        input_file = resolve_file_path(req.input_path, RAW_DIR)
        if not input_file.exists():
            err_msg = f"Input GeoTIFF not found: {req.input_path} (Resolved to: {input_file})"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        # Resolve output directory to strict absolute path
        if req.output_dir:
            p_out = Path(req.output_dir)
            out_dir = p_out.resolve() if p_out.is_absolute() else (ROOT_DIR / req.output_dir).resolve()
        else:
            out_dir = TILES_DIR.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            str(CORE_INGEST_BIN.resolve()),
            str(input_file.resolve()),
            "-o", str(out_dir.resolve()),
            "-s", str(req.chunk_size),
        ]
        if req.dry_run:
            cmd.append("--dry-run")

        start_time = time.time()
        res = subprocess.run(
            cmd,
            cwd=str(ROOT_DIR.resolve()),
            capture_output=True,
            text=True,
        )
        elapsed = time.time() - start_time

        if res.returncode != 0:
            err_msg = f"C++ Ingestion Engine error (exit code {res.returncode}):\n{res.stderr or res.stdout}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        created_tiles = [p.name for p in sorted(out_dir.glob("chunk_*.tif"))]

        return IngestResponse(
            success=True,
            message=f"Successfully sliced raster into {len(created_tiles)} chunks.",
            elapsed_seconds=round(elapsed, 3),
            output_dir=str(out_dir.relative_to(ROOT_DIR)),
            chunks_created=created_tiles,
            log_output=res.stdout,
        )
    except HTTPException as he:
        print(f"[API HTTP_EXCEPTION] Status {he.status_code}: {he.detail}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=he.status_code,
            content={"detail": str(he.detail), "error": str(he.detail), "success": False},
        )
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] Ingestion failed: {e}", file=sys.stderr)
        traceback.print_exc()
        err_msg = f"Ingestion server error: {str(e)}"
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": err_msg, "error": err_msg, "traceback": traceback.format_exc(), "success": False},
        )


@app.post("/api/match", tags=["Pipeline"])
def run_matching(req: MatchRequest):
    """
    Execute AI feature extraction (LightGlue) and geometric verification (USAC_MAGSAC).
    Returns verified homography, inlier statistics, and 3D lunar geographic projection coordinates.
    """
    try:
        # Strict absolute path resolution for tile inputs
        tile_a = resolve_file_path(req.tile_a, TILES_DIR)
        tile_b = resolve_file_path(req.tile_b, TILES_DIR)

        if not tile_a.exists():
            err_msg = f"Reference tile (Tile A) not found: {req.tile_a} (Resolved to: {tile_a})"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )
        if not tile_b.exists():
            err_msg = f"Target tile (Tile B) not found: {req.tile_b} (Resolved to: {tile_b})"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        # Strict absolute path resolution for outputs
        out_viz = resolve_output_path(req.output_viz, DEFAULT_VIZ_PNG)
        out_json = resolve_output_path(req.output_json, DEFAULT_METRICS_JSON)

        cmd = [
            str(PYTHON_BIN),
            str(MATCHER_SCRIPT.resolve()),
            "--tile-a", str(tile_a.resolve()),
            "--tile-b", str(tile_b.resolve()),
            "--output-viz", str(out_viz.resolve()),
            "--output-json", str(out_json.resolve()),
            "--reproj-thresh", str(req.reproj_thresh),
            "--max-kpts", str(req.max_kpts),
            "--device", req.device,
        ]

        sub_env = os.environ.copy()
        sub_env["VIRTUAL_ENV"] = str(ROOT_DIR / "sih_env")
        sub_env["PATH"] = f"{ROOT_DIR / 'sih_env' / 'bin'}:{sub_env.get('PATH', '')}"

        start_time = time.time()
        res = subprocess.run(
            cmd,
            cwd=str(ROOT_DIR.resolve()),
            env=sub_env,
            capture_output=True,
            text=True,
        )
        elapsed = time.time() - start_time

        if res.returncode != 0:
            err_msg = f"AI Matcher process exited with code {res.returncode}:\n{res.stderr or res.stdout}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        if not out_json.exists():
            err_msg = f"Matcher failed to produce metrics output JSON:\n{res.stderr or res.stdout}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        try:
            with open(out_json, "r") as f:
                metrics = json.load(f)
        except Exception as ex:
            err_msg = f"Error parsing metrics.json: {ex}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": err_msg, "error": err_msg, "success": False},
            )

        try:
            rel_viz = out_viz.relative_to(DATA_DIR)
            viz_url = f"/static/{rel_viz.as_posix()}" if out_viz.exists() else None
        except ValueError:
            viz_url = f"/static/{out_viz.name}" if out_viz.exists() else None

        try:
            rel_json = out_json.relative_to(DATA_DIR)
            metrics_url = f"/static/{rel_json.as_posix()}" if out_json.exists() else None
        except ValueError:
            metrics_url = f"/static/{out_json.name}" if out_json.exists() else None

        # Simulated lunar coordinates for Chandrayaan-2 TMC-2 coverage region
        # (e.g., Boguslawsky Crater / South Pole-Aitken Basin exploration zone)
        lunar_coords = {
            "target_region": "Boguslawsky Crater / Lunar South Pole",
            "center_lat": -72.9,
            "center_lon": 43.2,
            "bounding_box": {
                "west": 42.5,
                "south": -73.5,
                "east": 43.9,
                "north": -72.3,
            },
            "elevation_m": -1850.0,
            "projection": "Lunar IAU2000 Sphere / Equirectangular",
        }

        return MatchResponse(
            success=metrics.get("success", False),
            num_tentative=metrics.get("num_tentative", 0),
            num_inliers=metrics.get("num_inliers", 0),
            inlier_ratio=round(metrics.get("inlier_ratio", 0.0), 4),
            mean_reprojection_error=(
                round(metrics["mean_reprojection_error"], 4)
                if metrics.get("mean_reprojection_error") is not None
                else None
            ),
            homography=metrics.get("homography"),
            viz_url=viz_url,
            metrics_url=metrics_url,
            reason=metrics.get("reason", "Registration evaluated."),
            elapsed_seconds=round(elapsed, 3),
            simulated_lunar_coords=lunar_coords,
        )
    except HTTPException as he:
        print(f"[API HTTP_EXCEPTION] Status {he.status_code}: {he.detail}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=he.status_code,
            content={"detail": str(he.detail), "error": str(he.detail), "success": False},
        )
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] Matching failed: {e}", file=sys.stderr)
        traceback.print_exc()
        err_msg = f"Matching server error: {str(e)}"
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": err_msg, "error": err_msg, "traceback": traceback.format_exc(), "success": False},
        )


@app.get("/api/metrics", tags=["Pipeline"])
def get_latest_metrics():
    """Retrieve the latest MAGSAC+ registration metrics and homography matrix."""
    try:
        metrics_file = DATA_DIR / "metrics.json"
        if not metrics_file.exists():
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"detail": "No registration metrics found. Run /api/match first.", "error": "Metrics file not found"},
            )
        with open(metrics_file, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] Metrics retrieval failed: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Error retrieving metrics: {str(e)}", "error": str(e)},
        )


@app.post("/api/upload", tags=["Imagery"])
async def upload_geotiff(
    file: UploadFile = File(...),
    target_folder: str = Form("raw"),
) -> Dict[str, Any]:
    """Upload a GeoTIFF directly into data/raw or data/tiles."""
    dest_dir = RAW_DIR if target_folder == "raw" else TILES_DIR
    dest_path = dest_dir / file.filename

    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "filename": file.filename,
        "saved_to": str(dest_path.relative_to(PROJECT_ROOT)),
        "size_bytes": dest_path.stat().st_size,
        "url": f"/static/{target_folder}/{file.filename}",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
