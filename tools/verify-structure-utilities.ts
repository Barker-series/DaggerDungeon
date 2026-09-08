import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { frameBuildingAir } from '../src/game/dungeon/frame-building';
import { createFramePlan, createFrameSpec } from '../src/game/dungeon/frame-building';
import type { WorldData } from '../src/game/types';
import type { RoadBuildingPlan } from '../src/game/dungeon/road-buildings';

assert.ok(
  existsSync(new URL('../src/engine/StructureUtilities.ts', import.meta.url)),
  'surface utility planner must exist',
);
const { collectStructureUtilities } = await import('../src/engine/StructureUtilities');
const road: RoadBuildingPlan = {
  id: 'road:-1,-1:test',
  tx0: -24,
  tz0: -24,
  body: [],
  interior: [],
  entry: [],
  posts: [],
  street: 0,
  baseTop: 6,
  storeys: 2,
  roofY: 24.5,
  anchors: [{ tx: -20, tz: -20, nx: 0, nz: -1 }],
};
for (let z = 4; z <= 14; z++)
  for (let x = 4; x <= 14; x++) {
    road.body.push(z * 24 + x);
    if (x > 4 && x < 14 && z > 4 && z < 14) road.interior.push(z * 24 + x);
  }
const pillar = createFrameSpec(createFramePlan(54, 0, 0, false), -2, -1);
const world = {
  seed: 42,
  originPcx: -3,
  originPcz: -2,
  roadBuildings: [road],
  pillars: new Map([['-2,-1', pillar]]),
} as WorldData;
const runs = collectStructureUtilities(world);
assert.ok(
  runs.some(
    (r) => r.kind === 'pipe' && r.radius >= 0.5 && Math.abs(r.anchors[1][1] - r.anchors[0][1]) > 12,
  ),
  'recognizable main risers must extend through multiple storeys',
);
assert.ok(
  runs.some(
    (r) =>
      r.kind === 'cable' &&
      Math.hypot(r.anchors[1][0] - r.anchors[0][0], r.anchors[1][2] - r.anchors[0][2]) > 25 &&
      r.points[Math.floor(r.points.length / 2)]![1] < (r.anchors[0][1] + r.anchors[1][1]) / 2 - 1.5,
  ),
  'hanging cables must span the atrium, not only decorate a short wall bank',
);
assert.ok(
  runs.some((r) => r.source === road.id),
  'road architecture receives mounted pipes',
);
assert.ok(
  runs.some((r) => r.source === 'frame:-2,-1'),
  'framed architecture receives mounted pipes',
);
for (const source of [road.id, 'frame:-2,-1']) {
  const bank = runs.filter((r) => r.source === source);
  assert.ok(bank.some((r) => r.kind === 'pipe' && r.radius >= 0.2));
  assert.ok(bank.some((r) => r.kind === 'pipe' && r.radius <= 0.1));
  assert.ok(bank.some((r) => r.kind === 'collar'));
  assert.ok(bank.some((r) => r.kind === 'support'));
}
assert.deepEqual(collectStructureUtilities(world), runs, 'deterministic regeneration');
assert.deepEqual(
  collectStructureUtilities({ pillars: new Map() } as WorldData),
  [],
  'empty architecture',
);
for (const source of [road.id, 'frame:-2,-1']) {
  const cables = runs.filter(
    (r) => r.source === source && (r.kind === 'cable' || r.kind === 'wire'),
  );
  assert.ok(
    cables.some((r) => r.kind === 'cable'),
    'sagging cable on each architecture',
  );
  assert.ok(cables.filter((r) => r.kind === 'wire').length >= 2, 'thin parallel wires');
  assert.ok(new Set(cables.map((r) => r.radius)).size >= 2);
  for (const r of cables) {
    assert.deepEqual(r.points[0], r.anchors[0]);
    assert.deepEqual(r.points.at(-1), r.anchors[1]);
    assert.ok(
      r.points[Math.floor(r.points.length / 2)]![1] < r.points[0]![1] - 0.15,
      'real sag, not straight lines',
    );
    assert.ok(
      r.points.every((p) => p[1] > 5),
      'ordinary walking clearance',
    );
  }
}
assert.deepEqual(
  collectStructureUtilities({ ...world, roadBuildings: [] }),
  runs.filter((r) => r.source.startsWith('frame:')),
  'unloaded unrelated parcel cannot change frame utilities',
);
assert.deepEqual(
  collectStructureUtilities({ ...world, originPcx: 10, originPcz: 4 }),
  runs,
  'window origin never decides existence',
);
const utilities = await import('../src/engine/StructureUtilities');
assert.ok('buildStructureUtilityBuffers' in utilities, 'bounded surface mesh compiler must exist');
const { buildStructureUtilityBuffers } = utilities;
const bounds = { x0: 0, z0: 0, x1: 168, z1: 112 };
const full = buildStructureUtilityBuffers(world, bounds);
const triangles = (buffers: ReturnType<typeof buildStructureUtilityBuffers>): string[] =>
  Object.entries(buffers).flatMap(([key, b]) => {
    const out: string[] = [];
    for (let i = 0; i < b.idxs.length; i += 3)
      out.push(
        key +
          ':' +
          b.idxs
            .slice(i, i + 3)
            .flatMap((v) => b.verts.slice(v * 3, v * 3 + 3))
            .map((v) => v.toFixed(7))
            .join(','),
      );
    return out;
  });
const whole = triangles(full).sort(),
  parts: string[] = [];
