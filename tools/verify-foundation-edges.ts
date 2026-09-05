import assert from 'node:assert/strict';

// Same headless renderer setup as tools/debug-view.ts, without a browser.
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
const world = generateWorldChunked({ seed: 1, stack: 1, originPcx: -8, originPcz: -5 });
const scene = new THREE.Scene();
new DungeonRenderer(scene).build(world);
scene.updateMatrixWorld(true);

// DDSNAP1{"seed":1,"stack":1,"opx":-8,"opz":-5,"x":292.7,"y":1.31,"z":255.38,"yaw":-15.335,"pitch":-0.604}
// The reported fin intersects the view's pixel (250,155) at x=294,y=0.70.
const ray = new THREE.Raycaster(
  new THREE.Vector3(292.7, 2.91, 255.38),
  new THREE.Vector3(0.28, -0.477, 0.833).normalize(),
  0,
  10,
);
const hit = ray.intersectObjects(scene.children, true)[0];
assert.ok(
  hit && hit.face && hit.face.normal.y > 0.5,
  `reported view must hit the drawn ground, not a vertical fin: ${JSON.stringify(hit && { point: hit.point, normal: hit.face?.normal })}`,
);

// At this end of the joint terrain is LOWER than the foundation. There must
// still be a small foundation face, oriented toward the terrain, not a hole.
const reverse = new THREE.Raycaster(
  new THREE.Vector3(294.1, -0.1, 258.5),
  new THREE.Vector3(-1, 0, 0),
  0,
  0.3,
);
const skirt = reverse.intersectObjects(scene.children, true)[0];
assert.ok(
  skirt?.face && Math.abs(skirt.point.x - 294) < 0.001 && skirt.face.normal.x > 0.9,
  'the lowered terrain side must see a correctly wound foundation edge',
);

const { floorEdgeSegments } = await import('../src/engine/floor-edge');
assert.deepEqual(floorEdgeSegments(0, 0, 0, 0), [], 'continuous ground has no riser');
assert.equal(floorEdgeSegments(0, 0, 0.6, 0.6)[0]?.towardA, true, 'real stair risers stay intact');
assert.equal(
  floorEdgeSegments(0, 0, -0.2, 0)[0]?.towardA,
  false,
  'a reversed step faces the lower terrain',
);
const crossing = floorEdgeSegments(0, 0, -0.5, 0.5);
assert.equal(crossing.length, 2, 'crossing profiles split at their intersection');
assert.equal(crossing[0]!.end, 0.5);
assert.equal(crossing[0]!.towardA, false);
assert.equal(crossing[1]!.towardA, true);
console.log(
  'foundation edges: exact DDSNAP fin removed, reverse-side seal and step/crossing profiles passed',
);
