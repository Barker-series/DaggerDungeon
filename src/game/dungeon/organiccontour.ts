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

import { TileType, TILE_SIZE, type DungeonData, type ColumnSpan } from '../types';
import { tileBiome, isOrganicBiome, type BiomeType } from './cells';

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
  /** Flat GROUP indices (gz * width + gx) that produced segments — the
   *  segment-wall extruder and the face-pass suppression must agree on
   *  exactly these (see DungeonRenderer.segGroupEmits). */
  segmentGroups: Set<number>;
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

/** Is the tile in an organic-biome cell, per a level's biome snapshot */
export function isOrganicTileIn(cellBiomes: (BiomeType | null)[][], tx: number, tz: number): boolean {
  const biome = tileBiome(cellBiomes, tx, tz);
  // null (transit pseudo-biome) stays NON-organic: flipping it to
  // contour-capable reclassified bore walls as soft and un-sealed
  // tunnel ceilings (tunnels opened to sky — Aug 2026). Transit wall
  // smoothing needs its own dedicated treatment, not this predicate.
  return biome ? isOrganicBiome(biome) : false;
}

/** A WALKABLE tile carved through the null (transit) pseudo-biome — a
 *  bore corridor between active cells. These join the contour so bore
 *  walls get machined 45° corner chamfers; soft bore walls also KEEP
 *  their ceiling caps (see the cap logic in DungeonRenderer), which is
 *  what seals the chamfer pockets in an enclosed space. Wall mass in
 *  null cells stays hard — only genuine corridor boundaries smooth. */
export function isTransitFloorIn(
  dungeon: Pick<DungeonData, 'tiles' | 'cellBiomes'>,
  tx: number,
  tz: number,
): boolean {
  const tile = dungeon.tiles[tz]?.[tx];
  if (tile === undefined || tile === TileType.Wall) return false;
  return tileBiome(dungeon.cellBiomes, tx, tz) === null;
}

export function buildOrganicContour(
  dungeon: DungeonData,
  /** Column model (optional): floor tiles BURIED by generated mass
   *  (fold structures) are structural, not organic air — contouring a
   *  corner as if they were open opens the chamfer wedge into solid
   *  (DDSNAP, Aug 2026). Pass it wherever available. */
  columns?: ColumnSpan[][],
): OrganicContour {
  const s = TILE_SIZE;
  const w = dungeon.width;
  const h = dungeon.height;
  // Roads-district tiles are 'outside' biome but rectilinear architecture:
  // their plinth walls are honest column geometry, not organic cave mass.
  // Ringing them with contour segments gave them phantom full-height 2D
  // collision (courts became unhoppable). roadsCells travels WITH the
  // world data so worker-generated worlds agree with the engine thread.
  const cellTiles = Math.floor(w / dungeon.cellBiomes.length) || w;
  const isRoadsTile = (tx: number, tz: number): boolean =>
    dungeon.roadsCells?.[Math.floor(tz / cellTiles)]?.[Math.floor(tx / cellTiles)] ?? false;
  const isOrganicTile = (tx: number, tz: number): boolean =>
    !isRoadsTile(tx, tz) && isOrganicTileIn(dungeon.cellBiomes, tx, tz);
  // Smoothing participants: organic biome tiles OR carved transit
  // floors (machined bores). Roads stay excluded (their own slice).
  const isSmoothTile = (tx: number, tz: number): boolean =>
    isOrganicTile(tx, tz)
    || (!isRoadsTile(tx, tz) && isTransitFloorIn(dungeon, tx, tz));

  const segments: ContourSegment[] = [];
  const byTile = new Map<number, ContourSegment[]>();
  const softWalls = new Set<number>();
  const segmentGroups = new Set<number>();

  const getTile = (tx: number, tz: number): number => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return 0;
    return dungeon.tiles[tz]![tx] !== TileType.Wall ? 1 : 0;
  };

  // Pillar footprints are STRUCTURAL: never contoured, never soft. Their
  // real shape (ramps, plazas, doorways) lives in the column spans; a
  // contour fence here would wall off the pillar's own stairs. Roads
  // tiles are structural for the same reason — a border group between a
  // cave ledge and a roads plinth must not fence the step with a 2D
  // segment the column model says is walkable.
  /** A floor tile whose column has no standable air at its floor —
   *  buried under generated mass. Structural like a pillar footprint:
   *  the mass's real shape lives in the column spans. */
  const isBuried = (tx: number, tz: number): boolean => {
    if (!columns || tx < 0 || tz < 0 || tx >= w || tz >= h) return false;
    if (dungeon.tiles[tz]![tx] === TileType.Wall) return false;
    const f = dungeon.floorHeights[tz]![tx]!;
    if (f <= -900) return false;
    const fy = dungeon.baseY + f;
    const col = columns[tz * w + tx];
    if (!col) return false;
    return !col.some((sp) => sp.floor <= fy + 0.05 && sp.ceil >= fy + 1.5);
  };
  const isPillar = (tx: number, tz: number): boolean =>
    (dungeon.pillarWall?.[tz]?.[tx] ?? false) || isRoadsTile(tx, tz) || isBuried(tx, tz);

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

  // ── Soft (contoured) walls — the one predicate the chamfer render,
  // the apron backing, and the soft collision all share. A wall tile is
  // soft ONLY if every corner group of it that touches walkable space
  // can produce a contour segment (has an organic tile). A partially
  // contourable wall (hallway meeting an organic boundary) must stay
  // HARD: going soft would strip square collision from sides the contour
  // never covers — a rendered wall you can walk through. ──
  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      if (dungeon.tiles[tz]![tx] !== TileType.Wall) continue;
      if (isPillar(tx, tz)) continue; // structural — always hard
      let touchesContour = false;
      let fullyCovered = true;
      for (const [gx, gz] of [[tx - 1, tz - 1], [tx, tz - 1], [tx - 1, tz], [tx, tz]]) {
        let hasWalk = false;
        let hasOrg = false;
        let hasPillar = false;
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const nx = gx! + ox!;
          const nz = gz! + oz!;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          if (dungeon.tiles[nz]![nx] !== TileType.Wall) hasWalk = true;
          if (isSmoothTile(nx, nz)) hasOrg = true;
          if (isPillar(nx, nz)) hasPillar = true;
        }
        if (hasWalk) {
          // Groups touching a pillar produce no contour (see below), so a
          // wall bordering one must stay hard or that side loses collision
          if (hasOrg && !hasPillar) touchesContour = true;
          else if (!hasOrg || hasPillar) fullyCovered = false;
        }
      }
      if (touchesContour && fullyCovered) {
        softWalls.add(tz * w + tx);
      }
    }
  }

  for (let tz = 0; tz < h; tz++) {
    for (let tx = 0; tx < w; tx++) {
      // 2x2 group of tile centers: (tx,tz) .. (tx+1,tz+1)
      if (!isSmoothTile(tx, tz) && !isSmoothTile(tx + 1, tz) && !isSmoothTile(tx, tz + 1) && !isSmoothTile(tx + 1, tz + 1)) continue;
      // Groups touching a pillar produce no contour — the pillar's edge
      // is span-derived geometry, and a fence here would seal its stairs
      if (isPillar(tx, tz) || isPillar(tx + 1, tz) || isPillar(tx, tz + 1) || isPillar(tx + 1, tz + 1)) continue;

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
        segmentGroups.add(tz * w + tx);
        register(tx, tz, seg);
        register(tx + 1, tz, seg);
        register(tx, tz + 1, seg);
        register(tx + 1, tz + 1, seg);
      }
    }
  }

  return { segments, byTile, softWalls, segmentGroups };
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
