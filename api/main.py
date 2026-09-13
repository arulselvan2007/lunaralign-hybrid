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
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Project Root Resolution
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
TILES_DIR = DATA_DIR / "tiles"
CORE_INGEST_BIN = PROJECT_ROOT / "core_ingestion" / "ingest_geotiff"
MATCHER_SCRIPT = PROJECT_ROOT / "ai_matching" / "matcher.py"
PYTHON_BIN = PROJECT_ROOT / "sih_env" / "bin" / "python3"
if not PYTHON_BIN.exists():
    PYTHON_BIN = Path(sys.executable)

# Ensure essential directories exist
RAW_DIR.mkdir(parents=True, exist_ok=True)
TILES_DIR.mkdir(parents=True, exist_ok=True)

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


@app.post("/api/ingest", response_model=IngestResponse, tags=["Pipeline"])
def run_ingestion(req: IngestRequest) -> IngestResponse:
    """
    Execute the C++ memory-safe GDAL windowed slicing engine.
    Splits large lunar satellite scenes into 1024x1024 chunks with bounded RAM.
    """
    # Verify C++ binary existence; compile if needed
    if not CORE_INGEST_BIN.exists():
        compile_res = subprocess.run(
            ["make", "-C", str(PROJECT_ROOT / "core_ingestion"), "all"],
            capture_output=True,
            text=True,
        )
        if compile_res.returncode != 0 or not CORE_INGEST_BIN.exists():
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to build core_ingestion binary:\n{compile_res.stderr}",
            )

    # Resolve input path
    input_file = Path(req.input_path)
    if not input_file.is_absolute():
        input_file = PROJECT_ROOT / input_file

    if not input_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Input GeoTIFF not found: {req.input_path}",
        )

    # Resolve output directory
    out_dir = Path(req.output_dir)
    if not out_dir.is_absolute():
        out_dir = PROJECT_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(CORE_INGEST_BIN),
        str(input_file),
        "-o", str(out_dir),
        "-s", str(req.chunk_size),
    ]
    if req.dry_run:
        cmd.append("--dry-run")

    start_time = time.time()
    res = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    elapsed = time.time() - start_time

    if res.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"C++ Ingestion Engine error:\n{res.stderr or res.stdout}",
        )

    created_tiles = [p.name for p in sorted(out_dir.glob("chunk_*.tif"))]

    return IngestResponse(
        success=True,
        message=f"Successfully sliced raster into {len(created_tiles)} chunks.",
        elapsed_seconds=round(elapsed, 3),
        output_dir=str(out_dir.relative_to(PROJECT_ROOT)),
        chunks_created=created_tiles,
        log_output=res.stdout,
    )


@app.post("/api/match", response_model=MatchResponse, tags=["Pipeline"])
def run_matching(req: MatchRequest) -> MatchResponse:
    """
    Execute AI feature extraction (LightGlue) and geometric verification (USAC_MAGSAC).
    Returns verified homography, inlier statistics, and 3D lunar geographic projection coordinates.
    """
    tile_a = Path(req.tile_a)
    if not tile_a.is_absolute():
        tile_a = PROJECT_ROOT / tile_a

    tile_b = Path(req.tile_b)
    if not tile_b.is_absolute():
        tile_b = PROJECT_ROOT / tile_b

    if not tile_a.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tile A not found: {req.tile_a}",
        )
    if not tile_b.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tile B not found: {req.tile_b}",
        )

    out_viz = Path(req.output_viz)
    if not out_viz.is_absolute():
        out_viz = PROJECT_ROOT / out_viz
    out_viz.parent.mkdir(parents=True, exist_ok=True)

    out_json = Path(req.output_json)
    if not out_json.is_absolute():
        out_json = PROJECT_ROOT / out_json
    out_json.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(PYTHON_BIN),
        str(MATCHER_SCRIPT),
        "--tile-a", str(tile_a),
        "--tile-b", str(tile_b),
        "--output-viz", str(out_viz),
        "--output-json", str(out_json),
        "--reproj-thresh", str(req.reproj_thresh),
        "--max-kpts", str(req.max_kpts),
        "--device", req.device,
    ]

    start_time = time.time()
    res = subprocess.run(
        cmd,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
    )
    elapsed = time.time() - start_time

    if not out_json.exists():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Matcher failed to produce metrics output:\n{res.stderr or res.stdout}",
        )

    try:
        with open(out_json, "r") as f:
            metrics = json.load(f)
    except Exception as ex:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error parsing metrics.json: {ex}",
        )

    viz_url = f"/static/{out_viz.name}" if out_viz.exists() else None
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


@app.get("/api/metrics", tags=["Pipeline"])
def get_latest_metrics() -> Dict[str, Any]:
    """Retrieve the latest MAGSAC+ registration metrics and homography matrix."""
    metrics_file = DATA_DIR / "metrics.json"
    if not metrics_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No registration metrics found. Run /api/match first.",
        )
    with open(metrics_file, "r") as f:
        return json.load(f)


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
