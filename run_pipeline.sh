#!/usr/bin/env bash
# ==============================================================================
# LunarAlign-Hybrid: Master Orchestration Pipeline
# ==============================================================================
# Workflow:
#   1. Dependency Verification (GDAL, Python 3, Node.js)
#   2. C++ Ingestion & Tiling (GDAL 1024x1024 windowed slicing) -> data/tiles/
#   3. Downstream AI Matching (LightGlue + USAC_MAGSAC)
#   4. Full-Stack Web Application (FastAPI Backend + Next.js 3D Lunar Globe)
# ==============================================================================

set -euo pipefail

# Project root resolution
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_INGESTION_DIR="${PROJECT_ROOT}/core_ingestion"
AI_MATCHING_DIR="${PROJECT_ROOT}/ai_matching"
API_DIR="${PROJECT_ROOT}/api"
WEB_APP_DIR="${PROJECT_ROOT}/web_app"
SIH_PYTHON="${PROJECT_ROOT}/sih_env/bin/python3"
DEFAULT_INPUT="${PROJECT_ROOT}/data/raw/lunar_test.tif"
DEFAULT_OUTPUT="${PROJECT_ROOT}/data/tiles"
DEFAULT_CHUNK_SIZE="1024"

# ANSI Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }

usage() {
    cat << EOF
Usage: $(basename "$0") [options]

Options:
  -i, --input <file>        Path to input GeoTIFF (default: ${DEFAULT_INPUT})
  -o, --output-dir <dir>    Directory for sliced GeoTIFF tiles (default: ${DEFAULT_OUTPUT})
  -s, --chunk-size <size>   Chunk dimension in pixels (default: ${DEFAULT_CHUNK_SIZE})
  -d, --dry-run             Simulate ingestion without writing tiles to disk
  -w, --serve               Boot both FastAPI backend and Next.js frontend simultaneously
  --skip-matching           Skip the AI feature matching stage
  --skip-web                Skip launching the web application
  -h, --help                Show this help message

Example:
  # Ingest and match:
  $(basename "$0") -i data/raw/lunar_test.tif -s 1024

  # Boot full-stack 3D lunar web app and API:
  $(basename "$0") --serve
EOF
}

# Defaults
INPUT_TIFF=""
OUTPUT_DIR="${DEFAULT_OUTPUT}"
CHUNK_SIZE="${DEFAULT_CHUNK_SIZE}"
DRY_RUN=""
SERVE_WEB=false
SKIP_MATCHING=false
SKIP_WEB=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--input)
            INPUT_TIFF="$2"
            shift 2
            ;;
        -o|--output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -s|--chunk-size)
            CHUNK_SIZE="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        -w|--serve)
            SERVE_WEB=true
            shift
            ;;
        --skip-matching)
            SKIP_MATCHING=true
            shift
            ;;
        --skip-web)
            SKIP_WEB=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

echo -e "\n======================================================="
echo -e "       🌙 LunarAlign-Hybrid Production Pipeline         "
echo -e "       (Chandrayaan-2 TMC-2 / 3D Lunar Application)    "
echo -e "=======================================================\n"

# ------------------------------------------------------------------------------
# 1. Dependency Checks
# ------------------------------------------------------------------------------
log_info "Verifying system prerequisites..."

# Python environment
PY_EXEC="python3"
if [[ -x "${SIH_PYTHON}" ]]; then
    PY_EXEC="${SIH_PYTHON}"
    log_success "Using sandboxed environment: ${SIH_PYTHON}"
else
    log_warn "sih_env not found. Defaulting to system python3."
fi
PY_VER="$("${PY_EXEC}" --version 2>&1)"
log_success "Python: ${PY_VER}"

# Node.js and npm check
if command -v node &>/dev/null && command -v npm &>/dev/null; then
    NODE_VER="$(node -v)"
    log_success "Node.js: ${NODE_VER} | npm: $(npm -v)"
else
    log_warn "Node.js or npm not detected in PATH. Frontend server may fail."
fi

# Check GDAL
GDAL_FOUND=false
if command -v gdal-config &>/dev/null; then
    GDAL_VER="$(gdal-config --version 2>/dev/null || true)"
    log_success "Found GDAL via gdal-config (v${GDAL_VER})"
    GDAL_FOUND=true
elif command -v pkg-config &>/dev/null && pkg-config --exists gdal; then
    GDAL_VER="$(pkg-config --modversion gdal 2>/dev/null || true)"
    log_success "Found GDAL via pkg-config (v${GDAL_VER})"
    GDAL_FOUND=true
elif [[ -f "/opt/homebrew/include/gdal.h" || -f "/usr/local/include/gdal.h" ]]; then
    log_success "Found GDAL headers in system paths."
    GDAL_FOUND=true
fi

if [[ "${GDAL_FOUND}" = false ]]; then
    log_warn "GDAL not detected in standard system paths."
fi

# Ensure official NASA global Moon texture is injected for CesiumJS
GLOBAL_TEXTURE="${WEB_APP_DIR}/public/textures/moon_global.jpg"
if [[ ! -f "${GLOBAL_TEXTURE}" ]]; then
    log_info "Injecting official open-source global Moon texture for CesiumJS..."
    "${PY_EXEC}" "${PROJECT_ROOT}/scripts/download_moon_texture.py"
else
    log_success "Global Moon texture verified: ${GLOBAL_TEXTURE}"
