import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('textures/source/manifest.json', root), 'utf8'));
assert.equal(manifest.license, 'CC0-1.0');
assert.equal(manifest.materials.length, 5);
assert.equal(new Set(manifest.materials.map((m: any) => m.role)).size, 5);
let bytes = 0,
  files = 0;
for (const material of manifest.materials) {
  assert.equal(material.license, 'CC0-1.0');
  assert.ok(material.license_url.startsWith('https://'));
  for (const [channel, asset] of Object.entries(material.outputs) as [string, any][]) {
    const file = new URL(asset.path.slice(1), root),
      data = readFileSync(file);
    assert.equal(statSync(file).size, asset.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
    const info = execFileSync('magick', [file.pathname, '-format', '%w %h %[channels]', 'info:'], {
      encoding: 'utf8',
    }).split(' ');
    const dimension = channel === 'color' ? 1024 : 512;
    assert.equal(Number(info[0]), dimension);
    assert.equal(Number(info[1]), dimension);
    if (channel === 'height')
      assert.ok(info[2]!.startsWith('gray'), 'height map is grayscale data');
    assert.ok(asset.source.download_url.startsWith('https://'));
    bytes += data.length;
    files++;
  }
}
assert.equal(files, 10);
assert.equal(bytes, manifest.total_bytes);
assert.ok(bytes < 4 * 1024 * 1024);
console.log(
  `Source assets: ${manifest.materials.length} CC0 materials, ${files} decoded color/height maps, ${bytes} verified bytes; sources and checksums passed`,
);
