import assert from 'node:assert/strict';
const solid = await import('../src/game/dungeon/infrastructure-solid');
const pipe = {
  id: 'x',
  kind: 'pipe' as const,
  a: [-20, 0, 0] as [number, number, number],
  b: [20, 0, 0] as [number, number, number],
  radius: 5,
  innerRadius: 4.25,
};
assert.deepEqual(solid.infrastructureIntervalsAt([pipe], 0, 0), [
  [-5, -4.25],
  [4.25, 5],
]);
const q = 5 * (Math.SQRT2 - 1);
const corner = solid.infrastructureIntervalsAt([pipe], 0, 4);
assert.ok(Math.abs(corner[0]![0] + (5 + q - 4)) < 1e-9, 'octagon not circular collision');
assert.deepEqual(solid.primitiveBounds(pipe), { x0: -20, y0: -5, z0: -5, x1: 20, y1: 5, z1: 5 });
console.log('PASS exact octagonal intervals and hollow bore');
const branch = {
  ...pipe,
  id: 'z',
  a: [0, 0, 0] as [number, number, number],
  b: [0, 0, 20] as [number, number, number],
};
const network = [pipe, branch];
assert.deepEqual(solid.infrastructureIntervalsAt(network, 0, 3), [
  [-5, -4.25],
  [4.25, 5],
]);
const faces = solid.infrastructureBoundaryFaces(network);
assert.ok(faces.length > 0);
for (const f of faces) {
  const c = f.vertices.reduce(
    (s, v) => s.map((a, i) => a + v[i]! / f.vertices.length) as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  const inside = (sign: number) => {
    const t = c.map((a, i) => a + sign * f.normal[i]! * 1e-5);
    return solid
      .infrastructureIntervalsAt(network, t[0]!, t[2]!)
      .some(([a, b]) => t[1]! > a && t[1]! < b);
  };
  assert.equal(inside(-1), true, `solid behind ${f.primitive.id} face at ${c}`);
  assert.equal(inside(1), false, `air ahead ${f.primitive.id} face at ${c}`);
}
assert.equal(
  solid.infrastructureBodyIntersects(network, { x: 0, y: -4.24, z: 0 }, 2, 0.35),
  false,
  'walkable T bore',
);
assert.equal(
  solid.infrastructureBodyIntersects(network, { x: 0, y: 4, z: 0 }, 2, 0.35),
  true,
  'blocked crown',
);
const wire = {
  ...pipe,
  id: 'wire',
  kind: 'cable' as const,
  a: [-2, 1, 0] as [number, number, number],
  b: [2, 1.5, 0] as [number, number, number],
  radius: 0.015,
  innerRadius: undefined,
};
assert.equal(
  solid.infrastructureBodyIntersects([wire], { x: 0, y: 0, z: 0 }, 2, 0.35),
  true,
  'thin diagonal wire cannot slip between probes',
);
console.log('PASS CSG T boundary winding and body clearance');

const rail = {
  id: 'interior-rail',
  kind: 'support' as const,
  a: [-3, 0, 0] as [number, number, number],
  b: [3, 0, 0] as [number, number, number],
  radius: 0.2,
};
const furnished = [pipe, rail];
assert.deepEqual(
  solid.infrastructureIntervalsAt(furnished, 0, 0),
  [
    [-5, -4.25],
    [-0.2, 0.2],
    [4.25, 5],
  ],
  'interior rail survives bore subtraction',
);
assert.equal(
  solid.infrastructureBodyIntersects(furnished, { x: 0, y: -0.1, z: 0 }, 0.2, 0.05),
  true,
);
assert.ok(
  solid.infrastructureBoundaryFaces(furnished).some((f) => f.primitive === rail),
  'interior rail has renderable boundary faces',
);

const riser = { ...pipe, id: 'vertical-riser', a: [0, -10, 0], b: [0, 20, 0] } as typeof pipe;
const tread = { ...rail, id: 'tread', a: [-2, 2, 0], b: [2, 2, 0], radius: 0.15 } as typeof rail;
const landing = {
  ...rail,
  id: 'landing',
  kind: 'deck' as const,
  a: [0, 5, 0] as [number, number, number],
  b: [0, 5.25, 0] as [number, number, number],
  radius: 4.6,
};
const bracket = {
  ...rail,
  id: 'bracket',
  a: [0, -1, 3],
  b: [0, -1, 6],
  radius: 0.3,
} as typeof rail;
const outsideWire = { ...wire, id: 'outside-wire', a: [-2, 7, 0], b: [2, 7.5, 0] } as typeof wire;
const fixtureScenarios = [
  furnished,
  [pipe, wire],
  [pipe, outsideWire],
  [riser, rail, tread, landing],
  [pipe, bracket],
  [pipe, branch, bracket, tread],
  [pipe, { ...rail, id: 'buried', a: [-3, 4.6, 0], b: [3, 4.6, 0] }],
  [pipe, { ...rail, id: 'touching', a: [-3, 4.05, 0], b: [3, 4.05, 0] }],
] as import('../src/game/dungeon/infrastructure-solid').InfrastructurePrimitive[][];
for (const ps of fixtureScenarios) {
  for (const f of solid.infrastructureBoundaryFaces(ps)) {
    const c = f.vertices.reduce(
      (s, v) => s.map((a, i) => a + v[i]! / f.vertices.length) as [number, number, number],
      [0, 0, 0] as [number, number, number],
    );
    for (const sign of [-1, 1]) {
      const t = c.map((a, i) => a + sign * f.normal[i]! * 1e-5);
      assert.equal(
        solid.infrastructureIntervalsAt(ps, t[0]!, t[2]!).some(([a, b]) => t[1]! > a && t[1]! < b),
        sign < 0,
        `fixture boundary side ${sign} for ${f.primitive.id} at ${c}`,
      );
    }
  }
}
for (const [ps, feet, height, radius] of [
  [[pipe, wire], { x: 0, y: 0, z: 0.2 }, 2, 0.25],
  [[pipe, outsideWire], { x: 0, y: 6, z: 0.2 }, 2, 0.25],
  [[riser, tread], { x: 0, y: 1.5, z: 0.2 }, 1, 0.25],
  [[riser, landing], { x: 0, y: 4.8, z: 0 }, 1, 0.25],
  [[pipe, bracket], { x: 0, y: -1.1, z: 3.5 }, 0.2, 0.1],
] as const)
  assert.equal(
    solid.infrastructureBodyIntersects(ps, feet, height, radius),
    true,
    'fixture blocks body including off-center boundary-only hits',
  );
assert.equal(
  solid.infrastructureBodyIntersects([riser, landing], { x: 0, y: 5.25, z: 0 }, 2, 0.35),
  false,
  'standing on landing is clear',
);
console.log(
  'PASS fixture intervals, boundary orientation and body contact (rail, tread, landing, bracket, cables)',
);

const render = await import('../src/engine/InfrastructureRenderer');
const full = render.buildInfrastructureBuffers(network, { x0: -25, z0: -25, x1: 25, z1: 25 });
const area = (b: typeof full): number =>
  Object.values(b).reduce((sum, buf) => {
    for (let i = 0; i < buf.idxs.length; i += 3) {
      const pts = buf.idxs.slice(i, i + 3).map((k) => buf.verts.slice(k * 3, k * 3 + 3));
      const u = pts[1]!.map((v, j) => v - pts[0]![j]!),
        v = pts[2]!.map((v, j) => v - pts[0]![j]!);
      sum +=
        Math.hypot(
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ) / 2;
    }
    return sum;
  }, 0);
let quarters = 0;
for (const [x0, x1] of [
  [-25, 0],
  [0, 25],
])
  for (const [z0, z1] of [
    [-25, 0],
    [0, 25],
  ])
    quarters += area(
      render.buildInfrastructureBuffers(network, { x0: x0!, x1: x1!, z0: z0!, z1: z1! }),
    );
assert.ok(
  Math.abs(area(full) - quarters) < 1e-6,
  'quarter clipping has identical surface area, no caps',
);
const base = [];
const projected = [];
const world = {
  columns: projected,
  infrastructureBaseColumns: base,
  infrastructure: { primitives: network },
} as any;
assert.equal(render.infrastructureRenderWorld(world).columns, base);
assert.equal(
  render.infrastructureRenderWorld(world),
  render.infrastructureRenderWorld(world),
  'cached shallow wrapper',
);
assert.equal(render.infrastructureRenderWorld(world).infrastructure, world.infrastructure);
console.log('PASS renderer exact area seams and base-column wrapper');

(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
(globalThis as any).self = globalThis;
const THREE = await import('three');
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const renderer = new DungeonRenderer(new THREE.Scene());
const internals = renderer as any;
const shifted = network.map((p) => ({
  ...p,
  a: [p.a[0] + 30, p.a[1] + 10, p.a[2] + 30],
  b: [p.b[0] + 30, p.b[1] + 10, p.b[2] + 30],
}));
const rw = {
  originPcx: 0,
  originPcz: 0,
  levels: [{ width: 28, height: 28 }],
  infrastructure: { primitives: shifted },
} as any;
internals.buildInfrastructure(rw, internals.meshGroup);
assert.equal(internals.meshGroup.children.length, 1, 'network is batched');
let disposed = 0;
for (const mesh of internals.meshGroup.children)
  mesh.geometry.addEventListener('dispose', () => disposed++);
renderer.clear();
assert.equal(disposed, 1, 'actual renderer disposal event');
const target = new THREE.Group(),
  chunk = { acc: new Map() };
internals.accumulating.set(target, chunk);
for (let z = 0; z < 28; z += 14)
  for (let x = 0; x < 28; x += 14)
    internals.buildInfrastructure(rw, target, { x0: x, z0: z, x1: x + 14, z1: z + 14 });
assert.equal(chunk.acc.size, 1, '14-tile jobs accumulate one shared pipe material');
console.log('PASS real renderer batching and geometry disposal');

const far = {
  ...pipe,
  id: 'far',
  a: [1000, 0, 0] as [number, number, number],
  b: [1040, 0, 0] as [number, number, number],
};
assert.equal(
  solid
    .infrastructureBoundaryFaces([...network, far], {
      x0: -30,
      y0: -10,
      z0: -30,
      x1: 30,
      y1: 10,
      z1: 30,
    })
    .some((f) => f.primitive === far),
  false,
  'bounded jobs never build remote primitive facets',
);
console.log('PASS spatially bounded facet generation');

const scenarios = [
  ...fixtureScenarios,
  network,
  [
    pipe,
    { ...pipe, id: 'collar', kind: 'collar' as const, a: [-1, 0, 0], b: [1, 0, 0], radius: 5.4 },
  ],
  [pipe, { ...pipe, id: 'riser', a: [0, 0, 0], b: [0, 20, 0] }],
  [pipe, { ...pipe, id: 'continuation', a: [20, 0, 0], b: [40, 0, 0] }],
  [{ ...pipe, id: 'diagonal', a: [-10, -4, -10], b: [10, 4, 10] }],
  [pipe, { ...pipe, id: 'duplicate' }],
] as import('../src/game/dungeon/infrastructure-solid').InfrastructurePrimitive[][];
let rays = 0,
  triangles = 0;
for (const ps of scenarios) {
  const batch = render.buildInfrastructureBuffers(ps, { x0: -50, z0: -50, x1: 50, z1: 50 });
  const meshes = Object.values(batch).map((b) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.verts, 3));
    g.setIndex(b.idxs);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld();
    return mesh;
  });
  for (const b of Object.values(batch))
    for (let i = 0; i < b.idxs.length; i += 3) {
      const [a, c, d] = b.idxs
        .slice(i, i + 3)
        .map(
          (k) =>
            new THREE.Vector3(...(b.verts.slice(k * 3, k * 3 + 3) as [number, number, number])),
        );
      const n = c!.clone().sub(a!).cross(d!.clone().sub(a!));
      const normal = new THREE.Vector3(
        ...(b.norms.slice(b.idxs[i]! * 3, b.idxs[i]! * 3 + 3) as [number, number, number]),
      );
      assert.ok(n.dot(normal) > 0, 'geometric front winding, not smooth normal proxy');
      triangles++;
    }
  const samples: [number, number][] = [
    [0.123, 0.003],
    [0.123, 3.5],
    [0.123, 4.4],
  ];
  for (let z = -11.371; z < 12; z += 1.713)
    for (let x = -22.217; x < 43; x += 2.371) samples.push([x, z]);
  for (const [x, z] of samples) {
    const intervals = solid.infrastructureIntervalsAt(ps, x, z);
    for (const dir of [-1, 1]) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(x, dir < 0 ? 60 : -60, z),
        new THREE.Vector3(0, dir, 0),
      );
      const hits = ray
        .intersectObjects(meshes)
        .map((h) => h.point.y)
        .sort((a, b) => a - b)
        .filter((y, i, ys) => i === 0 || Math.abs(y - ys[i - 1]!) > 1e-4);
      const expected = intervals.map((v) => (dir < 0 ? v[1] : v[0]));
      assert.equal(
        hits.length,
        expected.length,
        `front-ray crossings x=${x} z=${z} case=${ps[0]!.id}`,
      );
      hits.forEach((y, i) => assert.ok(Math.abs(y - expected[i]!) < 2e-5));
      rays++;
    }
  }
  for (const m of meshes) {
    m.geometry.dispose();
    m.material.dispose();
  }
}
console.log(
  `PASS ${rays} analytic/front-face ray comparisons; ${triangles} geometric winding checks (T, collars, risers, collinear joints, diagonal, coincident)`,
);

// Real full-build and streaming adoption must use structural, not projected,
// columns even when callers supply a previously computed contour context.
const { generateWorldChunked } = await import('../src/game/gen/assemble');
const generated = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: 0 });
const structural = (generated as any).infrastructureBaseColumns ?? generated.columns;
const combined = {
  ...generated,
  infrastructureBaseColumns: structural,
  columns: structural.map((c) => c.map((s) => ({ ...s }))),
  infrastructure: { ...(generated as any).infrastructure, primitives: shifted },
} as any;
const adopted = new DungeonRenderer(new THREE.Scene());
const ai = adopted as any;
adopted.setWindow(combined);
assert.equal(ai.chunkWorld.columns, structural);
const shared = ai.chunkCtx;
adopted.setWindow(combined, shared);
assert.equal(ai.chunkWorld.columns, structural);
adopted.build(combined);
assert.equal(ai.tintWorld.columns, structural);
assert.ok(
  ai.meshGroup.children.some((m: any) => m.name === 'infrastructure-pipe'),
  'full-build infrastructure pass',
);
adopted.clear();
console.log('PASS real full build and shared-context streaming adoption use base columns');
