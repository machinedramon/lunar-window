"""Downloads reference tables from JPL Horizons for the ephemeris tests.

Usage (from the repository root):  python -X utf8 tools/fetch_golden.py

Each file in tests/golden/ holds the apparent azimuth, elevation and angular diameter of the Sun
and of the Earth seen from one point of the lunar surface (airless, MOON_ME frame, sphere of
1737.4 km), as computed by the JPL Horizons System. The browser ephemeris is tested against them.
"""
from __future__ import annotations

import datetime
import json
import os
import sys

from lunar import ROOT, horizons_table

CASES = [
    # name, latitude, east longitude, start, stop, step
    ('south-pole-ridge-2027', -89.45, 222.69, '2027-01-01', '2027-03-01', '6 h'),
    ('malapert-2031', -85.9919, 2.0564, '2031-09-01', '2031-10-15', '6 h'),
    ('im1-odysseus-2024', -80.1276, 1.4367, '2024-02-20', '2024-03-05', '3 h'),
    ('change-6-2024', -41.6383, 206.0143, '2024-05-25', '2024-06-25', '6 h'),
    ('apollo-11-2028', 0.67416, 23.47314, '2028-06-01', '2028-07-15', '6 h'),
    ('apollo-11-1969', 0.67416, 23.47314, '1969-07-18', '1969-07-26', '2 h'),
    ('blue-ghost-eclipse-2025', 18.5622, 61.8102, '2025-03-13', '2025-03-15', '1 h'),
]


def iso(stamp: str) -> str:
    return datetime.datetime.strptime(stamp.strip(), '%Y-%b-%d %H:%M').strftime('%Y-%m-%dT%H:%MZ')


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    out = os.path.join(ROOT, 'tests', 'golden')
    os.makedirs(out, exist_ok=True)
    for name, lat, lon_e, start, stop, step in CASES:
        doc = {
            'source': 'JPL Horizons System API (ssd.jpl.nasa.gov), observer on the lunar surface: CENTER=coord@301, '
                      'geodetic coordinates, height 0, quantities 4 (apparent azimuth and elevation) and 13 (angular diameter)',
            'site': {'lat': lat, 'lonE': lon_e},
            'columns': ['time (UTC)', 'azimuth (deg)', 'elevation (deg)', 'angular diameter (arcsec)'],
        }
        for key, body in (('sun', '10'), ('earth', '399')):
            table, stamps = horizons_table(body, lon_e, lat, start, stop, step)
            doc[key] = [[iso(s), round(float(r[0]), 6), round(float(r[1]), 6), round(float(r[2]), 3)] for s, r in zip(stamps, table)]
        with open(os.path.join(out, name + '.json'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(doc, separators=(',', ':')) + '\n')
        print(f'{name}: {len(doc["sun"])} rows')


if __name__ == '__main__':
    main()
