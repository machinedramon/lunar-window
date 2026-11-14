"""Prepares the third-party 3D assets of the first-person view for the web.

Usage (from the repository root):  python -X utf8 tools/build_assets.py

Sources (download them into data/raw/assets first; see docs/REFERENCES.md):
  Poly Haven (CC0)            moon_rock_01, moon_rock_03, moon_rock_05 (glTF, 1k), and the
                              textures moon_dusted_01 and moon_footprints_01 (1k JPEG)
  NASA 3D Resources           Astronaut.glb and "Apollo Lunar Module.glb" (public domain)

Output: public/models and public/textures/regolith. Textures are reduced so that the whole set
stays small; the geometry is untouched. Needs Pillow.
"""
from __future__ import annotations

import json
import os
import shutil
import struct
import sys

from PIL import Image

from lunar import ROOT

SRC = os.path.join(ROOT, 'data', 'raw', 'assets')
MODELS = os.path.join(ROOT, 'public', 'models')
TEX = os.path.join(ROOT, 'public', 'textures', 'regolith')


def save_jpeg(src: str, dst: str, size: int, quality: int, gray: bool = False) -> int:
    im = Image.open(src)
    im = im.convert('L' if gray else 'RGB').resize((size, size), Image.LANCZOS)
    im.save(dst, 'JPEG', quality=quality, optimize=True)
    return os.path.getsize(dst)


def glb_summary(path: str) -> str:
    with open(path, 'rb') as f:
        magic, version, length = struct.unpack('<4sII', f.read(12))
        chunk_len, chunk_type = struct.unpack('<I4s', f.read(8))
        doc = json.loads(f.read(chunk_len))
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            acc = doc['accessors'][prim['attributes']['POSITION']]
            if 'min' in acc:
                lo = [min(a, b) for a, b in zip(lo, acc['min'])]
                hi = [max(a, b) for a, b in zip(hi, acc['max'])]
    tris = sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc.get('meshes', []) for p in m['primitives'] if 'indices' in p)
    return (f"{len(doc.get('nodes', []))} nodes, {len(doc.get('meshes', []))} meshes, {tris} triangles, {len(doc.get('materials', []))} materials, "
            f"{len(doc.get('images', []))} images, skins {len(doc.get('skins', []))}, bounds {[round(v, 2) for v in lo]} .. {[round(v, 2) for v in hi]}")


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    os.makedirs(MODELS, exist_ok=True)
    os.makedirs(TEX, exist_ok=True)

    # Regolith: grey-scale albedo and a normal map for the ground near the camera.
    for name, out, size, q, gray in (
        ('moon_dusted_01_diff_1k.jpg', 'albedo.jpg', 1024, 86, True),
        ('moon_dusted_01_nor_gl_1k.jpg', 'normal.jpg', 1024, 90, False),
        ('moon_footprints_01_diff_1k.jpg', 'footprints_albedo.jpg', 1024, 86, True),
        ('moon_footprints_01_nor_gl_1k.jpg', 'footprints_normal.jpg', 1024, 90, False),
    ):
        n = save_jpeg(os.path.join(SRC, 'tex', name), os.path.join(TEX, out), size, q, gray)
        print(f'{out}: {n / 1000:.0f} kB')

    # Rocks: keep colour and normal maps at 512 px, drop the rest.
    for k, rock in enumerate(('moon_rock_01', 'moon_rock_03', 'moon_rock_05'), start=1):
        folder = os.path.join(SRC, rock)
        doc = json.load(open(os.path.join(folder, f'{rock}_1k.gltf'), encoding='utf-8'))
        shutil.copyfile(os.path.join(folder, f'{rock}.bin'), os.path.join(MODELS, f'rock{k}.bin'))
        doc['buffers'][0]['uri'] = f'rock{k}.bin'
        mat = doc['materials'][0]
        pbr = mat.setdefault('pbrMetallicRoughness', {})
        keep = {}
        images = []
        textures = []
        for role, ref, size, q in (('diff', pbr.get('baseColorTexture'), 512, 86), ('nor', mat.get('normalTexture'), 512, 90)):
            if not ref:
                continue
            uri = doc['images'][doc['textures'][ref['index']]['source']]['uri']
            out = f'rock{k}_{role}.jpg'
            save_jpeg(os.path.join(folder, uri), os.path.join(MODELS, out), size, q)
            images.append({'uri': out, 'mimeType': 'image/jpeg'})
            textures.append({'source': len(images) - 1, 'sampler': 0} if doc.get('samplers') else {'source': len(images) - 1})
            keep[role] = len(textures) - 1
        doc['images'] = images
        doc['textures'] = textures
        pbr.pop('metallicRoughnessTexture', None)
        mat.pop('occlusionTexture', None)
        pbr['metallicFactor'] = 0.0
        pbr['roughnessFactor'] = 0.95
        if 'diff' in keep:
            pbr['baseColorTexture'] = {'index': keep['diff']}
        if 'nor' in keep:
            mat['normalTexture'] = {'index': keep['nor']}
        json.dump(doc, open(os.path.join(MODELS, f'rock{k}.gltf'), 'w', encoding='utf-8'), separators=(',', ':'))
        acc = doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['POSITION']]
        tris = doc['accessors'][doc['meshes'][0]['primitives'][0]['indices']]['count'] // 3
        print(f"rock{k}: {tris} triangles, bounds {[round(v, 2) for v in acc['min']]} .. {[round(v, 2) for v in acc['max']]}")

    for src, out in (('Astronaut.glb', 'astronaut.glb'), ('Apollo Lunar Module.glb', 'apollo-lm.glb')):
        shutil.copyfile(os.path.join(SRC, src), os.path.join(MODELS, out))
        print(f'{out}: {glb_summary(os.path.join(MODELS, out))}')

    total = sum(os.path.getsize(os.path.join(d, f)) for d in (MODELS, TEX) for f in os.listdir(d))
    print(f'total: {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
