"""Checks the recorded frames of the film for flicker: single frames much darker or brighter than both neighbours.

    python tools/film_check.py [video/frames]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src = Path(sys.argv[1] if len(sys.argv) > 1 else 'video/frames')
files = sorted(src.glob('*.jpg'))
# brightness of the whole frame and of four quarters, to catch a part of the picture dropping out
levels = []
for f in files:
    a = np.asarray(Image.open(f).convert('L').resize((192, 108))).astype(float)
    levels.append([a.mean(), a[:54, :96].mean(), a[:54, 96:].mean(), a[54:, :96].mean(), a[54:, 96:].mean()])
m = np.array(levels)
bad = []
for i in range(1, len(m) - 1):
    for k in range(m.shape[1]):
        before, here, after = m[i - 1, k], m[i, k], m[i + 1, k]
        # a spike: this frame differs from both neighbours, which agree with each other
        if abs(here - before) > 4 and abs(here - after) > 4 and abs(before - after) < 2:
            bad.append((i, k, before, here, after))
            break
print(f'{len(files)} frames; {len(bad)} single-frame spikes')
for i, k, b, h, a in bad[:30]:
    print(f'  frame {i} ({i / 30:.2f} s), region {k}: {b:.1f} -> {h:.1f} -> {a:.1f}')
sys.exit(1 if bad else 0)
