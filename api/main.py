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
HIRES_MOON_DIR = ROOT_DIR / "data" / "highres_moon"
HIRES_MOON_DIR.mkdir(parents=True, exist_ok=True)


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

# CORS Middleware (Enable Global Cloudflare Quick Tunnels and Mobile/iPad Client Access)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        "https://appeals-combat-exam-ballot.trycloudflare.com",
        "https://favorites-towers-frankfurt-sugar.trycloudflare.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Local 1.5-2 GB High-Resolution Lunar Mosaic & Tile Server (NVMe local map streaming)
app.mount("/static/lunar_hires", StaticFiles(directory=str(ROOT_DIR / "data" / "highres_moon")), name="lunar_hires")

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


class StreamUrlRequest(BaseModel):
    url: Optional[str] = Field(
        default="https://raw.githubusercontent.com/OSGeo/gdal/master/autotest/gcore/data/byte.tif",
        description="Public HTTP/HTTPS GeoTIFF URL from NASA PDS, ISRO, or Cloud Storage",
    )
    input_url: Optional[str] = Field(
        default=None,
        description="Alternative field for public GeoTIFF URL",
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
    max_chunks: Optional[int] = Field(
        default=4,
        description="Maximum chunks to stream and slice from remote dataset",
    )
    dry_run: bool = Field(
        default=False,
        description="Inspect metadata without writing files to disk",
    )


class StreamUrlResponse(BaseModel):
    success: bool
    message: str
    stream_url: str
    vsi_path: str
    elapsed_seconds: float
    output_dir: str
    chunks_created: List[str]
    tiles: List[str]
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
    branch: str = Field(
        default="auto",
        description="Execution branch: 'auto' (dynamic routing), 'ai', 'physics', or 'fusion'",
    )
    sensor: str = Field(
        default="auto",
        description="Payload sensor type: 'auto', 'tmc2', 'ohrc', 'iirs'",
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
        description="Target execution device ('auto', 'cuda', 'cpu')",
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
    heatmap_url: Optional[str] = None
    warped_url: Optional[str] = None
    reason: str
    elapsed_seconds: float
    simulated_lunar_coords: Dict[str, Any]
    routing: Optional[Dict[str, Any]] = None
    uncertainty: Optional[Dict[str, Any]] = None
    dem_warping: Optional[Dict[str, Any]] = None
    inlier_points: Optional[List[List[float]]] = None
    inlier_residuals: Optional[List[float]] = None


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
    """Health check endpoint indicating server readiness, binary status, and offline map server telemetry."""
    hires_files = list(HIRES_MOON_DIR.glob("**/*")) if HIRES_MOON_DIR.exists() else []
    hires_bytes = sum(f.stat().st_size for f in hires_files if f.is_file())
    return {
        "status": "healthy",
        "service": "LunarAlign-Hybrid API",
        "version": "2.0.0",
        "core_ingestion_compiled": CORE_INGEST_BIN.exists(),
        "python_env": str(PYTHON_BIN),
        "data_root": str(DATA_DIR),
        "lunar_hires_mounted": True,
        "lunar_hires_dir": str(HIRES_MOON_DIR),
        "lunar_hires_files_count": len([f for f in hires_files if f.is_file()]),
        "lunar_hires_size_mb": round(hires_bytes / (1024 * 1024), 2),
        "lunar_hires_size_gb": round(hires_bytes / (1024 * 1024 * 1024), 2),
        "timestamp": time.time(),
    }


@app.get("/api/lunar-hires/manifest", tags=["Imagery"])
def get_lunar_hires_manifest() -> Any:
    """Retrieve metadata registry for local high-resolution lunar mosaic and regional tiles."""
    try:
        manifest_path = HIRES_MOON_DIR / "manifest.json"
        if manifest_path.exists():
            with open(manifest_path, "r") as f:
                return json.load(f)
        return {
            "status": "online",
            "mount": "/static/lunar_hires",
            "global_mosaic": "/static/lunar_hires/lunar_global_hires.jpg",
            "tiles_available": len(list(HIRES_MOON_DIR.glob("**/*.jpg"))) + len(list(HIRES_MOON_DIR.glob("**/*.tif"))),
        }
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] manifest error: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Failed to retrieve high-res manifest: {str(e)}", "error": str(e)},
        )


@app.get("/api/tiles", response_model=List[TileInfo], tags=["Imagery"])
def list_tiles() -> Any:
    """List all currently available 1024x1024 processed GeoTIFF tiles."""
    try:
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
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] list_tiles error: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Failed to list tiles: {str(e)}", "error": str(e)},
        )


