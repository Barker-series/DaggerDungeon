import assert from 'node:assert/strict';
import { generateWorldChunked, resetGenState } from '../src/game/gen/assemble';
import { collectStructureUtilities } from '../src/engine/StructureUtilities';
const seed = 1788647085001;
const a = generateWorldChunked({ seed, stack: 1, originPcx: -5, originPcz: 1 });
let columns = 0,
  plans = 0,
  runs = 0;
for (const [dx, dz] of [
  [1, 0],
  [0, 1],
  [1, 1],
]) {
  resetGenState(); // cold providers: cache reuse must not hide a seam
  const b = generateWorldChunked({ seed, stack: 1, originPcx: -5 + dx!, originPcz: 1 + dz! });
  const sx = dx! * 56,
    sz = dz! * 56;
  for (let z = sz; z < 224; z++)
    for (let x = sx; x < 224; x++) {
      assert.deepEqual(
        a.columns[z * 224 + x],
        b.columns[(z - sz) * 224 + x - sx],
        'road columns must agree across recentering',
      );
      assert.equal(
        a.levels[0]!.roadBuildingTiles?.[z]?.[x],
        b.levels[0]!.roadBuildingTiles?.[z - sz]?.[x - sx],
      );
      columns++;
    }
  const aPlans = new Map((a.roadBuildings ?? []).map((p) => [p.id, p]));
  const sources = new Set<string>();
  for (const p of b.roadBuildings ?? [])
    if (aPlans.has(p.id)) {
      assert.deepEqual(p, aPlans.get(p.id), 'whole parcel plan must be window independent');
      sources.add(p.id);
      plans++;
    }
  const frames = new Set([...a.pillars.values()].map((p) => `frame:${p.acx},${p.acz}`));
  for (const p of b.pillars.values())
    if (frames.has(`frame:${p.acx},${p.acz}`)) sources.add(`frame:${p.acx},${p.acz}`);
  const normalized = (w: typeof a) =>
    collectStructureUtilities(w)
      .filter((r) => sources.has(r.source))
      .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const ar = normalized(a),
    br = normalized(b);
  assert.deepEqual(ar, br, 'pipes/cables cannot change when the window changes');
  runs += ar.length;
}
assert.ok(plans > 0 && runs > 0, 'recenter test must cover real facilities and utilities');
generateWorldChunked({ seed, stack: 1, originPcx: 25, originPcz: 31 });
const revisited = generateWorldChunked({ seed, stack: 1, originPcx: -5, originPcz: 1 });
assert.deepEqual(revisited.columns, a.columns, 'eviction/revisit must reproduce road columns');
assert.deepEqual(
  revisited.roadBuildings,
  a.roadBuildings,
  'eviction/revisit must reproduce parcel plans',
);
for (const run of collectStructureUtilities(a))
  for (const p of run.anchors) {
    const x = Math.floor(p[0] / 3) - a.originPcx * 56,
      z = Math.floor(p[2] / 3) - a.originPcz * 56;
    if (x < 0 || z < 0 || x >= 224 || z >= 224) continue;
    assert.ok(
      !a.columns[z * 224 + x]!.some((s) => p[1] > s.floor + 1e-6 && p[1] < s.ceil - 1e-6),
      `utility ${run.id} anchor must contact actual generated solid`,
    );
  }
console.log(
  `road seams: ${columns} overlap columns, ${plans} shared plans and ${runs} utility runs agree across X/Z/diagonal recenters`,
);
