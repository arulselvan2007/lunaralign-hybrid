#!/usr/bin/env bash
# ==============================================================================
# LunarAlign-Hybrid: Local Backend Runner & Cloudflare Tunnel
# Smart India Hackathon (SIH) High-Availability Edge Strategy
# ==============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${GREEN}🚀 LunarAlign-Hybrid: SIH Hybrid Edge-Cloud Backend Runner${NC}"
echo -e "${BOLD}${CYAN}======================================================================${NC}"

# a) Silently kill any stale processes on port 8000
echo -e "${YELLOW}[1/3] Checking and clearing port 8000...${NC}"
STALE_PID=$(lsof -ti :8000 2>/dev/null || true)
if [[ -n "${STALE_PID:-}" ]]; then
    kill -9 ${STALE_PID} 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}✓ Stale process(es) on port 8000 terminated.${NC}"
else
    echo -e "${GREEN}✓ Port 8000 is clean.${NC}"
fi

# Locate Python environment
PY_EXEC="${PROJECT_ROOT}/sih_env/bin/python3"
if [[ ! -x "${PY_EXEC}" ]]; then
    PY_EXEC="$(which python3)"
fi

# Locate cloudflared binary
CLOUDFLARED_BIN="$(which cloudflared 2>/dev/null || echo "/opt/homebrew/bin/cloudflared")"
if [[ ! -x "${CLOUDFLARED_BIN}" ]]; then
    echo -e "${YELLOW}[WARN] cloudflared not found in PATH or /opt/homebrew/bin/cloudflared. Please run 'brew install cloudflared'.${NC}"
    exit 1
fi

# b) Boot the local FastAPI backend in the background using Uvicorn
echo -e "${YELLOW}[2/3] Booting FastAPI backend server on 0.0.0.0:8000...${NC}"
export PYTHONPATH="${PROJECT_ROOT}:${PYTHONPATH:-}"
export VIRTUAL_ENV="${PROJECT_ROOT}/sih_env"
export PATH="${PROJECT_ROOT}/sih_env/bin:${PATH}"

"${PY_EXEC}" -m uvicorn api.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

cleanup() {
    echo -e "\n${YELLOW}[SHUTDOWN] Terminating FastAPI backend (PID: ${BACKEND_PID})...${NC}"
    kill -TERM "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
    echo -e "${GREEN}✓ Backend cleanly stopped.${NC}"
}
trap cleanup SIGINT SIGTERM EXIT

# Wait for FastAPI server to bind socket
sleep 2

# Verify local backend health
if curl -s -f http://127.0.0.1:8000/health >/dev/null 2>&1 || curl -s -f http://127.0.0.1:8000/docs >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Local FastAPI backend is live and healthy at http://localhost:8000${NC}"
else
    echo -e "${GREEN}✓ FastAPI backend process is active (PID: ${BACKEND_PID}).${NC}"
fi

# Instructions for the user
echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${YELLOW}📋 SIH JUDGES FAILOVER INSTRUCTION:${NC}"
echo -e "   1. Copy the generated ${GREEN}https://*.trycloudflare.com${NC} URL printed below."
echo -e "   2. If Hugging Face is down/limited, update Vercel's backend environment variable:"
echo -e "      ${BOLD}cd web_app && npx vercel env add NEXT_PUBLIC_BACKEND_URL production${NC}"
echo -e "      (paste your Cloudflare URL when prompted, then re-deploy with: npx vercel --prod)"
echo -e "   3. Keep this terminal session open during judge demonstrations."
echo -e "${BOLD}${CYAN}======================================================================${NC}"

# c) Launch cloudflared tunnel
echo -e "${YELLOW}[3/3] Launching Cloudflare Tunnel on http://localhost:8000...${NC}\n"
exec "${CLOUDFLARED_BIN}" tunnel --url http://localhost:8000
