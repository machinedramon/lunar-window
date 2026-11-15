"""The faces of the planets in the telescope of the 3D view.

    python -X utf8 tools/build_planets.py

Downloads NASA's maps of Jupiter, Saturn and Mars from the NASA 3D Resources collection ("free and without
copyright": https://github.com/nasa/NASA-3D-Resources, folder "Images and Textures") and writes them, small, to
public/textures/planets/<name>.webp (equirectangular, north up).

One thing is done to them besides making them small: the map of Saturn is strongly coloured, as spacecraft
pictures often are, and its colours are softened to the pale butterscotch a telescope shows.

Mercury and Venus have no map here: at the size they show, a telescope sees no markings on them (and NASA's
map of Venus is of its surface, by radar, which no eye sees through the clouds). They are drawn plain.
"""
import io
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'video' / 'src-planets'
OUT = ROOT / 'public' / 'textures' / 'planets'
SIZE = (720, 360)
URL = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/{name}/{name}.jpg'


def fetch(name: str) -> Image.Image:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f'{name}.jpg'
    if not path.exists():
        with urllib.request.urlopen(URL.format(name=urllib.parse.quote(name)), timeout=120) as r:
            path.write_bytes(r.read())
    return Image.open(io.BytesIO(path.read_bytes())).convert('RGB')


def soften(img: Image.Image, keep: float, lift: float) -> Image.Image:
    """Keeps a share of the colour (the rest goes to grey) and lifts the whole a little."""
    a = np.asarray(img).astype(np.float32) / 255
    grey = (a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[..., None]
    a = (grey + (a - grey) * keep) * lift
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


OUT.mkdir(parents=True, exist_ok=True)
for name in ('Jupiter', 'Saturn', 'Mars'):
    img = fetch(name).resize(SIZE, Image.LANCZOS)
    if name == 'Saturn':
        img = soften(img, 0.42, 1.04)
    path = OUT / f'{name.lower()}.webp'
    img.save(path, 'WEBP', quality=82, method=6)
    print(f'{path.relative_to(ROOT)}: {SIZE[0]} x {SIZE[1]}, {path.stat().st_size / 1024:.0f} kB')
