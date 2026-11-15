"""The relief of the whole Moon, for the journey over the globe.

    python -X utf8 tools/build_moon_relief.py

Reads NASA's global LOLA elevation model (data/raw/ldem_64.img: 64 pixels per degree, 23040 x 11520, heights in
half metres; tools/README.md says how to fetch it) and writes public/textures/moon-relief.webp: for every point
of a 2048 x 1024 map (same layout as the colour map: 0 deg E in the middle, north up) the slope of the ground
towards the east (red) and towards the north (green), measured over about 5 km.

The globe of the journey is lit with it, so that where the Sun grazes (the line between day and night, the
poles) the rims of the craters catch the light and their floors stay dark, as on the Moon. The slopes are the
measured ones; how strongly they are shown is a choice of the drawing (src/viz/travel.ts).
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'raw' / 'ldem_64.img'
OUT = ROOT / 'public' / 'textures' / 'moon-relief.webp'
W, H = 2048, 1024
RADIUS_M = 1737400.0
# A slope of 1 in SPAN (about 9.5 degrees) fills the range of a byte on either side of the middle.
SPAN = 6.0

dem = np.memmap(SRC, dtype='<i2', mode='r', shape=(11520, 23040))
# Mean height of each cell of the small map (11.25 x 11.25 pixels of the model); longitudes from 0 to 360 deg E.
rows = np.linspace(0, 11520, H + 1).astype(int)
cols = np.linspace(0, 23040, W + 1).astype(int)
small = np.empty((H, W), dtype=np.float32)
for j in range(H):
    band = np.asarray(dem[rows[j]:rows[j + 1]], dtype=np.float32).mean(axis=0)
    small[j] = np.add.reduceat(band, cols[:-1]) / np.diff(cols)
small *= 0.5  # metres
small = np.roll(small, W // 2, axis=1)  # 0 deg E in the middle

lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
step_north = RADIUS_M * np.pi / H
step_east = RADIUS_M * 2 * np.pi / W * np.maximum(np.cos(lat), 0.05)[:, None]
east = (np.roll(small, -1, axis=1) - np.roll(small, 1, axis=1)) / (2 * step_east)
north = np.empty_like(small)
north[1:-1] = (small[:-2] - small[2:]) / (2 * step_north)
north[0] = north[1]
north[-1] = north[-2]

rgb = np.zeros((H, W, 3), dtype=np.uint8)
rgb[..., 0] = np.clip(127.5 + east * SPAN * 127.5, 0, 255)
rgb[..., 1] = np.clip(127.5 + north * SPAN * 127.5, 0, 255)
rgb[..., 2] = 128
Image.fromarray(rgb).save(OUT, 'WEBP', quality=88, method=6)
print(f'{OUT.relative_to(ROOT)}: {W} x {H}, {OUT.stat().st_size / 1024:.0f} kB; slope east {np.abs(east).mean():.4f} mean, {np.abs(east).max():.3f} max')
