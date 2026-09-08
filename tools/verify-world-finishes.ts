import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { InfrastructurePrimitive } from '../src/game/dungeon/infrastructure-solid';
assert.ok(
  existsSync(new URL('../src/game/dungeon/infrastructure-finishes.ts', import.meta.url)),
  'pipe finishes must be chosen from stable service/world context',
);
const { pipeFinish, mountedPipeFinish } =
  await import('../src/game/dungeon/infrastructure-finishes');
const p: InfrastructurePrimitive = {
  id: 'infra:-2,1:east:1',
  kind: 'pipe',
  a: [-650, 70, 355],
  b: [-320, 70, 355],
  radius: 6,
  innerRadius: 5.1,
};
const primary = pipeFinish(1234, p);
assert.deepEqual(
  pipeFinish(1234, { ...p, id: 'infra:-2,1:east:4', a: [-320, 40, 355], b: [-320, 70, 355] }),
  primary,
  'one trunk keeps its finish through separate segments/risers',
);
assert.equal(primary.service, 'trunk');
const ret = pipeFinish(1234, { ...p, id: p.id + ':return', radius: 1.2, innerRadius: undefined });
const access = pipeFinish(1234, {
  ...p,
  id: 'infra:-2,1:access:port:0:entry',
  radius: 2.4,
  innerRadius: 1.8,
});
assert.equal(ret.service, 'return');
assert.equal(access.service, 'service');
assert.notEqual(primary.hex, ret.hex);
assert.notEqual(primary.hex, access.hex);
const colors = new Set<number>();
for (const seed of [42, 1234])
  for (let z = -3; z <= 3; z++)
    for (let x = -3; x <= 3; x++) {
      const f = pipeFinish(seed, { ...p, id: `infra:${x},${z}:east:1` });
      colors.add(f.hex);
      assert.ok(f.color.every((v: number) => Number.isFinite(v) && v > 0 && v <= 1));
      assert.deepEqual(
        f,
        pipeFinish(seed, { ...p, id: `infra:${x},${z}:south:2` }),
        'coarse owner establishes a construction finish, not per-mesh random paint',
      );
    }
assert.ok(colors.size >= 5, 'the world cannot be one universal green pipe material');
assert.deepEqual(
  mountedPipeFinish(1, 'frame:-2,1', 0.55, [0, 0, 0]),
  mountedPipeFinish(1, 'frame:-2,1', 0.55, [300, 0, 300]),
  'mounted bank ownership, not window/anchor choice, keeps its finish',
);
const { buildWorldInfrastructureBuffers } = await import('../src/engine/InfrastructureRenderer');
const world = {
  seed: 1234,
  stack: 0,
  originPcx: -4,
  originPcz: 1,
  infrastructure: { primitives: [p] },
} as any;
const buffers = buildWorldInfrastructureBuffers(world, { x0: 0, z0: 0, x1: 224, z1: 224 });
assert.ok(buffers.pipe.colors?.length, 'actual pipe vertices carry their finish');
assert.equal(buffers.pipe.colors!.length, buffers.pipe.verts.length);
for (let i = 0; i < buffers.pipe.colors!.length; i += 3)
  assert.deepEqual(buffers.pipe.colors!.slice(i, i + 3), primary.color);
const rebased = buildWorldInfrastructureBuffers(
  { ...world, originPcx: -3, originPcz: 0 },
  { x0: -56, z0: 56, x1: 168, z1: 280 },
);
assert.deepEqual(
  rebased.pipe.colors,
  buffers.pipe.colors,
  'recenter changes neither service finish nor any vertex colour',
);
assert.deepEqual(
  rebased.pipe.uvs,
  buffers.pipe.uvs,
  'finish pass preserves the corrected UV chart across recenter',
);
console.log(
  `world finishes: ${colors.size} context finishes; service separation, segment identity and actual pipe RGB buffers passed`,
);

(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
const THREE = await import('three');
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const renderer: any = new DungeonRenderer(new THREE.Scene()),
  group = new THREE.Group();
renderer.tintAt = () => {
  assert.fail('explicit service paint must not be replaced by generic biome tint');
};
renderer.addMesh(group, buffers.pipe, renderer.utilityMaterials.pipe, 'paint-test');
assert.equal(
  renderer.utilityMaterials.pipe.vertexColors,
  true,
  'shipping pipe shader must use service RGB',
);
const painted = group.children[0] as import('three').Mesh;
assert.deepEqual(
  Array.from(painted.geometry.getAttribute('color').array),
  buffers.pipe.colors!.map(Math.fround),
);
const target = new THREE.Group(),
  chunk = { acc: new Map() };
renderer.accumulating.set(target, chunk);
renderer.addMesh(target, buffers.pipe, renderer.utilityMaterials.pipe, 'paint-test');
renderer.addMesh(target, buffers.pipe, renderer.utilityMaterials.pipe, 'paint-test');
assert.deepEqual(
  [...chunk.acc.values()][0].buf.colors,
  [...buffers.pipe.colors!, ...buffers.pipe.colors!],
  'streamed accumulation keeps every vertex color',
);
console.log('world finishes: actual renderer and streamed accumulation retain service paint');
