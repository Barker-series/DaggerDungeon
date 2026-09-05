import assert from 'node:assert/strict';
import * as lighting from '../src/engine/LightingSystem';
import { generateWorldChunked } from '../src/game/gen/assemble';
import { SKY_CEIL, TILE_SIZE } from '../src/game/types';

assert.ok(
  'collectFrameFixtures' in lighting,
  'internal stair cores need column-validated mounted fixtures',
);
const world = generateWorldChunked({ seed: 1, stack: 1 });
const fixtures = lighting.collectFrameFixtures(world);
assert.ok(fixtures.length > 0, 'naturally generated framed buildings must receive fixtures');
const keys = new Set<string>();
for (const f of fixtures) {
  const x = Math.floor(f.x / TILE_SIZE),
    z = Math.floor(f.z / TILE_SIZE);
  const col = world.columns[z * world.levels[0]!.width + x]!;
  assert.ok(
    col.some((s) => s.floor < f.y && s.ceil === f.ceilingY),
    'fixture must be mounted inside real column air',
  );
  assert.ok(
    f.ceilingY < SKY_CEIL && Math.abs(f.ceilingY - f.y - 0.28) < 1e-6,
    'no hanging lights in open sky',
  );
  keys.add(`${f.x},${f.y},${f.z}`);
}
assert.equal(keys.size, fixtures.length, 'one mount per landing');
assert.deepEqual(
  lighting.collectFrameFixtures(world),
  fixtures,
  'fixture placement is deterministic',
);
const withoutFrames = {
  ...world,
  pillars: new Map([...world.pillars].map(([k, p]) => [k, { ...p, frame: undefined }])),
};
assert.equal(
  lighting.collectFrameFixtures(withoutFrames).length,
  0,
  'legacy/elevator lighting stays unchanged',
);
console.log(
  `frame fixtures: ${fixtures.length} deterministic, unique, ceiling-mounted landing fixtures validated`,
);
