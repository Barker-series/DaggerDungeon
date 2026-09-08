/** Regional infrastructure topology. A coarse cell owns east/south connections
 * to absolute shared nodes. Complete routes exist independently of buildings,
 * windows and generation order; buildings only supply clearance constraints. */
import { cellSeed, mulberry32 } from './rng';
import { sampleNoise } from './noise';
import { regionAtCell } from './region-layer';
import { assemblePillar } from './pillar-layer';
import { ROAD_MAX_FACILITY_ROOF } from './road-buildings';
import type { ChunkBounds } from '../gen/chunked';
import type { InfrastructurePrimitive, InfrastructurePoint } from './infrastructure-solid';

export const INFRA_CELL_TILES = 112;
export const INFRA_CELL_WU = INFRA_CELL_TILES * 3;
export interface InfrastructureNode {
  id: string;
  point: InfrastructurePoint;
  radius: number;
  district: ReturnType<typeof regionAtCell>;
}
export interface InfrastructureRoute {
  id: string;
  axis: 'east' | 'south';
  points: InfrastructurePoint[];
  radius: number;
}
export interface InfrastructurePlan {
  id: string;
  node: InfrastructureNode;
  routes: InfrastructureRoute[];
  primitives: InfrastructurePrimitive[];
}

export function infrastructureNode(seed: number, cx: number, cz: number): InfrastructureNode {
  const laneX = mulberry32(cellSeed(cx, 0, seed, 0x50495045));
  const laneZ = mulberry32(cellSeed(0, cz, seed, 0x50495046));
  const district = regionAtCell(seed, cx * 8, cz * 8);
  // Alley reservations lie outside every building family's central footprint.
  const x = cx * INFRA_CELL_WU + (6 + Math.floor(laneX() * 4)) * 3 + 1.5;
  const z = cz * INFRA_CELL_WU + (6 + Math.floor(laneZ() * 4)) * 3 + 1.5;
  const stratum = Math.floor((sampleNoise(cx, cz, seed + 12031, 0.16) + 1) * 1.5);
  let y = (district === 'roads' ? 60 : district === 'machine' ? 36 : 45) + stratum * 12;
  // Reserve the whole upstream facility height envelope wherever this coarse
  // cell can contain roads. The lower return and maintenance-gallery bottom
  // must clear roofs too, not just the large trunk. Pure region reads keep
  // shared node heights identical even before adjacent facilities are loaded.
  roads: for (let dz = 0; dz < 8; dz++)
    for (let dx = 0; dx < 8; dx++) {
      if (regionAtCell(seed, cx * 8 + dx, cz * 8 + dz) === 'roads') {
        y = Math.max(y, Math.ceil((ROAD_MAX_FACILITY_ROOF + 18) / 3) * 3);
        break roads;
      }
    }
  const radiusAt = (nx: number, nz: number): number => {
    const r = regionAtCell(seed, nx * 8, nz * 8);
    return r === 'machine' || r === 'canyon' ? 6 : 4.5;
  };
  const radius = Math.max(
    radiusAt(cx, cz),
    radiusAt(cx - 1, cz),
    radiusAt(cx + 1, cz),
    radiusAt(cx, cz - 1),
    radiusAt(cx, cz + 1),
  );
  return { id: `infra-node:${cx},${cz}`, point: [x, y, z], radius, district };
}

/** Preserve every possible bridge opening along the bounded fabrication route.
 * No column/renderer reads: bridges publish their socket heights upstream. */
