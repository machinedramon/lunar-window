"""Checks the elevation model used for any point near the south pole (public/data/polar).

Usage (from the repository root):  python -X utf8 tools/check_polar.py

Reads the files exactly as the browser does (the 3 x 3 dense tiles around the point, the coarse grid beyond) and
computes horizons with the same code as the listed sites (lunar.horizon). Writes:

    tests/terrain/polar-horizon.json   three points, for the test of the TypeScript implementation (src/core/polar.ts)
    public/data/validation.json       the "anyPoint" block shown on the Accuracy page:
        - against the full NASA models (80 m to 80 S, 240 m beyond) on 40 random points between 84 S and the pole
        - against the detailed horizons of the listed sites, most of which use a 5 m site model near the point
"""
from __future__ import annotations

import gzip
import json
import os
import sys

import numpy as np

import lunar
from lunar import D2R, R_M, ROOT, PolarGrid

POLAR = os.path.join(ROOT, 'public', 'data', 'polar')
INDEX = json.load(open(os.path.join(POLAR, 'index.json'), encoding='utf-8'))


def unpack(path: str, width: int) -> np.ndarray:
    d = np.frombuffer(gzip.decompress(open(path, 'rb').read()), dtype='<i2').reshape(-1, width)
    return np.cumsum(d, axis=1, dtype=np.int16)


class Piece:
    """A rectangle of a polar grid, sampled as the browser samples it."""

    def __init__(self, a, n, step, oi=0, oj=0):
        self.a, self.n, self.step, self.oi, self.oj = a, n, step, oi, oj

    def sample(self, lat, lon):
        r = 2 * R_M * np.tan((np.pi / 2 + lat) / 2)
        i = r * np.sin(lon) / self.step + self.n / 2 - 0.5 - self.oi
        j = self.n / 2 - 0.5 - r * np.cos(lon) / self.step - self.oj
        h, w = self.a.shape
        ok = (i >= 0) & (j >= 0) & (i < w - 1) & (j < h - 1)
        out = np.full(lat.shape, np.nan)
        i0, j0 = np.floor(i[ok]).astype(np.int64), np.floor(j[ok]).astype(np.int64)
        fi, fj = i[ok] - i0, j[ok] - j0
        a = self.a
        out[ok] = ((a[j0, i0] * (1 - fi) + a[j0, i0 + 1] * fi) * (1 - fj) + (a[j0 + 1, i0] * (1 - fi) + a[j0 + 1, i0 + 1] * fi) * fj) * INDEX['unitM']
        return out


class Stack:
    def __init__(self, grids):
        self.grids = grids

    def height(self, lat, lon):
        h = self.grids[0].sample(lat, lon)
        for g in self.grids[1:]:
            bad = np.isnan(h)
            if not bad.any():
                break
            h[bad] = g.sample(lat[bad], lon[bad])
        return h

    def height_at(self, lat, lon):
        return float(self.height(np.array([lat]), np.array([lon]))[0])


FAR = Piece(unpack(os.path.join(POLAR, 'far.bin.gz'), INDEX['far']['n']), INDEX['far']['n'], INDEX['far']['stepM'])


