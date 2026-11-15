# Lunar Window

**When the launch slips, see what still works.** A landing-window planner for the lunar south pole.

Built for the NASA Space Apps Challenge 2026, challenge *Lunar Landing Site Navigator*.

**Open it: https://machinedramon.github.io/lunar-window/**

![Explore: standing at Malapert Massif, with the Earth over the skyline, the readings on the right and the time dock below](docs/img/stand-there.jpg)

| | |
|---|---|
| ![A ridge takes the Sun, seen through a long lens](docs/img/ridge.jpg) | ![The night sky over the Moon: catalogue stars and the Milky Way](docs/img/night-sky.jpg) |
| *One ridge decides: the Sun is a disc of its true size, and the terrain is NASA's.* | *When the Sun is hidden the real sky comes out: Yale catalogue stars, the planets, NASA's Milky Way.* |

![Plan a mission: requirements on the left, the launch slip, the map of the south pole and the landing-window calendar, in one screen](docs/img/planner.jpg)

Most tools ask you to pick a landing site and a date, then show you the sky. Lunar Window starts from
what a mission needs — sunlight at landing, hours of continuous power, Earth in view for
communication — and shows every site and day that works across a year. When the launch date moves,
it shows which sites survive, which fail, and why.

## What is in it

- **Explore** — pick a site and a moment; stand there in 3D, or read the 360° panorama and the 30-day timeline. Seven real landings can be replayed.
- **Any point of the Moon** — type a latitude and longitude, or click the map of the south pole: the point gets its real terrain, computed in your browser from NASA's LOLA elevation models in a few seconds — its horizon, its 3D view, its row in the landing-window calendar. The model is 80 m per pixel from the south pole to 82°S and 474 m everywhere else. No site and no point uses a smooth Moon.
- **Check with NASA** — the site file gives the azimuth and elevation of the Sun and the Earth to a thousandth of a degree, with a link that asks NASA's JPL Horizons System the same question for that place and moment.
- **Plan a mission** — requirements in, landing windows out, for 15 sites over a year; slip the launch and see what survives, and why. A map of the south pole shows the sites on NASA's relief, with the permanently shadowed ground in black.
- **Compare** — up to four options side by side.
- **Missions** — three planning problems to play, scored on real quantities.
- **Accuracy** — the measured errors against NASA data, and the limits of the model.
- **Three languages** — English (the default), Portuguese and Spanish, one click apart in the top bar. Nothing reloads: the 3D view stays where it is and the words change around it.

Built during the hackathon weekend (14–15 November 2026).

## How it works

- **Terrain horizon.** For each site, an offline Python tool reads NASA LOLA elevation models
  and computes the elevation of the terrain horizon in 1440 directions, for observers 0, 2 and 10 m
  above the ground.
- **Sun and Earth.** The browser computes where the Sun and the Earth are, as seen from the site,
  with [astronomy-engine](https://github.com/cosinekitty/astronomy). No server is involved.
- **Planner.** Mission requirements are checked against the horizon for every landing day.
- **Any point.** For a point of the visitor's own the same horizon method runs in a web worker
  (`src/core/polar.ts`) on NASA's models cut in pieces that the browser fetches on demand: near the south
  pole the polar model (80 m per pixel around the point, 480 m beyond; `tools/build_polar.py`), everywhere
  else the global model `ldem_64`, unchanged (474 m per pixel; `tools/build_global.py`). Measured, and shown
  on the Accuracy page: the polar pieces differ from the full polar models by 0.002° on average; the global
  pieces are identical to the global model, which itself differs from the finer polar models by 0.19° at the
  median (several degrees on steep ground, where slopes shorter than 474 m decide).
- **Stand there.** A first-person 3D view from the site: the real LOLA terrain (5 m near seven of the
  sites) with shadows marched through the elevation data, and the Sun and the Earth at their true
  positions, sizes, phase and rotation.

Accuracy is measured against NASA products (JPL Horizons and the LOLA average-illumination maps) and
published with the tool, including where it does not hold.

## Run it

```bash
npm install
npm run dev      # http://localhost:5700
npm test
npm run build
```

Rebuilding the horizon profiles needs Python 3.12 with numpy and the NASA source rasters; see
[`tools/README.md`](tools/README.md).

## Data and references

All external data, code and reading are listed in [`docs/REFERENCES.md`](docs/REFERENCES.md).

## Use of AI

An AI coding assistant (a large language model) was used throughout this project: to research NASA
data sources, the rules and prior work; to propose and compare design options; and to generate most of
the code, the tests and the documentation. The team member chose the challenge, chose among the options
proposed and set the direction, reviewed the work on screen at every step and decided what to keep.

All numerical results were validated against NASA data (JPL Horizons tables and LOLA illumination maps);
the measured errors are published on the Accuracy page of the tool.

In the tool itself nothing is an AI-generated image, video or sound: the visuals are rendered in real
time from NASA data and open-licensed 3D assets, and the sounds are synthesised by code. The demo video
(30 seconds in English; a few seconds longer in Portuguese and Spanish) is a recording of the tool; its
narration is an AI-generated voice (OpenAI text-to-speech) reading a script in each language, as the
closing credits and the file metadata state, and its music is synthesised by code (`tools/film_audio.py`).
The Portuguese and Spanish texts of the interface were written with the same AI assistant and reviewed by
the team member.

## License

[MIT](LICENSE). NASA data is in the public domain; this project is not endorsed by NASA.
