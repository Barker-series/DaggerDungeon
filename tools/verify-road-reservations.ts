import assert from 'node:assert/strict';
import { planRoadParcel, ROAD_PARCEL_TILES } from '../src/game/dungeon/road-buildings';

const reserved = new Set<string>();
for (let z = -2; z < ROAD_PARCEL_TILES + 2; z++)
  for (let x = 10; x <= 12; x++) reserved.add(`${x},${z}`);
const probe = (x: number, z: number) => {
  const foundation = x >= 2 && x <= 21 && z >= 2 && z <= 21;
  return { foundation, street: !foundation, top: 3, block: 'fixture' };
};
const base = planRoadParcel(1, 0, 0, probe);
assert.ok(base, 'positive control must create a facility');
const guarded = planRoadParcel(1, 0, 0, probe, reserved);
assert.ok(guarded, 'a reserved corridor should leave buildable frontage');
for (const k of [...guarded.body, ...guarded.entry])
  assert.ok(
    !reserved.has(`${k % ROAD_PARCEL_TILES},${Math.floor(k / ROAD_PARCEL_TILES)}`),
    'new building and entry mass must respect existing bridge reservations',
  );
console.log('road reservations: existing crossings remain free of new facility mass');
const negative = planRoadParcel(1, -5, -5, (x, z) => probe(x + 120, z + 120), new Set());
assert.ok(
  negative && negative.posts.length > 0,
  'negative-coordinate halls must retain their regular structural supports',
);
const { legacyWindowPaddingPc } = await import('../src/game/gen/layers');
const { TUNABLES } = await import('../src/game/dungeon/tunables');
const saved = { ...TUNABLES };
try {
  TUNABLES.siloRadius = 2;
  TUNABLES.siloFallenLength = 10;
  assert.ok(
    legacyWindowPaddingPc() >= 2,
    'legacy road planning needs the complete neighbouring transit chunk plus its tile-base context',
  );
} finally {
  Object.assign(TUNABLES, saved);
}
