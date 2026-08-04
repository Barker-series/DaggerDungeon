/**
 * Roads wall contour — One Wall v2, slice 2.
 *
 * Roads districts are plinth architecture: block masses are Wall tiles
 * whose columns carry one air span from a flat, module-quantized top
 * (0.6 court, 3/6/9/12 masses) to the sky. Their walls are CLIFFS in a
 * heightmap, not walkable|wall boundaries — stair risers between two
 * plinths are wall|wall in the tile grid, which is why the organic
 * marching-squares contour (walkability-based) cannot see them (the
 * reverted first attempt, Aug 2026; see segment-walls-design.md).
 *
 * This pass runs marching squares PER MODULE LEVEL (3, 6, 9, 12) over
 * the field "tile top >= level". Every 3-unit band of every cliff —
 * street wall or riser — gets its own smooth contour ring, and both
 * sides of a one-tile ridge read the same field, so their walls agree
 * by construction. Segments carry the band [level-3, level]:
 *  - the renderer extrudes them as plain vertical quads (sharp
 *    brutalist edges — no octagonal trim) and suppresses the square
 *    span-XOR faces they replace;
 *  - collision blocks a body exactly like the square span rule did
 *    (pass when feetY > top - 1.5), so plinth tops stay walkable,
 *    mantling is unchanged, and sub-module court lips (0.1) never
 *    produce segments at all.
 *
 * Participation is strict: all four tiles of a group must be
 * roads-district, non-pillar, with a defined top (street floor or
 * single-sky-span plinth). District borders and pillars keep their
 * square span-derived faces.
 */

import { TileType, TILE_SIZE, SKY_CEIL, type WorldData } from '../types';

export interface RoadsSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Top-left tile of the 2x2 group that produced this segment */
  gx: number;
  gz: number;
  /** Vertical band of this wall piece */
  lo: number;
  hi: number;
  /** Normal toward the LOW (open) side */
  nx: number;
  nz: number;
  /** Index into ROAD_WALL_LEVELS */
  levelIdx: number;
}

export interface RoadsContour {
  segments: RoadsSegment[];
  /** Segments indexed by flat tile index of each tile in their group */
  byTile: Map<number, RoadsSegment[]>;
  /** (group flat index * levels.length + levelIndex) that emitted —
   *  the face-pass suppression consults exactly this. */
  groupLevels: Set<number>;
  /** Plinth tiles whose EVERY corner group fully participates: their
   *  square tile-box collision is replaced by the banded segments
   *  (the organic softWalls rule, roads edition). Border plinths with
   *  any non-participating corner group stay hard — going soft there
   *  would strip collision from sides the contour never covers. */
  softPlinths: Set<number>;
}

export const ROAD_WALL_MODULE = 3;
export const ROAD_WALL_LEVELS: readonly number[] = [3, 6, 9, 12];

// Marching squares lookup (same convention as organiccontour):
// 4-bit index (TL<<3 | TR<<2 | BR<<1 | BL), 1 = LOW side (below level).
// Segments as pairs of edge indices: 0=top, 1=right, 2=bottom, 3=left.
const MS_TABLE: number[][][] = [
  [],
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[1, 0]],
  [[3, 0], [1, 2]],
  [[2, 0]],
  [[3, 0]],
  [[0, 3]],
  [[0, 2]],
  [[0, 1], [2, 3]],
  [[0, 1]],
  [[1, 3]],
  [[1, 2]],
  [[2, 3]],
  [],
];

