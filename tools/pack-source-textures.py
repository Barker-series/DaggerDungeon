#!/usr/bin/env python3
"""Rebuild local CC0 packed derivatives, no downloads. RGB=sRGB, A=linear height.
Run from repository root: python tools/pack-source-textures.py [--check]
Original source provenance remains in public/textures/source/manifest.json.
"""
from pathlib import Path
from PIL import Image
import hashlib, json, sys
ROOT = Path(__file__).resolve().parents[1] / 'public/textures/source'
roles = ['concrete-wall','concrete-floor','painted-metal','rusted-metal','utility-tread']
entries = []
for role in roles:
    color = ROOT / f'{role}-color.jpg'
    height = ROOT / f'{role}-height.jpg'
    out = ROOT / f'{role}-packed.webp'
    rgb = Image.open(color).convert('RGB')
    alpha = Image.open(height).convert('L').resize(rgb.size, Image.Resampling.BILINEAR)
    rgba = rgb.copy(); rgba.putalpha(alpha)
    if '--check' not in sys.argv:
        rgba.save(out, 'WEBP', lossless=True, exact=True, quality=100, method=6)
    decoded = Image.open(out).convert('RGBA')
    assert decoded.size == (1024,1024)
    assert decoded.tobytes() == rgba.tobytes(), f'RGB/height changed: {role}'
    assert out.stat().st_size < 4*1024*1024
    entries.append(dict(role=role, file=out.name, size=out.stat().st_size,
        width=1024,height=1024,channels='sRGB RGB; linear height alpha (NOT opacity)',
        sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
        sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [color,height]}))
manifest = dict(derivation='Pillow lossless exact WebP; original decoded RGB unchanged; bilinear 512-to-1024 height in alpha',
    provenance='manifest.json (original CC0 sources retained)', textures=entries,
    decodedRGBABytes=sum(e['width']*e['height']*4 for e in entries),
    gpuBytesIncludingMipmaps=sum(sum(max(1,1024>>i)**2*4 for i in range(11)) for _ in entries))
if '--check' not in sys.argv:
    (ROOT/'packed-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
else:
    assert json.loads((ROOT/'packed-manifest.json').read_text()) == manifest
print(json.dumps(dict(textures=len(entries), networkBytes=sum(e['size'] for e in entries),
    decodedRGBABytes=manifest['decodedRGBABytes'],gpuBytesIncludingMipmaps=manifest['gpuBytesIncludingMipmaps'],
    exactRGBAndHeight=True)))