@app.get("/api/raw-images", response_model=List[Dict[str, Any]], tags=["Imagery"])
def list_raw_images() -> Any:
    """List uncompressed raw input GeoTIFF scenes (Chandrayaan-2 TMC-2 / LROC)."""
    try:
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
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] list_raw_images error: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Failed to list raw images: {str(e)}", "error": str(e)},
        )


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

        # Resolve input path to strict absolute path or remote /vsicurl/
        raw_in = req.input_path.strip()
        if raw_in.startswith("http://") or raw_in.startswith("https://") or raw_in.startswith("/vsicurl/"):
            target_input = raw_in if raw_in.startswith("/vsicurl/") else f"/vsicurl/{raw_in}"
        else:
            input_file = resolve_file_path(req.input_path, RAW_DIR)
            if not input_file.exists():
                err_msg = f"Input GeoTIFF not found: {req.input_path} (Resolved to: {input_file})"
                print(f"[API ERROR] {err_msg}", file=sys.stderr)
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": err_msg, "error": err_msg, "success": False},
                )
            target_input = str(input_file.resolve())

        # Resolve output directory to strict absolute path
        if req.output_dir:
            p_out = Path(req.output_dir)
            out_dir = p_out.resolve() if p_out.is_absolute() else (ROOT_DIR / req.output_dir).resolve()
        else:
            out_dir = TILES_DIR.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            str(CORE_INGEST_BIN.resolve()),
            target_input,
            "-o", str(out_dir.resolve()),
            "-s", str(req.chunk_size),
        ]
        if req.dry_run:
            cmd.append("--dry-run")

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


@app.post("/api/stream-url", tags=["Pipeline"], response_model=StreamUrlResponse)
@app.post("/api/stream_url", tags=["Pipeline"], response_model=StreamUrlResponse)
def stream_remote_geotiff(req: StreamUrlRequest):
    """
    Cloud-Native Direct Ingestion Endpoint using GDAL Virtual File Systems (/vsicurl/).
    Streams remote GeoTIFFs (NASA PDS, ISRO, USGS, or S3/GCS buckets) on-the-fly using
    HTTP byte-range requests without downloading the massive source file.
    """
    try:
        raw_url = (req.url or req.input_url or "").strip()
        if not raw_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing GeoTIFF URL. Please provide a valid HTTP/HTTPS GeoTIFF URL via the 'url' field.",
            )

        # Prepend /vsicurl/ if not already present
        if raw_url.startswith("/vsicurl/"):
            vsi_url = raw_url
        else:
            vsi_url = f"/vsicurl/{raw_url}"

        # Ensure C++ binary exists; compile if needed
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

        # Resolve output directory
        if req.output_dir:
            p_out = Path(req.output_dir)
            out_dir = p_out.resolve() if p_out.is_absolute() else (ROOT_DIR / req.output_dir).resolve()
        else:
            out_dir = TILES_DIR.resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        # Snapshot existing tiles before run
        existing_tiles_before = set(p.name for p in out_dir.glob("chunk_*.tif"))

        cmd = [
            str(CORE_INGEST_BIN.resolve()),
            vsi_url,
            "-o", str(out_dir.resolve()),
            "-s", str(req.chunk_size),
        ]
        if req.max_chunks and req.max_chunks > 0:
            cmd.extend(["-m", str(req.max_chunks)])
        if req.dry_run:
            cmd.append("--dry-run")

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
            err_msg = f"Cloud-Native Streaming Ingestion error (exit code {res.returncode}):\n{res.stderr or res.stdout}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"detail": err_msg, "error": err_msg, "log_output": res.stdout, "success": False},
            )

        all_tiles = [p.name for p in sorted(out_dir.glob("chunk_*.tif"))]
        newly_created = [t for t in all_tiles if t not in existing_tiles_before]
        reported_created = newly_created if newly_created else all_tiles

        return StreamUrlResponse(
            success=True,
            message=f"Cloud-Native stream completed: sliced {len(reported_created)} chunks from remote GeoTIFF via GDAL /vsicurl/.",
            stream_url=raw_url,
            vsi_path=vsi_url,
            elapsed_seconds=round(elapsed, 3),
            output_dir=str(out_dir.relative_to(ROOT_DIR)),
            chunks_created=reported_created,
            tiles=all_tiles,
            log_output=res.stdout,
        )
    except HTTPException as he:
        print(f"[API HTTP_EXCEPTION] Status {he.status_code}: {he.detail}", file=sys.stderr)
        return JSONResponse(
            status_code=he.status_code,
            content={"detail": str(he.detail), "error": str(he.detail), "success": False},
        )
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] Stream ingestion failed: {e}", file=sys.stderr)
        traceback.print_exc()
        err_msg = f"Streaming ingestion server error: {str(e)}"
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
            "--branch", req.branch,
            "--sensor", req.sensor,
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

        # Harden subprocess.run stdout parsing:
        # Isolate the JSON response by extracting only the text between the first '{' and the last '}'
        metrics = None
        stdout_raw = res.stdout or ""
        first_brace = stdout_raw.find("{")
        last_brace = stdout_raw.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            json_str = stdout_raw[first_brace : last_brace + 1]
            try:
                metrics = json.loads(json_str)
            except Exception as e:
                print(f"[API WARN] Failed to parse isolated stdout JSON: {e}", file=sys.stderr)

        # Fallback to out_json file if stdout parsing didn't find valid JSON
        if metrics is None and out_json.exists():
            try:
                with open(out_json, "r") as f:
                    file_content = f.read()
                    f_first = file_content.find("{")
                    f_last = file_content.rfind("}")
                    if f_first != -1 and f_last != -1 and f_last > f_first:
                        metrics = json.loads(file_content[f_first : f_last + 1])
                    else:
                        metrics = json.loads(file_content)
            except Exception as ex:
                print(f"[API WARN] Failed to parse out_json file: {ex}", file=sys.stderr)

        # If both failed and returncode != 0, report the exact Python stderr/stdout traceback
        if metrics is None:
            err_msg = f"AI Matcher process exited with code {res.returncode}:\n{res.stderr or res.stdout}"
            print(f"[API ERROR] {err_msg}", file=sys.stderr)
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "detail": err_msg,
                    "error": err_msg,
                    "stderr": res.stderr,
                    "stdout": res.stdout,
                    "success": False,
                },
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

        heatmap_url = metrics.get("uncertainty", {}).get("heatmap_url", "/static/uncertainty_heatmap.png")
        warped_url = metrics.get("dem_warping", {}).get("warped_raster_url", "/static/warped_aligned.png")

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
            heatmap_url=heatmap_url,
            warped_url=warped_url,
            reason=metrics.get("reason", "Registration evaluated."),
            elapsed_seconds=round(elapsed, 3),
            simulated_lunar_coords=lunar_coords,
            routing=metrics.get("routing"),
            uncertainty=metrics.get("uncertainty"),
            dem_warping=metrics.get("dem_warping"),
            inlier_points=metrics.get("inlier_points"),
            inlier_residuals=metrics.get("inlier_residuals"),
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


