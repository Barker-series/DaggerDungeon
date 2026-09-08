/** Building-owned maintenance routes. Geometry is compiled into the ordinary
 * columns; ladder interactions and fittings are derived from the same complete
 * plan. No loaded-neighbour queries, cross-cell writes or renderer decisions. */
import type { WorldData } from '../types';
import type { FrameBuildingPlan } from './frame-building';
import { frameFloorY } from './frame-building';

export interface ServiceDeck {
  level: number;
  top: number;
  bottom: number;
  ladderX: number;
  endX: number;
}

export function frameServiceDecks(p: FrameBuildingPlan): ServiceDeck[] {
  if (!p.serviceRoutes) return [];
  const out: ServiceDeck[] = [];
  for (let level = 3; level < p.aboveLevels; level += p.industrial ? 4 : 6) {
    const endX = level > p.setbackLevel ? 36 : 40;
    out.push({
      level,
      top: frameFloorY(level),
      bottom: frameFloorY(level - 1),
      ladderX: level % 8 === 3 || endX === 36 ? 32 : 38,
      endX,
    });
  }
  return out;
}

/** Unrotated tile columns: thick anchored shelf, corbels, projecting approach
 * and broad ladder foot. The ladder climbs OUTSIDE the upper shelf slab. */
export function frameServiceSolids(p: FrameBuildingPlan, x: number, z: number): [number, number][] {
  if (x < 27 || x > 40 || z < 22 || z > 25) return [];
  const out: [number, number][] = [];
  for (const d of frameServiceDecks(p)) {
    if (x > d.endX) continue;
    if (z === 22) {
      out.push([d.top - 1.25, d.top]);
      if ([31, 36, 40].includes(x)) out.push([d.top - 3.5, d.top - 1.25]);
    }
    if ((z >= 24 && x <= d.ladderX + 1) || (z === 23 && x >= d.ladderX && x <= d.ladderX + 1)) {
      out.push([d.bottom - 1.25, d.bottom]);
      // A deep root beam rather than an unsupported paper-thin projection.
      if (x <= 28) out.push([d.bottom - 3, d.bottom - 1.25]);
    }
  }
  return out;
}

export interface ServiceLadder {
  id: string;
  x: number;
  z: number;
  bottom: number;
  top: number;
  nx: number;
  nz: number;
  exitX: number;
  exitZ: number;
}

/** Point rotation uses the continuous 168wu cell, not tile-index rotation. */
export function serviceWorldPoint(
  acx: number,
  acz: number,
  rotation: number,
  x: number,
  z: number,
): [number, number] {
  for (let i = 0; i < rotation; i++) [x, z] = [168 - z, x];
  return [acx * 168 + x, acz * 168 + z];
}

export function collectServiceLadders(world: WorldData): ServiceLadder[] {
  const out: ServiceLadder[] = [];
  for (const p of world.pillars.values()) {
    if (!p.frame) continue;
    for (const d of frameServiceDecks(p.frame)) {
      const [x, z] = serviceWorldPoint(
        p.acx,
        p.acz,
        p.frame.rotation,
        (d.ladderX + 0.5) * 3,
        69.75,
      );
      const [exitX, exitZ] = serviceWorldPoint(
        p.acx,
        p.acz,
        p.frame.rotation,
        (d.ladderX + 0.5) * 3,
        67.5,
      );
      const [aheadX, aheadZ] = serviceWorldPoint(
        p.acx,
        p.acz,
        p.frame.rotation,
        (d.ladderX + 0.5) * 3,
        70.75,
      );
      out.push({
        id: `service:${p.acx},${p.acz}:${d.level}`,
        x,
        z,
        bottom: d.bottom,
        top: d.top,
        nx: aheadX - x,
        nz: aheadZ - z,
        exitX,
        exitZ,
      });
    }
  }
  return out;
}
