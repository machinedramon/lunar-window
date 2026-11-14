"""Builds the shaded-relief map of the lunar south pole: public/data/southpole.jpg

Usage (from the repository root):  python -X utf8 tools/build_map.py

South polar stereographic, 620 km across (the pole at the centre, longitude 0 towards the top),
from the LOLA 80 m elevation model. Ground that NASA's LOLA illumination map marks as never
sunlit (permanent shadow) is drawn black. Needs Pillow.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

from lunar import ROOT, PolarGrid

SIZE = 1400          # pixels
HALF_KM = 310.0      # half-width of the map


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    dem = PolarGrid('ldem_80s_80m')
    sun = PolarGrid('AVGVISIB_85S_060M_201608')
    metres_per_px = 2 * HALF_KM * 1000 / SIZE

    # Projected coordinates of every pixel centre (x to the right, y up; longitude 0 is +y).
    c = (np.arange(SIZE) + 0.5) / SIZE * 2 - 1
    x, y = np.meshgrid(c * HALF_KM * 1000, -c * HALF_KM * 1000)

    def sample(grid: PolarGrid, block: int) -> np.ndarray:
        """Mean of block x block source pixels around each map pixel (the map is coarser than the data)."""
        i = np.round(x / grid.step + grid.n / 2 - 0.5).astype(int)
        j = np.round(grid.n / 2 - 0.5 - y / grid.step).astype(int)
        ok = (i >= block) & (i < grid.n - block) & (j >= block) & (j < grid.n - block)
        out = np.full(x.shape, np.nan)
        acc = np.zeros(int(ok.sum()))
        n = 0
        for dj in range(-block, block + 1, max(1, block)):
            for di in range(-block, block + 1, max(1, block)):
                acc += grid.a[j[ok] + dj, i[ok] + di]
                n += 1
        out[ok] = acc / n * grid.scale
        return out

    h = sample(dem, 2)
    h = np.where(np.isnan(h), np.nanmean(h), h)
    gy, gx = np.gradient(h, metres_per_px)
    gy = -gy  # rows grow downwards, y grows upwards

    def shade(az_deg: float, alt_deg: float, exaggeration: float) -> np.ndarray:
        az, alt = np.radians(az_deg), np.radians(alt_deg)
        lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
        nx, ny, nz = -gx * exaggeration, -gy * exaggeration, 1.0
        return np.clip((nx * lx + ny * ly + nz * lz) / np.sqrt(nx * nx + ny * ny + nz * nz), 0, 1)

    relief = 0.7 * shade(315, 38, 1.6) + 0.3 * shade(45, 50, 1.6)
    tone = 0.10 + 0.78 * relief
    tone *= 0.86 + 0.14 * np.clip((h - h.min()) / (h.max() - h.min()), 0, 1)

    lit = sample(sun, 3)
    tone = np.where(lit == 0, tone * 0.12, tone)   # permanent shadow
    r = np.hypot(x, y)
    tone = np.where(r > HALF_KM * 1000 * 0.985, tone * 0.5, tone)

    out = os.path.join(ROOT, 'public', 'data', 'southpole.jpg')
    Image.fromarray(np.clip(tone * 255, 0, 255).astype(np.uint8), 'L').save(out, 'JPEG', quality=84, optimize=True)
    print(f'{out}: {os.path.getsize(out) / 1000:.0f} kB, {metres_per_px:.0f} m per pixel')


if __name__ == '__main__':
    main()
