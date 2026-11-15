"""Shared geometry for the offline tools.

LOLA polar rasters, terrain horizon by great-circle marching, and Sun/Earth
directions from JPL Horizons. Only numpy and the standard library are used.

Conventions: latitudes and longitudes in radians inside this module, east
positive, MOON_ME frame, sphere of radius 1737.4 km. Azimuth is true azimuth,
measured from north towards east.
"""
from __future__ import annotations

import os
import re
import urllib.parse
import urllib.request

import numpy as np

R_M = 1737400.0
AU_KM = 149597870.7
D2R = np.pi / 180
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')


class PolarGrid:
    """A PDS3 raster in south polar stereographic projection (pixel registration)."""

    def __init__(self, basename: str):
        label = open(os.path.join(RAW, basename + '.lbl'), encoding='latin-1').read()
        self.name = basename
        self.n = int(re.search(r'LINE_SAMPLES\s*=\s*(\d+)', label).group(1))
        self.step = float(re.search(r'MAP_SCALE\s*=\s*([\d.]+)', label).group(1))
        self.scale = float(re.search(r'SCALING_FACTOR\s*=\s*([\d.eE+-]+)', label).group(1))
        mm = np.memmap(os.path.join(RAW, basename + '.img'), dtype='<i2', mode='r', shape=(self.n, self.n))
        self.a = np.array(mm)  # in memory: random access is much faster than through the map

    def ij(self, lat, lon):
        """Fractional column and row of a point."""
        r = 2 * R_M * np.tan((np.pi / 2 + lat) / 2)
        return r * np.sin(lon) / self.step + self.n / 2 - 0.5, self.n / 2 - 0.5 - r * np.cos(lon) / self.step

    def latlon(self, i, j):
        """Centre of pixel (column i, row j)."""
        x = (i + 0.5 - self.n / 2) * self.step
        y = (self.n / 2 - 0.5 - j) * self.step
        return 2 * np.arctan(np.hypot(x, y) / (2 * R_M)) - np.pi / 2, np.arctan2(x, y)

    def nearest(self, lat, lon):
        i, j = self.ij(np.float64(lat), np.float64(lon))
        return int(round(float(i))), int(round(float(j)))

    def inside(self, i, j, margin=0):
        return margin <= i < self.n - margin and margin <= j < self.n - margin

    def value(self, i, j):
        return float(self.a[j, i]) * self.scale

    def sample(self, lat, lon):
        """Bilinear sample; NaN outside the raster."""
        i, j = self.ij(lat, lon)
        i0 = np.floor(i).astype(np.int64)
        j0 = np.floor(j).astype(np.int64)
        ok = (i0 >= 0) & (i0 < self.n - 1) & (j0 >= 0) & (j0 < self.n - 1)
        out = np.full(lat.shape, np.nan)
        ii, jj = i0[ok], j0[ok]
        fi, fj = i[ok] - ii, j[ok] - jj
        a = self.a
        out[ok] = (a[jj, ii] * (1 - fi) * (1 - fj) + a[jj, ii + 1] * fi * (1 - fj)
                   + a[jj + 1, ii] * (1 - fi) * fj + a[jj + 1, ii + 1] * fi * fj) * self.scale
        return out


