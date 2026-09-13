# LunarAlign-Hybrid

Modular multi-modal feature matching and registration pipeline for lunar and planetary satellite imagery (e.g., Chandrayaan-2 TMC-2 / OHRC and LRO NAC).

## Architecture

```
.
├── core_ingestion/       # C++ & GDAL windowed raster ingestion (1024x1024 chunks)
│   ├── ingest_geotiff.cpp
│   └── Makefile
├── ai_matching/          # Multi-modal matching (LightGlue, RoMa, MAGSAC+)
│   └── README.md
├── dashboard/            # Interactive Streamlit UI and visualization
│   └── README.md
├── data/
│   ├── raw/              # Input GeoTIFF satellite scenes (git-ignored)
│   └── tiles/            # Sliced 1024x1024 chunks (git-ignored)
├── run_pipeline.sh       # Master pipeline orchestrator
└── .gitignore            # Production git configuration
```

## Quick Start

### 1. Build Ingestion Engine
```bash
make -C core_ingestion all
```

### 2. Run Full Pipeline
```bash
./run_pipeline.sh -i data/raw/lunar_scene.tif -s 1024
```

### 3. Dry-Run Inspection
Inspect Coordinate Reference System (CRS) and simulate chunking without writing files:
```bash
./run_pipeline.sh -i data/raw/lunar_scene.tif --dry-run
```
