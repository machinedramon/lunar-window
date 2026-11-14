"""Builds public/data/sites.json and the terrain horizon profiles of the polar sites.

Usage (from the repository root):  python -X utf8 tools/build_horizon.py

For every site with a terrain horizon it writes
  public/data/horizons/<id>.json       the site itself: horizon elevation and distance, 1440 azimuths x 3 mast heights
  public/data/horizons/<id>.ring.json  eight points 250 m around it, used to test robustness to landing error
"""
from __future__ import annotations

import datetime
import json
import math
import os
import sys
import time

import numpy as np

from lunar import D2R, DIST_FINE, DIST_FULL, ROOT, FineGrid, PolarGrid, Terrain, destination, horizon

OUT = os.path.join(ROOT, 'public', 'data')
MASTS = (0.0, 2.0, 10.0)
STEP_DEG = 0.25
RING_RADIUS_M = 250.0
RING_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]
SNAP_RADIUS_M = 1500.0


def snap(nasa: PolarGrid, lat: float, lon: float):
    """Best-lit spot near a published point.

    Published high-illumination points are given with two decimals (about 300 m) and came from
    a 240 m model, so they miss the lit ground by hundreds of metres. The site point becomes the
    pixel with the highest 3x3 mean in NASA's 60 m average-illumination map within SNAP_RADIUS_M.
    The 3x3 mean is used because single pixels of that map are noisy.
    """
    i0, j0 = nasa.nearest(lat, lon)
    w = int(SNAP_RADIUS_M // nasa.step)
    best = None
    for dj in range(-w, w + 1):
        for di in range(-w, w + 1):
            if (di * di + dj * dj) * nasa.step ** 2 > SNAP_RADIUS_M ** 2:
                continue
            i, j = i0 + di, j0 + dj
            mean = float(nasa.a[j - 1:j + 2, i - 1:i + 2].mean()) * nasa.scale
            if best is None or mean > best[0]:
                best = (mean, i, j)
    mean, i, j = best
    lat2, lon2 = nasa.latlon(i, j)
    return float(lat2), float(lon2), mean, math.hypot(i - i0, j - j0) * nasa.step


def wrap180(deg: float) -> float:
    return (deg + 180) % 360 - 180


def dump(path: str, obj) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text + '\n')
    return len(text)


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    t0 = time.time()
    sun_map = PolarGrid('AVGVISIB_85S_060M_201608')
    earth_map = PolarGrid('AVGVISIB_85S_060M_201608_EARTH')
    today = datetime.date.today().isoformat()
    source = json.load(open(os.path.join(ROOT, 'tools', 'sites.src.json'), encoding='utf-8'))
    sites = []
    for src in source:
        site = {k: src[k] for k in ('id', 'name', 'category', 'mission', 'status') if k in src}
        if 'date' in src:
            site['date'] = src['date']
        lat_d, lon_d = src['lat'], src['lon']
        if src['horizon'] != 'lola':
            site.update(lat=lat_d, lon=lon_d, elevationM=src['elevationM'], horizon='sphere', source=src['source'])
            if 'note' in src:
                site['note'] = src['note']
            sites.append(site)
            continue

        moved = None
        if src.get('snap'):
            la, lo, mean, moved = snap(sun_map, lat_d * D2R, lon_d * D2R)
            site['published'] = {'lat': lat_d, 'lon': lon_d}
            lat_d, lon_d = round(la / D2R, 5), round(wrap180(lo / D2R), 5)
        lat, lon = lat_d * D2R, lon_d * D2R

        # A 5 m site model, where NASA made one, replaces the 80 m model for the terrain near the site.
        fine = FineGrid(src['fine']) if src.get('fine') else None
        terrain = Terrain(fine)
        dist = DIST_FINE if fine else DIST_FULL
        h0, elev, far, nodata = horizon(terrain, lat, lon, STEP_DEG, dist, masts=MASTS)
        size = dump(os.path.join(OUT, 'horizons', f"{src['id']}.json"), {
            'siteId': src['id'], 'lat': lat_d, 'lon': lon_d, 'elevationM': round(h0, 1),
            'az0Deg': 0, 'stepDeg': STEP_DEG, 'mastsM': list(MASTS),
            'elevDeg': np.round(elev, 3).tolist(), 'distKm': np.round(far, 2).tolist(),
            'dem': terrain.names, 'noDataFraction': round(nodata, 4), 'generated': today,
        })

        points = []
        for bearing in RING_BEARINGS:
            la, lo = destination(lat, lon, bearing * D2R, RING_RADIUS_M)
            la, lo = float(la), float(lo)
            hp, ep, _, _ = horizon(terrain, la, lo, STEP_DEG, dist, masts=MASTS)
            points.append({'bearingDeg': bearing, 'lat': round(la / D2R, 5), 'lon': round(wrap180(lo / D2R), 5),
                           'elevationM': round(hp, 1), 'elevCdeg': np.round(ep * 100).astype(int).tolist()})
        ring_size = dump(os.path.join(OUT, 'horizons', f"{src['id']}.ring.json"), {
            'siteId': src['id'], 'radiusM': RING_RADIUS_M, 'az0Deg': 0, 'stepDeg': STEP_DEG,
            'mastsM': list(MASTS), 'points': points, 'dem': terrain.names, 'generated': today,
        })

        site.update(lat=lat_d, lon=lon_d, elevationM=round(h0), horizon='lola-5m-80m-240m' if fine else 'lola-80m-240m', source=src['source'])
        if 'note' in src:
            site['note'] = src['note']
        i, j = sun_map.nearest(lat, lon)
        if sun_map.inside(i, j, 1):
            site['nasa'] = {
                'sunVisibility': round(sun_map.value(i, j), 3),
                'sunVisibility3x3': round(float(sun_map.a[j - 1:j + 2, i - 1:i + 2].mean()) * sun_map.scale, 3),
                'earthVisibility': round(earth_map.value(i, j), 3),
                'earthVisibility3x3': round(float(earth_map.a[j - 1:j + 2, i - 1:i + 2].mean()) * earth_map.scale, 3),
            }
        sites.append(site)
        nasa = site.get('nasa', {})
        print(f"{src['id']:17s} lat {lat_d:9.5f} lon {lon_d:10.5f} elev {h0:6.0f} m | horizon {elev[0].min():6.2f}..{elev[0].max():5.2f} deg"
              f" | no data {nodata:5.1%} | NASA sun {nasa.get('sunVisibility', float('nan')):.3f} (3x3 {nasa.get('sunVisibility3x3', float('nan')):.3f})"
              f" | {size / 1000:.0f} kB + ring {ring_size / 1000:.0f} kB" + (f' | moved {moved:.0f} m from the published point' if moved is not None else ''),
              flush=True)

    dump(os.path.join(OUT, 'sites.json'), {
        'frame': 'MOON_ME', 'radiusKm': 1737.4, 'generated': today,
        'ring': {'radiusM': RING_RADIUS_M, 'bearingsDeg': RING_BEARINGS},
        'sites': sites,
    })
    print(f'{len(sites)} sites written in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
