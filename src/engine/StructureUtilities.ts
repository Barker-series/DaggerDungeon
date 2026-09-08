/** Decorative SURFACE infrastructure only: no collision, walkable bores, or
 * navigation authority. Small wall-mounted banks live high above occupied
 * floors. Complete architectural plans, never the loaded neighbours/window,
 * decide existence. All coordinates below are ABSOLUTE world units.
 */
import { Quaternion, Vector3 } from 'three';
import type { WorldData } from '../game/types';
import { TILE_SIZE } from '../game/types';
import { PILLAR_CELL_TILES } from '../game/dungeon/pillar-layer';
import { frameFloorY } from '../game/dungeon/frame-building';
import { mountedPipeFinish } from '../game/dungeon/infrastructure-finishes';
import { roadBuildingAir } from '../game/dungeon/road-buildings';

export type UtilityPoint = [number, number, number];
export interface UtilityRun {
  id: string;
  source: string;
  kind: 'pipe' | 'collar' | 'support' | 'cable' | 'wire';
  radius: number;
  points: UtilityPoint[];
  /** The actual architectural wall contacts, not inferred neighbours. */
  anchors: [UtilityPoint, UtilityPoint];
}
const point = (a: UtilityPoint, n: UtilityPoint, d: number): UtilityPoint => [
  a[0] + n[0] * d,
  a[1] + n[1] * d,
  a[2] + n[2] * d,
];
const mix = (a: UtilityPoint, b: UtilityPoint, t: number): UtilityPoint => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function collectStructureUtilities(world: WorldData): UtilityRun[] {
  const out: UtilityRun[] = [];
  const bank = (
    source: string,
    key: string,
    a: UtilityPoint,
    b: UtilityPoint,
    n: UtilityPoint,
    vertical = false,
  ): void => {
    const t = new Vector3(...b)
      .sub(new Vector3(...a))
      .normalize()
      .toArray() as UtilityPoint;
    let serial = 0;
    const add = (
      kind: UtilityRun['kind'],
      radius: number,
      points: UtilityPoint[],
      anchors: [UtilityPoint, UtilityPoint],
    ): void => {
      out.push({ source, id: `${source}:${key}:${serial++}`, kind, radius, points, anchors });
    };
    const lateral = vertical
      ? (new Vector3(...t)
          .cross(new Vector3(...n))
          .normalize()
          .toArray() as UtilityPoint)
      : ([0, 1, 0] as UtilityPoint);
    const bend = vertical ? 0.8 : 0.48;
    for (const [j, radius] of (vertical ? [0.55, 0.24, 0.13] : [0.24, 0.13, 0.075]).entries()) {
      const offset = vertical ? [0, 0.84, 1.26][j]! : -j * 0.58;
      const aa = point(a, lateral, offset),
        bb = point(b, lateral, offset);
      // Quarter-circle elbows return into both real wall/pier contacts.
      const points: UtilityPoint[] = [aa];
      for (let i = 0; i <= 6; i++) {
        const q = (i * Math.PI) / 12;
        points.push(point(point(aa, t, bend * (1 - Math.cos(q))), n, bend * Math.sin(q)));
      }
      points.push(point(point(bb, t, -bend), n, bend));
      for (let i = 1; i <= 6; i++) {
        const q = (i * Math.PI) / 12;
        points.push(point(point(bb, t, -bend * (1 - Math.sin(q))), n, bend * Math.cos(q)));
      }
      // Avoid a duplicate first point (degenerate tube strip).
      points.splice(0, 1);
      add('pipe', radius, points, [aa, bb]);
      const length = new Vector3(...aa).distanceTo(new Vector3(...bb));
      const collars = vertical
        ? Array.from(
            { length: Math.max(1, Math.floor((length - 4) / 6) + 1) },
            (_, i) => (2 + i * 6) / length,
          ).filter((u) => u < 1)
        : [0.1, 0.9];
      for (const u of collars) {
        const c = point(mix(aa, bb, u), n, bend);
        add('collar', radius + 0.065, [point(c, t, -0.09), point(c, t, 0.09)], [aa, bb]);
      }
      // Supports are at the contacts, so frame bays never gain floating brackets.
      for (const c of vertical ? collars.map((u) => mix(aa, bb, u)) : [aa, bb])
        add('support', 0.11, [point(c, n, -0.08), point(c, n, bend)], [c, c]);
    }
    if (vertical) return;
    for (let j = 0; j < 3; j++) {
      const aa = point(a, [0, 1, 0], -1.65 - j * 0.22),
        bb = point(b, [0, 1, 0], -1.65 - j * 0.22);
      const sag = 0.26 + j * 0.13;
      const points = Array.from({ length: 25 }, (_, i) => {
        const u = i / 24,
          p = mix(aa, bb, u);
        // Different sag and outward bow keep thin wires legible as a bundle.
        p[1] -= 4 * sag * u * (1 - u);
        return point(p, n, 0.22 * Math.sin(Math.PI * u));
      });
      points[0] = aa;
      points[24] = bb;
      add(j === 0 ? 'cable' : 'wire', j === 0 ? 0.055 : 0.022, points, [aa, bb]);
    }
  };
  for (const p of world.roadBuildings ?? []) {
    const body = new Set(p.body),
      interior = new Set(p.interior),
      entry = new Set(p.entry);
    for (const [i, a] of p.anchors.entries()) {
      const x = a.tx - p.tx0,
        z = a.tz - p.tz0;
      const wall = (x: number, z: number): boolean =>
        x >= 0 &&
        z >= 0 &&
        x < 24 &&
        z < 24 &&
        body.has(z * 24 + x) &&
        !interior.has(z * 24 + x) &&
        !entry.has(z * 24 + x) &&
        !body.has((z + a.nz) * 24 + x + a.nx);
      if (!wall(x, z)) continue;
      let best = 0;
      for (const sign of [-1, 1]) {
        let d = 0;
        while (d < 5 && wall(x - a.nz * (d + 1) * sign, z + a.nx * (d + 1) * sign)) d++;
        if (d > Math.abs(best)) best = d * sign;
      }
      if (Math.abs(best) < 1) continue;
      const y = p.roofY - 2.2;
      const start: UtilityPoint = [
        (a.tx + 0.5) * TILE_SIZE + a.nx * 1.48,
        y,
        (a.tz + 0.5) * TILE_SIZE + a.nz * 1.48,
      ];
      const end: UtilityPoint = [
        start[0] - a.nz * best * TILE_SIZE,
        y,
        start[2] + a.nx * best * TILE_SIZE,
      ];
      bank(p.id, String(i), start, end, [a.nx, 0, a.nz]);
      const bottom = Math.max(p.baseTop + 6, 6.5);
      // A riser follows a genuinely solid wall strip, not a stack of windows.
      if (
        i < 2 &&
        y - bottom > 6 &&
        !(roadBuildingAir(p, x, z) ?? []).some(([f, c]) => f < y && c > bottom)
      ) {
        bank(p.id, `riser:${i}`, [start[0], bottom, start[2]], start, [a.nx, 0, a.nz], true);
      }
    }
  }
  for (const p of world.pillars.values()) {
    if (!p.frame) continue;
    const f = p.frame;
    const transform = (x: number, z: number, y: number): UtilityPoint => {
      for (let r = 0; r < f.rotation; r++) [x, z] = [PILLAR_CELL_TILES * TILE_SIZE - z, x];
      return [
        p.acx * PILLAR_CELL_TILES * TILE_SIZE + x,
        y,
        p.acz * PILLAR_CELL_TILES * TILE_SIZE + z,
      ];
    };
    for (const south of [false, true])
      for (let level = 0; level < (south ? f.southLevels : f.aboveLevels); level += 3) {
        const y = frameFloorY(level) + 7.8,
          z = south ? 125.98 : 42.02;
        const a = transform(46.5, z, y),
          b = transform(61.5, z, y);
        const n0 = transform(46.5, z + (south ? 1 : -1), y);
        bank(`frame:${p.acx},${p.acz}`, `${south}:${level}`, a, b, [n0[0] - a[0], 0, n0[2] - a[2]]);
      }
    for (const south of [false, true]) {
      const top = frameFloorY(south ? f.southLevels : f.aboveLevels) - 2.2;
      const z = south ? 125.98 : 42.02;
      const a = transform(46.5, z, 8.3),
        b = transform(46.5, z, top);
      const n0 = transform(46.5, z + (south ? 1 : -1), 8.3);
      if (top > 14.3)
        bank(
          `frame:${p.acx},${p.acz}`,
          `riser:${south}`,
          a,
          b,
          [n0[0] - a[0], 0, n0[2] - a[2]],
          true,
        );
    }
    // Long spans cross the actual atrium between two solid inner piers.
    // The lower wing's roof, not a loaded neighbour, supplies the far anchor.
    for (let j = 0; j < 3; j++) {
      const a = transform(94.5 + j * 0.2, 65.98, frameFloorY(f.aboveLevels) - 3);
      const b = transform(94.5 + j * 0.2, 102.02, frameFloorY(f.southLevels) - 3);
      const points = Array.from({ length: 49 }, (_, i) => {
        const t = i / 48,
          q = mix(a, b, t);
        q[1] -= 4 * (2.5 + j * 0.5) * t * (1 - t);
        return q;
      });
      points[0] = a;
      points[48] = b;
      out.push({
        source: `frame:${p.acx},${p.acz}`,
        id: `frame:${p.acx},${p.acz}:atrium:${j}`,
        kind: j === 0 ? 'cable' : 'wire',
        radius: j === 0 ? 0.07 : 0.03,
        points,
        anchors: [a, b],
      });
    }
  }
  return out;
}

