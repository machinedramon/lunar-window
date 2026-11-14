"""Checks the terrain horizon against NASA's LOLA average-illumination maps.

Usage (from the repository root):  python -X utf8 tools/validate_horizon.py

For a mesh of points it computes, from our own horizon, the fraction of time in which any part
of the solar disc (and of the Earth's disc) is above the terrain, for an observer on the ground,
and compares it with the value of the same pixel in NASA's maps (Mazarico et al. 2011 method,
product AVGVISIB_85S_060M_201608). The result is written to public/data/validation.json and shown
on the Accuracy page of the tool, whatever it turns out to be.
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import time

import numpy as np

from build_horizon import OUT, dump
from lunar import (D2R, DIST_COARSE, ROOT, PolarGrid, Terrain, az_el, disc_fraction, horizon,
                   horizons_table, to_moon_fixed)

REF_LAT, REF_LON_E = -89.45, 222.69          # reference site for the JPL Horizons tables
SPAN = ['2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01', '2030-10-20']
HOURS = 33276                                # four draconic years (4 x 346.62 d): whole lunar seasons


def body_positions(body):
    parts = [horizons_table(body, REF_LON_E, REF_LAT, a, b)[0][:-1] for a, b in zip(SPAN[:-1], SPAN[1:])]
    table = np.vstack(parts)[:HOURS]
    return to_moon_fixed(table, REF_LAT * D2R, REF_LON_E * D2R), table[:, 2]


def stats(ours, nasa):
    d = ours - nasa
    return {
        'n': int(d.size),
        'meanAbsError': round(float(np.abs(d).mean()), 4),
        'bias': round(float(d.mean()), 4),
        'rms': round(float(np.sqrt((d ** 2).mean())), 4),
        'correlation': round(float(np.corrcoef(ours, nasa)[0, 1]), 4),
        'within5pp': round(float((np.abs(d) < 0.05).mean()), 4),
        'within10pp': round(float((np.abs(d) < 0.10).mean()), 4),
    }


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    t0 = time.time()
    terrain = Terrain()  # 80 m and 240 m models only: comparable with NASA's maps, made from a 60 m model
    maps = {'sun': PolarGrid('AVGVISIB_85S_060M_201608'), 'earth': PolarGrid('AVGVISIB_85S_060M_201608_EARTH')}
    bodies = {'sun': body_positions('10'), 'earth': body_positions('399')}

    def visibility(lat, lon, h0, profile, step):
        out = {}
        for name, (pos, diam) in bodies.items():
            az, el = az_el(pos, lat, lon, h0)
            out[name] = float((disc_fraction(az, el, diam, profile, step) > 0).mean())
        return out

    def mesh(offsets):
        ic, jc = maps['sun'].nearest(REF_LAT * D2R, REF_LON_E * D2R)
        rows = []
        for dj in offsets:
            for di in offsets:
                i, j = ic + di, jc + dj
                lat, lon = maps['sun'].latlon(i, j)
                h0, elev, _, _ = horizon(terrain, float(lat), float(lon), 0.5, DIST_COARSE, masts=(0.0,))
                v = visibility(float(lat), float(lon), h0, elev[0], 0.5)
                rows.append([v['sun'], maps['sun'].value(i, j), float(maps['sun'].a[j - 1:j + 2, i - 1:i + 2].mean()) * maps['sun'].scale,
                             v['earth'], maps['earth'].value(i, j)])
        return np.array(rows)

    regional = mesh(range(-275, 276, 50))     # 144 points, 3 km apart, 33 x 33 km
    print(f'regional mesh done in {time.time() - t0:.0f} s', flush=True)
    fine = mesh(range(-15, 16, 3))            # 121 points, 180 m apart
    print(f'fine mesh done in {time.time() - t0:.0f} s', flush=True)

    sites = []
    for s in json.load(open(os.path.join(OUT, 'sites.json'), encoding='utf-8'))['sites']:
        if 'nasa' not in s:
            continue
        lat, lon = s['lat'] * D2R, s['lon'] * D2R
        # Like for like with NASA's maps (made from a 60 m model, observer on the ground): the 80 m model only.
        h0, elev, _, _ = horizon(terrain, lat, lon, 0.5, DIST_COARSE, masts=(0.0,))
        v = visibility(lat, lon, h0, elev[0], 0.5)
        entry = {'id': s['id'], 'sun': round(v['sun'], 3), 'earth': round(v['earth'], 3), **s['nasa']}
        # What the planner uses: the stored profile (5 m model near the site where one exists), at each height.
        prof = json.load(open(os.path.join(OUT, 'horizons', s['id'] + '.json'), encoding='utf-8'))
        entry['model'] = s['horizon']
        entry['sunByHeight'] = [round(visibility(lat, lon, prof['elevationM'] + m, np.array(prof['elevDeg'][k]), prof['stepDeg'])['sun'], 3) for k, m in enumerate(prof['mastsM'])]
        sites.append(entry)

    report = {
        'generated': datetime.date.today().isoformat(),
        'reference': 'NASA LOLA average illumination maps AVGVISIB_85S_060M_201608 (Sun and Earth), 60 m/pixel',
        'method': 'Fraction of hourly time steps over four draconic years (from 2027-01-01) in which any part of the disc '
                  'is above our terrain horizon, observer on the ground, compared with the same pixel of the NASA map.',
        'regional': {
            'description': '144 points on a 3 km grid covering 33 x 33 km around the Shackleton - de Gerlache connecting ridge',
            'sun': stats(regional[:, 0], regional[:, 1]), 'earth': stats(regional[:, 3], regional[:, 4]),
            'pointsSun': np.round(regional[:, [1, 0]], 3).tolist(), 'pointsEarth': np.round(regional[:, [4, 3]], 3).tolist(),
        },
        'fine': {
            'description': '121 points on a 180 m grid on the ridge: pixel against pixel, and against the 3 x 3 pixel mean of the NASA map',
            'sunPixel': stats(fine[:, 0], fine[:, 1]), 'sunArea': stats(fine[:, 0], fine[:, 2]),
        },
        'sites': sites,
    }
    dump(os.path.join(OUT, 'validation.json'), report)
    for key in ('sun', 'earth'):
        print('regional', key, report['regional'][key])
    print('fine pixel', report['fine']['sunPixel'])
    print('fine area ', report['fine']['sunArea'])
    for s in sites:
        print(f"{s['id']:17s} sun ours {s['sun']:.3f} NASA {s['sunVisibility']:.3f} (3x3 {s['sunVisibility3x3']:.3f})"
              f" | earth ours {s['earth']:.3f} NASA {s['earthVisibility']:.3f} (3x3 {s['earthVisibility3x3']:.3f})"
              f" | planner profile, any part of the Sun at 0 / 2 / 10 m: {s['sunByHeight']}")
    print(f'done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
