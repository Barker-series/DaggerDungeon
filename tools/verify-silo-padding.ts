import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function internals(path: string, names: string[]) {
  const file = new URL(path, import.meta.url).pathname;
  const m = new Module(file); m.filename = file; m.require = createRequire(file);
  (m as any)._compile(ts.transpileModule(readFileSync(file, 'utf8') + `\nexport { ${names.join(',')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, file);
  return m.exports as any;
}
const { TUNABLES } = require('../src/game/dungeon/tunables.ts');
const { siloMaxReachTiles, siloIntervalsAt, siloFootprintTiles } = require('../src/game/dungeon/silo-structure.ts');
const { TileBaseLayer, TransitLayer, HeightLayer, ColumnLayer, legacyWindowPaddingPc } = require('../src/game/gen/layers.ts');
const { siloPlacement } = internals('../src/game/dungeon/fold-structure.ts', ['siloPlacement']);
const { layersFor, resetGenState } = internals('../src/game/gen/assemble.ts', ['layersFor']);
const saved = { ...TUNABLES };
let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}
check('declared dependencies cover full footprint at min/default/max', () => {
  for (const [radius, length] of [[2, 10], [saved.siloRadius, saved.siloFallenLength], [14, 120]]) {
    TUNABLES.siloRadius = radius; TUNABLES.siloFallenLength = length;
    const base = new TileBaseLayer(17), transit = new TransitLayer(17, base), height = new HeightLayer(17, base, transit);
    const column = new ColumnLayer(17, base, transit, height);
    for (const dep of (column as any).deps) {
      assert.ok(dep.padTiles >= 2 * siloMaxReachTiles(), `padding ${dep.padTiles} < diameter ${2 * siloMaxReachTiles()}`);
      assert.equal(dep.padTiles % 14, 0);
      assert.ok(legacyWindowPaddingPc() * 56 >= dep.padTiles + 28 + 14, 'legacy guard covers composed upstream dependency');
    }
    console.log(`  radius=${radius} length=${length}: column pad=${column.padTiles}, legacy guard=${legacyWindowPaddingPc()} pillar cells`);
  }
});
Object.assign(TUNABLES, saved);
check('hot column reset reconstructs dependency and working pad together', () => {
  resetGenState();
  const old = layersFor(17, 0);
  const oldColumn = old.column;
  TUNABLES.siloRadius = 14; TUNABLES.siloFallenLength = 120;
  resetGenState('column');
  const changed = layersFor(17, 0);
  assert.notEqual(changed.column, oldColumn, 'changed padding must reconstruct the column layer');
  assert.equal(changed.transit, old.transit, 'hot column changes preserve upstream cache');
  for (const dep of changed.column.deps) assert.ok(dep.padTiles >= 2 * siloMaxReachTiles());
  // Exercise provider ensure + actual working-grid assembly with the new pad.
  changed.column.ensure({ tx0: -56, tz0: -56, tx1: 0, tz1: 0 });
  const warm = changed.column.get(-1, -1);
  resetGenState();
  const fresh = layersFor(17, 0);
  fresh.column.ensure({ tx0: -56, tz0: -56, tx1: 0, tz1: 0 });
  assert.deepEqual(warm, fresh.column.get(-1, -1));
});
Object.assign(TUNABLES, saved);
check('unavailable footprint terrain cannot count as open', () => {
  const { TileType } = require('../src/game/types.ts');
  const n = 56;
  const tiles = Array.from({ length: n }, () => Array(n).fill(TileType.Floor));
  const floors = Array.from({ length: n }, () => Array(n).fill(0));
  const biomes = Array.from({ length: 4 }, () => Array(4).fill('outside'));
  const pl = siloPlacement(tiles, floors, biomes, undefined, undefined, 17, 0, 0);
  assert.equal(pl.footprintOpen({ acx: 3, acz: 2, cx: 52, cz: 28, r: 4, h: 60, fallen: true, yaw: 0 }), false);
});
check('only touching candidates request eligibility context', () => {
  TUNABLES.siloDensity = 1;
  let visits = 0;
  for (let z = -7; z <= 7; z++) for (let x = -7; x <= 7; x++) siloIntervalsAt(17, x, z, {
    cellHasSilos: () => true,
    footprintOpen: (spec: any) => {
      visits++;
      assert.ok(siloFootprintTiles(spec).some(([ax,az]: number[]) => ax === x && az === z), 'irrelevant candidate read beyond effect distance');
      return true;
    },
  });
  assert.ok(visits > 0);
});
Object.assign(TUNABLES, saved);
if (failures) process.exitCode = 1;