@app.get("/api/uncertainty", tags=["Pipeline"])
def get_uncertainty_map():
    """Retrieve the quantitative registration uncertainty heatmap and telemetry matrix."""
    try:
        u_file = DATA_DIR / "uncertainty_map.json"
        if not u_file.exists():
            # Check metrics.json fallback
            metrics_file = DATA_DIR / "metrics.json"
            if metrics_file.exists():
                with open(metrics_file, "r") as f:
                    m = json.load(f)
                    if "uncertainty" in m:
                        return m["uncertainty"]
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"detail": "No uncertainty map found. Run /api/match first.", "error": "Uncertainty map not found"},
            )
        with open(u_file, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] Uncertainty retrieval failed: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Error retrieving uncertainty map: {str(e)}", "error": str(e)},
        )


@app.post("/api/upload", tags=["Imagery"])
async def upload_geotiff(
    file: UploadFile = File(...),
    target_folder: str = Form("raw"),
) -> Any:
    """Upload a GeoTIFF directly into data/raw or data/tiles."""
    try:
        if target_folder not in ("raw", "tiles"):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Invalid target_folder. Must be 'raw' or 'tiles'.", "error": "Invalid folder parameter"},
            )

        if not file.filename:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "No filename provided.", "error": "Missing filename"},
            )

        # Sanitize filename (prevent path traversal)
        safe_filename = Path(file.filename).name
        dest_dir = RAW_DIR if target_folder == "raw" else TILES_DIR
        dest_path = (dest_dir / safe_filename).resolve()

        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        return {
            "filename": safe_filename,
            "saved_to": str(dest_path.relative_to(PROJECT_ROOT)),
            "size_bytes": dest_path.stat().st_size,
            "url": f"/static/{target_folder}/{safe_filename}",
        }
    except Exception as e:
        print(f"[API UNHANDLED_EXCEPTION] upload_geotiff error: {e}", file=sys.stderr)
        traceback.print_exc()
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"File upload failed: {str(e)}", "error": str(e)},
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
