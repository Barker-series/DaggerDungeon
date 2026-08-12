/**
 * PIT RIM CONTOUR — marching-squares smoothing for pit edges, the
 * walls' treatment applied to holes. CUT-ONLY by design: only groups
 * with exactly ONE floor tile among pits emit (the convex sawtooth
 * corners); concave pit corners and straight runs keep their square
 * faces (which end up sealed exactly as today), and SADDLES DECLINE —
 * a diagonal walk between two floor tiles across a saddle passes
 * through the shared corner, and cutting it would drop the bot/player
 * through a hole on a path the tile grid calls walkable.
 *
 * Erosion never ADDS floor over a hole, so collision agreement is one
 * rule: a position on the pit side of its tile's rim segment has no
 * ground (you fall exactly where the hole is drawn) — never the
 * reverse. Decks/causeways SMOOTH like everything else (a diagonal
 * bridge's side is a straight 45° line, not a staircase); their cliff
 * bands are clipped renderer-side at arch-void ceilings so they never
 * hang through the open air carved under a deck.
 *
 * Effect distance: one tile (2x2 groups) — window-stable by the same
 * argument as the organic contour.
 */

import { TileType, TILE_SIZE, type DungeonData } from '../types';
import { PIT_LEVEL } from './heightfield';
import { archSpanAt } from './layer6-heights';
import type { ContourSegment } from './organiccontour';

export interface PitContour {
  /** CUT segments (convex floor corners eroded) */
  segments: ContourSegment[];
  /** FILL segments (concave pit corners bridged by a floor patch) */
  fillSegments: ContourSegment[];
  /** CUT segments indexed by flat tile index of each tile in group */
  byTile: Map<number, ContourSegment[]>;
  /** FILL segments indexed by the PIT tile they patch */
  fillByTile: Map<number, ContourSegment[]>;
  /** Cut corners of FLOOR tiles: (tz * w + tx) * 4 + corner, corner
   *  0=NW 1=NE 2=SW 3=SE (the roads-contour convention) */
  cutTileCorners: Set<number>;
  /** Groups (gz * w + gx) that emitted a CUT segment: the square XOR
   *  faces on their floor|pit boundary halves are SUPPRESSED — for
   *  cuts they'd poke out on the pit side of the diagonal (the pleat
   *  bug); fill groups keep their faces (buried inside the fill). */
  cutGroups: Set<number>;
}

/** Single-floor-corner marching-squares cases (1=floor bit order
 *  TL<<3|TR<<2|BR<<1|BL), with the segment endpoints as edge indices
 *  (0=top 1=right 2=bottom 3=left of the group) and which group tile
 *  is the floor (0=TL 1=TR 2=BL 3=BR). */
const CUT_CASES: Record<number, { seg: [number, number]; floorTile: number }> = {
  1: { seg: [3, 2], floorTile: 2 }, // BL floor
  2: { seg: [2, 1], floorTile: 3 }, // BR floor
  4: { seg: [1, 0], floorTile: 1 }, // TR floor
  8: { seg: [0, 3], floorTile: 0 }, // TL floor
};

/** Single-PIT-corner cases: the concave notch. The pit tile's near
 *  quarter is BRIDGED by a floor patch (fill) — smoothing must both
 *  erode convex corners and fill concave ones, or a diagonal pit edge
 *  (which alternates the two) keeps half its sawtooth. Filling only
 *  ADDS ground, so it can never drop the bot/player unexpectedly. */
const FILL_CASES: Record<number, { seg: [number, number]; pitTile: number }> = {
  7: { seg: [3, 0], pitTile: 0 }, // TL pit
  11: { seg: [0, 1], pitTile: 1 }, // TR pit
  13: { seg: [1, 2], pitTile: 3 }, // BR pit
  14: { seg: [2, 3], pitTile: 2 }, // BL pit
};

