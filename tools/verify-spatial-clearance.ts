import assert from 'node:assert/strict';
import {
  FRAME_PITCH,
  FRAME_SLAB,
  createFramePlan,
  createFrameSpec,
  frameFloorY,
} from '../src/game/dungeon/frame-building';
import { pillarAirSpans } from '../src/game/dungeon/pillar-geometry';

assert.equal(FRAME_PITCH, 9, 'occupied frame storeys need a taller floor-to-floor rhythm');
assert.equal(FRAME_SLAB, 1.5, 'gain height without making the structural floors thin again');
const plan = createFramePlan(72, 18, 0, false);
const spec = createFrameSpec(plan, 0, 0);
const air = pillarAirSpans(
  spec,
  () => 0,
  () => 3,
);
const at = (x: number, z: number, y: number) =>
  air.get(`${x},${z}`)?.find((s) => Math.abs(s.floor - y) < 0.01);
const occupied = frameFloorY(2);
assert.ok(
  at(30, 19, occupied)!.ceil - occupied >= 7.5,
  'ordinary occupied gallery must have generous clear height',
);
assert.ok(
  at(31, 19, occupied)!.ceil - occupied >= 6.5,
  'downstand beams must no longer make the floor feel cramped',
);
assert.ok(
  at(18, 28, 4.7),
  'the longer switchback must reach its new far landing without steeper risers',
);
assert.ok(at(22, 18, 9.5), 'return flight must meet the next full storey');
assert.ok(
  at(25, 20, spec.totalHeight)!.ceil - spec.totalHeight >= 6,
  'enclosed roof landings need generous headroom too',
);
console.log(
  'PASS taller frame storeys, unchanged slab mass, extended switchback and roof clearance',
);

const { computeHeightFields } = await import('../src/game/dungeon/layer6-heights');
const { resetCells, setWindowOrigin, getOrCreateCell } = await import('../src/game/dungeon/cells');
const { TileType, SKY_CEIL } = await import('../src/game/types');
const { CLEARANCE, PIPE_BORE, carveBridgeIntoColumn } =
  await import('../src/game/dungeon/pillar-bridges');
const size = 42;
const tiles = Array.from({ length: size }, () => Array(size).fill(TileType.Floor));
const mask = Array.from({ length: size }, () => Array(size).fill(false));
for (const biome of [null, 'dungeon', 'crypt', 'cave', 'ember', 'outside'] as const) {
  resetCells();
  setWindowOrigin(-3, 2);
  for (let z = 0; z < 3; z++)
    for (let x = 0; x < 3; x++) {
      const cell = getOrCreateCell(x, z);
      cell.active = biome !== null;
      cell.biome = biome ?? 'dungeon';
    }
  const h = computeHeightFields(tiles, size, 14, 1234, mask);
  const clearance = h.ceiling[21]![21]! - h.floor[21]![21]!;
  if (biome === null)
    assert.equal(clearance, 6, 'ordinary ground corridors must no longer use a low 3.5-unit bore');
  else if (biome === 'outside')
    assert.equal(h.ceiling[21]![21], 96, 'outside skyline/data-ceiling contract is unchanged');
  else {
    const minimum = { dungeon: 24, crypt: 18, cave: 15.5, ember: 29.5 }[biome];
    assert.ok(
      clearance >= minimum,
      `${biome} chamber clearance ${clearance} is below its new spatial range`,
    );
  }
}
assert.equal(
  CLEARANCE,
  6,
  'ordinary bridge housings and ground transit share the taller clearance',
);
assert.equal(PIPE_BORE, 2.6, 'explicit service ducts retain their tight profile');
assert.equal(
  carveBridgeIntoColumn([], 20)[0]!.ceil,
  26,
  'a bridge through solid must carve the full height',
);
assert.equal(
  carveBridgeIntoColumn([], 20, true)[0]!.ceil,
  22.6,
  'a pipe remains an intentional compression',
);
console.log(
  'PASS taller ground chambers/transit and bridges, with tight ducts and skyline preserved',
);

const { applyFoldStructures } = await import('../src/game/dungeon/fold-structure');
const { TUNABLES } = await import('../src/game/dungeon/tunables');
const saved = { ...TUNABLES };
try {
  Object.assign(TUNABLES, { foldPreset: 0, foldTop: 24, foldCrestToAbyss: 0 });
  const columns = Array.from({ length: size * size }, () => [
    { floor: 0, ceil: SKY_CEIL, owner: 0, ceilOwner: -1 },
  ]);
  const floors = Array.from({ length: size }, () => Array(size).fill(0));
  const biomes = Array.from({ length: 3 }, () => Array(3).fill('outside' as const));
  const transit = new Set<string>();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) transit.add(`${x},${z}`);
  applyFoldStructures(
    columns,
    tiles,
    floors,
    biomes,
    size,
    100001,
    0,
    0,
    undefined,
    mask,
    transit,
    mask,
  );
  assert.ok(
    columns.some((c) => c.some((s) => s.ceil < SKY_CEIL)),
    'fold test must actually create structural mass',
  );
  for (const col of columns)
    assert.ok(
      col.some((s) => s.floor === 0 && s.ceil >= 6),
      'fold mass must not reintroduce a low transit bore',
    );
} finally {
  Object.assign(TUNABLES, saved);
  resetCells();
}
console.log('PASS shared transit clearance through actual fold-generated mass');
