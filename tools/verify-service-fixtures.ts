import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createFramePlan, createFrameSpec } from '../src/game/dungeon/frame-building';
import { collectServiceLadders } from '../src/game/dungeon/frame-services';
import { collectServiceFixtures, buildServiceFixtureBuffers } from '../src/engine/ServiceFixtures';
import { generateWorldChunked, resetGenState } from '../src/game/gen/assemble';
import type { WorldData } from '../src/game/types';

const spec = createFrameSpec(createFramePlan(90, 18, 1, false), -2, -1);
const world = { pillars: new Map([['p', spec]]), originPcx: -3, originPcz: -2 } as WorldData;
const triangles = (batches: ReturnType<typeof buildServiceFixtureBuffers>): string[] =>
  Object.entries(batches).flatMap(([kind, b]) => {
    const out: string[] = [];
    for (let i = 0; i < b.idxs.length; i += 3) {
      const ids = b.idxs.slice(i, i + 3);
      const v = ids.map(
        (id) => new Vector3(...(b.verts.slice(id * 3, id * 3 + 3) as [number, number, number])),
      );
      const n = new Vector3(
        ...(b.norms.slice(ids[0]! * 3, ids[0]! * 3 + 3) as [number, number, number]),
      );
      assert.ok(
        v[1]!.clone().sub(v[0]!).cross(v[2]!.clone().sub(v[0]!)).dot(n) > 1e-10,
        'outward nondegenerate service fittings',
      );
      out.push(
        kind +
          ':' +
          ids
            .flatMap((id) => b.verts.slice(id * 3, id * 3 + 3))
            .map((v) => v.toFixed(7))
            .join(','),
      );
    }
    return out;
  });
const whole = triangles(
  buildServiceFixtureBuffers(world, { x0: 0, z0: 0, x1: 168, z1: 112 }),
).sort();
const parts: string[] = [];
for (let z = 0; z < 112; z += 14)
  for (let x = 0; x < 168; x += 14) {
    const mesh = buildServiceFixtureBuffers(world, { x0: x, z0: z, x1: x + 14, z1: z + 14 });
    parts.push(...triangles(mesh));
    for (const b of Object.values(mesh))
      for (let i = 0; i < b.verts.length; i += 3) {
        assert.ok(
          b.verts[i]! >= x * 3 - 3.5 && b.verts[i]! <= (x + 14) * 3 + 3.5,
          'bounded service X reach',
        );
        assert.ok(
          b.verts[i + 2]! >= z * 3 - 3.5 && b.verts[i + 2]! <= (z + 14) * 3 + 3.5,
          'bounded service Z reach',
        );
      }
  }
assert.ok(
  whole.length > 1000 && whole.length < 20000,
  'batched service geometry has a bounded triangle budget',
);
assert.deepEqual(parts.sort(), whole, 'full and quarter jobs emit exactly the same triangles once');
assert.deepEqual(
  collectServiceFixtures({ ...world, originPcx: 12, originPcz: -8 }),
  collectServiceFixtures(world),
);

const a = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: -1 });
let ladders = 0,
  columns = 0;
for (const [dx, dz] of [
  [1, 0],
  [0, 1],
  [1, 1],
]) {
  resetGenState();
  const b = generateWorldChunked({ seed: 1234, stack: 1, originPcx: dx, originPcz: -1 + dz! });
  const ids = new Set(collectServiceLadders(a).map((l) => l.id));
  const common = new Set(
    collectServiceLadders(b)
      .filter((l) => ids.has(l.id))
      .map((l) => l.id),
  );
  assert.ok(common.size > 0, 'seam test covers real service routes');
  const sort = <T extends { id: string }>(xs: T[]) => xs.sort((p, q) => p.id.localeCompare(q.id));
  assert.deepEqual(
    sort(collectServiceLadders(a).filter((l) => common.has(l.id))),
    sort(collectServiceLadders(b).filter((l) => common.has(l.id))),
    'stable absolute ladder identity',
  );
  assert.deepEqual(
    sort(collectServiceFixtures(a).filter((r) => common.has(r.source))),
    sort(collectServiceFixtures(b).filter((r) => common.has(r.source))),
    'cold recenter retains complete fittings',
  );
  ladders += common.size;
  for (let z = dz! * 56; z < 224; z++)
    for (let x = dx! * 56; x < 224; x++) {
      assert.deepEqual(a.columns[z * 224 + x], b.columns[(z - dz! * 56) * 224 + x - dx! * 56]);
      columns++;
    }
}
for (const r of collectServiceFixtures(a))
  for (const anchor of r.anchors) {
    const x = Math.floor(anchor[0] / 3) - a.originPcx * 56;
    const z = Math.floor(anchor[2] / 3) - a.originPcz * 56;
    if (x < 0 || z < 0 || x >= 224 || z >= 224) continue;
    assert.ok(
      !a.columns[z * 224 + x]!.some((s) => anchor[1] > s.floor && anchor[1] < s.ceil),
      `integrated fitting ${r.id} attaches to actual solid`,
    );
  }
generateWorldChunked({ seed: 1234, stack: 1, originPcx: 25, originPcz: 31 });
const revisited = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: -1 });
assert.deepEqual(revisited.columns, a.columns, 'service floors survive eviction/revisit');
assert.deepEqual(collectServiceLadders(revisited), collectServiceLadders(a));

// The local decorative pipe-bank render pass was deliberately retired. Keep
// its recipe/ownership regressions above, then verify its physical replacement:
// actual renderer clipping, batching/disposal and engine collision, not a stub
// of the removed private method.
await import('./verify-infrastructure-solids');
await import('./verify-infrastructure-physics');
console.log(
  `service fixtures: ${whole.length} partition-owned triangles; ${ladders} shared ladder records and ${columns} cold overlap columns; anchors, winding and revisit passed`,
);
