#!/usr/bin/env python3
"""Build the CC0 Source-inspired texture set from verified downloaded originals.

Usage: python tools/build-source-textures.py /path/to/download-cache
The cache contains selected.json (provider/source/download metadata) and its
listed originals. Downloads are deliberately separate from this reproducible
image-processing step. Requires ImageMagick; does not install packages.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--font', help='Optional label font file; defaults to fontconfig sans-serif')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'public/textures/source'
out.mkdir(parents=True, exist_ok=True)
items = json.loads((args.source / 'selected.json').read_text())
expected = {'concrete-wall', 'concrete-floor', 'painted-metal', 'rusted-metal', 'utility-tread'}
assert {x['role'] for x in items} == expected and len(items) == len(expected)
manifest = {'license': 'CC0-1.0', 'style_reference': 'Half-Life 2 / Source; no Valve artwork included', 'materials': []}
previews = []
for item in items:
    record = {k: v for k, v in item.items() if k not in ('files', 'source_description')}
    record['license'] = 'CC0-1.0'
    record['license_url'] = 'https://docs.ambientcg.com/license' if item['provider'] == 'ambientCG' else 'https://polyhaven.com/license'
    record['outputs'] = {}
    for channel in ('color', 'height'):
        source = args.source / item['files'][channel]['original_filename']
        assert source.is_file(), source
        assert hashlib.sha256(source.read_bytes()).hexdigest() == item['files'][channel]['source_sha256'], source
        target = out / f"{item['role']}-{channel}.jpg"
        size = 1024 if channel == 'color' else 512
        command = ['magick', str(source)]
        if channel == 'height':
            command += ['-colorspace', 'Gray']
        command += ['-resize', f'{size}x{size}!', '-depth', '8', '-strip', '-quality', '88' if channel == 'color' else '94', str(target)]
        subprocess.run(command, check=True)
        dimensions = subprocess.check_output(['magick', 'identify', '-format', '%w %h %[channels]', str(target)], text=True).split()
        assert dimensions[:2] == [str(size), str(size)]
        record['outputs'][channel] = {
            'path': f'/textures/source/{target.name}', 'width': size, 'height': size,
            'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'color_space': 'sRGB' if channel == 'color' else 'linear height data',
            'source': item['files'][channel],
            'processing': f'resize to {size}px, 8-bit JPEG; metadata removed' + ('; grayscale' if channel == 'height' else '; original colors retained'),
        }
        if channel == 'color': previews += ['-label', item['role'], str(target)]
    manifest['materials'].append(record)
manifest['total_bytes'] = sum(v['bytes'] for m in manifest['materials'] for v in m['outputs'].values())
assert manifest['total_bytes'] < 4 * 1024 * 1024, 'texture download budget exceeded'
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
font = args.font or subprocess.check_output(['fc-match', 'sans-serif', '-f', '%{file}'], text=True).strip()
subprocess.run(['magick', 'montage', *previews, '-font', font, '-pointsize', '16', '-background', '#242725', '-fill', '#efefdd', '-geometry', '256x256+8+8', '-tile', '5x1', '/tmp/source-material-contact-sheet.png'], check=True)
with tempfile.TemporaryDirectory() as temp:
    tiled = []
    for item in items:
        tile = Path(temp) / f"{item['role']}.png"
        repeat = Path(temp) / f"{item['role']}-repeat.png"
        subprocess.run(['magick', str(out / f"{item['role']}-color.jpg"), '-resize', '256x256', str(tile)], check=True)
        subprocess.run(['magick', '-size', '512x512', f'tile:{tile}', str(repeat)], check=True)
        tiled += ['-label', item['role'], str(repeat)]
    subprocess.run(['magick', 'montage', *tiled, '-font', font, '-pointsize', '16', '-background', '#242725', '-fill', '#efefdd', '-geometry', '384x384+8+8', '-tile', '5x1', '/tmp/source-material-tiling.png'], check=True)
print(json.dumps({'materials': len(items), 'files': len(items) * 2, 'bytes': manifest['total_bytes'], 'manifest': str(out / 'manifest.json'), 'contact_sheet': '/tmp/source-material-contact-sheet.png'}, indent=2))