assert.ok(whole.length > 100, 'real rounded meshes');
assert.ok(
  whole.length < 16000,
  'straight utility runs must not waste dense longitudinal tessellation',
);
for (let z = 0; z < 112; z += 14)
  for (let x = 0; x < 168; x += 14) {
    const b = { x0: x, z0: z, x1: x + 14, z1: z + 14 };
    const mesh = buildStructureUtilityBuffers(world, b);
    parts.push(...triangles(mesh));
    for (const buf of Object.values(mesh))
      for (let i = 0; i < buf.verts.length; i += 3) {
        assert.ok(
          buf.verts[i]! >= x * 3 - 2.2 && buf.verts[i]! <= (x + 14) * 3 + 2.2,
          'bounded X reach',
        );
        assert.ok(
          buf.verts[i + 2]! >= z * 3 - 2.2 && buf.verts[i + 2]! <= (z + 14) * 3 + 2.2,
          'bounded Z reach',
        );
        assert.ok(Number.isFinite(buf.verts[i + 1]!));
      }
  }
assert.deepEqual(
  parts.sort(),
  whole,
  'half-open ownership emits each triangle exactly once across quarter chunks, including negative absolute origins',
);
assert.deepEqual(buildStructureUtilityBuffers(world, bounds), full, 'repeat buffers identical');
assert.equal(
  triangles(
    buildStructureUtilityBuffers(
      { pillars: new Map(), originPcx: 0, originPcz: 0 } as WorldData,
      bounds,
    ),
  ).length,
  0,
);
for (let rotation = 0; rotation < 4; rotation++) {
  const frame = createFramePlan(54, 0, rotation, false),
    spec = createFrameSpec(frame, -2, -1);
  for (const run of collectStructureUtilities({
    ...world,
    roadBuildings: [],
    pillars: new Map([['f', spec]]),
  }))
    for (const a of run.anchors) {
      let x = Math.floor(a[0] / 3) - spec.acx * 56,
        z = Math.floor(a[2] / 3) - spec.acz * 56;
      for (let r = 0; r < (4 - rotation) % 4; r++) [x, z] = [55 - z, x];
      assert.ok(
        x >= 14 && x <= 41 && z >= 14 && z <= 41,
        'mount contact is inside authored facade',
      );
      assert.ok(
        !frameBuildingAir(frame, x, z).some(([lo, hi]) => a[1] > lo && a[1] < hi),
        'mount is solid architecture, not air',
      );
    }
}
for (const buf of Object.values(full))
  for (let i = 0; i < buf.idxs.length; i += 3) {
    const ids = buf.idxs.slice(i, i + 3),
      v = ids.map(
        (id) => new Vector3(...(buf.verts.slice(id * 3, id * 3 + 3) as [number, number, number])),
      );
    const normal = new Vector3(
      ...(buf.norms.slice(ids[0]! * 3, ids[0]! * 3 + 3) as [number, number, number]),
    );
    assert.ok(
      v[1]!.clone().sub(v[0]!).cross(v[2]!.clone().sub(v[0]!)).dot(normal) > 1e-10,
      'nondegenerate outward front faces',
    );
  }
const rendererSource = readFileSync(
  new URL('../src/engine/DungeonRenderer.ts', import.meta.url),
  'utf8',
);
assert.ok(
  rendererSource.includes('this.buildStructureUtilities(world, this.meshGroup)'),
  'full build includes utilities',
);
assert.ok(
  rendererSource.includes('this.buildStructureUtilities(w, chunk.group, bounds)'),
  'stream jobs include identical bounded utility pass',
);
// Exercise the real renderer pass without WebGL; same DOM shim as debug-view.
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
(globalThis as unknown as { self: unknown }).self = globalThis;
const THREE = await import('three');
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const scene = new THREE.Scene(),
  renderer = new DungeonRenderer(scene);
const internals = renderer as unknown as {
  meshGroup: import('three').Group;
  buildStructureUtilities: (
    world: WorldData,
    target: import('three').Group,
    bounds?: { x0: number; z0: number; x1: number; z1: number },
  ) => void;
  accumulating: Map<
    import('three').Group,
    { acc: Map<string, { buf: import('../src/engine/StructureUtilities').UtilityBuffers }> }
  >;
};
const renderWorld = { ...world, levels: [{ width: 168, height: 112 }] } as WorldData;
internals.buildStructureUtilities(renderWorld, internals.meshGroup);
assert.equal(internals.meshGroup.children.length, 3, 'just three meshes, no per-fitting draws');
let disposed = 0;
for (const child of internals.meshGroup.children)
  (child as import('three').Mesh).geometry.addEventListener('dispose', () => disposed++);
renderer.clear();
assert.equal(disposed, 3, 'ordinary clear disposes all utility geometry');
const target = new THREE.Group(),
  chunk = { acc: new Map() };
internals.accumulating.set(target, chunk);
for (let z = 0; z < 112; z += 14)
  for (let x = 0; x < 168; x += 14)
    internals.buildStructureUtilities(renderWorld, target, {
      x0: x,
      z0: z,
      x1: x + 14,
      z1: z + 14,
    });
assert.equal(chunk.acc.size, 3, 'stream quarter jobs merge into just three material batches');
assert.equal(target.children.length, 0, 'stream jobs defer mesh creation until flush');
assert.equal(
  [...chunk.acc.values()].reduce((n, e) => n + e.buf.idxs.length, 0),
  whole.length * 3,
  'real renderer receives all partition triangles',
);
internals.buildStructureUtilities({ ...world, levels: [] } as WorldData, target);
console.log(
  `structure utilities: ${runs.length} anchored decorative runs; ${whole.length} partition-owned triangles; renderer batching/disposal passed`,
);
