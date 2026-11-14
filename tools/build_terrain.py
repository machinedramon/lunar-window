"""Builds the terrain tiles of the 3D view: public/data/terrain/<id>.bin

Usage (from the repository root):  python -X utf8 tools/build_terrain.py

For every site with a terrain horizon, four nested square grids centred on the site, each of
257 x 257 samples:

    level 0   5 m spacing     1.28 km across   (NASA's 5 m site model where one exists)
    level 1   50 m spacing    12.8 km across
    level 2   400 m spacing   102 km across
    level 3   2400 m spacing  614 km across

A sample is the height of the ground in the local frame of the site: metres above the plane
tangent to the Moon at the site. The curvature of the Moon is therefore already in the data,
which is what makes distant mountains sink below the horizon as they do on the real Moon.
Grid axes: x to the east, y to the north; the grid coordinates are the great-circle distance
and bearing from the site (azimuthal equidistant). Coarser levels are box-averaged from a
denser sampling, so that they do not alias.

File layout: little-endian int16, level 0 to 3, each row by row from south to north, west to
east. Units per count: 0.0625 m, 0.25 m, 0.5 m and 2.5 m.
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

from lunar import D2R, R_M, ROOT, FineGrid, Terrain, destination

N = 257
SPACING_M = [5.0, 50.0, 400.0, 2400.0]
UNIT_M = [0.0625, 0.25, 0.5, 2.5]
OVERSAMPLE = [1, 5, 4, 3]
OUT = os.path.join(ROOT, 'public', 'data', 'terrain')


def level(terrain: Terrain, lat: float, lon: float, h0: float, spacing: float, over: int) -> np.ndarray:
    n = (N - 1) * over + 1 + 2 * (over // 2)
    idx = (np.arange(n) - n // 2) * (spacing / over)
    east, north = np.meshgrid(idx, idx)
    dist = np.hypot(east, north)
    lat2, lon2 = destination(lat, lon, np.arctan2(east, north), dist)
    h = terrain.height(lat2, lon2)
    if np.isnan(h).any():
        h = np.where(np.isnan(h), np.nanmin(h), h)
    y = (R_M + h) * np.cos(dist / R_M) - (R_M + h0)
    if over == 1:
        return y
    # Box average of over x over samples around each node.
    k = over // 2
    c = np.cumsum(np.cumsum(np.pad(y, ((1, 0), (1, 0))), axis=0), axis=1)
    w = 2 * k + 1
    box = (c[w:, w:] - c[:-w, w:] - c[w:, :-w] + c[:-w, :-w]) / (w * w)
    return box[::over, ::over][:N, :N]


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    source = {s['id']: s for s in json.load(open(os.path.join(ROOT, 'tools', 'sites.src.json'), encoding='utf-8'))}
    sites = json.load(open(os.path.join(ROOT, 'public', 'data', 'sites.json'), encoding='utf-8'))['sites']
    for s in sites:
        if s['horizon'] == 'sphere':
            continue
        fine_id = source[s['id']].get('fine')
        terrain = Terrain(FineGrid(fine_id) if fine_id else None)
        lat, lon = s['lat'] * D2R, s['lon'] * D2R
        h0 = terrain.height_at(lat, lon)
        parts = []
        notes = []
        for spacing, unit, over in zip(SPACING_M, UNIT_M, OVERSAMPLE):
            y = level(terrain, lat, lon, h0, spacing, over)
            assert y.shape == (N, N), y.shape
            q = np.round(y / unit)
            clipped = int((np.abs(q) > 32767).sum())
            parts.append(np.clip(q, -32767, 32767).astype('<i2'))
            notes.append(f'{y.min():7.0f}..{y.max():6.0f}' + (f' ({clipped} clipped)' if clipped else ''))
        with open(os.path.join(OUT, s['id'] + '.bin'), 'wb') as f:
            for p in parts:
                f.write(p.tobytes())
        print(f"{s['id']:17s} {'5 m ' + fine_id if fine_id else '80 m only':14s} " + ' | '.join(notes), flush=True)
    print(f'done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
