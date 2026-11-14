"""Self-checks of the offline geometry.  Usage: python -X utf8 tools/selftest.py"""
from __future__ import annotations

import math
import sys

import numpy as np

from lunar import D2R, R_M, PolarGrid, Terrain, destination, horizon


class Flat:
    """A perfectly smooth sphere."""

    def height(self, lat, lon):
        return np.zeros(lat.shape)

    def height_at(self, lat, lon):
        return 0.0


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    failures = 0

    def check(name, ok, detail):
        nonlocal failures
        failures += 0 if ok else 1
        print(('ok   ' if ok else 'FAIL ') + name + ': ' + detail)

    # Horizon of a smooth sphere seen from a 2 m mast: -acos(R / (R + 2)) = -0.0869 degrees.
    _, elev, far, _ = horizon(Flat(), -85 * D2R, 30 * D2R, 1.0, masts=(0.0, 2.0))
    dip = -math.degrees(math.acos(R_M / (R_M + 2)))
    check('smooth sphere, 2 m mast', abs(elev[1].mean() - dip) < 0.002 and np.ptp(elev[1]) < 1e-6,
          f'{elev[1].mean():.4f} deg, expected {dip:.4f}; set by ground {far[1].mean():.2f} km away')

    # Projection round trip on the 80 m grid.
    grid = PolarGrid('ldem_80s_80m')
    lat, lon = grid.latlon(1234, 5678)
    i, j = grid.ij(lat, lon)
    check('projection round trip', abs(i - 1234) < 1e-6 and abs(j - 5678) < 1e-6, f'({float(i):.6f}, {float(j):.6f})')

    # A point 250 m away is 250 m away.
    la, lo = destination(-89.4 * D2R, 20 * D2R, 70 * D2R, 250.0)
    a = np.array([math.cos(-89.4 * D2R) * math.cos(20 * D2R), math.cos(-89.4 * D2R) * math.sin(20 * D2R), math.sin(-89.4 * D2R)])
    b = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    dist = math.acos(float(np.clip(a @ b, -1, 1))) * R_M
    check('great-circle destination', abs(dist - 250) < 0.5, f'{dist:.2f} m')

    # Elevation read at two real landing sites against the radius published by LROC.
    terrain = Terrain()
    for name, la_d, lo_d, lroc in (('IM-1 Odysseus', -80.1276, 1.4367, 2580), ('IM-2 Athena', -84.7906, 29.1957, 5321)):
        h = terrain.height_at(la_d * D2R, lo_d * D2R)
        check(f'elevation at {name}', abs(h - lroc) <= 10, f'{h:.0f} m, LROC {lroc} m')

    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
