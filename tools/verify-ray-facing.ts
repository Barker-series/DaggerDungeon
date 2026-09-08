import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./debug-view.ts', import.meta.url), 'utf8');
assert.ok(
  source.includes('triangleFacingNormal'),
  'DDSNAP facing audit must use triangle winding, not the first smooth vertex normal',
);
const { triangleFacingNormal } = await import('./triangle-facing');
const q = Math.SQRT1_2;
const triangle = [1, 0, 0, q, 0, -q, q, 1, -q];
const ray = [0.268, -0.062, 0.961];
const n = triangleFacingNormal(triangle);
assert.ok(
  n[0] * ray[0]! + n[1] * ray[1]! + n[2] * ray[2]! < 0,
  'glancing front-facing cylinder facet must not be called a backface',
);
assert.ok(
  ray[0]! > 0,
  'positive control: its first smooth vertex normal points away from the camera',
);
const reversed = triangleFacingNormal([
  ...triangle.slice(0, 3),
  ...triangle.slice(6, 9),
  ...triangle.slice(3, 6),
]);
assert.ok(
  reversed[0] * ray[0]! + reversed[1] * ray[1]! + reversed[2] * ray[2]! > 0,
  'reversed winding must still be detected',
);
assert.deepEqual(triangleFacingNormal([0, 0, 0, 0, 0, 0, 0, 0, 0]), [0, 0, 0]);
console.log(
  'ray facing: smooth-pipe grazing false positives removed; reversed winding still detected',
);
