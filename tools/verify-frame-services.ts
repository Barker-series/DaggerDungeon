import assert from 'node:assert/strict';
import { createFramePlan, frameBuildingAir, frameFloorY } from '../src/game/dungeon/frame-building';

// A service shelf and its projecting lower approach must be real column floors,
// without consuming the tall central void or replacing the main circulation.
const p = createFramePlan(72, 18, 0, true);
const floor = (x: number, z: number, y: number) =>
  frameBuildingAir(p, x, z).find(([f, c]) => Math.abs(f - y) < 0.01 && c - f >= 1.8);
assert.ok(floor(38, 22, frameFloorY(3)), 'upper service shelf must exist as usable column air');
assert.ok(
  floor(29, 24, frameFloorY(2)),
  'projecting maintenance approach must meet an existing core landing',
);
assert.ok(floor(32, 23, frameFloorY(2)), 'ladder foot needs a real lower landing');
assert.ok(
  frameBuildingAir(p, 29, 28).some(([f, c]) => f === 0.5 && c >= 30),
  'central atrium must stay open',
);
console.log('frame services: structural shelf, approach, landing and retained void passed');

const { collectServiceFixtures } = await import('../src/engine/ServiceFixtures');
const { createFrameSpec } = await import('../src/game/dungeon/frame-building');
const { collectServiceLadders } = await import('../src/game/dungeon/frame-services');
const world = {
  pillars: new Map([['p', createFrameSpec(p, -2, -1)]]),
  originPcx: -3,
  originPcz: -2,
} as import('../src/game/types').WorldData;
const fixtures = collectServiceFixtures(world);
assert.ok(
  fixtures.some((r) => r.kind === 'pipe' && r.radius >= 1.5),
  'human-scale service routes need monumental overhead pipes',
);
assert.ok(
  fixtures.some(
    (r) =>
      r.kind === 'cable' &&
      Math.hypot(r.points[0]![0] - r.points.at(-1)![0], r.points[0]![2] - r.points.at(-1)![2]) > 25,
  ),
  'anchored cables span the actual void',
);
for (const ladder of collectServiceLadders(world)) {
  assert.ok(
    fixtures.some((r) => r.id === `${ladder.id}:rail:0`),
    'each usable ladder has visible rails',
  );
  assert.ok(
    fixtures.filter((r) => r.id.startsWith(`${ladder.id}:rung:`)).length >= 20,
    'fixed human-scale rungs',
  );
}
console.log('frame services: large pipes, gap cables and visible ladder fittings passed');

for (const industrial of [false, true])
  for (const rotation of [0, 1, 2, 3]) {
    const plan = createFramePlan(90, 18, rotation, industrial);
    const spec = createFrameSpec(plan, -2, -1);
    assert.ok(
      spec.roomSockets.some((s) => s.group.startsWith('service-')),
      'service routes publish targets for the normal world reachability audit',
    );
    const w = { ...world, pillars: new Map([['p', spec]]) };
    for (const r of collectServiceFixtures(w))
      for (const a of r.anchors) {
        let x = Math.floor(a[0] / 3) - spec.acx * 56;
        let z = Math.floor(a[2] / 3) - spec.acz * 56;
        for (let k = 0; k < (4 - rotation) % 4; k++) [x, z] = [55 - z, x];
        assert.ok(
          !frameBuildingAir(plan, x, z).some(([lo, hi]) => a[1] > lo && a[1] < hi),
          `${r.id}: fitting contact must be real solid even above the setback`,
        );
      }
  }
