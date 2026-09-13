#!/usr/bin/env bash
# ==============================================================================
# LunarAlign-Hybrid: Master Orchestration Pipeline
# ==============================================================================
# Workflow:
#   1. Dependency Verification (GDAL, Python 3)
#   2. C++ Ingestion & Tiling (GDAL 1024x1024 windowed slicing) -> data/tiles/
#   3. Downstream AI Matching (LightGlue + RoMa + MAGSAC+)
#   4. Interactive Dashboard (Streamlit Visualization)
# ==============================================================================

set -euo pipefail

# Project root resolution
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_INGESTION_DIR="${PROJECT_ROOT}/core_ingestion"
AI_MATCHING_DIR="${PROJECT_ROOT}/ai_matching"
DASHBOARD_DIR="${PROJECT_ROOT}/dashboard"
DEFAULT_INPUT="${PROJECT_ROOT}/data/raw/sample_lunar.tif"
DEFAULT_OUTPUT="${PROJECT_ROOT}/data/tiles"
DEFAULT_CHUNK_SIZE="1024"

# ANSI Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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
  --skip-matching           Skip the AI feature matching stage
  --skip-dashboard          Skip the Streamlit dashboard launch
  -h, --help                Show this help message

Example:
  $(basename "$0") -i data/raw/ch2_tmc2_orbit1234.tif -s 1024
EOF
}

# Defaults
INPUT_TIFF=""
OUTPUT_DIR="${DEFAULT_OUTPUT}"
CHUNK_SIZE="${DEFAULT_CHUNK_SIZE}"
DRY_RUN=""
SKIP_MATCHING=false
SKIP_DASHBOARD=false

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
        --skip-matching)
            SKIP_MATCHING=true
            shift
            ;;
        --skip-dashboard)
            SKIP_DASHBOARD=true
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
echo -e "=======================================================\n"

# ------------------------------------------------------------------------------
# 1. Dependency Checks
# ------------------------------------------------------------------------------
log_info "Verifying system prerequisites..."

# Check Python 3
if command -v python3 &>/dev/null; then
    PY_VER="$(python3 --version 2>&1)"
    log_success "Found Python: ${PY_VER}"
else
    log_error "Python 3 is required but not found in PATH."
    exit 1
fi

# Check GDAL availability
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
    log_warn "If compilation fails, install GDAL using: brew install gdal"
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
if [[ -z "${INPUT_TIFF}" ]]; then
    log_warn "No input GeoTIFF provided (--input). Checking for existing tiles..."
    EXISTING_TILES="$(find "${OUTPUT_DIR}" -name "*.tif" 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${EXISTING_TILES}" -gt 0 ]]; then
        log_info "Found ${EXISTING_TILES} existing tiles in ${OUTPUT_DIR}. Proceeding."
    else
        log_warn "No input image specified and no tiles present in ${OUTPUT_DIR}."
        log_info "To ingest an image, provide: $0 -i /path/to/satellite.tif"
        echo ""
    fi
else
    if [[ ! -f "${INPUT_TIFF}" ]]; then
        log_error "Input file does not exist: ${INPUT_TIFF}"
        exit 1
    fi

    log_info "Starting GeoTIFF ingestion & chunking..."
    mkdir -p "${OUTPUT_DIR}"

    "${INGEST_BIN}" "${INPUT_TIFF}" \
        --output-dir "${OUTPUT_DIR}" \
        --chunk-size "${CHUNK_SIZE}" \
        ${DRY_RUN}

    log_success "Ingestion stage completed successfully."
fi

# ------------------------------------------------------------------------------
# 4. Stage 2: AI Matching Engine (LightGlue + RoMa + MAGSAC+)
# ------------------------------------------------------------------------------
if [[ "${SKIP_MATCHING}" = false ]]; then
    echo -e "\n-------------------------------------------------------"
    log_info "Stage 2: AI Feature Matching & Geometric Verification"
    echo -e "-------------------------------------------------------"

    MATCHER_SCRIPT="${AI_MATCHING_DIR}/matcher.py"
    if [[ -f "${MATCHER_SCRIPT}" ]]; then
        log_info "Executing AI matching engine (${MATCHER_SCRIPT})..."
        python3 "${MATCHER_SCRIPT}" --tiles-dir "${OUTPUT_DIR}"
    else
        log_info "Stub: AI Matching engine ready for implementation in ${AI_MATCHING_DIR}/"
        log_info "Components configured: LightGlue (sparse) | RoMa (dense) | MAGSAC+ (homography)"
    fi
else
    log_info "Skipping AI matching stage (--skip-matching)."
fi

# ------------------------------------------------------------------------------
# 5. Stage 3: Visualization Dashboard (Streamlit)
# ------------------------------------------------------------------------------
if [[ "${SKIP_DASHBOARD}" = false ]]; then
    echo -e "\n-------------------------------------------------------"
    log_info "Stage 3: Interactive Visualization Dashboard"
    echo -e "-------------------------------------------------------"

    DASHBOARD_SCRIPT="${DASHBOARD_DIR}/app.py"
    if [[ -f "${DASHBOARD_SCRIPT}" ]]; then
        if command -v streamlit &>/dev/null; then
            log_info "Launching Streamlit UI: ${DASHBOARD_SCRIPT}..."
            streamlit run "${DASHBOARD_SCRIPT}"
        else
            log_warn "Streamlit is not installed in the active environment."
            log_info "Install with: pip install streamlit"
        fi
    else
        log_info "Stub: Streamlit UI ready for implementation in ${DASHBOARD_DIR}/"
        log_info "Run 'streamlit run ${DASHBOARD_DIR}/app.py' once created."
    fi
else
    log_info "Skipping Dashboard stage (--skip-dashboard)."
fi

echo -e "\n======================================================="
log_success "LunarAlign-Hybrid pipeline execution finished."
echo -e "=======================================================\n"
EOF
