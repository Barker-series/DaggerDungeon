import assert from 'node:assert/strict';
import { compileStructurePlan, type StructurePlan } from '../src/game/dungeon/structure-kit';

const plan = compileStructurePlan({
  name: 'landing',
  bounds: { x0: 0, x1: 2, z0: 0, z1: 2 },
  pieces: [{ kind: 'landing', rect: { x0: 0, x1: 1, z0: 1, z1: 2 }, y: 0, thickness: 1.5 }],
  sockets: [],
});
const solids: [number, number][] = [[-4, -3]];
plan.appendSolids(1, 2, 9.5, solids);
assert.deepEqual(solids, [
  [-4, -3],
  [8, 9.5],
]);
plan.appendSolids(2, 2, 9.5, solids);
plan.appendSolids(-1, 2, 9.5, solids);
assert.equal(solids.length, 2);
const flight = compileStructurePlan({
  name: 'return-flight',
  bounds: { x0: 0, x1: 1, z0: 20, z1: 27 },
  sockets: [],
  pieces: [
    {
      kind: 'flight',
      rect: { x0: 0, x1: 1, z0: 20, z1: 27 },
      axis: 'z',
      direction: -1,
      start: 28,
      maxSteps: 8,
      rise: 0.6,
      y: 4.2,
      thickness: 1.5,
    },
  ],
});
for (const base of [-80.5, 0.5, 18.5, 144.5])
  for (let z = 20; z <= 27; z++) {
    const out: [number, number][] = [];
    flight.appendSolids(0, z, base, out);
    const y = base + 4.2 + (28 - z) * 0.6;
    assert.deepEqual(out, [[y - 1.5, y]], 'float operation order must be preserved');
  }
const doorway = compileStructurePlan({
  name: 'doorway',
  bounds: { x0: 0, x1: 1, z0: 0, z1: 0 },
  pieces: [
    { kind: 'solid', rect: { x0: 0, x1: 1, z0: 0, z1: 0 }, lo: 0, hi: 9 },
    { kind: 'opening', rect: { x0: 1, x1: 1, z0: 0, z1: 0 }, lo: 0, hi: 6 },
  ],
  sockets: [{ name: 'entry', role: 'entry', x: 1, z: 0, y: 0 }],
});
const doorSolids: [number, number][] = [];
doorway.appendSolids(1, 0, 0.5, doorSolids);
doorway.appendSolids(0, 0, 0.5, doorSolids);
assert.deepEqual(doorSolids, [
  [6.5, 9.5],
  [0.5, 9.5],
]);
assert.deepEqual(doorway.sockets.entry, { name: 'entry', role: 'entry', x: 1, z: 0, y: 0 });
const valid: StructurePlan = {
  name: 'validation',
  bounds: { x0: 0, x1: 2, z0: 0, z1: 2 },
  pieces: [{ kind: 'slab', rect: { x0: 0, x1: 2, z0: 0, z1: 2 }, y: 0, thickness: 1 }],
  sockets: [{ name: 'entry', role: 'entry', x: 1, z: 1, y: 0 }],
};
const rejects = (change: (p: any) => void, message: RegExp) => {
  const p = structuredClone(valid);
  change(p);
  assert.throws(() => compileStructurePlan(p), message);
};
rejects((p) => (p.name = ''), /name/);
rejects((p) => (p.bounds.x0 = NaN), /bounds.*integer/);
rejects((p) => (p.bounds.x1 = -1), /bounds.*ordered/);
rejects((p) => (p.bounds.x1 = 100000), /bounds.*65536/);
rejects((p) => (p.pieces[0].rect.z1 = 3), /piece 0.*bounds/);
rejects((p) => (p.pieces[0].rect.x0 = 0.5), /piece 0.*integer/);
rejects((p) => (p.pieces[0].thickness = 0), /piece 0.*thickness/);
rejects((p) => (p.pieces[0].y = Infinity), /piece 0.*finite/);
rejects((p) => (p.pieces[0].kind = 'mesh'), /piece 0.*kind/);
rejects((p) => (p.pieces = [{ kind: 'solid', rect: p.bounds, lo: 1, hi: 1 }]), /piece 0.*interval/);
rejects((p) => (p.sockets[0].role = 'spawn-whatever'), /socket entry.*role/);
rejects((p) => p.sockets.push(p.sockets[0]), /socket entry.*duplicate/);
rejects((p) => (p.sockets[0].x = 3), /socket entry.*bounds/);
rejects((p) => (p.sockets[0].y = NaN), /socket entry.*finite/);
rejects(
  (p) =>
    (p.pieces = [
      {
        kind: 'flight',
        rect: p.bounds,
        axis: 'z',
        direction: 1,
        start: 1,
        maxSteps: 3,
        rise: 0.6,
        y: 0,
        thickness: 1,
      },
    ]),
  /piece 0.*start/,
);
const flightPlan: StructurePlan = {
  name: 'outward',
  bounds: { x0: 1, x1: 4, z0: 0, z1: 0 },
  sockets: [],
  pieces: [
    {
      kind: 'flight',
      rect: { x0: 1, x1: 4, z0: 0, z1: 0 },
      axis: 'x',
      direction: 1,
      start: 0,
      maxSteps: 3,
      rise: 0.6,
      y: 0,
      thickness: 1.5,
    },
  ],
};
for (const [field, value, error] of [
  ['axis', 'y', /axis/],
  ['direction', 0, /direction/],
  ['start', 0.5, /start/],
  ['maxSteps', 0, /maxSteps/],
  ['maxSteps', 1.5, /maxSteps/],
  ['rise', 0, /rise/],
  ['rise', Infinity, /finite/],
] as const) {
  const p = structuredClone(flightPlan);
  (p.pieces[0] as any)[field] = value;
  assert.throws(() => compileStructurePlan(p), error);
}
const outward = compileStructurePlan(flightPlan);
const treads: [number, number][] = [];
for (let x = 1; x <= 4; x++) outward.appendSolids(x, 0, 0.5, treads);
assert.deepEqual(
  treads.map((s) => s[1]),
  [0.5 + 0.6, 0.5 + 2 * 0.6, 0.5 + 3 * 0.6, 0.5 + 3 * 0.6],
);
// Compiled recipes snapshot data: subsequent authoring mutations cannot make
// an already-validated instance change beneath column generation.
(flightPlan.pieces[0] as any).rise = NaN;
(flightPlan.bounds as any).x1 = -1;
const again: [number, number][] = [];
outward.appendSolids(1, 0, 0.5, again);
assert.deepEqual(again, [treads[0]]);
assert.ok(Object.isFrozen(doorway.sockets.entry));

