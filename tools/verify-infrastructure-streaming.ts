import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';

import { generateWorldChunked } from '../src/game/gen/assemble';
import { buildWorldInfrastructureBuffers } from '../src/engine/InfrastructureRenderer';

// Bundle in memory to apply Vite's DEV constant; no browser/GPU or output files.
(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
(globalThis as any).self = globalThis;
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const THREE = require('three');
const compiled = await build({
  entryPoints: ['src/engine/DungeonRenderer.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: { 'import.meta.env.DEV': 'false' },
  logLevel: 'silent',
});
const module = new Module(import.meta.filename);
(module as any).paths = (Module as any)._nodeModulePaths(process.cwd());
(module as any)._compile(compiled.outputFiles[0]!.text, import.meta.filename);
const { DungeonRenderer } = module.exports;
const world = generateWorldChunked({ seed: 1234, stack: 1 });
const renderer: any = new DungeonRenderer(new THREE.Scene());
// Isolate infrastructure, not its scheduler/accumulation/flush machinery.
renderer.chunkWorld = world;
renderer.tintWorld = world;
renderer.chunkCtx = { cornerFloors: [], contours: [] };
for (const pass of [
  'buildLevelSurfaces',
  'buildWalls',
  'buildPipeChamfers',
  'buildStructureUtilities',
  'buildPitRims',
  'buildSegmentWalls',
  'buildTunnelTrim',
  'buildRoadsWalls',
])
  renderer[pass] = () => {};
renderer.buildInfrastructure = () => {
  assert.fail('streaming must never use the synchronous infrastructure builder');
};
const chunk = renderer.createChunk(world.originPcx, world.originPcz);
renderer.chunks.set(`${chunk.acx},${chunk.acz}`, chunk);
assert.equal(
  chunk.jobs.filter((j: any) => j.kind === 'infrastructure').length,
  16,
  'each quarter must schedule its own resumable infrastructure job',
);
console.log('infrastructure streaming job creation: PASS');
const bounds = chunk.jobs.filter((j: any) => j.kind === 'infrastructure').map((j: any) => j.bounds);

// A deterministic clock forces an actual generator to suspend and makes the
// outer eight-ms scheduler budget test independent of machine speed.
const originalNow = performance.now.bind(performance);
const jobTimes: number[] = [],
  infrastructureTimes: number[] = [],
  flushTimes: number[] = [];
const runChunkJob = renderer.runChunkJob;
renderer.runChunkJob = function (target: any) {
  const kind = target.jobs[0]?.kind;
  const start = originalNow();
  runChunkJob.call(this, target);
  const elapsed = originalNow() - start;
  jobTimes.push(elapsed);
  if (kind === 'infrastructure') infrastructureTimes.push(elapsed);
};
let ticks = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => ticks++ });
try {
  renderer.runChunkJob(chunk); // non-infrastructure passes only
  const job = chunk.jobs[0];
  renderer.runChunkJob(chunk);
  assert.equal(chunk.jobs[0], job, 'unfinished infrastructure stays at the queue front');
  assert.ok(job.builder, 'resumption retains the real generator');
  assert.equal(chunk.complete, false);
  assert.equal(chunk.group.parent, null, 'incomplete geometry remains off-scene');
  assert.equal(
    chunk.jobs.some((j: any) => j.kind === 'flush'),
    false,
  );
  const oldBuilder = job.builder;
  renderer.needsSyncFill = false;
  const cellDist = renderer.cellDist;
  renderer.cellDist = (_x: number, _z: number, x: number, z: number) =>
    x === chunk.acx && z === chunk.acz ? 0 : 1000;
  const before = ticks;
  renderer.updateChunks(0, 0);
  renderer.cellDist = cellDist;
  assert.ok(
    ticks - before >= 8 && ticks - before < 20,
    'updateChunks returns after its real outer budget',
  );
  assert.equal(job.builder, oldBuilder, 'next frame resumes, rather than rebuilding');
  assert.equal(chunk.complete, false);
} finally {
  Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
}

// Read the exact raw buffers entering the real emit path, and measure that
// path including THREE geometry, colors and indices (not GPU upload).
const emitted = new Map<string, any>();
const emitMesh = renderer.emitMesh;
renderer.emitMesh = function (group: any, buf: any, material: any, name: string) {
  emitted.set(name, buf);
  const start = originalNow();
  emitMesh.call(this, group, buf, material, name);
  flushTimes.push(originalNow() - start);
};
while (!chunk.complete) {
  assert.ok(chunk.jobs.length, 'pending geometry must never lose its final flush');
  if (chunk.jobs[0].kind === 'flush')
    assert.ok(
      chunk.jobs.every((j: any) => j.kind === 'flush'),
      'flushes follow ALL build and infrastructure jobs',
    );
  renderer.runChunkJob(chunk);
  assert.ok(jobTimes.length < 100000, 'scheduler must converge');
  if (!chunk.complete) assert.equal(chunk.group.parent, null);
}
assert.equal(chunk.group.parent, renderer.meshGroup);
assert.equal(chunk.acc.size, 0);
assert.equal(chunk.jobs.length, 0);
assert.ok(chunk.group.children.length > 0);
renderer.runChunkJob = runChunkJob;

