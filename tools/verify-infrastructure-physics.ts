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
const { GameEngine } = await import('../src/engine/GameEngine');
const { generateWorldChunked } = await import('../src/game/gen/assemble');
const { prepareWindow } = await import('../src/game/dungeon/window-prep');
const { infrastructureColumnAt, infrastructureBaseWorld } =
  await import('../src/game/dungeon/infrastructure-columns');
const { FoldContour } = await import('../src/game/dungeon/fold-contour');
const w = generateWorldChunked({ seed: 1234, stack: 1 });
const e = Object.create(GameEngine.prototype) as any;
Object.assign(e, {
  world: w,
  originPcx: 0,
  originPcz: 0,
  gridCamera: { position: new THREE.Vector3(), eyeHeight: 1.6 },
  ...prepareWindow(w),
  foldContour: new FoldContour(infrastructureBaseWorld(w)),
  movers: null,
  crouchAmount: 0,
  input: { hasMovementOverride: () => false },
});
const p = w.infrastructure!.primitives.find(
  (p) =>
    p.kind === 'pipe' &&
    p.innerRadius &&
    Math.abs(p.b[0] - p.a[0]) > 250 &&
    p.a[0] > 0 &&
    p.a[2] > 0,
)!;
assert.ok(p, 'real long exposed/refined pipe');
const x = p.a[0] + (p.b[0] - p.a[0]) * 0.43,
  z = p.a[2] + p.radius * 0.8;
assert.deepEqual(
  e.columnAt(x, z),
  infrastructureColumnAt(w, x, z),
  'engine must query the actual octagonal facet, not the tile-center pipe projection',
);
e.gridCamera.position.set(x, p.a[1] + p.radius + 1, z);
const expected = infrastructureColumnAt(w, x, z)!
  .filter((s) => s.floor <= p.a[1] + p.radius + 1)
  .at(-1)!.floor;
assert.ok(
  Math.abs(e.worldGround(x, z, p.a[1] + p.radius + 1) - expected) < 1e-5,
  'standing surface follows exact sloping pipe facet',
);
const cable = w.infrastructure!.primitives.find((p) => p.kind === 'cable')!;
assert.ok(cable, 'real physical cable generated with access');
const c = cable.a.map((v, i) => (v + cable.b[i]!) / 2);
e.gridCamera.position.set(c[0], c[1]! - 0.8, c[2]);
assert.ok(
  e.collisionNormalAt(c[0], c[2]),
  'thin cable collision cannot disappear between tile centers',
);
const innerZ = p.a[2],
  innerY = p.a[1] - p.innerRadius!;
e.gridCamera.position.set(x, innerY + 0.01, innerZ);
assert.equal(
  e.collisionNormalAt(x, innerZ),
  null,
  'standing inside the pipe bore is not blocked by its voxel envelope',
);
console.log(
  'infrastructure physics: exact facet ground, real pipe bore and sub-tile cable collision passed through GameEngine queries',
);
for (const site of w.infrastructure!.access)
  for (const ladder of site.ladders) {
    for (let y = ladder.bottom; y <= ladder.top; y += 0.15)
      assert.ok(
        e.ladderClear({ x: ladder.x, y, z: ladder.z }),
        `actual generated ladder body corridor blocked: ${ladder.id} y=${y}`,
      );
    assert.ok(
      e.ladderClear({ x: ladder.exitX, y: ladder.top, z: ladder.exitZ }),
      `actual generated ladder exit blocked: ${ladder.id}`,
    );
    for (let t = 0; t <= 1; t += 0.05)
      assert.ok(
        e.ladderClear({
          x: ladder.x + (ladder.exitX - ladder.x) * t,
          y: ladder.top,
          z: ladder.z + (ladder.exitZ - ladder.z) * t,
        }),
        `physical rung/rail blocks top dismount: ${ladder.id}`,
      );
  }
console.log(
  'infrastructure physics: complete generated access ladder corridors and exits are clear',
);