fi

# ------------------------------------------------------------------------------
# 2. Compile Core Ingestion (C++)
# ------------------------------------------------------------------------------
INGEST_BIN="${CORE_INGESTION_DIR}/ingest_geotiff"

if [[ ! -x "${INGEST_BIN}" ]]; then
    log_info "Building C++ ingest_geotiff module..."
    make -C "${CORE_INGESTION_DIR}" all
    log_success "C++ ingestion binary ready: ${INGEST_BIN}"
else
    log_info "C++ ingestion binary is up-to-date: ${INGEST_BIN}"
fi

# ------------------------------------------------------------------------------
# 3. Stage 1: GeoTIFF Ingestion & Memory-Bounded Slicing
# ------------------------------------------------------------------------------
if [[ -n "${INPUT_TIFF}" ]]; then
    if [[ ! -f "${INPUT_TIFF}" ]]; then
        log_error "Input file does not exist: ${INPUT_TIFF}"
        exit 1
    fi

    log_info "Starting GeoTIFF ingestion & chunking on: ${INPUT_TIFF}"
    mkdir -p "${OUTPUT_DIR}"

    "${INGEST_BIN}" "${INPUT_TIFF}" \
        --output-dir "${OUTPUT_DIR}" \
        --chunk-size "${CHUNK_SIZE}" \
        ${DRY_RUN}

    log_success "Ingestion stage completed successfully."
else
    EXISTING_TILES="$(find "${OUTPUT_DIR}" -name "*.tif" 2>/dev/null | wc -l | tr -d ' ')"
    log_info "Existing tiles in ${OUTPUT_DIR}: ${EXISTING_TILES}"
fi

# ------------------------------------------------------------------------------
# 4. Stage 2: AI Matching Engine (LightGlue + USAC_MAGSAC)
# ------------------------------------------------------------------------------
TILE_A="${OUTPUT_DIR}/chunk_x0_y0.tif"
TILE_B="${OUTPUT_DIR}/chunk_x1_y0.tif"

if [[ "${SKIP_MATCHING}" = false && -f "${TILE_A}" && -f "${TILE_B}" && "${SERVE_WEB}" = false ]]; then
    echo -e "\n-------------------------------------------------------"
    log_info "Stage 2: AI Feature Matching & Geometric Verification"
    echo -e "-------------------------------------------------------"

    MATCHER_SCRIPT="${AI_MATCHING_DIR}/matcher.py"
    if [[ -f "${MATCHER_SCRIPT}" ]]; then
        log_info "Running LunarMatcher on ${TILE_A} and ${TILE_B}..."
        "${PY_EXEC}" "${MATCHER_SCRIPT}" \
            --tile-a "${TILE_A}" \
            --tile-b "${TILE_B}" \
            --output-viz "${PROJECT_ROOT}/data/matches_visualization.png" \
            --output-json "${PROJECT_ROOT}/data/metrics.json" \
            --device auto
        log_success "Matching stage complete."
    fi
fi

# ------------------------------------------------------------------------------
# 5. Stage 3: Boot FastAPI Backend and Next.js 3D Web Application
# ------------------------------------------------------------------------------
if [[ "${SERVE_WEB}" = true || ("${SKIP_WEB}" = false && -z "${INPUT_TIFF}") ]]; then
    echo -e "\n-------------------------------------------------------"
    log_info "Stage 3: Booting LunarAlign-Hybrid Full-Stack Platform"
    echo -e "-------------------------------------------------------"

    # Background processes cleanup handler on Ctrl+C / exit
    cleanup() {
        echo -e "\n${YELLOW}[SHUTDOWN]${NC} Stopping FastAPI server and Next.js frontend..."
        kill 0 2>/dev/null || true
        wait 2>/dev/null || true
        log_success "All LunarAlign-Hybrid services stopped."
    }
    trap cleanup SIGINT SIGTERM EXIT

    # 1. Start FastAPI backend (port 8000)
    log_info "Launching FastAPI backend server (http://127.0.0.1:8000)..."
    "${PY_EXEC}" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 &
    FASTAPI_PID=$!

    # Wait briefly for FastAPI to bind
    sleep 2

    # 2. Start Next.js frontend (port 3000)
    log_info "Launching Next.js 3D Lunar Globe Web App (http://localhost:3000)..."
    (cd "${WEB_APP_DIR}" && npm run dev) &
    NEXTJS_PID=$!

    echo -e "\n======================================================="
    echo -e "${GREEN}${BOLD}🚀 LunarAlign-Hybrid Platform is Live!${NC}"
    echo -e "======================================================="
    echo -e "  🛰️ 3D Lunar Web App    : ${CYAN}${BOLD}http://localhost:3000${NC}"
    echo -e "  ⚡ FastAPI Backend API : ${CYAN}${BOLD}http://localhost:8000/docs${NC}"
    echo -e "  📁 Processed Tile Data : ${CYAN}${BOLD}http://localhost:8000/static/tiles/${NC}"
    echo -e "======================================================="
    echo -e "Press ${BOLD}Ctrl+C${NC} to stop both services.\n"

    # Wait for child processes
    wait "${FASTAPI_PID}" "${NEXTJS_PID}"
fi

echo -e "\n======================================================="
log_success "LunarAlign-Hybrid execution finished."
echo -e "=======================================================\n"
