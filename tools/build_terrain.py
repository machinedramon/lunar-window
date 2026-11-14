"""Builds the terrain tiles of the 3D view: public/data/terrain/<id>.bin

Usage (from the repository root):  python -X utf8 tools/build_terrain.py

For every site with a terrain horizon, three nested square grids centred on the site, each of
257 x 257 samples:

    level 0   50 m spacing    12.8 km across   (resampled from the 80 m model)
    level 1   400 m spacing   102 km across
    level 2   2400 m spacing  614 km across

A sample is the height of the ground in the local frame of the site: metres above the plane
tangent to the Moon at the site. The curvature of the Moon is therefore already in the data,
which is what makes distant mountains sink below the horizon as they do on the real Moon.
Grid axes: x to the east, y to the north; the grid coordinates are the great-circle distance
and bearing from the site (azimuthal equidistant).

File layout: little-endian int16, level 0 then 1 then 2, each row by row from south to north,
west to east. Units per count: 0.25 m, 0.5 m and 2.5 m.
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

from lunar import D2R, R_M, ROOT, Terrain, destination

N = 257
SPACING_M = [50.0, 400.0, 2400.0]
UNIT_M = [0.25, 0.5, 2.5]
OUT = os.path.join(ROOT, 'public', 'data', 'terrain')


def level(terrain: Terrain, lat: float, lon: float, h0: float, spacing: float) -> np.ndarray:
    idx = (np.arange(N) - N // 2) * spacing
    east, north = np.meshgrid(idx, idx)
    dist = np.hypot(east, north)
    lat2, lon2 = destination(lat, lon, np.arctan2(east, north), dist)
    h = terrain.height(lat2, lon2)
    if np.isnan(h).any():
        h = np.where(np.isnan(h), np.nanmin(h), h)
    return (R_M + h) * np.cos(dist / R_M) - (R_M + h0)


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    t0 = time.time()
    terrain = Terrain()
    os.makedirs(OUT, exist_ok=True)
    sites = json.load(open(os.path.join(ROOT, 'public', 'data', 'sites.json'), encoding='utf-8'))['sites']
    for s in sites:
        if s['horizon'] == 'sphere':
            continue
        lat, lon = s['lat'] * D2R, s['lon'] * D2R
        h0 = terrain.height_at(lat, lon)
        parts = []
        notes = []
        for spacing, unit in zip(SPACING_M, UNIT_M):
            y = level(terrain, lat, lon, h0, spacing)
            q = np.round(y / unit)
            clipped = int((np.abs(q) > 32767).sum())
            parts.append(np.clip(q, -32767, 32767).astype('<i2'))
            notes.append(f'{y.min():8.0f}..{y.max():6.0f} m' + (f' ({clipped} clipped)' if clipped else ''))
        with open(os.path.join(OUT, s['id'] + '.bin'), 'wb') as f:
            for p in parts:
                f.write(p.tobytes())
        print(f"{s['id']:17s} " + ' | '.join(notes), flush=True)
    print(f'done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
