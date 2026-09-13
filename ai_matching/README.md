# AI Matching Engine (LunarAlign-Hybrid)

This module handles multi-modal feature matching and geometric verification:
- **LightGlue**: Sparse deep feature matching.
- **RoMa**: Dense visual correspondence model for high-resolution lunar terrain.
- **MAGSAC++**: Robust homography and fundamental matrix estimation with non-parametric scoring.

### Planned Structure:
- `matcher.py`: Core pipeline interface combining LightGlue and RoMa.
- `homography.py`: MAGSAC++ geometric verification and outlier rejection.
- `requirements.txt`: PyTorch, kornia, opencv-python, and LightGlue dependencies.