export function buildRoadsContour(world: WorldData): RoadsContour {
  const L = world.levels[0]!;
  const w = L.width;
  const h = L.height;
  const segments: RoadsSegment[] = [];
  const byTile = new Map<number, RoadsSegment[]>();
  const groupLevels = new Set<number>();
  const softPlinths = new Set<number>();
  const out: RoadsContour = { segments, byTile, groupLevels, softPlinths };
  if (!L.roadsCells) return out;
  const cellTiles = Math.floor(w / L.cellBiomes.length) || w;
  const isRoads = (tx: number, tz: number): boolean =>
    L.roadsCells?.[Math.floor(tz / cellTiles)]?.[Math.floor(tx / cellTiles)] ?? false;

  // ── Per-tile TOP: street/court walking surface or plinth top.
  // NaN = non-participant (non-roads, pillar, bore-carrying wall).
  const top = new Float64Array(w * h).fill(NaN);
  let any = false;
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      if (!isRoads(tx, tz)) continue;
      if (L.pillarWall?.[tz]?.[tx]) continue;
      const k = tz * w + tx;
      if (L.tiles[tz]![tx] === TileType.Wall) {
        const spans = world.columns[k]!;
        if (spans.length === 1 && spans[0]!.ceil >= SKY_CEIL) {
          top[k] = spans[0]!.floor;
          any = true;
        }
      } else {
        top[k] = L.floorHeights[tz]![tx]!;
        any = true;
      }
    }
  }
  if (!any) return out;

  // ── Soft plinths: full corner-group coverage required (see interface)
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      const k = tz * w + tx;
      if (Number.isNaN(top[k]!)) continue;
      if (L.tiles[tz]![tx] !== TileType.Wall) continue;
      let covered = true;
      for (const [gx, gz] of [[tx - 1, tz - 1], [tx, tz - 1], [tx - 1, tz], [tx, tz]] as const) {
        if (gx < 0 || gz < 0 || gx >= w - 1 || gz >= h - 1) {
          covered = false;
          break;
        }
        if (Number.isNaN(top[gz * w + gx]!) || Number.isNaN(top[gz * w + gx + 1]!)
          || Number.isNaN(top[(gz + 1) * w + gx]!) || Number.isNaN(top[(gz + 1) * w + gx + 1]!)) {
          covered = false;
          break;
        }
      }
      if (covered) softPlinths.add(k);
    }
  }

  const s = TILE_SIZE;
  const register = (tx: number, tz: number, seg: RoadsSegment): void => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return;
    const key = tz * w + tx;
    let list = byTile.get(key);
    if (!list) {
      list = [];
      byTile.set(key, list);
    }
    list.push(seg);
  };

  for (let li = 0; li < ROAD_WALL_LEVELS.length; li++) {
    const Lv = ROAD_WALL_LEVELS[li]!;
    for (let gz = 0; gz < h - 1; gz++) {
      for (let gx = 0; gx < w - 1; gx++) {
        const t00 = top[gz * w + gx]!;
        const t10 = top[gz * w + gx + 1]!;
        const t01 = top[(gz + 1) * w + gx]!;
        const t11 = top[(gz + 1) * w + gx + 1]!;
        if (Number.isNaN(t00) || Number.isNaN(t10) || Number.isNaN(t01) || Number.isNaN(t11)) continue;
        // 1 = LOW side (below this level): matches organiccontour's
        // "1 = floor" convention so the same table applies.
        const bl0 = t00 < Lv - 0.05 ? 1 : 0;
        const bl1 = t10 < Lv - 0.05 ? 1 : 0;
        const bl2 = t11 < Lv - 0.05 ? 1 : 0;
        const bl3 = t01 < Lv - 0.05 ? 1 : 0;
        const caseIdx = (bl0 << 3) | (bl1 << 2) | (bl2 << 1) | bl3;
        if (caseIdx === 0 || caseIdx === 15) continue;
        // Edge midpoints between tile centers
        const cx0 = (gx + 0.5) * s;
        const cz0 = (gz + 0.5) * s;
        const mids: [number, number][] = [
          [cx0 + s / 2, cz0],         // 0: top edge (between TL,TR)
          [cx0 + s, cz0 + s / 2],     // 1: right edge (TR,BR)
          [cx0 + s / 2, cz0 + s],     // 2: bottom edge (BR,BL)
          [cx0, cz0 + s / 2],         // 3: left edge (BL,TL)
        ];
        // LOW-side centroid for normal orientation
        let lcx = 0;
        let lcz = 0;
        let ln = 0;
        const tiles4: [number, number, number][] = [
          [gx, gz, bl0], [gx + 1, gz, bl1], [gx + 1, gz + 1, bl2], [gx, gz + 1, bl3],
        ];
        for (const [tx, tz, low] of tiles4) {
          if (!low) continue;
          lcx += (tx + 0.5) * s;
          lcz += (tz + 0.5) * s;
          ln++;
        }
        for (const [e0, e1] of MS_TABLE[caseIdx]!) {
          const [x0, z0] = mids[e0!]!;
          const [x1, z1] = mids[e1!]!;
          let nx = -(z1 - z0);
          let nz = x1 - x0;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          if (ln > 0 && nx * (lcx / ln - mx) + nz * (lcz / ln - mz) < 0) {
            nx = -nx;
            nz = -nz;
          }
          const nl = Math.hypot(nx, nz) || 1;
          const seg: RoadsSegment = {
            x0, z0, x1, z1, gx, gz,
            lo: Lv - ROAD_WALL_MODULE - 0.1,
            hi: Lv,
            nx: nx / nl,
            nz: nz / nl,
            levelIdx: li,
          };
          segments.push(seg);
          for (const [tx, tz] of tiles4) register(tx, tz, seg);
        }
        groupLevels.add((gz * w + gx) * ROAD_WALL_LEVELS.length + li);
      }
    }
  }
  return out;
}