class GeoGrid:
    """A raster of the whole Moon in latitude and longitude (simple cylindrical, pixel registration):
    the first pixel is centred half a pixel from 90 N, 0 E; longitude grows to the east. Never NaN."""

    def __init__(self, a: np.ndarray, ppd: float, scale: float = 0.5, name: str = 'global'):
        self.a, self.ppd, self.scale, self.name = a, ppd, scale, name
        self.h, self.w = a.shape

    @classmethod
    def from_pds(cls, basename: str) -> 'GeoGrid':
        label = open(os.path.join(RAW, basename + '.lbl'), encoding='latin-1').read()
        w = int(re.search(r'LINE_SAMPLES\s*=\s*(\d+)', label).group(1))
        h = int(re.search(r'^\s*LINES\s*=\s*(\d+)', label, re.M).group(1))
        ppd = float(re.search(r'MAP_RESOLUTION\s*=\s*([\d.]+)', label).group(1))
        scale = float(re.search(r'SCALING_FACTOR\s*=\s*([\d.eE+-]+)', label).group(1))
        return cls(np.array(np.memmap(os.path.join(RAW, basename + '.img'), dtype='<i2', mode='r', shape=(h, w))), ppd, scale, basename)

    def coarser(self, factor: int) -> 'GeoGrid':
        """Block mean, in the same counts."""
        h, w = self.h // factor, self.w // factor
        a = np.rint(self.a.reshape(h, factor, w, factor).mean(axis=(1, 3), dtype=np.float32)).astype('<i2')
        return GeoGrid(a, self.ppd / factor, self.scale, f'{self.name}/{factor}')

    def sample(self, lat, lon):
        """Bilinear sample at latitudes and longitudes in radians; wraps in longitude, holds at the poles."""
        x = np.mod(np.degrees(lon) * self.ppd - 0.5, self.w)
        y = np.clip((90.0 - np.degrees(lat)) * self.ppd - 0.5, 0, self.h - 1)
        i0 = np.floor(x).astype(np.int64)
        j0 = np.minimum(np.floor(y).astype(np.int64), self.h - 2)
        i1 = np.where(i0 + 1 == self.w, 0, i0 + 1)
        fi, fj = x - i0, y - j0
        a = self.a
        return ((a[j0, i0] * (1 - fi) + a[j0, i1] * fi) * (1 - fj) + (a[j0 + 1, i0] * (1 - fi) + a[j0 + 1, i1] * fi) * fj) * self.scale


class FineGrid:
    """A 5 m/pixel site elevation model from NASA GSFC's PGDA (GeoTIFF, same south polar stereographic
    projection, metres above the 1737.4 km sphere). Needs the tifffile and imagecodecs packages."""

    def __init__(self, site_id: str):
        import tifffile

        with tifffile.TiffFile(os.path.join(RAW, 'pgda5m', site_id + '.tif')) as tif:
            page = tif.pages[0]
            self.a = page.asarray().astype(np.float32)
            scale = page.tags['ModelPixelScaleTag'].value
            tie = page.tags['ModelTiepointTag'].value
            nodata = page.tags.get('GDAL_NODATA')
        if nodata is not None:
            try:
                self.a[self.a == np.float32(float(str(nodata.value).strip().rstrip('\x00')))] = np.nan
            except ValueError:
                pass
        self.a[np.abs(self.a) > 30000] = np.nan
        self.name = 'pgda_5m_' + site_id.lower()
        self.step = float(scale[0])
        # Projected coordinates (metres) of the outer corner of the first pixel.
        self.x0 = float(tie[3]) - float(tie[0]) * self.step
        self.y0 = float(tie[4]) + float(tie[1]) * self.step
        self.rows, self.cols = self.a.shape

    def sample(self, lat, lon):
        r = 2 * R_M * np.tan((np.pi / 2 + lat) / 2)
        i = (r * np.sin(lon) - self.x0) / self.step - 0.5
        j = (self.y0 - r * np.cos(lon)) / self.step - 0.5
        i0 = np.floor(i).astype(np.int64)
        j0 = np.floor(j).astype(np.int64)
        ok = (i0 >= 0) & (i0 < self.cols - 1) & (j0 >= 0) & (j0 < self.rows - 1)
        out = np.full(lat.shape, np.nan)
        ii, jj = i0[ok], j0[ok]
        fi, fj = i[ok] - ii, j[ok] - jj
        a = self.a
        out[ok] = a[jj, ii] * (1 - fi) * (1 - fj) + a[jj, ii + 1] * fi * (1 - fj) + a[jj + 1, ii] * (1 - fi) * fj + a[jj + 1, ii + 1] * fi * fj
        return out


class Terrain:
    """Elevation above the 1737.4 km sphere: a 5 m site model where one exists, then the 80 m model
    near the pole, then the 240 m model beyond it."""

    DEMS = ['ldem_80s_80m', 'ldem_60s_240m']
    _shared = None

    def __init__(self, fine: FineGrid | None = None):
        if Terrain._shared is None:
            Terrain._shared = [PolarGrid(n) for n in self.DEMS]
        self.grids = ([fine] if fine else []) + Terrain._shared
        self.names = [g.name for g in self.grids]

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


