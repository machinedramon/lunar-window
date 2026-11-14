# Lunar Window

**When the launch slips, see what still works.** A landing-window planner for the lunar south pole.

Built for the NASA Space Apps Challenge 2026, challenge *Lunar Landing Site Navigator*.

Most tools ask you to pick a landing site and a date, then show you the sky. Lunar Window starts from
what a mission needs — sunlight at landing, hours of continuous power, Earth in view for
communication — and shows every site and day that works across a year. When the launch date moves,
it shows which sites survive, which fail, and why.

## Status

Work in progress during the hackathon weekend (14–15 November 2026).

## How it works

- **Terrain horizon.** For each site, an offline Python tool reads NASA LOLA elevation models
  and computes the elevation of the terrain horizon in 1440 directions, for observers 0, 2 and 10 m
  above the ground.
- **Sun and Earth.** The browser computes where the Sun and the Earth are, as seen from the site,
  with [astronomy-engine](https://github.com/cosinekitty/astronomy). No server is involved.
- **Planner.** Mission requirements are checked against the horizon for every landing day.
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

AI assistants (large language models) were used to research NASA sources, to propose and compare
design options, and to write code and documentation. The full statement is on the project page.

## License

[MIT](LICENSE). NASA data is in the public domain; this project is not endorsed by NASA.
