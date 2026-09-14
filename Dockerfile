# ==============================================================================
# LunarAlign-Hybrid: Production Container for Cloud & Hugging Face Spaces
# ==============================================================================
# Base Image: Python 3.14-slim (Debian-based)
FROM python:3.14-slim

# Prevent interactive prompts during apt package installation
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Install system dependencies:
# - GDAL utilities & headers (gdal-bin, libgdal-dev)
# - C++ build-essential (for compiling ingest_geotiff)
# - Node.js and npm
# - Git, curl, pkg-config, and shared runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gdal-bin \
    libgdal-dev \
    nodejs \
    npm \
    git \
    curl \
    pkg-config \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set container working directory
WORKDIR /app

# Copy dependency requirements first to leverage Docker layer caching
COPY requirements.txt .

# Install Python production packages
RUN pip install --no-cache-dir -r requirements.txt

# Copy C++ core ingestion engine source and compile ingest_geotiff binary
COPY core_ingestion/ ./core_ingestion/
RUN make -C core_ingestion all

# Copy backend application modules, datasets, and scripts
COPY ai_matching/ ./ai_matching/
COPY api/ ./api/
COPY data/ ./data/
COPY scripts/ ./scripts/

# Ensure runtime directories exist with write permissions for cache & tiles
RUN mkdir -p /app/data/raw /app/data/tiles /app/data/highres_moon && \
    chmod -R 777 /app/data

# Expose primary backend port (8000) and Hugging Face default port (7860)
EXPOSE 8000
EXPOSE 7860

# Launch FastAPI server bound to 0.0.0.0:8000 (with PORT fallback for HF Spaces)
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