export function buildPitContour(dungeon: DungeonData): PitContour {
  const s = TILE_SIZE;
  const w = dungeon.width;
  const h = dungeon.height;
  const segments: ContourSegment[] = [];
  const fillSegments: ContourSegment[] = [];
  const byTile = new Map<number, ContourSegment[]>();
  const fillByTile = new Map<number, ContourSegment[]>();
  const cutTileCorners = new Set<number>();
  const cutGroups = new Set<number>();

  const isPit = (tx: number, tz: number): boolean =>
    tx >= 0 && tz >= 0 && tx < w && tz < h
    && dungeon.tiles[tz]![tx] !== TileType.Wall
    && dungeon.floorHeights[tz]![tx]! <= PIT_LEVEL;
  const isFloor = (tx: number, tz: number): boolean =>
    tx >= 0 && tz >= 0 && tx < w && tz < h
    && dungeon.tiles[tz]![tx] !== TileType.Wall
    && dungeon.floorHeights[tz]![tx]! > PIT_LEVEL;
  /** THIN pit: a slot one tile wide (floor on both opposite sides).
   *  Smoothing a slot fans opposing rim wedges into each other —
   *  slots stay square. */
  const isThinPit = (tx: number, tz: number): boolean =>
    isPit(tx, tz)
    && ((isFloor(tx - 1, tz) && isFloor(tx + 1, tz))
      || (isFloor(tx, tz - 1) && isFloor(tx, tz + 1)));

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

  for (let tz = 0; tz < h - 1; tz++) {
    for (let tx = 0; tx < w - 1; tx++) {
      // Group tiles: TL (tx,tz), TR, BL, BR
      const tl = isFloor(tx, tz);
      const tr = isFloor(tx + 1, tz);
      const bl = isFloor(tx, tz + 1);
      const br = isFloor(tx + 1, tz + 1);
      // The NON-floor tiles must all be PITS (walls never border pits —
      // the pit buffer — but arch columns and window rims exist; any
      // wall in the group declines it)
      const pTL = isPit(tx, tz);
      const pTR = isPit(tx + 1, tz);
      const pBL = isPit(tx, tz + 1);
      const pBR = isPit(tx + 1, tz + 1);
      const caseIdx = (Number(tl) << 3) | (Number(tr) << 2) | (Number(br) << 1) | Number(bl);
      const cut = CUT_CASES[caseIdx];
      const fill = FILL_CASES[caseIdx];
      if (!cut && !fill) continue;
      // Every non-floor tile must be a genuine pit
      if ((!tl && !pTL) || (!tr && !pTR) || (!bl && !pBL) || (!br && !pBR)) continue;
      // Thin-slot pits decline the whole group
      if ((pTL && isThinPit(tx, tz)) || (pTR && isThinPit(tx + 1, tz))
        || (pBL && isThinPit(tx, tz + 1)) || (pBR && isThinPit(tx + 1, tz + 1))) continue;
      // ARCH-carved floors decline: arch undersides render DATA-EXACT
      // (flat per-tile soffits), and a smoothing band can't meet that
      // surface — its corner-blended bottom hangs mid-air as a
      // floating panel at the arch mouth (DDSNAP, Aug 2026). Square
      // rims + XOR faces seal these groups the ordinary way. Same
      // shape authority as the carve, so decline == carved, always.
      if ((tl && archSpanAt(dungeon.tiles, dungeon.floorHeights, w, tx, tz, dungeon.pillarWall))
        || (tr && archSpanAt(dungeon.tiles, dungeon.floorHeights, w, tx + 1, tz, dungeon.pillarWall))
        || (bl && archSpanAt(dungeon.tiles, dungeon.floorHeights, w, tx, tz + 1, dungeon.pillarWall))
        || (br && archSpanAt(dungeon.tiles, dungeon.floorHeights, w, tx + 1, tz + 1, dungeon.pillarWall))) continue;

      const cx = (tx + 1) * s;
      const cz = (tz + 1) * s;
      const edgeMid: [number, number][] = [
        [cx, cz - s * 0.5],
        [cx + s * 0.5, cz],
        [cx, cz + s * 0.5],
        [cx - s * 0.5, cz],
      ];
      if (cut) {
        const ftx = tx + (cut.floorTile % 2);
        const ftz = tz + (cut.floorTile >= 2 ? 1 : 0);
        const p0 = edgeMid[cut.seg[0]]!;
        const p1 = edgeMid[cut.seg[1]]!;
        const seg: ContourSegment = { x0: p0[0], z0: p0[1], x1: p1[0], z1: p1[1], gx: tx, gz: tz };
        segments.push(seg);
        register(tx, tz, seg);
        register(tx + 1, tz, seg);
        register(tx, tz + 1, seg);
        register(tx + 1, tz + 1, seg);
        // The floor tile's corner AT the group center is cut. Corner
        // index in the 0=NW 1=NE 2=SW 3=SE convention: the group center
        // is the floor tile's opposite corner to its group position.
        const cornerIdx = cut.floorTile === 0 ? 3 // TL tile: SE corner
          : cut.floorTile === 1 ? 2 // TR tile: SW corner
            : cut.floorTile === 2 ? 1 // BL tile: NE corner
              : 0; // BR tile: NW corner
        cutTileCorners.add((ftz * w + ftx) * 4 + cornerIdx);
        cutGroups.add(tz * w + tx);
      } else if (fill) {
        const ptx = tx + (fill.pitTile % 2);
        const ptz = tz + (fill.pitTile >= 2 ? 1 : 0);
        const p0 = edgeMid[fill.seg[0]]!;
        const p1 = edgeMid[fill.seg[1]]!;
        const seg: ContourSegment = { x0: p0[0], z0: p0[1], x1: p1[0], z1: p1[1], gx: tx, gz: tz };
        fillSegments.push(seg);
        const key = ptz * w + ptx;
        let list = fillByTile.get(key);
        if (!list) {
          list = [];
          fillByTile.set(key, list);
        }
        list.push(seg);
      }
    }
  }

  return { segments, fillSegments, byTile, fillByTile, cutTileCorners, cutGroups };
}

