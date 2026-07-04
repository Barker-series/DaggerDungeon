/**
 * Organic wall contour — marching squares over the tile grid, sampled at
 * TILE CENTERS, shared by the renderer (wall geometry) and the game engine
 * (collision). One source of truth: the wall you see is the wall you hit.
 *
 * Each 2x2 group of tile centers with mixed floor/wall produces one or two
 * line segments through the edge midpoints between centers. Straight runs
 * land exactly on tile boundaries (matching the axis-aligned wall quads);
 * corners get 45° chamfers that cut across the wall tile, never into open
 * floor beyond half a tile.
 */

import { TileType, TILE_SIZE, type DungeonData } from '../types';
import { getCell, isOrganicBiome } from './cells';

const CELL_TILE_SIZE = 14;

export interface ContourSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Top-left tile of the 2x2 group that produced this segment */
  gx: number;
  gz: number;
}

export interface OrganicContour {
  segments: ContourSegment[];
  /** Segments indexed by the flat tile index (y * width + x) of each tile
   *  in their 2x2 group — query the 3x3 neighborhood around a position. */
  byTile: Map<number, ContourSegment[]>;
  /** Flat indices of wall tiles in organic cells: their box collision is
   *  replaced by the contour segments. */
  softWalls: Set<number>;
}

/**
 * Marching squares lookup table.
 * 4-bit index from (TL<<3 | TR<<2 | BR<<1 | BL), 1 = floor.
 * Segments as pairs of edge indices: 0=top, 1=right, 2=bottom, 3=left.
 */
const MS_TABLE: number[][][] = [
  [],                // 0: all wall
  [[3, 2]],          // 1: BL floor
  [[2, 1]],          // 2: BR floor
  [[3, 1]],          // 3: BL+BR floor
  [[1, 0]],          // 4: TR floor
  [[3, 0], [1, 2]],  // 5: BL+TR (saddle)
  [[2, 0]],          // 6: BR+TR floor
  [[3, 0]],          // 7: BL+BR+TR floor
  [[0, 3]],          // 8: TL floor
  [[0, 2]],          // 9: TL+BL floor
  [[0, 1], [2, 3]],  // 10: TL+BR (saddle)
  [[0, 1]],          // 11: TL+BL+BR floor
  [[1, 3]],          // 12: TL+TR floor
  [[1, 2]],          // 13: TL+TR+BL floor
  [[2, 3]],          // 14: TL+TR+BR floor
  [],                // 15: all floor
];

export function isOrganicTile(tx: number, tz: number): boolean {
  const cell = getCell(Math.floor(tx / CELL_TILE_SIZE), Math.floor(tz / CELL_TILE_SIZE));
  return cell ? isOrganicBiome(cell.biome) : false;
}

export function buildOrganicContour(dungeon: DungeonData): OrganicContour {
  const s = TILE_SIZE;
  const w = dungeon.width;
  const h = dungeon.height;

  const segments: ContourSegment[] = [];
  const byTile = new Map<number, ContourSegment[]>();
  const softWalls = new Set<number>();

  const getTile = (tx: number, tz: number): number => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return 0;
    return dungeon.tiles[tz]![tx] !== TileType.Wall ? 1 : 0;
  };

  const register = (tx: number, tz: number, seg: ContourSegment): void => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return;
    const key = tz * w + tx;
    let list = byTile.get(key);
    if (!list) {
      list = [];
      byTile.set(key, list);
    }
    list.push(seg);
  };

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      if (dungeon.tiles[tz]![tx] === TileType.Wall && isOrganicTile(tx, tz)) {
        softWalls.add(tz * w + tx);
      }

      // 2x2 group of tile centers: (tx,tz) .. (tx+1,tz+1)
      if (!isOrganicTile(tx, tz) && !isOrganicTile(tx + 1, tz) && !isOrganicTile(tx, tz + 1) && !isOrganicTile(tx + 1, tz + 1)) continue;

      const tl = getTile(tx, tz);
      const tr = getTile(tx + 1, tz);
      const br = getTile(tx + 1, tz + 1);
      const bl = getTile(tx, tz + 1);

      const caseIdx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caseIdx === 0 || caseIdx === 15) continue;

      // Edge midpoints between tile centers (center of tile (tx,tz) is at
      // (tx+0.5)*s). 0=top, 1=right, 2=bottom, 3=left.
      const cx = (tx + 1) * s; // shared corner of the group
      const cz = (tz + 1) * s;
      const edgeMid: [number, number][] = [
        [cx, cz - s * 0.5], // top
        [cx + s * 0.5, cz], // right
        [cx, cz + s * 0.5], // bottom
        [cx - s * 0.5, cz], // left
      ];

      for (const segDef of MS_TABLE[caseIdx] ?? []) {
        if (!segDef || segDef.length < 2) continue;
        const p0 = edgeMid[segDef[0]!]!;
        const p1 = edgeMid[segDef[1]!]!;
        const seg: ContourSegment = { x0: p0[0], z0: p0[1], x1: p1[0], z1: p1[1], gx: tx, gz: tz };
        segments.push(seg);
        register(tx, tz, seg);
        register(tx + 1, tz, seg);
        register(tx, tz + 1, seg);
        register(tx + 1, tz + 1, seg);
      }
    }
  }

  return { segments, byTile, softWalls };
}

/** Squared distance from a point to a segment (2D, XZ plane) */
export function segmentDistSq(seg: ContourSegment, x: number, z: number): number {
  const dx = seg.x1 - seg.x0;
  const dz = seg.z1 - seg.z0;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((x - seg.x0) * dx + (z - seg.z0) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const px = seg.x0 + dx * t;
  const pz = seg.z0 + dz * t;
  return (x - px) * (x - px) + (z - pz) * (z - pz);
}
