"""Checks the elevation model used for any point of the Moon outside the polar model (public/data/global).

Usage (from the repository root):  python -X utf8 tools/check_global.py

Reads the files exactly as the browser does (three rows of dense tiles around the point, the coarse grid beyond)
and computes horizons with the same code as the listed sites (lunar.horizon). Writes:

    tests/terrain/global-horizon.json   five points, for the test of the TypeScript implementation
    public/data/validation.json         the "anyPoint.global" block shown on the Accuracy page:
        - against NASA's finer polar models (80 m and 240 m) on 24 points between 70 S and 82 S, the roughest
          ground where both exist: what the 474 m model misses
        - against the whole ldem_64, on 16 random points: what cutting it in pieces costs
"""
from __future__ import annotations

import gzip
import json
import os
import sys

import numpy as np

import lunar
from lunar import D2R, DIST_GLOBAL, R_M, ROOT, GeoGrid

GLOBAL = os.path.join(ROOT, 'public', 'data', 'global')
INDEX = json.load(open(os.path.join(GLOBAL, 'index.json'), encoding='utf-8'))
UNIT = INDEX['unitM']


def unpack(path: str, width: int) -> np.ndarray:
    raw = np.frombuffer(gzip.decompress(open(path, 'rb').read()), dtype='u1')
    n = raw.size // 2
    z = raw[:n].astype(np.int32) | (raw[n:].astype(np.int32) << 8)
    e = ((z >> 1) ^ -(z & 1)).reshape(-1, width)
    return np.cumsum(np.cumsum(e, axis=0), axis=1)


class Piece:
    """A rectangle of the global grid, sampled as the browser samples it (src/core/polar.ts, sampleGeo)."""

    def __init__(self, a, ppd, oi=0, oj=0, whole=False):
        self.a, self.ppd, self.oi, self.oj, self.whole = a, ppd, oi, oj, whole

    def sample(self, lat, lon):
        h, w = self.a.shape
        n = 360 * self.ppd
        x = np.degrees(lon) * self.ppd - 0.5 - self.oi
        x = x - np.floor(x / n) * n
        y = (90.0 - np.degrees(lat)) * self.ppd - 0.5 - self.oj
        a = self.a
        if self.whole:
            y = np.clip(y, 0, h - 1)
            i0 = np.floor(x).astype(np.int64)
            j0 = np.minimum(np.floor(y).astype(np.int64), h - 2)
            i1 = np.where(i0 + 1 == w, 0, i0 + 1)
            fi, fj = x - i0, y - j0
            return ((a[j0, i0] * (1 - fi) + a[j0, i1] * fi) * (1 - fj) + (a[j0 + 1, i0] * (1 - fi) + a[j0 + 1, i1] * fi) * fj) * UNIT
        ok = (y >= 0) & (x < w - 1) & (y < h - 1)
        out = np.full(lat.shape, np.nan)
        i0, j0 = np.floor(x[ok]).astype(np.int64), np.floor(y[ok]).astype(np.int64)
        fi, fj = x[ok] - i0, y[ok] - j0
        out[ok] = ((a[j0, i0] * (1 - fi) + a[j0, i0 + 1] * fi) * (1 - fj) + (a[j0 + 1, i0] * (1 - fi) + a[j0 + 1, i0 + 1] * fi) * fj) * UNIT
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


FAR = Piece(unpack(os.path.join(GLOBAL, 'far.bin.gz'), 360 * INDEX['far']['ppd']), INDEX['far']['ppd'], whole=True)


def light(lat, lon):
    """The model the browser builds for a point (geoTilesFor and joinGeoTiles in src/core/polar.ts)."""
    ppd, tile = INDEX['near']['ppd'], INDEX['near']['tile']
    lat_d, lon_d = np.degrees(lat), np.degrees(lon)
    cols_all, rows_all = 360 * ppd // tile, 180 * ppd // tile
    lon_p = lon_d - np.floor(lon_d / 360) * 360
    tc = min(cols_all - 1, int(np.floor(lon_p * ppd / tile)))
    tr = min(rows_all - 1, max(0, int(np.floor((90 - lat_d) * ppd / tile))))
    tile_km = (tile / ppd) * D2R * R_M / 1000
    side = max(1, min(8, int(np.ceil(60 / max(1e-6, tile_km * np.cos(lat))))))
    cols = list(range(tc - side, tc + side + 1))
    rows = list(range(max(0, tr - 1), min(rows_all - 1, tr + 1) + 1))
    block = np.vstack([np.hstack([unpack(os.path.join(GLOBAL, 'near', f'{c % cols_all}_{r}.bin.gz'), tile) for c in cols]) for r in rows])
    return Stack([Piece(block, ppd, cols[0] * tile, rows[0] * tile), FAR])


