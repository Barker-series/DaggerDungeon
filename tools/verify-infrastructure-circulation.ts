import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { planInfrastructureCell } from '../src/game/dungeon/infrastructure-network';
import {
  infrastructureBodyIntersects,
  infrastructureIntervalsAt,
  type InfrastructurePrimitive,
} from '../src/game/dungeon/infrastructure-solid';
import { infrastructureLadderPrimitives } from '../src/game/dungeon/infrastructure-columns';
assert.ok(
  existsSync(new URL('../src/game/dungeon/infrastructure-circulation.ts', import.meta.url)),
  'circulation factory must exist',
);
const { planInfrastructureCirculation } =
  await import('../src/game/dungeon/infrastructure-circulation');
let ladders = 0,
  sweeps = 0,
  beams = 0,
  anchors = 0;
const failures: string[] = [];
for (const seed of [42, 7, 1337])
  for (const [cx, cz] of [
    [0, 0],
    [-2, -3],
    [3, 2],
  ]) {
    const plans = [];
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++) plans.push(planInfrastructureCell(seed, x, z));
    const records = plans.map((p) => planInfrastructureCirculation(seed, p));
    const solids = plans.flatMap((p, i) => [
      ...p.primitives,
      ...records[i]!.primitives,
      ...infrastructureLadderPrimitives(records[i]!.ladders),
    ]);
    const body = (x: number, y: number, z: number, label: string) => {
      if (infrastructureBodyIntersects(solids, { x, y, z }, 1.8, 0.35))
        failures.push(`${seed} blocked ${label} at ${x},${y},${z}`);
      sweeps++;
    };
    const supported = (x: number, y: number, z: number, label: string) =>
      assert.ok(
        infrastructureIntervalsAt(solids, x, z).some(
          ([lo, hi]) => lo < y && Math.abs(hi - y) < 1e-5,
        ),
        `${seed} unsupported ${label}`,
      );
    const plan = plans[4]!,
      record = records[4]!;
    assert.deepEqual(record, planInfrastructureCirculation(seed, plan), 'determinism');
    assert.ok(record.primitives.length < 400 && record.ladders.length <= 6, 'bounded factory');
    const floor = plan.node.point[1] - plan.node.radius + 0.9;
    supported(plan.node.point[0], floor, plan.node.point[2], 'node');
    for (const l of record.ladders) {
      ladders++;
      const support = Math.max(
        ...[
          [0, 0],
          [0.35, 0],
          [-0.35, 0],
          [0, 0.35],
          [0, -0.35],
        ].flatMap(([dx, dz]) =>
          infrastructureIntervalsAt(solids, l.x + dx!, l.z + dz!)
            .filter(([, hi]) => hi <= l.bottom + 1e-5)
            .map(([, hi]) => hi),
        ),
      );
      assert.ok(
        Math.abs(support - l.bottom) < 1e-5,
        'ladder bottom is supported under the actual circular player footprint',
      );
      supported(l.exitX, l.top, l.exitZ, 'ladder exit');
      for (let y = l.bottom; y < l.top; y += 0.7) body(l.x, y, l.z, l.id);
      body(l.x, l.top, l.z, l.id);
      // The game steps onto the exit after climbing; rails must not occlude it.
      for (let t = 0; t <= 1; t += 0.1)
        body(l.x + (l.exitX - l.x) * t, l.top, l.z + (l.exitZ - l.z) * t, `${l.id} exit sweep`);
      if (l.id.includes(':maintenance:')) {
        const beam = record.primitives.find((p) => p.id === l.id.replace(/:ladder$/, ':beam'))!;
        const bx = (beam.a[0] + beam.b[0]) / 2,
          bz = (beam.a[2] + beam.b[2]) / 2;
        // Walk around the collidable rungs to their front, not through the
        // back of the ladder. The long beam provides this side approach.
        const path = [
          [bx, bz],
          [bx + l.nz * 1.2, bz - l.nx * 1.2],
          [l.x + l.nx * 0.25 + l.nz * 1.2, l.z + l.nz * 0.25 - l.nx * 1.2],
          [l.x + l.nx * 0.25, l.z + l.nz * 0.25],
          [l.x, l.z],
        ];
        for (let j = 1; j < path.length; j++)
          for (let t = 0; t <= 1; t += 0.1)
            body(
              path[j - 1]![0]! + (path[j]![0]! - path[j - 1]![0]!) * t,
              l.bottom,
              path[j - 1]![1]! + (path[j]![1]! - path[j - 1]![1]!) * t,
              'beam ladder side approach',
            );
        continue;
      }
      const node = plans.find(
        (p) =>
          Math.abs(
            p.node.point[0] -
              (l.x + l.nx * (plan.routes.find((r) => l.id.startsWith(r.id))!.radius - 1.7)),
          ) < 0.001 &&
          Math.abs(
            p.node.point[2] -
              (l.z + l.nz * (plan.routes.find((r) => l.id.startsWith(r.id))!.radius - 1.7)),
          ) < 0.001,
      );
      assert.ok(node, 'lower junction exists in halo');
      for (let t = 0; t <= 1; t += 0.1)
        body(
          node.node.point[0] + (l.x - node.node.point[0]) * t,
          l.bottom,
          node.node.point[2] + (l.z - node.node.point[2]) * t,
          'bottom approach',
        );
    }
    for (const r of plan.routes)
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]!,
          b = r.points[i]!;
        if (a[1] !== b[1]) continue;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let d = 9; d < length - 9; d += 6) {
          const x = a[0] + ((b[0] - a[0]) * d) / length,
            z = a[2] + ((b[2] - a[2]) * d) / length,
            y = a[1] - r.radius + 0.9;
          supported(x, y, z, 'route floor');
          body(x, y, z, 'route interior');
        }
      }
    const decks = record.primitives.filter((p) => p.kind === 'deck' && p.a[1] === p.b[1]);
    assert.ok(decks.length >= 2, 'long runs require maintenance beams');
    for (const p of decks) {
      beams++;
      for (let t = 0.05; t < 1; t += 0.05) {
        const x = p.a[0] + (p.b[0] - p.a[0]) * t,
          z = p.a[2] + (p.b[2] - p.a[2]) * t,
          y = p.a[1] + p.radius;
        supported(x, y, z, 'beam');
        body(x, y, z, 'beam');
      }
    }
    const contains = (ps: InfrastructurePrimitive[], p: number[]) =>
      infrastructureIntervalsAt(ps, p[0]!, p[2]!).some(
        ([lo, hi]) => p[1]! >= lo - 1e-5 && p[1]! <= hi + 1e-5,
      );
    const hangers = record.primitives.filter((p) => p.id.includes(':hanger:'));
    assert.ok(hangers.length > 0, 'beams must hang from shell');
    for (const p of hangers) {
      assert.ok(contains(decks, p.a), 'hanger root in deck');
      assert.ok(contains(plan.primitives, p.b), 'hanger anchored to actual pipe shell');
      anchors++;
    }
    const cables = record.primitives.filter((p) => p.kind === 'cable');
    const supports = record.primitives.filter((p) => p.id.includes(':standoff:'));
    assert.ok(cables.length > 0, 'anchored cables required');
    for (const p of supports) {
      assert.ok(contains(plan.primitives, p.a), 'cable standoff root in shell');
      anchors++;
    }
    for (const p of cables)
      for (const pt of [p.a, p.b])
        assert.ok(
          contains([...supports, ...cables.filter((c) => c !== p)], pt),
          'cable endpoint connected',
        );
  }
console.log(
  JSON.stringify({
    seeds: 3,
    neighborhoods: 9,
    ladders,
    sweeps,
    beams,
    anchors,
    blocked: failures.length,
  }),
);
assert.deepEqual(
  failures,
  [],
  'standing body sweeps must clear actual shared CSG, including ladder rungs',
);
