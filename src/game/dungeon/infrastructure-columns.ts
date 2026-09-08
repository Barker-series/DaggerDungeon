/** Exact infrastructure is a refinement of the column authority, like terrain
 * corner fields: coarse centers serve navigation; point queries and rendered
 * facets use the same published convex solids. Never infer collision from meshes. */
import type { ColumnSpan, WorldData } from '../types';
import type { ServiceLadder } from './frame-services';
import type { InfrastructurePlan } from './infrastructure-network';
import type { InfrastructureAccess } from './infrastructure-access';
import {
  infrastructureIntervalsAt,
  infrastructureBodyIntersects,
  infrastructureBoundaryFaces,
  clipInfrastructurePolygon,
  type InfrastructurePlane,
  primitiveBounds,
  type InfrastructurePrimitive,
} from './infrastructure-solid';

export interface InfrastructureData {
  primitives: InfrastructurePrimitive[];
  ladders: ServiceLadder[];
  plans: InfrastructurePlan[];
  access: InfrastructureAccess[];
}

export function mergeInfrastructureData(data: InfrastructureData[]): InfrastructureData {
  const unique = <T extends { id: string }>(items: T[]): T[] =>
    [...new Map(items.map((p) => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    primitives: unique(data.flatMap((d) => d.primitives)),
    ladders: unique(data.flatMap((d) => d.ladders)),
    plans: unique(data.flatMap((d) => d.plans)),
    access: unique(data.flatMap((d) => d.access)),
  };
}

export function cutInfrastructureSolids(
  spans: readonly ColumnSpan[],
  solids: [number, number][],
  projection = false,
): ColumnSpan[] {
  let out = spans.map((s) => ({ ...s }));
  for (const [lo, hi] of solids) {
    const next: ColumnSpan[] = [];
    for (const s of out) {
      if (hi <= s.floor || lo >= s.ceil) {
        next.push(s);
        continue;
      }
      if (lo > s.floor + 1e-6) next.push({ ...s, ceil: lo, ceilOwner: -1 });
      if (hi < s.ceil - 1e-6) next.push({ ...s, floor: hi, owner: -1 });
    }
    out = next;
  }
  return projection
    ? out.filter((s) => s.ceil - s.floor >= 1.5 || s.ceil >= 1e9 || s.floor <= -1e9)
    : out;
}

export function carveInfrastructureAir(
  spans: readonly ColumnSpan[],
  lo: number,
  hi: number,
): ColumnSpan[] {
  const all = [
    ...spans.map((s) => ({ ...s })),
    { floor: lo, ceil: hi, owner: -1, ceilOwner: -1 },
  ].sort((a, b) => a.floor - b.floor);
  const out: ColumnSpan[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (!last || s.floor > last.ceil + 1e-6) out.push(s);
    else if (s.ceil > last.ceil) {
      last.ceil = s.ceil;
      last.ceilOwner = s.ceilOwner;
    }
  }
  return out;
}

const baseWorlds = new WeakMap<WorldData, WorldData>();
export function infrastructureBaseWorld(world: WorldData): WorldData {
  if (!world.infrastructureBaseColumns) return world;
  let base = baseWorlds.get(world);
  if (!base) {
    base = { ...world, columns: world.infrastructureBaseColumns };
    baseWorlds.set(world, base);
  }
  return base;
}

/** Sparse absolute-tile index; immutable published plans and weak world lifetime. */
export function indexInfrastructure(
  primitives: InfrastructurePrimitive[],
): Map<string, InfrastructurePrimitive[]> {
  const index = new Map<string, InfrastructurePrimitive[]>();
  for (const p of primitives) {
    const b = primitiveBounds(p);
    for (let z = Math.floor(b.z0 / 3); z <= Math.floor(b.z1 / 3); z++)
      for (let x = Math.floor(b.x0 / 3); x <= Math.floor(b.x1 / 3); x++) {
        const k = `${x},${z}`;
        const list = index.get(k);
        if (list) list.push(p);
        else index.set(k, [p]);
      }
  }
  return index;
}
const indexes = new WeakMap<InfrastructureData, Map<string, InfrastructurePrimitive[]>>();
const neighborLists = new WeakMap<InfrastructureData, Map<string, InfrastructurePrimitive[]>>();
export function infrastructureNear(
  world: WorldData,
  x: number,
  z: number,
  radius = 0,
): InfrastructurePrimitive[] {
  const data = world.infrastructure;
  if (!data) return [];
  let index = indexes.get(data);
  if (!index) {
    index = indexInfrastructure(data.primitives);
    indexes.set(data, index);
  }
  const ax = x + world.originPcx * 168,
    az = z + world.originPcz * 168;
  if (radius === 0) return index.get(`${Math.floor(ax / 3)},${Math.floor(az / 3)}`) ?? [];
  let lists = neighborLists.get(data);
  if (!lists) {
    lists = new Map();
    neighborLists.set(data, lists);
  }
  const cacheKey = `${Math.floor((ax - radius) / 3)},${Math.floor((az - radius) / 3)},${Math.floor((ax + radius) / 3)},${Math.floor((az + radius) / 3)}`;
  const cached = lists.get(cacheKey);
  if (cached) return cached;
  const found = new Set<InfrastructurePrimitive>();
  for (let tz = Math.floor((az - radius) / 3); tz <= Math.floor((az + radius) / 3); tz++)
    for (let tx = Math.floor((ax - radius) / 3); tx <= Math.floor((ax + radius) / 3); tx++) {
      for (const p of index.get(`${tx},${tz}`) ?? []) found.add(p);
    }
  const list = [...found];
  if (lists.size >= 4096) lists.clear();
  lists.set(cacheKey, list);
  return list;
}

export function infrastructureColumnAt(
  world: WorldData,
  x: number,
  z: number,
): ColumnSpan[] | undefined {
  const w = world.levels[0]!.width,
    h = world.levels[0]!.height;
  const tx = Math.floor(x / 3),
    tz = Math.floor(z / 3);
  if (tx < 0 || tz < 0 || tx >= w || tz >= h) return undefined;
  const base = (world.infrastructureBaseColumns ?? world.columns)[tz * w + tx]!;
  const primitives = infrastructureNear(world, x, z);
  return primitives.length
    ? cutInfrastructureSolids(
        base,
        infrastructureIntervalsAt(primitives, x + world.originPcx * 168, z + world.originPcz * 168),
      )
    : base;
}

export function infrastructureBodyBlocked(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
): boolean {
  const primitives = infrastructureNear(world, x, z, radius);
  return (
    primitives.length > 0 &&
    infrastructureBodyIntersects(
      primitives,
      { x: x + world.originPcx * 168, y, z: z + world.originPcz * 168 },
      height,
      radius,
    )
  );
}

/** Full-footprint vertical contact. Point samples alone miss thin wires;
 * the exact rendered boundary polygons also own landing and head clearance. */
export function infrastructureVerticalContact(
  world: WorldData,
  x: number,
  z: number,
  limitY: number,
  radius: number,
  kind: 'floor' | 'ceiling',
): number {
  const ps = infrastructureNear(world, x, z, radius);
  let best = kind === 'floor' ? -Infinity : Infinity;
  if (!ps.length) return best;
  const ax = x + world.originPcx * 168,
    az = z + world.originPcz * 168;
  const b = {
    x0: ax - radius,
    x1: ax + radius,
    z0: az - radius,
    z1: az + radius,
    y0: kind === 'ceiling' ? limitY : -Infinity,
    y1: kind === 'floor' ? limitY : Infinity,
  };
  const planes: InfrastructurePlane[] = [
    { n: [-1, 0, 0], d: -b.x0 },
    { n: [1, 0, 0], d: b.x1 },
    { n: [0, 0, -1], d: -b.z0 },
    { n: [0, 0, 1], d: b.z1 },
  ];
  for (const f of infrastructureBoundaryFaces(ps, b)) {
    if (kind === 'floor' ? f.normal[1] <= 1e-8 : f.normal[1] >= -1e-8) continue;
    let poly = f.vertices;
    for (const plane of planes) {
      poly = clipInfrastructurePolygon(poly, plane);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    const y =
      kind === 'floor' ? Math.max(...poly.map((v) => v[1])) : Math.min(...poly.map((v) => v[1]));
    if (kind === 'floor' && y <= limitY + 1e-6) best = Math.max(best, y);
    if (kind === 'ceiling' && y >= limitY - 1e-6) best = Math.min(best, y);
  }
  return best;
}

export function infrastructureLadderPrimitives(
  ladders: ServiceLadder[],
): InfrastructurePrimitive[] {
  const out: InfrastructurePrimitive[] = [];
  for (const l of ladders) {
    const at = (side: number, y: number, depth = -0.45): [number, number, number] => [
      l.x + l.nz * side + l.nx * depth,
      y,
      l.z - l.nx * side + l.nz * depth,
    ];
    for (const side of [-0.46, 0.46]) {
      out.push({
        id: `${l.id}:rail:${side}`,
        kind: 'support',
        a: at(side, l.bottom - 0.1),
        b: at(side, l.top + 1),
        radius: 0.055,
      });
      out.push({
        id: `${l.id}:handle:${side}`,
        kind: 'support',
        a: at(side, l.top + 1),
        b: at(side, l.top + 1, -1.15),
        radius: 0.055,
      });
      out.push({
        id: `${l.id}:return:${side}`,
        kind: 'support',
        a: at(side, l.top + 1, -1.15),
        b: at(side, l.top - 0.1, -1.15),
        radius: 0.055,
      });
    }
    // Leave the last rung entirely below the landing plane. A collidable
    // bar whose center merely lies below it can still snag the dismount.
    for (let i = 0; l.bottom + 0.28 + i * 0.3 < l.top - 0.08; i++) {
      const y = l.bottom + 0.28 + i * 0.3;
      out.push({
        id: `${l.id}:rung:${i}`,
        kind: 'support',
        a: at(-0.46, y),
        b: at(0.46, y),
        radius: 0.042,
      });
    }
  }
  return out;
}
