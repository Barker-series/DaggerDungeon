import assert from 'node:assert/strict';
import {
  infrastructureBoundaryFaces,
  infrastructureIntervalsAt,
  primitiveBounds,
  type InfrastructurePrimitive,
} from '../src/game/dungeon/infrastructure-solid';
const pipe: InfrastructurePrimitive = {
  id: 'pipe',
  kind: 'pipe',
  a: [0, 0, 0],
  b: [0, 90, 0],
  radius: 6,
  innerRadius: 5.1,
};
const fixtures: InfrastructurePrimitive[] = Array.from({ length: 240 }, (_, i) => ({
  id: `rung:${i}`,
  kind: 'support',
  a: [-0.46, 1 + i * 0.3, 4.6],
  b: [0.46, 1 + i * 0.3, 4.6],
  radius: 0.042,
}));
const bare = infrastructureBoundaryFaces([pipe]).filter((f) => f.primitive.id === 'pipe');
const detailed = infrastructureBoundaryFaces([pipe, ...fixtures]).filter(
  (f) => f.primitive.id === 'pipe',
);
// Every rung is wholly inside the bore and touches neither shell nor ends.
// It must remain visible/physical, but cannot split disjoint pipe surfaces.
assert.equal(
  detailed.length,
  bare.length,
  'interior rungs must not gratuitously subdivide untouched pipe walls',
);
for (const p of fixtures)
  assert.ok(
    infrastructureIntervalsAt([pipe, ...fixtures], 0, 4.6).some(
      ([lo, hi]) => lo < p.a[1] && hi > p.a[1],
    ),
    'rungs remain physical',
  );
console.log(
  `performance guard: ${fixtures.length} independent fittings leave ${bare.length} untouched pipe faces unchanged`,
);

const renderer = await import('../src/engine/InfrastructureRenderer');
assert.equal(
  typeof renderer.buildInfrastructureBuffersIncrementally,
  'function',
  'travel builds must be resumable rather than one unbounded CSG job',
);
const ps = [pipe, ...fixtures],
  bounds = { x0: -10, z0: -10, x1: 10, z1: 10 };
const expected = renderer.buildInfrastructureBuffers(ps, bounds);
const work = renderer.buildInfrastructureBuffersIncrementally(structuredClone(ps), bounds);
let steps = 0,
  result = work.next();
while (!result.done) {
  steps++;
  result = work.next();
}
assert.ok(
  steps > fixtures.length,
  'work yields within expensive primitive construction, not only after the entire mesh',
);
assert.deepEqual(
  result.value,
  expected,
  'resuming changes neither vertices, normals, UVs nor triangle indices',
);
console.log(
  `performance guard: ${steps} cooperative work slices preserve the exact synchronous mesh`,
);

const cancelledInput = structuredClone(ps),
  cancelled = renderer.buildInfrastructureBuffersIncrementally(cancelledInput, bounds);
for (let i = 0; i < 100; i++) cancelled.next();
cancelled.return(undefined as never);
assert.deepEqual(
  renderer.buildInfrastructureBuffers(cancelledInput, bounds),
  expected,
  'cancellation never publishes partial cached geometry',
);
const cases: InfrastructurePrimitive[] = [
  structuredClone(pipe),
  {
    id: 'tilted',
    kind: 'pipe',
    a: [-1234, 3, -456],
    b: [120, 28, 99],
    radius: 4.5,
    innerRadius: 3.6,
  },
  { id: 'cable', kind: 'cable', a: [-19, 7, 4], b: [-8, 2, 17], radius: 0.03 },
];
for (const p of cases) {
  const cold = primitiveBounds(p);
  infrastructureBoundaryFaces([p]);
  assert.deepEqual(
    primitiveBounds(p),
    cold,
    'cheap broad-phase bounds exactly match the fully constructed prism',
  );
}
console.log('performance guard: cancelled work and lazy bounds preserve the physical model');