const split = compileStructurePlan({
  name: 'cuts',
  bounds: { x0: 0, x1: 0, z0: 0, z1: 0 },
  sockets: [],
  pieces: [
    // Authored solid order remains intact; openings are subtractive regardless
    // of declaration order, and overlapping cuts never emit reversed spans.
    { kind: 'opening', rect: { x0: 0, x1: 0, z0: 0, z1: 0 }, lo: 2, hi: 4 },
    { kind: 'solid', rect: { x0: 0, x1: 0, z0: 0, z1: 0 }, lo: 10, hi: 12 },
    { kind: 'solid', rect: { x0: 0, x1: 0, z0: 0, z1: 0 }, lo: 0, hi: 9 },
    { kind: 'opening', rect: { x0: 0, x1: 0, z0: 0, z1: 0 }, lo: 3, hi: 5 },
    { kind: 'opening', rect: { x0: 0, x1: 0, z0: 0, z1: 0 }, lo: 7, hi: 9 },
  ],
});
const splitOut: [number, number][] = [];
split.appendSolids(0, 0, -0.5, splitOut);
assert.deepEqual(splitOut, [
  [9.5, 11.5],
  [-0.5, 1.5],
  [4.5, 6.5],
]);
const stacked: [number, number][] = [];
flight.appendLevels(0, 23, -9, 16, 9, 0.5, stacked);
const separate: [number, number][] = [];
for (let level = -9; level <= 16; level++) flight.appendSolids(0, 23, level * 9 + 0.5, separate);
assert.deepEqual(stacked, separate, 'bulk storeys retain level/piece order and exact arithmetic');
const splitStack: [number, number][] = [];
split.appendLevels(0, 0, -1, 1, 9, 0.5, splitStack);
const splitSeparate: [number, number][] = [];
for (let level = -1; level <= 1; level++) split.appendSolids(0, 0, level * 9 + 0.5, splitSeparate);
assert.deepEqual(splitStack, splitSeparate);
split.appendLevels(1, 0, -1, 1, 9, 0.5, splitStack);
split.appendLevels(0, 0, 1, -1, 9, 0.5, splitStack);
assert.deepEqual(splitStack, splitSeparate, 'outside and empty stacks append nothing');
console.log('structure-kit: sampling, sockets and compile-time validation pass');
