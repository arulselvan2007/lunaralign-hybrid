#!/usr/bin/env python3
"""
Generate a 2048x2048 synthetic lunar satellite GeoTIFF image (lunar_test.tif)
with realistic crater morphologies, ejecta blankets, rilles, and regolith noise.

To facilitate cross-tile feature matching between chunk_x0_y0 and chunk_x1_y0:
- The top-left quadrant [0:1024, 0:1024] (chunk_x0_y0) contains a primary crater field.
- The top-right quadrant [0:1024, 1024:2048] (chunk_x1_y0) contains the same crater field
  transformed by a realistic orbital affine transformation (rotation, translation, and scale)
  with varying photometric illumination, simulating a multi-temporal satellite pass.
"""

import os
import cv2
import numpy as np

def draw_lunar_crater(img, cx, cy, radius, sun_angle_deg=-45):
    """
    Draw a photometrically realistic lunar impact crater.
    - Illuminated rim on the sun-facing side
    - Deep shadow on the opposite inner rim wall
    - Flat or peaked crater floor
    """
    h, w = img.shape[:2]
    # Crater bowl depression (darker than regolith)
    cv2.circle(img, (cx, cy), radius, 75, -1, cv2.LINE_AA)
    
    # Sun vector
    sun_rad = np.radians(sun_angle_deg)
    dx = np.cos(sun_rad)
    dy = np.sin(sun_rad)
    
    # Internal shadow crescent
    shadow_offset = int(radius * 0.25)
    scx = int(cx - dx * shadow_offset)
    scy = int(cy - dy * shadow_offset)
    shadow_r = int(radius * 0.8)
    cv2.circle(img, (scx, scy), shadow_r, 30, -1, cv2.LINE_AA)
    
    # Crater floor gradient / transition
    floor_cx = int(cx + dx * int(radius * 0.1))
    floor_cy = int(cy + dy * int(radius * 0.1))
    floor_r = int(radius * 0.5)
    cv2.circle(img, (floor_cx, floor_cy), floor_r, 90, -1, cv2.LINE_AA)

    # Central peak for larger craters
    if radius > 45:
        peak_r = int(radius * 0.12)
        cv2.circle(img, (cx, cy), peak_r, 165, -1, cv2.LINE_AA)
        cv2.circle(img, (cx - 2, cy - 2), max(1, int(peak_r * 0.6)), 210, -1, cv2.LINE_AA)

    # Outer elevated rim (bright sunlit crescent)
    cv2.ellipse(
        img,
        (cx, cy),
        (radius + 2, radius + 2),
        sun_angle_deg,
        120,
        240,
        220,
        max(2, int(radius * 0.12)),
        cv2.LINE_AA,
    )
    # Opposite dim rim
    cv2.ellipse(
        img,
        (cx, cy),
        (radius + 1, radius + 1),
        sun_angle_deg + 180,
        120,
        240,
        120,
        max(1, int(radius * 0.06)),
        cv2.LINE_AA,
    )

    # Ejecta rays for prominent craters
    if radius > 60:
        for angle_offset in [-60, -30, 0, 30, 60, 110, 150, 220, 290]:
            ray_angle = np.radians(sun_angle_deg + angle_offset)
            ray_len = radius * np.random.uniform(1.8, 3.5)
            ex = int(cx + np.cos(ray_angle) * ray_len)
            ey = int(cy + np.sin(ray_angle) * ray_len)
            cv2.line(img, (cx, cy), (ex, ey), 145, np.random.randint(1, 3), cv2.LINE_AA)

def generate_crater_field(size=1024, seed=42):
    """Generate a 1024x1024 realistic lunar surface tile."""
    np.random.seed(seed)
    # Background lunar mare albedo
    base = np.full((size, size), 115, dtype=np.uint8)
    
    # Low-frequency topological shading (maria vs highlands)
    low_freq = cv2.resize(np.random.normal(0, 15, (32, 32)), (size, size), interpolation=cv2.INTER_CUBIC)
    base = np.clip(base + low_freq, 40, 210).astype(np.uint8)

    # High-frequency regolith roughness noise
    noise = np.random.normal(0, 8, (size, size)).astype(np.float32)
    base = np.clip(base.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    # Rilles / graben (linear lunar canyons)
    pts = np.array([[120, 80], [280, 220], [450, 310], [600, 520], [750, 680]], np.int32)
    cv2.polylines(base, [pts], False, 50, 3, cv2.LINE_AA)
    cv2.polylines(base, [pts + 2], False, 160, 2, cv2.LINE_AA)

    # Fixed landmark craters for repeatable deep feature matching
    landmarks = [
        (350, 320, 85),
        (720, 280, 65),
        (250, 680, 55),
        (620, 720, 95),
        (820, 550, 45),
        (180, 220, 38),
        (480, 520, 50),
        (850, 850, 70),
        (450, 820, 42),
        (280, 450, 35),
    ]
    for cx, cy, r in landmarks:
        draw_lunar_crater(base, cx, cy, r, sun_angle_deg=-45)

    # Random micro-craters
    for _ in range(45):
        rx = np.random.randint(40, size - 40)
        ry = np.random.randint(40, size - 40)
        rr = np.random.randint(8, 28)
        draw_lunar_crater(base, rx, ry, rr, sun_angle_deg=-45)

    return base

def main():
    os.makedirs("data/raw", exist_ok=True)
    out_path = "data/raw/lunar_test.tif"

    full_size = 2048
    half_size = 1024
    image = np.zeros((full_size, full_size), dtype=np.uint8)

    print("[Synthetic Lunar Generator] Generating primary lunar crater field...")
    tile_a = generate_crater_field(size=half_size, seed=101)

    # Top-Left: Tile A (chunk_x0_y0)
    image[0:half_size, 0:half_size] = tile_a

    # Top-Right: Tile B (chunk_x1_y0) -> Affine-warped pass of Tile A
    # Rotation: +4.5 deg, Translation: dx=+35, dy=-20, Scale: 1.015
    center = (half_size / 2.0, half_size / 2.0)
    rot_matrix = cv2.getRotationMatrix2D(center, angle=4.5, scale=1.015)
    rot_matrix[0, 2] += 35.0
    rot_matrix[1, 2] -= 20.0

    tile_b = cv2.warpAffine(
        tile_a,
        rot_matrix,
        (half_size, half_size),
        borderMode=cv2.BORDER_REFLECT101,
        flags=cv2.INTER_LINEAR,
    )
    # Simulate slight orbital sensor noise and illumination variation
    sensor_noise = np.random.normal(2, 6, (half_size, half_size)).astype(np.float32)
    tile_b = np.clip(tile_b.astype(np.float32) * 0.96 + sensor_noise, 0, 255).astype(np.uint8)

    image[0:half_size, half_size:full_size] = tile_b

    # Bottom Half: Additional diverse crater fields [1024:2048, :]
    tile_c = generate_crater_field(size=half_size, seed=202)
    tile_d = generate_crater_field(size=half_size, seed=303)
    image[half_size:full_size, 0:half_size] = tile_c
    image[half_size:full_size, half_size:full_size] = tile_d

    # Save as 2048x2048 GeoTIFF
    success = cv2.imwrite(out_path, image)
    if not success:
        raise RuntimeError(f"Failed to write image to {out_path}")

    print(f"[Synthetic Lunar Generator] Successfully generated 2048x2048 GeoTIFF: {out_path}")
    print(f"File size: {os.path.getsize(out_path) / (1024*1024):.2f} MB")

if __name__ == "__main__":
    main()
