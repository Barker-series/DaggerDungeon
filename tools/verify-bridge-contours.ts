import assert from 'node:assert/strict';
import { generateWorldChunked } from '../src/game/gen/assemble';
import { buildOrganicContour } from '../src/game/dungeon/organiccontour';

// Exact user reproduction: a bridge traverses a ground-contour/cliff boundary.
const world = generateWorldChunked({ seed: 1788654748228, stack: 1, originPcx: -1, originPcz: -5 });
const level = world.levels[0]!;
const w = level.width;
assert.ok(
  world.columns[108 * w + 84]!.some((s) => s.floor === 45.5 && s.ceil === 51.5),
  'fixture contains the actual bridge bore',
);
const contour = buildOrganicContour(level, world.columns);
assert.ok(
  !contour.softWalls.has(108 * w + 84),
  'a wall pierced by a bridge must not remain a full-height soft wall',
);
assert.ok(
  !contour.segmentGroups.has(108 * w + 84),
  'a contour group cannot extrude a ground wall through authored bridge air',
);
assert.ok(contour.softWalls.size > 0, 'ordinary organic walls must remain contoured');

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
const scene = new THREE.Scene();
new DungeonRenderer(scene).build(world);
// Double-sided only in this test to catch the erroneous back-facing seal.
scene.traverse((o) => {
  if (o instanceof THREE.Mesh)
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      m.side = THREE.DoubleSide;
});
scene.updateMatrixWorld(true);
const direction = new THREE.Vector3(0.567, -0.034, -0.823).normalize();
const ray = new THREE.Raycaster(new THREE.Vector3(250.69, 48.75, 332.71), direction, 0, 30);
const hit = ray.intersectObjects(scene.children, true)[0];
assert.ok(
  hit?.face && hit.face.normal.dot(direction) < 0,
  'the exact view must not hit the back of a contour seal',
);
assert.ok(
  hit && Math.abs(hit.point.x - 258) < 0.01,
  'the three-wide passage must remain open up to its actual side wall',
);
console.log(
  'bridge contours: exact raised-passage reproduction, structural contour exclusion and rendered side-wall ray passed',
);