function transferClearance(
  seed: number,
  a: InfrastructureNode,
  b: InfrastructureNode,
  radius: number,
): number {
  let y = Math.max(a.point[1], b.point[1]);
  for (
    let z = Math.floor(Math.min(a.point[2], b.point[2]) / 168) - 1;
    z <= Math.floor(Math.max(a.point[2], b.point[2]) / 168) + 1;
    z++
  ) {
    for (
      let x = Math.floor(Math.min(a.point[0], b.point[0]) / 168) - 1;
      x <= Math.floor(Math.max(a.point[0], b.point[0]) / 168) + 1;
      x++
    ) {
      const p = assemblePillar(seed, x, z);
      if (!p) continue;
      for (const socket of p.sockets)
        if (socket.kind === 'bridge') y = Math.max(y, socket.yAbs + radius + 14);
    }
  }
  return Math.ceil(y / 3) * 3;
}

export function planInfrastructureCell(seed: number, cx: number, cz: number): InfrastructurePlan {
  const node = infrastructureNode(seed, cx, cz);
  const id = `infra:${cx},${cz}`;
  const primitives: InfrastructurePrimitive[] = [];
  const routes: InfrastructureRoute[] = [];
  const [jx, jy, jz] = node.point;
  primitives.push({
    id: `${id}:junction`,
    kind: 'pipe',
    a: [jx, jy - node.radius, jz],
    b: [jx, jy + node.radius, jz],
    radius: node.radius,
    innerRadius: node.radius - 0.9,
  });
  for (const axis of ['east', 'south'] as const) {
    const b = infrastructureNode(
      seed,
      cx + (axis === 'east' ? 1 : 0),
      cz + (axis === 'south' ? 1 : 0),
    );
    const radius = Math.min(node.radius, b.radius);
    const y = transferClearance(seed, node, b, radius);
    const [ax, , az] = node.point;
    const [bx, , bz] = b.point;
    const corners: InfrastructurePoint[] = [
      node.point,
      [ax, y, az],
      axis === 'east' ? [bx, y, az] : [ax, y, bz],
      [bx, y, bz],
      b.point,
    ];
    const points = corners.filter((p, i) => i === 0 || p.some((v, k) => v !== corners[i - 1]![k]));
    const route: InfrastructureRoute = { id: `${id}:${axis}`, axis, points, radius };
    routes.push(route);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        end = points[i]!;
      primitives.push({
        id: `${route.id}:${i}`,
        kind: 'pipe',
        a,
        b: end,
        radius,
        innerRadius: radius - 0.9,
      });
      const length = Math.hypot(...a.map((v, k) => end[k]! - v));
      for (let d = 9; d < length - 3; d += 24) {
        const at = (offset: number): InfrastructurePoint =>
          a.map((v, k) => v + ((end[k]! - v) * (d + offset)) / length) as InfrastructurePoint;
        primitives.push({
          id: `${route.id}:${i}:collar:${d}`,
          kind: 'collar',
          a: at(-0.22),
          b: at(0.22),
          radius: radius + 0.16,
          innerRadius: radius - 0.9,
        });
      }
      // Smaller return circuit follows the same shared nodes at an offset
      // below the trunk. It continues through bends and across cell boundaries.
      const shift = (p: InfrastructurePoint): InfrastructurePoint => [p[0], p[1] - 10, p[2]];
      primitives.push({
        id: `${route.id}:${i}:return`,
        kind: 'pipe',
        a: shift(a),
        b: shift(end),
        radius: 1.2,
      });
    }
  }
  return { id, node, routes, primitives };
}

/** Owners can reach one coarse cell east/south plus fitting radius. Query the
 * complete bounded owner ring, not just owners whose nodes happen to be loaded. */
export function collectInfrastructurePlans(seed: number, b: ChunkBounds): InfrastructurePlan[] {
  const out: InfrastructurePlan[] = [];
  for (
    let z = Math.floor(b.tz0 / INFRA_CELL_TILES) - 1;
    z <= Math.floor(b.tz1 / INFRA_CELL_TILES);
    z++
  ) {
    for (
      let x = Math.floor(b.tx0 / INFRA_CELL_TILES) - 1;
      x <= Math.floor(b.tx1 / INFRA_CELL_TILES);
      x++
    )
      out.push(planInfrastructureCell(seed, x, z));
  }
  return out;
}