def light(lat, lon):
    """The model the browser builds for a point: 3 x 3 dense tiles, then the coarse grid."""
    near = INDEX['near']
    size = near['tile']
    r = 2 * R_M * np.tan((np.pi / 2 + lat) / 2)
    ti = int(np.floor((r * np.sin(lon) / near['stepM'] + near['n'] / 2 - 0.5) / size))
    tj = int(np.floor((near['n'] / 2 - 0.5 - r * np.cos(lon) / near['stepM']) / size))
    rows = []
    for j in range(tj - 1, tj + 2):
        row = []
        for i in range(ti - 1, ti + 2):
            assert f'{i}_{j}' in near['tiles'], f'tile {i}_{j} missing'
            row.append(unpack(os.path.join(POLAR, 'near', f'{i}_{j}.bin.gz'), size))
        rows.append(np.hstack(row))
    return Stack([Piece(np.vstack(rows), near['n'], near['stepM'], (ti - 1) * size, (tj - 1) * size), FAR])


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    masts = (0.0, 2.0, 10.0)

    # ----- golden values for the TypeScript implementation
    golden = []
    for lat_d, lon_d in [(-85.5, 30.0), (-89.2, -120.0), (-87.3, 150.0)]:
        h0, elev, far, _ = lunar.horizon(light(lat_d * D2R, lon_d * D2R), lat_d * D2R, lon_d * D2R, step_deg=5.0, masts=masts)
        golden.append({'lat': lat_d, 'lon': lon_d, 'elevationM': round(h0, 3), 'stepDeg': 5, 'mastsM': list(masts),
                       'elevDeg': [[round(float(v), 4) for v in row] for row in elev], 'distKm': [[round(float(v), 2) for v in row] for row in far]})
    os.makedirs(os.path.join(ROOT, 'tests', 'terrain'), exist_ok=True)
    json.dump(golden, open(os.path.join(ROOT, 'tests', 'terrain', 'polar-horizon.json'), 'w', encoding='utf-8'), separators=(',', ':'))

    # ----- against the full NASA models
    full = lunar.Terrain()
    rng = np.random.default_rng(11)
    diffs = []
    for _ in range(40):
        radius = np.sqrt(rng.uniform(0, 1)) * (90 + INDEX['minLat'])
        lat, lon = -(90 - radius) * D2R, rng.uniform(-180, 180) * D2R
        _, a, _, _ = lunar.horizon(light(lat, lon), lat, lon, step_deg=1.0, masts=masts)
        _, b, _, _ = lunar.horizon(full, lat, lon, step_deg=1.0, masts=masts)
        diffs.append(np.abs(a - b).ravel())
    d = np.concatenate(diffs)
    block = {
        'model': 'NASA LOLA ldem_80s_80m within the nine 20.5 km tiles around the point, ldem_75s_240m averaged to 480 m beyond',
        'againstFull': {'points': 40, 'meanAbsDeg': round(float(d.mean()), 4), 'p95Deg': round(float(np.percentile(d, 95)), 3), 'maxDeg': round(float(d.max()), 2)},
        'againstSites': [],
    }
    print(f"any point against the full 80 m + 240 m models, 40 points: mean {d.mean():.4f}, p95 {np.percentile(d, 95):.3f}, max {d.max():.2f} degrees")

    # ----- against the detailed horizons of the listed sites (observer 2 m above the ground)
    sites = json.load(open(os.path.join(ROOT, 'public', 'data', 'sites.json'), encoding='utf-8'))['sites']
    for s in sites:
        if s['horizon'] == 'sphere' or s['lat'] > INDEX['minLat']:
            continue
        stored = json.load(open(os.path.join(ROOT, 'public', 'data', 'horizons', s['id'] + '.json'), encoding='utf-8'))
        lat, lon = s['lat'] * D2R, s['lon'] * D2R
        _, a, _, _ = lunar.horizon(light(lat, lon), lat, lon, step_deg=1.0, masts=(2.0,))
        ref = np.array(stored['elevDeg'][stored['mastsM'].index(2)])[:: int(round(1.0 / stored['stepDeg']))]
        e = np.abs(a[0] - ref)
        block['againstSites'].append({'id': s['id'], 'fine': s['horizon'] == 'lola-5m-80m-240m', 'meanAbsDeg': round(float(e.mean()), 3), 'p95Deg': round(float(np.percentile(e, 95)), 2)})
        print(f"  {s['id']:18s} {s['horizon']:18s} mean {e.mean():.3f}  p95 {np.percentile(e, 95):.2f}")

    path = os.path.join(ROOT, 'public', 'data', 'validation.json')
    v = json.load(open(path, encoding='utf-8'))
    # The block of the global model (tools/check_global.py) is kept.
    if 'global' in v.get('anyPoint', {}):
        block['global'] = v['anyPoint']['global']
    v['anyPoint'] = block
    json.dump(v, open(path, 'w', encoding='utf-8'), separators=(',', ':'))
    print('written: tests/terrain/polar-horizon.json, public/data/validation.json (anyPoint)')


if __name__ == '__main__':
    main()
