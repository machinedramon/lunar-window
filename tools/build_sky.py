"""The Milky Way of the night sky at 8192 x 4096, from NASA's Deep Star Maps 2020.

    python -X utf8 tools/build_sky.py

Reads data/raw/sky8k/milkyway_2020_8k.exr (NASA/Goddard Space Flight Center Scientific Visualization
Studio, https://svs.gsfc.nasa.gov/4851) and writes public/textures/milkyway-8k.webp: one channel, the
brightness of the sky. The colour stays in the 4096-pixel map (public/textures/milkyway.jpg), which was
made first; the tones of the large map are matched to it, so both show the same sky and only the
sharpness differs. Needs ffmpeg, numpy and Pillow.
"""
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'data/raw/sky8k/milkyway_2020_8k.exr'
W, H = 8192, 4096
Image.MAX_IMAGE_PIXELS = None

# linear light, 32-bit float, straight from the EXR
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(SRC), '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-'], check=True, capture_output=True).stdout
planes = np.frombuffer(raw, dtype='<f4').reshape(3, H, W)  # g, b, r
lum = 0.7152 * planes[0] + 0.0722 * planes[1] + 0.2126 * planes[2]
print('linear luminance: min %.5f median %.5f p99 %.4f max %.3f' % (lum.min(), np.median(lum), np.percentile(lum, 99), lum.max()))

# The tones of the existing map: its brightness at each quantile, to be reproduced by the large one.
ref = np.asarray(Image.open(ROOT / 'public/textures/milkyway.jpg').convert('L')).astype(np.float32)
small = lum.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
q = np.linspace(0, 1, 2049)
src_q = np.quantile(small, q)
ref_q = np.quantile(ref, q)
# a monotone curve from linear light to the 8-bit tone of the existing map
src_q = np.maximum.accumulate(src_q + np.arange(len(q)) * 1e-12)
toned = np.interp(lum, src_q, ref_q).astype(np.float32)

# The faintest stars of the map are single bright pixels; a very light blur keeps them from sparkling when the
# camera moves, without softening the dust lanes.
def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    r = int(3 * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.concatenate([a[:, -r:], a, a[:, :r]], axis=1)  # the map wraps around in longitude
    a = sum(k[i] * a[:, i : i + W] for i in range(2 * r + 1))
    a = np.pad(a, ((r, r), (0, 0)), mode='edge')
    return sum(k[i] * a[i : i + H, :] for i in range(2 * r + 1))


toned = blur(toned, 0.7)
# where there is no Milky Way the sky is black: the faint grain left there is taken away
toned = np.maximum(0, toned - 4) * (255 / 251)
out = ROOT / 'public/textures/milkyway-8k.webp'
Image.fromarray(np.clip(toned + 0.5, 0, 255).astype(np.uint8), 'L').save(out, quality=78, method=5)
print(out, f'{out.stat().st_size / 1e6:.2f} MB')