export interface UtilityBuffers {
  verts: number[];
  norms: number[];
  uvs: number[];
  idxs: number[];
  colors?: number[];
}
export interface UtilityBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
export type UtilityBatches = Record<'pipe' | 'fitting' | 'cable', UtilityBuffers>;
const cache = new WeakMap<WorldData, UtilityRun[]>();
/** Maximum half-chord 1.5wu + radius <=0.615wu: owned strips project less
 * than 2.2wu outside requested bounds, well inside the renderer build margin.
 * A half-open ABSOLUTE midpoint owns each strip (and endpoint each cap).
 * Never crop/reparameterize a curve to a build window: seams stay identical.
 * Weak cached data dies with WorldData; GPU geometry uses renderer disposal.
 */
export function buildStructureUtilityBuffers(
  world: WorldData,
  bounds: UtilityBounds,
): UtilityBatches {
  let runs = cache.get(world);
  if (!runs) {
    runs = collectStructureUtilities(world);
    cache.set(world, runs);
  }
  return buildUtilityRunBuffers(world, bounds, runs);
}

/** Shared tube tessellation; callers own their plans, caches and reach budget. */
export function buildUtilityRunBuffers(
  world: WorldData,
  bounds: UtilityBounds,
  runs: UtilityRun[],
): UtilityBatches {
  const empty = (): UtilityBuffers => ({ verts: [], norms: [], uvs: [], idxs: [] });
  const batches: UtilityBatches = { pipe: empty(), fitting: empty(), cable: empty() };
  const ox = world.originPcx * PILLAR_CELL_TILES * TILE_SIZE,
    oz = world.originPcz * PILLAR_CELL_TILES * TILE_SIZE;
  const owns = (p: UtilityPoint): boolean =>
    p[0] >= bounds.x0 * TILE_SIZE + ox &&
    p[0] < bounds.x1 * TILE_SIZE + ox &&
    p[2] >= bounds.z0 * TILE_SIZE + oz &&
    p[2] < bounds.z1 * TILE_SIZE + oz;
  for (const run of runs) {
    const xs = run.points.map((p) => p[0]),
      zs = run.points.map((p) => p[2]);
    if (
      Math.max(...xs) < bounds.x0 * 3 + ox - run.radius ||
      Math.min(...xs) >= bounds.x1 * 3 + ox + run.radius ||
      Math.max(...zs) < bounds.z0 * 3 + oz - run.radius ||
      Math.min(...zs) >= bounds.z1 * 3 + oz + run.radius
    )
      continue;
    const paint =
      run.kind === 'pipe'
        ? mountedPipeFinish(
            (world.seed ?? 0) + (world.stack ?? 0) * 100000,
            run.source,
            run.radius,
            run.anchors[0],
          ).color
        : undefined;
    const buf =
      batches[
        run.kind === 'pipe'
          ? 'pipe'
          : run.kind === 'cable' || run.kind === 'wire'
            ? 'cable'
            : 'fitting'
      ];
    const points: UtilityPoint[] = [run.points[0]!];
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1]!,
        b = run.points[i]!;
      // Curves already provide their bend/sag samples. Long straight spans
      // need only tile-sized chords, not dense sub-tile rings.
      const steps = Math.max(1, Math.ceil(new Vector3(...a).distanceTo(new Vector3(...b)) / 3));
      for (let k = 1; k <= steps; k++) points.push(mix(a, b, k / steps));
    }
    const sides = run.kind === 'wire' ? 5 : 8;
    const tangents = points.map((_, i) =>
      new Vector3(...points[Math.min(i + 1, points.length - 1)]!)
        .sub(new Vector3(...points[Math.max(i - 1, 0)]!))
        .normalize(),
    );
    let u = new Vector3()
      .crossVectors(
        tangents[0]!,
        Math.abs(tangents[0]!.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0),
      )
      .normalize();
    const transport = new Quaternion();
    const rings = points.map((p, i) => {
      const tangent = tangents[i]!;
      if (i > 0)
        u.applyQuaternion(transport.setFromUnitVectors(tangents[i - 1]!, tangent)).normalize();
      const v = new Vector3().crossVectors(tangent, u).normalize();
      u = new Vector3().crossVectors(v, tangent).normalize();
      return Array.from({ length: sides }, (_, j) => {
        const angle = (j / sides) * Math.PI * 2;
        const normal = u
          .clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(v, Math.sin(angle));
        return { p: new Vector3(...p).addScaledVector(normal, run.radius), n: normal };
      });
    });
    // Track the real length of each meridian through bends. Computing from
    // the complete run (before strip ownership) keeps UVs stable at seams.
    const along: number[][] = [];
    for (let i = 0; i < rings.length; i++)
      along.push(
        rings[i]!.map((c, j) =>
          i === 0 ? 0 : along[i - 1]![j]! + c.p.distanceTo(rings[i - 1]![j]!.p),
        ),
      );
    const edgeLength = 2 * run.radius * Math.sin(Math.PI / sides);
    const vertex = (p: Vector3, n: Vector3, u: number, v: number): number => {
      const index = buf.verts.length / 3;
      buf.verts.push(p.x - ox, p.y, p.z - oz);
      buf.norms.push(n.x, n.y, n.z);
      if (paint) (buf.colors ??= []).push(...paint);
      buf.uvs.push(u / TILE_SIZE, v / TILE_SIZE);
      return index;
    };
    for (let i = 0; i < points.length - 1; i++) {
      if (!owns(mix(points[i]!, points[i + 1]!, 0.5))) continue;
      for (let j = 0; j < sides; j++) {
        const k = (j + 1) % sides;
        const corners = [rings[i]![j]!, rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![j]!];
        const uv = [
          [along[i]![j]!, j * edgeLength],
          [along[i]![k]!, (j + 1) * edgeLength],
          [along[i + 1]![k]!, (j + 1) * edgeLength],
          [along[i + 1]![j]!, j * edgeLength],
        ];
        const ids = corners.map((c, q) => vertex(c.p, c.n, uv[q]![1]!, uv[q]![0]!));
        // Ring winding follows the tangent; ring-then-longitudinal faces outward.
        buf.idxs.push(ids[0]!, ids[1]!, ids[2]!, ids[0]!, ids[2]!, ids[3]!);
      }
    }
    for (const i of [0, points.length - 1]) {
      if (!owns(points[i]!)) continue;
      const n = tangents[i]!.clone().multiplyScalar(i === 0 ? -1 : 1);
      const origin = new Vector3(...points[i]!);
      const capU = rings[i]![0]!.n,
        capV = new Vector3().crossVectors(tangents[i]!, capU).normalize();
      const capVertex = (p: Vector3): number => {
        const d = p.clone().sub(origin);
        return vertex(p, n, d.dot(capU), d.dot(capV));
      };
      const center = vertex(origin, n, 0, 0);
      for (let j = 0; j < sides; j++) {
        const a = capVertex(rings[i]![j]!.p),
          b = capVertex(rings[i]![(j + 1) % sides]!.p);
        buf.idxs.push(center, i === 0 ? b : a, i === 0 ? a : b);
      }
    }
  }
  return batches;
}
