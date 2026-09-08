/** Exact infrastructure facets; no independently approximated render tubes.
 * Bounds and model coordinates are absolute wu. Only final vertices are rebased.
 * Buffers feed DungeonRenderer's existing three material accumulators/disposal. */
import type { WorldData } from '../game/types';
import { infrastructureBaseWorld } from '../game/dungeon/infrastructure-columns';
import { TILE_SIZE } from '../game/types';
import { PILLAR_CELL_TILES } from '../game/dungeon/pillar-layer';
import {
  infrastructureBoundaryFaceBatches,
  clipInfrastructurePolygon,
  type InfrastructurePrimitive,
  type InfrastructurePlane,
} from '../game/dungeon/infrastructure-solid';
import type { UtilityBatches, UtilityBounds } from './StructureUtilities';
import { infrastructureUVChart, surfaceUV } from './surface-uv';
import { pipeFinish } from '../game/dungeon/infrastructure-finishes';
/** Alias for consumers of the renderer: one shared cached base authority. */
export const infrastructureRenderWorld = infrastructureBaseWorld;
export function buildInfrastructureBuffers(
  primitives: readonly InfrastructurePrimitive[],
  bounds: UtilityBounds,
  originX = 0,
  originZ = 0,
  appearanceSeed = 0,
): UtilityBatches {
  const work = buildInfrastructureBuffersIncrementally(
    primitives,
    bounds,
    originX,
    originZ,
    appearanceSeed,
  );
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}

/** Same output as the headless compiler, yielded between CSG/facet batches. */
export function* buildInfrastructureBuffersIncrementally(
  primitives: readonly InfrastructurePrimitive[],
  bounds: UtilityBounds,
  originX = 0,
  originZ = 0,
  appearanceSeed = 0,
): Generator<void, UtilityBatches> {
  const empty = () => ({
    verts: [] as number[],
    norms: [] as number[],
    uvs: [] as number[],
    idxs: [] as number[],
  });
  const out: UtilityBatches = { pipe: empty(), fitting: empty(), cable: empty() };
  const planes: InfrastructurePlane[] = [
    { n: [-1, 0, 0], d: -bounds.x0 },
    { n: [1, 0, 0], d: bounds.x1 },
    { n: [0, 0, -1], d: -bounds.z0 },
    { n: [0, 0, 1], d: bounds.z1 },
  ];
  let faceCount = 0;
  for (const batch of infrastructureBoundaryFaceBatches(primitives, {
    ...bounds,
    y0: -Infinity,
    y1: Infinity,
  })) {
    if (!batch) {
      yield;
      continue;
    }
    for (const face of batch) {
      if (++faceCount % 16 === 0) yield;
      let poly = face.vertices;
      // Half-open ownership for real faces exactly on a job boundary; ordinary
      // crossing faces are geometrically clipped, never capped at temporary edges.
      if (
        poly.every((v) => Math.abs(v[0] - bounds.x1) < 1e-8) ||
        poly.every((v) => Math.abs(v[2] - bounds.z1) < 1e-8)
      )
        continue;
      for (const p of planes) {
        poly = clipInfrastructurePolygon(poly, p);
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;
      const buf =
        out[
          face.primitive.kind === 'cable'
            ? 'cable'
            : face.primitive.kind === 'pipe'
              ? 'pipe'
              : 'fitting'
        ];
      const start = buf.verts.length / 3;
      const chart = infrastructureUVChart(face.primitive, face.normal, poly[0]!);
      const paint =
        face.primitive.kind === 'pipe'
          ? pipeFinish(appearanceSeed, face.primitive).color
          : undefined;
      for (const v of poly) {
        buf.verts.push(v[0] - originX, v[1], v[2] - originZ);
        buf.norms.push(...face.normal);
        if (paint) (buf.colors ??= []).push(...paint);
        buf.uvs.push(...surfaceUV(chart, v));
      }
      for (let i = 1; i + 1 < poly.length; i++) {
        const a = poly[0]!,
          b = poly[i]!,
          c = poly[i + 1]!;
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        if (
          Math.hypot(
            u[1]! * v[2]! - u[2]! * v[1]!,
            u[2]! * v[0]! - u[0]! * v[2]!,
            u[0]! * v[1]! - u[1]! * v[0]!,
          ) > 1e-8
        )
          buf.idxs.push(start, start + i, start + i + 1);
      }
    }
    yield;
  }
  return out;
}
/** DungeonRenderer bounds are window-local tiles, converted only here. */
export function buildWorldInfrastructureBuffersIncrementally(
  world: WorldData,
  bounds: UtilityBounds,
): Generator<void, UtilityBatches> {
  const ox = world.originPcx * PILLAR_CELL_TILES * TILE_SIZE,
    oz = world.originPcz * PILLAR_CELL_TILES * TILE_SIZE;
  return buildInfrastructureBuffersIncrementally(
    world.infrastructure?.primitives ?? [],
    {
      x0: ox + bounds.x0 * TILE_SIZE,
      x1: ox + bounds.x1 * TILE_SIZE,
      z0: oz + bounds.z0 * TILE_SIZE,
      z1: oz + bounds.z1 * TILE_SIZE,
    },
    ox,
    oz,
    (world.seed ?? 0) + (world.stack ?? 0) * 100000,
  );
}

export function buildWorldInfrastructureBuffers(
  world: WorldData,
  bounds: UtilityBounds,
): UtilityBatches {
  const ox = world.originPcx * PILLAR_CELL_TILES * TILE_SIZE,
    oz = world.originPcz * PILLAR_CELL_TILES * TILE_SIZE;
  return buildInfrastructureBuffers(
    world.infrastructure?.primitives ?? [],
    {
      x0: ox + bounds.x0 * TILE_SIZE,
      x1: ox + bounds.x1 * TILE_SIZE,
      z0: oz + bounds.z0 * TILE_SIZE,
      z1: oz + bounds.z1 * TILE_SIZE,
    },
    ox,
    oz,
    (world.seed ?? 0) + (world.stack ?? 0) * 100000,
  );
}
