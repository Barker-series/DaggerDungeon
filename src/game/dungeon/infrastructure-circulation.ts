/** Bounded, absolute-world circulation fixtures. Each owner publishes its own
 * junction floor and its east/south route ladders; rails are added by the layer. */
import {
  infrastructureNode,
  INFRA_CELL_WU,
  type InfrastructurePlan,
} from './infrastructure-network';
import type { InfrastructurePrimitive } from './infrastructure-solid';
import type { ServiceLadder } from './frame-services';

export function planInfrastructureCirculation(
  seed: number,
  plan: InfrastructurePlan,
): {
  primitives: InfrastructurePrimitive[];
  ladders: ServiceLadder[];
} {
  const primitives: InfrastructurePrimitive[] = [];
  const ladders: ServiceLadder[] = [];
  const [x, y, z] = plan.node.point;
  const floor = y - plan.node.radius + 0.9;
  primitives.push({
    id: `${plan.id}:floor`,
    kind: 'deck',
    a: [x, floor - 0.9, z],
    b: [x, floor, z],
    radius: plan.node.radius - 0.6,
  });
  for (const route of plan.routes) {
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!;
      const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (a[1] === b[1] && run >= 96) {
        const ux = (b[0] - a[0]) / run,
          uz = (b[2] - a[2]) / run;
        const px = -uz,
          pz = ux;
        // Node lanes are tile-centered. A whole-tile lateral shift keeps the
        // narrow walk surface visible to the coarse navigation columns too.
        const offset = Math.ceil((route.radius + 2) / 3) * 3;
        const top = a[1] - route.radius - 3;
        const at = (d: number, lateral: number, y: number): [number, number, number] => [
          a[0] + ux * d + px * lateral,
          y,
          a[2] + uz * d + pz * lateral,
        ];
        const id = `${route.id}:maintenance:${i}`;
        primitives.push({
          id: `${id}:beam`,
          kind: 'deck',
          a: at(24, offset, top - 1.8),
          b: at(run - 24, offset, top - 1.8),
          radius: 1.8,
        });
        const mid = run / 2;
        const boreFloor = a[1] - route.radius + 0.9;
        // A real side port and short ladder make the suspended beam accessible
        // from the main bore, not an isolated strip somebody must fall onto.
        primitives.push({
          id: `${id}:port`,
          kind: 'pipe',
          a: at(mid, 0, boreFloor + 1.8),
          b: at(mid, offset + 0.5, boreFloor + 1.8),
          radius: 2.4,
          innerRadius: 1.8,
        });
        const climb = at(mid, offset + 1.05, top),
          exit = at(mid, offset + 1.05 - 2.25, boreFloor);
        ladders.push({
          id: `${id}:ladder`,
          x: climb[0],
          z: climb[2],
          bottom: top,
          top: boreFloor,
          nx: px,
          nz: pz,
          exitX: exit[0],
          exitZ: exit[2],
        });
        const stations: number[] = [];
        for (let d = 28; d < run - 28; d += 24) if (Math.abs(d - mid) > 5) stations.push(d);
        if (stations[stations.length - 1] !== run - 28 && Math.abs(run - 28 - mid) > 5)
          stations.push(run - 28);
        for (const d of stations) {
          // The root is embedded below the walking plane; the upper tip is
          // embedded in the side wall, never merely attached to a bore void.
          primitives.push({
            id: `${id}:hanger:${d}`,
            kind: 'support',
            a: at(d, offset - 1.5, top - 1.2),
            b: at(d, route.radius - 0.1, a[1]),
            radius: 0.12,
          });
          primitives.push({
            id: `${id}:standoff:${d}`,
            kind: 'support',
            a: at(d, -route.radius + 0.1, a[1]),
            b: at(d, -offset, a[1] + 2),
            radius: 0.18,
          });
        }
        // Independent positive cable prisms, on the opposite side to the beam.
        // Every span terminates on real shell-rooted standoffs.
        for (let s = 1; s < stations.length; s++) {
          const start = stations[s - 1]!,
            end = stations[s]!;
          for (let k = 0; k < 8; k++) {
            const cablePoint = (t: number) =>
              at(start + (end - start) * t, -offset, a[1] + 2 - 1.5 * 4 * t * (1 - t));
            primitives.push({
              id: `${id}:cable:${s}:${k}`,
              kind: 'cable',
              a: cablePoint(k / 8),
              b: cablePoint((k + 1) / 8),
              radius: 0.075,
            });
          }
        }
      }
      if (a[0] !== b[0] || a[2] !== b[2] || Math.abs(a[1] - b[1]) <= 3) continue;
      const rising = b[1] > a[1];
      const low = rising ? a : b,
        high = rising ? b : a;
      const adjacent = rising ? route.points[i + 1] : route.points[i - 2];
      if (!adjacent) continue;
      const distance = Math.hypot(adjacent[0] - high[0], adjacent[2] - high[2]);
      if (distance === 0) continue;
      const dx = (adjacent[0] - high[0]) / distance,
        dz = (adjacent[2] - high[2]) / distance;
      const node = infrastructureNode(
        seed,
        Math.floor(low[0] / INFRA_CELL_WU),
        Math.floor(low[2] / INFRA_CELL_WU),
      );
      const offset = route.radius - 0.9 - 0.8;
      const lx = low[0] + dx * offset,
        lz = low[2] + dz * offset;
      // A larger intersecting riser can cut away the smaller trunk's floor.
      // Land beyond the widest node bore with full foot-body margin.
      const exitDistance = Math.max(2.25, node.radius - 0.9 + 0.5 - offset);
      ladders.push({
        id: `${route.id}:riser:${i}`,
        x: lx,
        z: lz,
        bottom: node.point[1] - node.radius + 0.9,
        top: high[1] - route.radius + 0.9,
        nx: -dx,
        nz: -dz,
        exitX: lx + dx * exitDistance,
        exitZ: lz + dz * exitDistance,
      });
    }
  }
  return { primitives, ladders };
}
