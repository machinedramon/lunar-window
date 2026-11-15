# Offline tools

Python 3.12 with numpy. Run everything from the repository root, with `python -X utf8` on Windows.

| Script | What it does |
|---|---|
| `build_horizon.py` | Reads `tools/sites.src.json` and the LOLA rasters; writes `public/data/sites.json` and the horizon profiles in `public/data/horizons/`. About four minutes. |
| `build_terrain.py` | Writes the terrain tiles of the 3D view, `public/data/terrain/<id>.bin`: four nested grids per site. |
| `validate_horizon.py` | Compares our horizon with NASA's LOLA average-illumination maps on a mesh of points; writes `public/data/validation.json`. About two minutes; the first run also downloads Sun and Earth tables from JPL Horizons. |
| `fetch_golden.py` | Downloads the JPL Horizons tables used by the ephemeris tests (`tests/golden`). |
| `build_assets.py` | Prepares the third-party 3D assets (rocks, textures) for the web. |
| `build_polar.py` | Writes `public/data/polar/`: the elevation model the browser uses for any point of the visitor's own, from the pole to 84°S (80 m tiles and a 480 m grid, 28 MB in all). |
| `check_polar.py` | Measures that model against the full NASA models and against the listed sites; writes the reference of `tests/core/polar.test.ts` and the `anyPoint` block of `public/data/validation.json`. |
| `selftest.py` | Checks the geometry: smooth-sphere horizon, projection, distances, elevation at two real landing sites. |
| `lunar.py` | Shared code: polar rasters, 5 m site models, great-circle horizon, JPL Horizons tables. |
| `shot.mjs`, `shot3d.mjs` | Development only: screenshots of the running app. |

`build_horizon.py` and `build_terrain.py` need `tifffile`; `build_assets.py` needs `Pillow`.

## Source rasters

Download these into `data/raw/` (not kept in the repository; about 900 MB):

From the NASA PDS Geosciences Node, `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/`:

- `ldem_80s_80m.img` and `.lbl` — elevation, 80 m/pixel, pole to 80°S
- `ldem_60s_240m.img` and `.lbl` — elevation, 240 m/pixel, pole to 60°S
- `ldem_75s_240m.img` and `.lbl` — elevation, 240 m/pixel, pole to 75°S (for `build_polar.py`)

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

## Any point

The listed sites have horizons computed offline. A point of the visitor's own, from the pole to 84°S, is computed
in the browser by `src/core/polar.ts` (a port of `lunar.horizon`, in a web worker) from `public/data/polar`:
the nine 20.5 km tiles of `ldem_80s_80m` around the point, and `ldem_75s_240m` averaged to 480 m for the rest.

```bash
python -X utf8 tools/build_polar.py     # public/data/polar (18 s)
python -X utf8 tools/check_polar.py     # the measurements below, and the reference of the TypeScript test
npm test                                # src/core/polar.ts against that reference, within 0.001 degrees
```

Measured: against the full models (80 m to 80°S, 240 m beyond) on 40 random points, the horizon differs by 0.002°
on average, 0.014° at the 95th percentile, 0.11° at most. Against the listed sites that have a 5 m model, the
horizon seen from 2 m above the ground differs by 0.03° to 1.3° on average: on a sharp crest the last metres
decide, and the 80 m model does not see them. The Accuracy page says so.

## The demo film

The film is a recording of the tool itself, one per language (English, Portuguese, Spanish). Nothing in it is
drawn by hand: a headless browser opens the dev server, drives the interface and saves every frame.

```bash
npm run dev                                  # the film is recorded from http://localhost:5700
python -X utf8 tools/film_audio.py en        # soundtrack + the time of every cut -> video/audio.en.wav, video/voice/en/marks.json
FILM_LANG=en node tools/film.mjs             # the frames -> video/frames (video/frames-pt, video/frames-es)
python -X utf8 tools/film_build.py en        # video/lunar-window-demo.en.mp4 and its .srt
```

- `film_audio.py` computes the music (no recording is used) and lays the narration over it. The narration is an
  AI-generated voice (OpenAI text-to-speech), one take per language in `video/voice/<lang>/narration.wav`, with
  the time of its nine segments in `segments.json`; the cuts, subtitles and the length of the film follow it.
- `film.mjs` opens the page with `?lang=`, so the interface, the captions and the credits are in that language.
  `SHOTS=7` records one shot again; `EVERY=30` records a sparse preview. Do not edit `src/` while it records:
  the dev server would reload the page.
- `film_build.py` needs ffmpeg. It writes the AI-voice notice into the file's metadata.

The `video/` folder is not in the repository.

## Checks that look at the screen

Small Playwright scripts (Edge channel) used during development; each prints what it found and saves captures
under `video/`: `wraps.mjs` (text that wraps or is cut, per language and window size), `states.mjs` (layout that
moves between states), `flicker.mjs` (consecutive frames of a still screen), `hitch.mjs` and `fps.mjs` (stalls
and frame rate), `wheels.mjs` (the vehicle resting on the terrain), `eclipse.mjs` (the Sun behind the Earth
through a long lens).
