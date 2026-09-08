import assert from 'node:assert/strict';
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
const { generateWorldChunked } = await import('../src/game/gen/assemble');
const world = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: -1 });
const scene = new THREE.Scene();
const renderer = new DungeonRenderer(scene);
const internals = renderer as unknown as {
  buildPipeChamfers(w: typeof world, target: InstanceType<typeof THREE.Group>): void;
};
const group = new THREE.Group();
internals.buildPipeChamfers(world, group);
group.updateMatrixWorld(true);
for (const o of group.children)
  ((o as InstanceType<typeof THREE.Mesh>).material as InstanceType<typeof THREE.Material>).side =
    THREE.DoubleSide;
// Exact wrong-side hotspot from the new shelf: a ray enters the uncapped
// end of a tunnel bevel before seeing the back of its correctly wound slope.
const ray = new THREE.Raycaster(
  new THREE.Vector3(436.5, 29.1, 235.5),
  new THREE.Vector3(0.848, -0.272, 0.454).normalize(),
);
const hit = ray.intersectObjects(group.children)[0];
assert.ok(hit?.face, 'ray must hit the mouth trim');
assert.ok(
  hit.face.normal.dot(ray.ray.direction) < 0,
  'tunnel bevel end must be capped before the ray sees its back',
);
console.log('service shelf view: tunnel-mouth bevel end is front-facing');
