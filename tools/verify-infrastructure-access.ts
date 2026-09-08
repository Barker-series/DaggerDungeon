import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { ColumnSpan } from '../src/game/types';
import { planInfrastructureCell } from '../src/game/dungeon/infrastructure-network';

assert.ok(
  existsSync(new URL('../src/game/dungeon/infrastructure-access.ts', import.meta.url)),
  'contextual access planner must exist',
);
const { planInfrastructureAccess } = await import('../src/game/dungeon/infrastructure-access');
const floor: readonly ColumnSpan[] = [{ floor: 7, ceil: 16, owner: -1, ceilOwner: -1 }];
const plan = planInfrastructureCell(123, 0, 0);
const access = planInfrastructureAccess(plan, () => floor);
assert.ok(access, 'existing finite floor receives maintenance access');
assert.equal(access.foot.y, 7);
assert.equal(access.ladders[0]!.bottom, 7);
assert.equal(
  access.ladders[0]!.top,
  plan.node.point[1] - plan.node.radius + 0.9,
  'service entry must meet the main pipe floor, not drop into it from midair',
);
assert.ok(
  access.boxes.some((b) => b.top === 7 && b.bottom < 7 && b.clearTop > access.ladders[0]!.top),
);
assert.ok(access.boxes.some((b) => b.top === access.ladders[0]!.top && b.bottom < b.top));
assert.deepEqual(
  planInfrastructureAccess(plan, () => floor),
  access,
);
console.log('infrastructure access: real column floor, physical boxes, stable ladder passed');
const { infrastructureIntervalsAt, primitiveBounds } =
  await import('../src/game/dungeon/infrastructure-solid');
const firstFoot = access.foot;
const alternative = planInfrastructureAccess(plan, (x, z) =>
  x === firstFoot.tx && z === firstFoot.tz ? [] : floor,
);
assert.ok(alternative, 'try the other diagonal ports when the first is solid');
assert.notDeepEqual(alternative.foot, firstFoot);
for (const spans of [
  [],
  [{ floor: -1e9, ceil: 1e9, owner: -1, ceilOwner: -1 }],
  [{ floor: 0, ceil: 1, owner: -1, ceilOwner: -1 }],
]) {
  assert.equal(
    planInfrastructureAccess(plan, () => spans),
    null,
    'no wall, abyss or unwalkable floor attachment',
  );
}
assert.throws(
  () => planInfrastructureAccess(plan, () => undefined),
  /context|column|missing/i,
  'missing provider is an error, not a window-dependent alternate',
);
const branch = access.primitives.find((p) => p.kind === 'pipe' && p.innerRadius);
assert.ok(branch, 'open branch reaches main node bore');
assert.equal(branch.a[0], plan.node.point[0]);
assert.equal(branch.a[2], plan.node.point[2]);
const all = [...plan.primitives, ...access.primitives];
for (let t = 0.05; t <= 1; t += 0.05) {
  const p = branch.a.map((v, k) => v + (branch.b[k]! - v) * t);
  assert.ok(
    !infrastructureIntervalsAt(all, p[0]!, p[2]!).some(([a, b]) => a < p[1]! && b > p[1]!),
    'branch centerline is connected air',
  );
}
assert.ok(
  access.boxes.filter((b) => b.top === access.ladders[0]!.top).length >= 2,
  'short maintenance shelf extends toward the network',
);
const supports = access.primitives.filter((p) => p.kind === 'support');
assert.ok(supports.length >= 2, 'platform has real rooted piers');
for (const p of supports) {
  assert.ok(p.a[1] < access.foot.y && p.b[1] >= access.ladders[0]!.top - 1.2);
  assert.ok(
    access.boxes.some(
      (b) =>
        b.top === access.foot.y &&
        p.a[0] > b.x0 * 3 &&
        p.a[0] < b.x1 * 3 &&
        p.a[2] > b.z0 * 3 &&
        p.a[2] < b.z1 * 3,
    ),
  );
}
assert.ok(access.primitives.some((p) => p.kind === 'cable' && p.radius === 0.08));
assert.ok(access.primitives.some((p) => p.kind === 'cable' && p.radius === 0.03));
assert.equal(new Set(access.primitives.map((p) => p.id)).size, access.primitives.length);
// Exhaust all 16 jitter positions, both radii, all four ports, negative owners.
let cases = 0;
for (const owner of [-2, 0])
  for (const radius of [4.5, 6])
    for (let jx = 6; jx <= 9; jx++)
      for (let jz = 6; jz <= 9; jz++) {
        const p = {
          ...plan,
          id: `infra:${owner},${owner}`,
          node: {
            ...plan.node,
            radius,
            point: [owner * 336 + jx * 3 + 1.5, 60, owner * 336 + jz * 3 + 1.5] as [
              number,
              number,
              number,
            ],
          },
        };
        const rejected = new Set<string>();
        for (let port = 0; port < 4; port++) {
          const a = planInfrastructureAccess(p, (x, z) => (rejected.has(`${x},${z}`) ? [] : floor));
          assert.ok(a, 'each diagonal port has a valid station');
          rejected.add(`${a.foot.tx},${a.foot.tz}`);
          for (const b of a.boxes)
            assert.ok(
              b.x0 >= owner * 112 &&
                b.z0 >= owner * 112 &&
                b.x1 <= owner * 112 + 56 &&
                b.z1 <= owner * 112 + 56,
              'box remains in owning chunk',
            );
          for (const q of a.primitives) {
            const b = primitiveBounds(q);
            assert.ok(
              b.x0 >= owner * 336 &&
                b.z0 >= owner * 336 &&
                b.x1 <= owner * 336 + 168 &&
                b.z1 <= owner * 336 + 168,
              `primitive ${q.id} remains owned`,
            );
          }
          const l = a.ladders[0]!;
          assert.ok(
            a.boxes.some(
              (b) =>
                b.top === l.top &&
                l.exitX > b.x0 * 3 &&
                l.exitX < b.x1 * 3 &&
                l.exitZ > b.z0 * 3 &&
                l.exitZ < b.z1 * 3,
            ),
          );
          assert.ok(
            !a.boxes.some(
              (b) =>
                b.top === l.top &&
                l.x > b.x0 * 3 &&
                l.x < b.x1 * 3 &&
                l.z > b.z0 * 3 &&
                l.z < b.z1 * 3,
            ),
            'ladder shaft outside slab',
          );
          for (let y = l.bottom + 0.1; y < l.top; y += 0.5)
            assert.ok(
              !infrastructureIntervalsAt(a.primitives, l.x, l.z).some(
                ([lo, hi]) => y > lo && y < hi,
              ),
              'climb shaft clear of structural fittings',
            );
          cases++;
        }
      }
console.log(
  `infrastructure access: diagonal fallback, missing context, connected bore, rooted supports, cables, ${cases} ownership/ladder cases passed`,
);