/** Height of the fill patch over a PIT tile at (x,z), or null when the
 *  point is not on the floor side of any of the tile's fill segments.
 *  The patch is the triangle (p0, p1, groupCorner); its plane is
 *  interpolated from the three heights the caller samples — the same
 *  three the renderer uses, so drawn = stood-on. */
export function pitFillGround(
  contour: PitContour,
  w: number,
  tx: number,
  tz: number,
  x: number,
  z: number,
  heightAt: (px: number, pz: number) => number,
): number | null {
  const segs = contour.fillByTile.get(tz * w + tx);
  if (!segs) return null;
  for (const seg of segs) {
    // Floor side = the side of the GROUP CENTER... the group corner
    // point (shared by the three floor tiles) is ON the patch, so use
    // the pit tile's center: the pit side contains it; floor side is
    // the opposite sign.
    const ccx = (tx + 0.5) * TILE_SIZE;
    const ccz = (tz + 0.5) * TILE_SIZE;
    const dx = seg.x1 - seg.x0;
    const dz = seg.z1 - seg.z0;
    const sideP = dx * (z - seg.z0) - dz * (x - seg.x0);
    const sideC = dx * (ccz - seg.z0) - dz * (ccx - seg.x0);
    if (sideP === 0 || Math.sign(sideP) === Math.sign(sideC)) continue;
    // Group corner: shared corner of the 2x2 group
    const gx = (seg.gx + 1) * TILE_SIZE;
    const gz = (seg.gz + 1) * TILE_SIZE;
    const h0 = heightAt(seg.x0, seg.z0);
    const h1 = heightAt(seg.x1, seg.z1);
    const hg = heightAt(gx, gz);
    // Barycentric interpolation over triangle (p0, p1, g)
    const v0x = seg.x1 - seg.x0;
    const v0z = seg.z1 - seg.z0;
    const v1x = gx - seg.x0;
    const v1z = gz - seg.z0;
    const v2x = x - seg.x0;
    const v2z = z - seg.z0;
    const den = v0x * v1z - v1x * v0z;
    if (Math.abs(den) < 1e-9) continue;
    const b1 = (v2x * v1z - v1x * v2z) / den;
    const b2 = (v0x * v2z - v2x * v0z) / den;
    return h0 + b1 * (h1 - h0) + b2 * (hg - h0);
  }
  return null;
}

/** Is (x,z) on the PIT side of any rim segment registered to its tile?
 *  Floor side contains the tile center by construction, so the sign of
 *  the cross product against the center settles orientation. */
export function inPitCut(
  contour: PitContour,
  w: number,
  tx: number,
  tz: number,
  x: number,
  z: number,
): boolean {
  const segs = contour.byTile.get(tz * w + tx);
  if (!segs) return false;
  const ccx = (tx + 0.5) * TILE_SIZE;
  const ccz = (tz + 0.5) * TILE_SIZE;
  for (const seg of segs) {
    const dx = seg.x1 - seg.x0;
    const dz = seg.z1 - seg.z0;
    const sideP = dx * (z - seg.z0) - dz * (x - seg.x0);
    const sideC = dx * (ccz - seg.z0) - dz * (ccx - seg.x0);
    // Opposite side from the tile center = the cut wedge. For points
    // INSIDE this tile the sign test is exact: the segment line only
    // crosses the tile through the cut quarter, so the opposite-side
    // region within the tile IS the wedge.
    if (sideP !== 0 && sideC !== 0 && Math.sign(sideP) !== Math.sign(sideC)) return true;
  }
  return false;
}