class GlobalTerrain:
    """The whole Moon from NASA's global model ldem_64 (474 m at the equator): for the sites the polar models do not reach."""

    names = ['ldem_64']
    _grid = None

    def __init__(self):
        if GlobalTerrain._grid is None:
            GlobalTerrain._grid = GeoGrid.from_pds('ldem_64')

    def height(self, lat, lon):
        return GlobalTerrain._grid.sample(lat, lon)

    def height_at(self, lat, lon):
        return float(self.height(np.array([lat]), np.array([lon]))[0])


def destination(lat, lon, azimuth, distance_m):
    """Point reached from (lat, lon) along a great circle."""
    d = distance_m / R_M
    lat2 = np.arcsin(np.clip(np.sin(lat) * np.cos(d) + np.cos(lat) * np.sin(d) * np.cos(azimuth), -1, 1))
    lon2 = lon + np.arctan2(np.sin(azimuth) * np.sin(d) * np.cos(lat), np.cos(d) - np.sin(lat) * np.sin(lat2))
    return lat2, lon2


# Sampling distances along each azimuth: 40 m steps to 100 km, 120 m steps to 300 km.
DIST_FULL = np.concatenate([np.arange(40.0, 100e3, 40.0), np.arange(100e3, 300e3 + 1, 120.0)])
# With a 5 m site model: 2.5 m steps to 1 km and 10 m steps to 5 km, then as above. Terrain closer than
# 10 m is left out: it is within the footprint of a lander and below the fidelity of the model (most
# 5 m pixels are interpolated between laser tracks), yet it would decide the horizon of a ground-level observer.
DIST_FINE = np.concatenate([np.arange(10.0, 1000.0, 2.5), np.arange(1000.0, 5000.0, 10.0), np.arange(5000.0, 100e3, 40.0),
                            np.arange(100e3, 300e3 + 1, 120.0)])
# For the global model (474 m at the equator): 120 m steps to 100 km, 480 m steps to 300 km.
DIST_GLOBAL = np.concatenate([np.arange(120.0, 100e3, 120.0), np.arange(100e3, 300e3 + 1, 480.0)])
# Coarser sampling for the many-point validation mesh.
DIST_COARSE = np.concatenate([np.arange(80.0, 100e3, 80.0), np.arange(100e3, 300e3 + 1, 240.0)])


def horizon(terrain, lat, lon, step_deg=0.25, dist=DIST_FULL, masts=(0.0, 2.0, 10.0)):
    """Terrain horizon around a point.

    Returns (site elevation in m, elevation of the horizon in degrees [mast, azimuth],
    distance in km of the terrain point that sets it [mast, azimuth],
    fraction of samples with no elevation data).

    The elevation angle of a terrain point at central angle d and radius rho, seen
    from radius rho0, is atan2(rho*cos d - rho0, rho*sin d): exact on a sphere, so the
    curvature is included. Values are never clamped at zero.
    """
    h0 = terrain.height_at(lat, lon)
    az = np.arange(0, 360, step_deg) * D2R
    d = (dist / R_M)[None, :]
    cd, sd = np.cos(d), np.sin(d)
    elev = np.empty((len(masts), az.size))
    far = np.empty((len(masts), az.size))
    nodata = 0
    block = 120
    for c in range(0, az.size, block):
        a = az[c:c + block, None]
        lat2 = np.arcsin(np.clip(np.sin(lat) * cd + np.cos(lat) * sd * np.cos(a), -1, 1))
        lon2 = lon + np.arctan2(np.sin(a) * sd * np.cos(lat), cd - np.sin(lat) * np.sin(lat2))
        h = terrain.height(lat2, lon2)
        bad = np.isnan(h)
        nodata += int(bad.sum())
        rho = R_M + np.where(bad, -20000.0, h)
        for k, mast in enumerate(masts):
            e = np.arctan2(rho * cd - (R_M + h0 + mast), rho * sd)
            idx = e.argmax(axis=1)
            elev[k, c:c + block] = e[np.arange(e.shape[0]), idx] / D2R
            far[k, c:c + block] = dist[idx] / 1000
    return h0, elev, far, nodata / (az.size * dist.size)