class One:
    def __init__(self, g):
        self.g = g

    def height(self, lat, lon):
        return self.g.sample(lat, lon)

    def height_at(self, lat, lon):
        return float(self.height(np.array([lat]), np.array([lon]))[0])


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    masts = (0.0, 2.0, 10.0)

    # ----- reference values for the TypeScript implementation
    golden = []
    for lat_d, lon_d in [(20.19, 30.77), (-41.64, -153.99), (86.5, 40.0), (0.5, 179.95), (-81.0, 10.0)]:
        h0, elev, far, _ = lunar.horizon(light(lat_d * D2R, lon_d * D2R), lat_d * D2R, lon_d * D2R, step_deg=5.0, dist=DIST_GLOBAL, masts=masts)
        golden.append({'lat': lat_d, 'lon': lon_d, 'elevationM': round(h0, 3), 'stepDeg': 5, 'mastsM': list(masts),
                       'elevDeg': [[round(float(v), 4) for v in row] for row in elev], 'distKm': [[round(float(v), 2) for v in row] for row in far]})
    os.makedirs(os.path.join(ROOT, 'tests', 'terrain'), exist_ok=True)
    json.dump(golden, open(os.path.join(ROOT, 'tests', 'terrain', 'global-horizon.json'), 'w', encoding='utf-8'), separators=(',', ':'))

    rng = np.random.default_rng(23)
    # ----- against the finer polar models, on the roughest ground where both exist
    polar = lunar.Terrain()
    diffs = []
    for _ in range(24):
        lat, lon = -rng.uniform(70.0, 82.0) * D2R, rng.uniform(-180, 180) * D2R
        _, a, _, _ = lunar.horizon(light(lat, lon), lat, lon, step_deg=2.0, dist=DIST_GLOBAL, masts=masts)
        _, b, _, _ = lunar.horizon(polar, lat, lon, step_deg=2.0, masts=masts)
        diffs.append(np.abs(a - b).ravel())
    d = np.concatenate(diffs)
    against_polar = {'points': 24, 'medianDeg': round(float(np.median(d)), 3), 'meanAbsDeg': round(float(d.mean()), 3), 'p95Deg': round(float(np.percentile(d, 95)), 2)}
    print(f"global model against the polar models, 24 points 70-82 S: median {np.median(d):.3f}, mean {d.mean():.3f}, p95 {np.percentile(d, 95):.2f} degrees")

    # ----- against the whole ldem_64, with the same sampling distances
    whole = One(GeoGrid.from_pds('ldem_64'))
    diffs = []
    for _ in range(16):
        lat, lon = np.arcsin(rng.uniform(-0.985, 0.999)), rng.uniform(-180, 180) * D2R
        _, a, _, _ = lunar.horizon(light(lat, lon), lat, lon, step_deg=2.0, dist=DIST_GLOBAL, masts=masts)
        _, b, _, _ = lunar.horizon(whole, lat, lon, step_deg=2.0, dist=DIST_GLOBAL, masts=masts)
        diffs.append(np.abs(a - b).ravel())
    d = np.concatenate(diffs)
    against_full = {'points': 16, 'medianDeg': round(float(np.median(d)), 3), 'meanAbsDeg': round(float(d.mean()), 3), 'p95Deg': round(float(np.percentile(d, 95)), 2)}
    print(f"packaging, against the whole ldem_64, 16 points: median {np.median(d):.3f}, mean {d.mean():.3f}, p95 {np.percentile(d, 95):.2f} degrees")

    path = os.path.join(ROOT, 'public', 'data', 'validation.json')
    v = json.load(open(path, encoding='utf-8'))
    v.setdefault('anyPoint', {})['global'] = {'model': 'NASA LOLA ldem_64 in three rows of 4-degree tiles around the point, averaged to 8 pixels per degree beyond', 'againstPolar': against_polar, 'againstFull': against_full}
    json.dump(v, open(path, 'w', encoding='utf-8'), separators=(',', ':'))
    print('written: tests/terrain/global-horizon.json, public/data/validation.json (anyPoint.global)')


if __name__ == '__main__':
    main()
