# Offline tools

Python 3.12 with numpy. Run everything from the repository root, with `python -X utf8` on Windows.

| Script | What it does |
|---|---|
| `build_horizon.py` | Reads `tools/sites.src.json` and the LOLA rasters; writes `public/data/sites.json` and the horizon profiles in `public/data/horizons/`. About two minutes. |
| `validate_horizon.py` | Compares our horizon with NASA's LOLA average-illumination maps on a mesh of points; writes `public/data/validation.json`. About two minutes; the first run also downloads Sun and Earth tables from JPL Horizons. |
| `selftest.py` | Checks the geometry: smooth-sphere horizon, projection, distances, elevation at two real landing sites. |
| `lunar.py` | Shared code: polar rasters, great-circle horizon, JPL Horizons tables. |

## Source rasters

Download these into `data/raw/` (not kept in the repository; about 420 MB):

From the NASA PDS Geosciences Node, `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/`:

- `ldem_80s_80m.img` and `.lbl` — elevation, 80 m/pixel, pole to 80°S
- `ldem_60s_240m.img` and `.lbl` — elevation, 240 m/pixel, pole to 60°S

From the LOLA team at `https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/` (save the labels with a lower-case `.lbl` and the images with `.img`):

- `AVGVISIB_85S_060M_201608.IMG` and `.LBL` — average visibility of the Sun
- `AVGVISIB_85S_060M_201608_EARTH.IMG` and `.LBL` — average visibility of the Earth

## Method

For each of 1440 true azimuths (0.25° apart) the terrain is sampled along a great circle, every 40 m out to
100 km and every 120 m out to 300 km. The elevation angle of each terrain point is computed exactly on the
sphere, `atan2((R + h)·cos d − ρ0, (R + h)·sin d)`, so the curvature of the Moon is included; the horizon is
the maximum. Three observer heights are stored: 0, 2 and 10 m above the ground.

Two published high-illumination points (Connecting Ridge and Shackleton rim) are given in the literature with
two decimals and came from a 240 m model. For those, the site point is the best-lit spot within 1.5 km in
NASA's 60 m illumination map; the published coordinates are kept in `sites.json`.