# ---------- Sun and Earth as seen from the surface (JPL Horizons) ----------

def horizons_table(body, lon_e_deg, lat_deg, start, stop, step='1 h', cache_dir=None):
    """Azimuth, elevation, angular diameter (arcsec) and range (au) of a body seen from a lunar site.

    One row per time step, from the JPL Horizons API. Responses are cached on disk.
    """
    cache_dir = cache_dir or os.path.join(RAW, 'horizons')
    os.makedirs(cache_dir, exist_ok=True)
    tag = re.sub(r'[^0-9A-Za-z.-]+', '_', f'{body}_{lon_e_deg}_{lat_deg}_{start}_{stop}_{step}')
    path = os.path.join(cache_dir, tag + '.txt')
    if os.path.exists(path):
        text = open(path, encoding='utf-8').read()
    else:
        params = {
            'format': 'text', 'COMMAND': f"'{body}'", 'OBJ_DATA': "'NO'", 'MAKE_EPHEM': "'YES'",
            'EPHEM_TYPE': "'OBSERVER'", 'CENTER': "'coord@301'", 'COORD_TYPE': "'GEODETIC'",
            'SITE_COORD': f"'{lon_e_deg},{lat_deg},0'", 'START_TIME': f"'{start}'", 'STOP_TIME': f"'{stop}'",
            'STEP_SIZE': f"'{step}'", 'QUANTITIES': "'4,13,20'", 'CSV_FORMAT': "'YES'",
        }
        url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        text = urllib.request.urlopen(url, timeout=240).read().decode()
        if '$$SOE' not in text:
            raise RuntimeError('JPL Horizons request failed: ' + text[:600])
        open(path, 'w', encoding='utf-8').write(text)
    lines = text.split('\n')
    s = next(i for i, l in enumerate(lines) if l.startswith('$$SOE'))
    e = next(i for i, l in enumerate(lines) if l.startswith('$$EOE'))
    head = [c.strip() for c in lines[next(i for i in range(s, 0, -1) if 'Date__(UT)' in lines[i])].split(',')]
    cols = [next(i for i, c in enumerate(head) if c.startswith(p)) for p in ('Azi', 'Elev', 'Ang-diam')]
    cols.append(head.index('delta'))
    rows = [l.split(',') for l in lines[s + 1:e]]
    return np.array([[float(r[c]) for c in cols] for r in rows]), [r[0].strip() for r in rows]


def basis(lat, lon):
    """Unit vectors up, east and north of a site, in the Moon-fixed frame."""
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    return up, east, north


def to_moon_fixed(table, lat, lon):
    """Moon-centred position (km) of the body, from azimuth/elevation/range seen at a site on the sphere."""
    az, el = table[:, 0] * D2R, table[:, 1] * D2R
    up, east, north = basis(lat, lon)
    u = np.cos(el)[:, None] * (np.cos(az)[:, None] * north + np.sin(az)[:, None] * east) + np.sin(el)[:, None] * up
    return u * (table[:, 3] * AU_KM)[:, None] + up * (R_M / 1000)


def az_el(position_km, lat, lon, height_m):
    """Azimuth and elevation (degrees) of a Moon-centred position seen from a site."""
    up, east, north = basis(lat, lon)
    v = position_km - up * ((R_M + height_m) / 1000)
    v = v / np.linalg.norm(v, axis=1)[:, None]
    return np.arctan2(v @ east, v @ north) / D2R % 360, np.arcsin(v @ up) / D2R


def disc_fraction(az, el, diameter_arcsec, profile, step_deg, columns=21):
    """Fraction of a disc above the horizon profile, by vertical columns across the disc."""
    rho = diameter_arcsec / 3600 / 2
    x = ((np.arange(columns) + 0.5) / columns * 2 - 1)[None, :] * rho[:, None]
    half = np.sqrt(np.maximum(rho[:, None] ** 2 - x ** 2, 0))
    azq = (az[:, None] + x / np.cos(el * D2R)[:, None]) % 360
    hq = np.interp(azq, np.arange(profile.size + 1) * step_deg, np.append(profile, profile[0]))
    visible = np.clip(el[:, None] + half - hq, 0, 2 * half)
    return visible.sum(1) / (2 * half).sum(1)
