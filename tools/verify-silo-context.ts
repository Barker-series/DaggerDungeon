import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';

// Expose private placement helpers in memory only; do not add a production test API.
const require = createRequire(import.meta.url);
function internals(path: string, names: string[]) {
  const file = new URL(path, import.meta.url).pathname;
  const m = new Module(file);
  m.filename = file;
  m.require = createRequire(file);
  const code = readFileSync(file, 'utf8') + `\nexport { ${names.join(',')} };`;
  (m as any)._compile(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return m.exports as any;
}
const { siloPlacement, cellHasSilos, siloCellMemo, presetIndexFor } = internals('../src/game/dungeon/fold-structure.ts', ['siloPlacement', 'cellHasSilos', 'siloCellMemo']);
const { TileType } = require('../src/game/types.ts');
const n = 112;
const grid = <T>(v: T) => Array.from({ length: n }, () => Array(n).fill(v));
const tiles = grid(TileType.Floor);
const floors = grid(0);
const biomes = Array.from({ length: n / 14 }, () => Array(n / 14).fill('outside'));
const spec = { acx: 4, acz: 4, cx: 60, cz: 60, r: 2, h: 30, fallen: false, yaw: 0 };
const placement = (t = tiles, f = floors, b = biomes, pg?: boolean[][], pw?: boolean[][]) => siloPlacement(t, f, b, pg, pw, 7, 0, 0);
assert.equal(placement().footprintOpen(spec), true);
const blocked = tiles.map(row => [...row]);
blocked[60]![60] = TileType.Wall;
assert.equal(placement(blocked).footprintOpen(spec), false, 'replacement terrain grid must not inherit accepted footprint');
const expandedTerrain = tiles.map(row => [...row]);
expandedTerrain[60]![65] = TileType.Wall;
const pl = placement(expandedTerrain);
assert.equal(pl.footprintOpen(spec), true);
assert.equal(pl.footprintOpen({ ...spec, r: 8 }), false, 'expanded radius must recheck terrain');
assert.equal(pl.footprintOpen({ ...spec, fallen: true, h: 60 }), false, 'fallen length/state must recheck terrain');
assert.equal(pl.footprintOpen(spec), true, 'restoring geometry restores acceptance');
const walls = grid(false); walls[60]![60] = true;
assert.equal(placement(tiles, floors, biomes, undefined, walls).footprintOpen(spec), false, 'replacement pillar mask must recheck terrain');
console.log('PASS silo immutable input and geometry context');
const { TUNABLES } = require('../src/game/dungeon/tunables.ts');
TUNABLES.foldPreset = -1;
let witness = false;
for (let seed = 0; seed < 100; seed++) {
  const a = presetIndexFor(seed, 0, 0) === 3;
  const b = presetIndexFor(seed, 1, -1000003) === 3;
  if (a === b) continue;
  witness = true;
  siloCellMemo.clear();
  const has = cellHasSilos(seed);
  assert.equal(has(0, 0), a);
  assert.equal(has(1, -1000003), b, 'distant coordinates must not alias');
  siloCellMemo.clear();
  const reverse = cellHasSilos(seed);
  assert.equal(reverse(1, -1000003), b);
  assert.equal(reverse(0, 0), a, 'coordinate lookup must be order independent');
  break;
}
assert.ok(witness, 'fixture must exercise different districts');
siloCellMemo.clear();
TUNABLES.foldPreset = 3;
const has = cellHasSilos(123);
for (let x = 0; x < 60000; x++) has(x, -x);
assert.ok([...siloCellMemo.values()].every((m: any) => m.size <= 50000), 'same-seed exploration cache must be bounded');
console.log('PASS silo distant coordinate independence and cache bound');
