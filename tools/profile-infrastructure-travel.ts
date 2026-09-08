import { writeFileSync } from 'node:fs';
import { generateWorldChunked } from '../src/game/gen/assemble';
import {
  buildWorldInfrastructureBuffers,
  buildWorldInfrastructureBuffersIncrementally,
} from '../src/engine/InfrastructureRenderer';
import {
  infrastructureColumnAt,
  infrastructureBodyBlocked,
  infrastructureVerticalContact,
} from '../src/game/dungeon/infrastructure-columns';
const output = process.argv[2] ?? '/tmp/infrastructure-travel-profile.json';
const start = performance.now();
const w = generateWorldChunked({ seed: 1234, stack: 1 });
const generationMs = performance.now() - start;
const mesh: { x: number; z: number; ms: number; triangles: number }[] = [];
const physics: { x: number; z: number; ms: number }[] = [];
const streamSlices: { x: number; z: number; ms: number }[] = [];
const save = () =>
  writeFileSync(output, JSON.stringify({ generationMs, mesh, physics, streamSlices }, null, 2));
// The actual quarter jobs used during streaming, including cold pipe junctions.
for (let z = 0; z < 112; z += 14)
  for (let x = 0; x < 112; x += 14) {
    const t = performance.now();
    const b = buildWorldInfrastructureBuffers(w, { x0: x, z0: z, x1: x + 14, z1: z + 14 });
    const row = {
      x,
      z,
      ms: performance.now() - t,
      triangles: Object.values(b).reduce((n, b) => n + b.idxs.length / 3, 0),
    };
    mesh.push(row);
    save();
    if (row.ms > 30) console.log('slow mesh', row);
  }
// Cold and warm motion through successive local physics neighborhoods.
for (let i = 0; i < 240; i++) {
  const x = 30 + i * 0.75,
    z = 22.5,
    y = 78.9,
    t = performance.now();
  for (const [dx, dz] of [
    [0, 0],
    [0.35, 0],
    [-0.35, 0],
    [0, 0.35],
    [0, -0.35],
    [0.247, 0.247],
    [-0.247, 0.247],
    [0.247, -0.247],
    [-0.247, -0.247],
  ])
    infrastructureColumnAt(w, x + dx!, z + dz!);
  infrastructureVerticalContact(w, x, z, y + 0.6, 0.35, 'floor');
  infrastructureVerticalContact(w, x, z, y, 0.35, 'ceiling');
  infrastructureBodyBlocked(w, x, y + 0.65, z, 1.1, 0.35);
  physics.push({ x, z, ms: performance.now() - t });
}
const delivered = structuredClone(w);
for (const job of mesh) {
  const work = buildWorldInfrastructureBuffersIncrementally(delivered, {
    x0: job.x,
    z0: job.z,
    x1: job.x + 14,
    z1: job.z + 14,
  });
  let done = false;
  while (!done) {
    const t = performance.now();
    let step;
    do {
      step = work.next();
    } while (!step.done && performance.now() - t < 2);
    done = !!step.done;
    streamSlices.push({ x: job.x, z: job.z, ms: performance.now() - t });
  }
  save();
}
save();
const summary = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return {
    samples: v.length,
    totalMs: v.reduce((a, b) => a + b, 0),
    medianMs: v[Math.floor(v.length * 0.5)],
    p95Ms: v[Math.floor(v.length * 0.95)],
    maxMs: v[v.length - 1],
  };
};
console.log(
  JSON.stringify(
    {
      generationMs,
      mesh: summary(mesh.map((x) => x.ms)),
      streamSlices: summary(streamSlices.map((x) => x.ms)),
      physics: summary(physics.map((x) => x.ms)),
      output,
    },
    null,
    2,
  ),
);
