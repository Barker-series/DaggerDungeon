/** Node-owned maintenance access. Inputs are complete upstream AIR columns,
 * never renderer/window state. All output belongs to the node's first 56-tile
 * chunk. Boxes are absolute half-open tiles; primitives/ladders use world units.
 * The caller compiles boxes before analytic infrastructure and retains ladders.
 * Undefined columns violate the dependency contract; [] means actual solid. */
import type { ColumnSpan } from '../types';
import type { ServiceLadder } from './frame-services';
import type { InfrastructurePlan } from './infrastructure-network';
import type { InfrastructurePrimitive, InfrastructurePoint } from './infrastructure-solid';

export interface InfrastructureAccessBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  bottom: number;
  top: number;
  clearTop: number;
}
export interface InfrastructureAccess {
  id: string;
  primitives: InfrastructurePrimitive[];
  ladders: ServiceLadder[];
  boxes: InfrastructureAccessBox[];
  foot: { tx: number; tz: number; y: number };
}

export function planInfrastructureAccess(
  plan: InfrastructurePlan,
  column: (absoluteTileX: number, absoluteTileZ: number) => readonly ColumnSpan[] | undefined,
  reserved: (absoluteTileX: number, absoluteTileZ: number) => boolean = () => false,
): InfrastructureAccess | null {
  const [x, y, z] = plan.node.point;
  const top = y - plan.node.radius + 0.9;
  // Four diagonal service ports leave the cardinal trunk corridors clear.
  // Read complete context before selecting, independent of loaded windows.
  const candidates = (
    [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const
  ).map(([dx, dz], port) => {
    const end: InfrastructurePoint = [
      x + dx * (plan.node.radius + 7),
      top + 1.8,
      z + dz * (plan.node.radius + 7),
    ];
    const ex = Math.floor(end[0] / 3),
      ez = Math.floor(end[2] / 3);
    // Tangential positive edge keeps even west/north variants within ownership.
    const nx = 0,
      nz = dz;
    const tx = ex + nx * 2,
      tz = ez + nz * 2;
    const spans = column(tx, tz);
    if (!spans) throw new Error(`Missing infrastructure access column context at ${tx},${tz}`);
    let blocked = false;
    for (let pz = ez - 1 + Math.min(0, nz); pz < ez + 2 + Math.max(0, nz); pz++)
      for (let px = ex - 2; px < ex + 3; px++) if (reserved(px, pz)) blocked = true;
    const floor = (blocked ? [] : spans)
      .filter(
        (s) =>
          Number.isFinite(s.floor) && s.floor >= 0 && s.floor <= top - 3 && s.ceil - s.floor >= 2.4,
      )
      .reduce<
        number | undefined
      >((best, s) => (best === undefined ? s.floor : Math.max(best, s.floor)), undefined);
    return { end, ex, ez, tx, tz, nx, nz, floor, port, dx, dz };
  });
  const c = candidates.find((c) => c.floor !== undefined);
  if (!c || c.floor === undefined) return null;
  const { end, ex, ez, tx, tz, nx, nz, floor, port, dx } = c;
  const id = `${plan.id}:access`;
  const prefix = `${id}:port:${port}`;
  const boxes: InfrastructureAccessBox[] = [
    // Pad roots every pier; the extra tangential tile is the cleared ladder foot.
    {
      x0: ex - 1,
      x1: ex + 2,
      z0: ez - 1 + Math.min(0, nz),
      z1: ez + 2 + Math.max(0, nz),
      bottom: floor - 1.2,
      top: floor,
      clearTop: top + 3,
    },
    { x0: ex - 1, x1: ex + 2, z0: ez - 1, z1: ez + 2, bottom: top - 1.2, top, clearTop: top + 3 },
  ];
  // A one-tile cantilever continues toward the trunk, overlapping the main
  // platform by one tile so the column compiler emits a continuous shelf.
  const sx = ex - dx;
  const sz = ez;
  boxes.push({
    x0: sx - (nz ? 1 : 0),
    x1: sx + 1 + (nz ? 1 : 0),
    z0: sz - (nx ? 1 : 0),
    z1: sz + 1 + (nx ? 1 : 0),
    bottom: top - 1.2,
    top,
    clearTop: top + 3,
  });
  const ladder: ServiceLadder = {
    id: `${prefix}:ladder`,
    x: nx ? tx * 3 + 0.75 : (tx + 0.5) * 3,
    z: nz > 0 ? tz * 3 + 0.75 : (tz + 1) * 3 - 0.75,
    bottom: floor,
    top,
    nx,
    nz,
    exitX: (tx + 0.5 - nx) * 3,
    exitZ: (tz + 0.5 - nz) * 3,
  };
  // Horizontal branch starts INSIDE the existing node bore. Union-of-bores
  // removes the main wall at the junction; terminal annulus stays open.
  const primitives: InfrastructurePrimitive[] = [
    {
      id: `${prefix}:entry`,
      kind: 'pipe',
      a: [x, top + 1.8, z],
      b: end,
      radius: 2.4,
      innerRadius: 1.8,
    },
  ];
  const anchors: InfrastructurePoint[] = [];
  for (const side of [-1, 1]) {
    const px = (ex + 0.5) * 3 + (nx ? -2.6 : side * 2.6);
    const pz = (ez + 0.5) * 3 - nz * 2.6;
    primitives.push({
      id: `${prefix}:pier:${side}`,
      kind: 'support',
      a: [px, floor - 0.1, pz],
      b: [px, top - 1, pz],
      radius: 0.4,
    });
    anchors.push([px, top - 1.05, pz]);
  }
  // Physical suspended chords attach to a rooted pier and the node outer wall.
  // Returns follow the same anchors, with a distinct sag and wire-scale radius.
  for (let wire = 0; wire < 2; wire++) {
    const a = anchors[wire]!;
    // Route below the walking plane. A wire drawn through a pipe's interior
    // becomes a real obstruction now that fittings have physical collision.
    const b: InfrastructurePoint = [
      x + plan.node.radius * 0.7,
      top - 0.7,
      z - plan.node.radius * 0.7,
    ];
    const at = (t: number): InfrastructurePoint => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - (wire ? 1.2 : 2) * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    ];
    for (let i = 0; i < 8; i++)
      primitives.push({
        id: `${prefix}:cable:${wire}:${i}`,
        kind: 'cable',
        a: at(i / 8),
        b: at((i + 1) / 8),
        radius: wire ? 0.03 : 0.08,
      });
  }
  return { id, primitives, ladders: [ladder], boxes, foot: { tx, tz, y: floor } };
}
