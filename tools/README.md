# Offline tools

Python 3.12 with numpy. Run everything from the repository root, with `python -X utf8` on Windows.

| Script | What it does |
|---|---|
| `build_horizon.py` | Reads `tools/sites.src.json` and the LOLA rasters; writes `public/data/sites.json` and the horizon profiles in `public/data/horizons/`. About four minutes. |
| `build_terrain.py` | Writes the terrain tiles of the 3D view, `public/data/terrain/<id>.bin`: four nested grids per site. |
| `validate_horizon.py` | Compares our horizon with NASA's LOLA average-illumination maps on a mesh of points; writes `public/data/validation.json`. About two minutes; the first run also downloads Sun and Earth tables from JPL Horizons. |
| `fetch_golden.py` | Downloads the JPL Horizons tables used by the ephemeris tests (`tests/golden`). |
| `build_assets.py` | Prepares the third-party 3D assets (rocks, textures) for the web. |
| `selftest.py` | Checks the geometry: smooth-sphere horizon, projection, distances, elevation at two real landing sites. |
| `lunar.py` | Shared code: polar rasters, 5 m site models, great-circle horizon, JPL Horizons tables. |
| `shot.mjs`, `shot3d.mjs` | Development only: screenshots of the running app. |

`build_horizon.py` and `build_terrain.py` need `tifffile`; `build_assets.py` needs `Pillow`.

## Source rasters

Download these into `data/raw/` (not kept in the repository; about 900 MB):

From the NASA PDS Geosciences Node, `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/`:

- `ldem_80s_80m.img` and `.lbl` — elevation, 80 m/pixel, pole to 80°S
- `ldem_60s_240m.img` and `.lbl` — elevation, 240 m/pixel, pole to 60°S

From the LOLA team at `https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/` (save the labels with a lower-case `.lbl` and the images with `.img`):

- `AVGVISIB_85S_060M_201608.IMG` and `.LBL` — average visibility of the Sun
- `AVGVISIB_85S_060M_201608_EARTH.IMG` and `.LBL` — average visibility of the Earth

From NASA GSFC's PGDA, `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/<ID>/<ID>_final_adj_5mpp_surf.tif`, into `data/raw/pgda5m/<ID>.tif`,
for the IDs `Site01`, `Site04`, `Site06`, `Site20`, `Site23`, `SL2` and `Haworth` (5 m/pixel site models).

The NASA 3D models were re-encoded with glTF-Transform, keeping every triangle:

```bash
npx @gltf-transform/cli optimize "Space Exploration Vehicle.glb" public/models/sev.glb   --compress meshopt --texture-compress webp --texture-size 2048 --simplify false
```

## Method

For each of 1440 true azimuths (0.25° apart) the terrain is sampled along a great circle, every 40 m out to
100 km and every 120 m out to 300 km. Where a 5 m site model exists the sampling near the site is finer
(2.5 m steps to 1 km, 10 m steps to 5 km) and starts 10 m away: closer ground is within the footprint of a
lander and below the fidelity of the model. The elevation angle of each terrain point is computed exactly on the
sphere, `atan2((R + h)·cos d − ρ0, (R + h)·sin d)`, so the curvature of the Moon is included; the horizon is
the maximum. Three observer heights are stored: 0, 2 and 10 m above the ground.

Two published high-illumination points (Connecting Ridge and Shackleton rim) are given in the literature with
two decimals and came from a 240 m model. For those, the site point is the best-lit spot within 1.5 km in
NASA's 60 m illumination map; the published coordinates are kept in `sites.json`.