// Sync reference uses identical quarter ownership and accumulation order.
const expected = new Map<string, any>();
for (const bound of bounds) {
  const batches = buildWorldInfrastructureBuffers(world, bound);
  for (const [key, buf] of Object.entries(batches)) {
    if (!buf.verts.length) continue;
    const name = `infrastructure-${key}`;
    let merged = expected.get(name);
    if (!merged) expected.set(name, (merged = { verts: [], norms: [], uvs: [], idxs: [] }));
    const offset = merged.verts.length / 3;
    for (const field of ['verts', 'norms', 'uvs'] as const)
      for (const value of buf[field]) merged[field].push(value);
    if (buf.colors || merged.colors) {
      if (!merged.colors) merged.colors = new Array(offset * 3).fill(1);
      for (let i = 0; i < buf.verts.length; i++) merged.colors.push(buf.colors?.[i] ?? 1);
    }
    for (const index of buf.idxs) merged.idxs.push(index + offset);
  }
}
assert.ok(expected.size > 0, 'fixture contains real infrastructure');
assert.deepEqual(emitted, expected, 'all accumulated buffers exactly match synchronous geometry');
renderer.emitMesh = emitMesh;
let disposed = 0;
chunk.group.traverse((child: any) => {
  if (child.isMesh) child.geometry.addEventListener('dispose', () => disposed++);
});
renderer.clearChunks();
assert.equal(renderer.meshGroup.children.length, 0);
assert.ok(disposed > 0, 'completed geometry is disposed');

// Adoption cancels a suspended generator, including background rebuilds.
const partial = renderer.createChunk(world.originPcx, world.originPcz);
const rebuild = renderer.createChunk(world.originPcx + 1, world.originPcz);
renderer.chunks.set(`${partial.acx},${partial.acz}`, partial);
renderer.chunkRebuilds.set(`${rebuild.acx},${rebuild.acz}`, rebuild);
ticks = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => ticks++ });
try {
  renderer.runChunkJob(partial);
  renderer.runChunkJob(partial);
  renderer.runChunkJob(rebuild);
  renderer.runChunkJob(rebuild);
} finally {
  Object.defineProperty(performance, 'now', { configurable: true, value: originalNow });
}
assert.ok(partial.jobs[0].builder && rebuild.jobs[0].builder);
let cancelledAdvances = 0;
partial.jobs[0].builder.next = rebuild.jobs[0].builder.next = () => {
  cancelledAdvances++;
  assert.fail('adoption must not resume stale-window CSG');
};
renderer.chunkStamp = `${world.seed}:${world.levels[0]!.floor ?? 0}:${renderer.configEpoch}`;
const moved = { ...world, originPcx: world.originPcx + 1 };
renderer.setWindow(moved, { cornerFloors: [], contours: [], roadsContour: {}, pitContour: {} });
assert.equal(renderer.chunks.size, 0);
assert.equal(renderer.chunkRebuilds.size, 0);
assert.equal(renderer.accumulating.has(partial.group), false);
assert.equal(renderer.accumulating.has(rebuild.group), false);
const replacement = renderer.createChunk(moved.originPcx, moved.originPcz);
assert.equal(replacement.jobs[0].bounds.x0, 0, 'replacement bounds use adopted origin');
assert.equal(replacement.jobs[1].builder, undefined);
renderer.chunks.set(`${replacement.acx},${replacement.acz}`, replacement);
renderer.cellDist = (_x: number, _z: number, x: number, z: number) =>
  x === replacement.acx && z === replacement.acz ? 0 : 1000;
renderer.needsSyncFill = true;
renderer.updateChunks(0, 0);
assert.equal(replacement.complete, true, 'initial synchronous fill also drains the resumable jobs');
assert.equal(replacement.group.parent, renderer.meshGroup);
assert.equal(replacement.acc.size, 0);
assert.equal(cancelledAdvances, 0);
renderer.clearChunks();
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      exactBufferBatches: expected.size,
      jobs: jobTimes.length,
      worstJobMs: Math.max(...jobTimes),
      worstInfrastructureJobMs: Math.max(...infrastructureTimes),
      worstFlushMs: Math.max(...flushTimes),
      flushes: flushTimes.length,
      checks: [
        'resumption',
        'frame budget',
        'off-scene until complete',
        'exact sync buffers',
        'final flush',
        'disposal',
        'recenter cancellation',
        'replacement sync fill',
      ],
    },
    null,
    2,
  ),
);
