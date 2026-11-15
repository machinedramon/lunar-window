"""The face of the Earth in the 3D view: one real day, as NASA's satellites saw it.

    python -X utf8 tools/build_earth.py [YYYY-MM-DD]

Downloads from NASA GIBS (Global Imagery Browse Services) the true-colour picture of the whole Earth for one
day, from the VIIRS instrument on two satellites that fly the same orbit fifty minutes apart (Suomi NPP and
NOAA-20), and writes public/textures/earth.webp (equirectangular, Greenwich in the middle, north up).

Two things are done to the pictures, and nothing else:
  - Each satellite sees the Sun mirrored on the sea as a pale stripe under every orbit. The stripes of the two
    do not fall on the same places, so for every region the picture with the darker sea is kept.
  - The satellites do not image the polar night. That cap is filled with a blur of what lies next to it: at
    the date of the picture the Sun does not light it either.

The clouds are therefore those of a real day, not of the moment shown in the tool, which may be years away.
"""
import io
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

DAY = sys.argv[1] if len(sys.argv) > 1 else '2026-02-07'
W, H = 4096, 2048
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'video' / 'src-earth'
OUT = ROOT / 'public' / 'textures' / 'earth.webp'
SIZE = (3072, 1536)  # as published: about 13 km per pixel at the equator
URL = ('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0'
       '&LAYERS=VIIRS_{sat}_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX=-90,-180,90,180'
       '&WIDTH={w}&HEIGHT={h}&FORMAT=image/jpeg&TIME={day}')


def fetch(sat: str) -> np.ndarray:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'viirs_{sat}_{DAY}.jpg'
    if not path.exists():
        with urllib.request.urlopen(URL.format(sat=sat, w=W, h=H, day=DAY), timeout=300) as r:
            path.write_bytes(r.read())
    return np.asarray(Image.open(io.BytesIO(path.read_bytes())).convert('RGB')).astype(np.float32)


def blur(a: np.ndarray, radius: float) -> np.ndarray:
    """Gaussian blur of one channel (or of one line of longitude): it wraps around in longitude and mirrors at the poles."""
    if a.ndim == 1:
        g = np.exp(-2 * (np.pi * radius * np.fft.rfftfreq(a.size)) ** 2)
        return np.fft.irfft(np.fft.rfft(a) * g, n=a.size).astype(np.float32)
    pad = int(radius * 3) + 1
    tall = np.concatenate([a[pad:0:-1], a, a[-2:-pad - 2:-1]], axis=0).astype(np.float32)
    for axis in (0, 1):
        g = np.exp(-2 * (np.pi * radius * np.fft.rfftfreq(tall.shape[axis])) ** 2)
        g = g[:, None] if axis == 0 else g[None, :]
        tall = np.fft.irfft(np.fft.rfft(tall, axis=axis) * g, n=tall.shape[axis], axis=axis)
    return tall[pad:-pad].astype(np.float32)


def luma(a: np.ndarray) -> np.ndarray:
    return a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


a, b = fetch('SNPP'), fetch('NOAA20')
seen_a, seen_b = a.sum(2) > 14, b.sum(2) > 14

# The picture with the darker sea, region by region. Where one saw nothing, the other is taken.
la = np.where(seen_a, blur(luma(a), 18), 999.0)
lb = np.where(seen_b, blur(luma(b), 18), 999.0)
w = np.clip(0.5 + (lb - la) / 10.0, 0.0, 1.0)
w = np.where(seen_a & ~seen_b, 1.0, np.where(seen_b & ~seen_a, 0.0, w))
w = np.clip(blur(w, 5), 0.0, 1.0)
w = np.where(~seen_b, 1.0, np.where(~seen_a, 0.0, w))[..., None]
day = a * w + b * (1 - w)
seen = seen_a | seen_b

# The polar night, and the wedges between the last swaths before it: filled from what lies around them, from
# near to far. The rows next to the night are twilight, dark and noisy; they are filled as well.
core = blur(seen.astype(np.float32), 5) > 0.97
filled = np.where(core[..., None], day, 0.0)
known = core.copy()
for radius in (5, 14, 40, 110):
    weight = blur(known.astype(np.float32), radius)
    near = weight > 0.03
    spread = np.stack([blur(filled[..., c], radius) for c in range(3)], axis=2) / np.maximum(weight, 1e-4)[..., None]
    filled = np.where((near & ~known)[..., None], spread, filled)
    known |= near
# No seam where the seen part meets the filled one.
edge = np.clip(blur(core.astype(np.float32), 9) * 2 - 1, 0.0, 1.0)[..., None]
soft = np.stack([blur(filled[..., c], 9) for c in range(3)], axis=2)
filled = filled * edge + soft * (1 - edge)

img = Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).resize(SIZE, Image.LANCZOS)
img.save(OUT, 'WEBP', quality=80, method=6)
print(f'{OUT.relative_to(ROOT)}: {SIZE[0]} x {SIZE[1]}, {OUT.stat().st_size / 1024:.0f} kB, the Earth on {DAY}')
img.resize((1536, 768), Image.LANCZOS).save(CACHE / '_earth_preview.jpg', quality=88)
