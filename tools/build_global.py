"""Builds the elevation model the browser uses for any point of the Moon: public/data/global/

Usage (from the repository root):  python -X utf8 tools/build_global.py

From NASA's LOLA global gridded elevation model ldem_64 (64 pixels per degree, 474 m at the equator, counts of
0.5 m above the 1737.4 km sphere), in its own grid of latitude and longitude:

    near/<col>_<row>.bin.gz   the model cut in tiles of 256 x 256 pixels (4 x 4 degrees), 90 columns by 45 rows,
                              from 90 N, 0 E; a point uses three rows of them and enough columns to reach 60 km
    far.bin.gz                the whole Moon averaged 8 x 8: 8 pixels per degree, for everything farther

Heights are NASA's own values, unchanged (the far grid is their mean, rounded to the same 0.5 m). Each file is
the grid row by row from the north; the differences from the pixel to the left, then the
differences of those from the row above (the first row and column as they are), each mapped to an unsigned
number (0, -1, 1, -2, ... become 0, 1, 2, 3, ...), written as all the low bytes then all the high bytes, and
gzip-compressed. src/core/polar.ts (unpackSecond) reads it back.
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import time

import numpy as np

from lunar import ROOT, GeoGrid

OUT = os.path.join(ROOT, 'public', 'data', 'global')
TILE = 256
UNIT_M = 0.5
FAR_FACTOR = 8


def pack(a: np.ndarray) -> bytes:
    """Second differences, zigzag, low bytes then high bytes, gzip. `a` in counts, int32."""
    d = a.astype(np.int32)
    d[:, 1:] = a[:, 1:].astype(np.int32) - a[:, :-1].astype(np.int32)
    e = d.copy()
    e[1:, :] = d[1:, :] - d[:-1, :]
    assert np.abs(e).max() < 32768, 'a second difference does not fit in 16 bits'
    z = ((e << 1) ^ (e >> 31)).astype('<u2')
    return gzip.compress((z & 255).astype('u1').tobytes() + (z >> 8).astype('u1').tobytes(), compresslevel=9, mtime=0)


def main() -> None:
    t0 = time.time()
    src = GeoGrid.from_pds('ldem_64')
    assert src.ppd == 64 and src.w % TILE == 0 and src.h % TILE == 0
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'near'))
    k = UNIT_M / src.scale
    total = 0
    cols, rows = src.w // TILE, src.h // TILE
    for row in range(rows):
        band = np.rint(src.a[row * TILE : (row + 1) * TILE].astype(np.float32) / k).astype(np.int32)
        for col in range(cols):
            blob = pack(band[:, col * TILE : (col + 1) * TILE])
            open(os.path.join(OUT, 'near', f'{col}_{row}.bin.gz'), 'wb').write(blob)
            total += len(blob)
    far = np.rint(src.a.reshape(src.h // FAR_FACTOR, FAR_FACTOR, src.w // FAR_FACTOR, FAR_FACTOR).mean(axis=(1, 3), dtype=np.float32) / k).astype(np.int32)
    blob = pack(far)
    open(os.path.join(OUT, 'far.bin.gz'), 'wb').write(blob)
    index = {
        'source': 'NASA LRO LOLA global gridded elevation ldem_64 (near), averaged 8 x 8 (far)',
        'grid': 'latitude and longitude, pixel registration, first pixel half a pixel from 90 N and 0 E, longitude to the east',
        'radiusM': 1737400.0,
        'unitM': UNIT_M,
        'near': {'ppd': int(src.ppd), 'tile': TILE},
        'far': {'ppd': int(src.ppd) // FAR_FACTOR},
    }
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'near: {cols * rows} tiles, {total / 1e6:.0f} MB; far: {far.shape[1]} x {far.shape[0]}, {len(blob) / 1e6:.2f} MB; {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
