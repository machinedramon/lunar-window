"""Builds the elevation model the browser uses for any point near the south pole: public/data/polar/

Usage (from the repository root):  python -X utf8 tools/build_polar.py

The listed sites have horizons computed offline. For a point of the visitor's own the horizon is computed in
the browser, from two pieces of NASA's LOLA polar elevation models, in their own south polar stereographic
projection and their own units (counts of 0.5 m above the 1737.4 km sphere):

    near/<col>_<row>.bin.gz   ldem_80s_80m cut in tiles of 256 x 256 pixels (20.5 km): 80 m/pixel, for every tile
                              that a point down to 82 S can need (the tile of the point and the eight around it)
    far.bin.gz                ldem_75s_240m averaged 2 x 2: 480 m/pixel, pole to 75 S, for everything farther

Measured on 24 random points between 84 S and the pole (the model now reaches 82 S) (tools/README.md, "Any point"): the horizon from these
two pieces differs from the horizon of the full 80 m + 240 m models by 0.004 degrees on average, 0.02 at the
95th percentile.

Each file is the grid row by row, north-up as in the NASA file, little-endian int16, as differences from the
pixel to the left (the first pixel of a row as is), gzip-compressed. index.json lists what exists.
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import time

import numpy as np

from lunar import ROOT, PolarGrid

OUT = os.path.join(ROOT, 'public', 'data', 'polar')
TILE = 256
MIN_LAT = -82.0
R_KM = 1737.4


def pack(a: np.ndarray) -> bytes:
    """Row-wise differences (wrapping in 16 bits), gzip."""
    d = a.astype('<i2').copy()
    d[:, 1:] = (a[:, 1:].astype(np.int32) - a[:, :-1].astype(np.int32)).astype('<i2')
    return gzip.compress(d.tobytes(), compresslevel=9, mtime=0)


def main() -> None:
    t0 = time.time()
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'near'))

    far_src = PolarGrid('ldem_75s_240m')
    n = far_src.n // 2
    far = np.rint(far_src.a[: n * 2, : n * 2].astype(np.float32).reshape(n, 2, n, 2).mean(axis=(1, 3))).astype('<i2')
    blob = pack(far)
    open(os.path.join(OUT, 'far.bin.gz'), 'wb').write(blob)
    total = len(blob)
    print(f'far: {n} x {n} at {far_src.step * 2:.0f} m, {len(blob) / 1e6:.2f} MB')

    near = PolarGrid('ldem_80s_80m')
    # Distance from the pole of the farthest point allowed, plus the diagonal of one tile: every tile a point can need.
    reach_m = 2 * R_KM * 1000 * np.tan(np.radians(90 + MIN_LAT) / 2) + TILE * near.step * np.sqrt(2)
    tiles = []
    for tj in range(near.n // TILE + 1):
        for ti in range(near.n // TILE + 1):
            i0, j0 = ti * TILE, tj * TILE
            if i0 >= near.n or j0 >= near.n:
                continue
            # Nearest point of the tile to the pole (the pole is at the centre of the grid).
            cx = np.clip(near.n / 2, i0, i0 + TILE) - near.n / 2
            cy = np.clip(near.n / 2, j0, j0 + TILE) - near.n / 2
            if np.hypot(cx, cy) * near.step > reach_m:
                continue
            a = np.zeros((TILE, TILE), dtype='<i2')
            part = near.a[j0 : j0 + TILE, i0 : i0 + TILE]
            a[: part.shape[0], : part.shape[1]] = part
            blob = pack(a)
            open(os.path.join(OUT, 'near', f'{ti}_{tj}.bin.gz'), 'wb').write(blob)
            total += len(blob)
            tiles.append(f'{ti}_{tj}')
    index = {
        'source': 'NASA LRO LOLA polar gridded elevation: ldem_80s_80m (near), ldem_75s_240m averaged 2 x 2 (far)',
        'projection': 'south polar stereographic, pixel registration, +x towards 90 E, +y towards 0 E',
        'radiusM': R_KM * 1000,
        'unitM': near.scale,
        'minLat': MIN_LAT,
        'near': {'n': near.n, 'stepM': near.step, 'tile': TILE, 'tiles': tiles},
        'far': {'n': n, 'stepM': far_src.step * 2},
    }
    assert near.scale == far_src.scale
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'near: {len(tiles)} tiles of {TILE} px at {near.step:.0f} m; everything {total / 1e6:.1f} MB; {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
