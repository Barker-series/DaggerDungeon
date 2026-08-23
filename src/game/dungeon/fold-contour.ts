/**
 * FOLD CONTOUR — the pit-rim treatment (pitcontour.ts) applied to fold
 * mass, stacked vertically: per 2x2 tile group, per HEIGHT BAND of
 * constant solidity, full marching squares over solid/air — convex mass
 * corners are CUT (the solid tile's corner wedge becomes air behind a
 * 45° diagonal), concave notches are FILLED (the air tile's near quarter
 * becomes solid behind a 45° diagonal). Cut AND fill, or a diagonal edge
 * keeps half its sawtooth (pitcontour's rule). Straight runs already lie
 * on tile boundaries (the XOR faces draw them); saddles decline.
 *
 * ONE AUTHORITY for both consumers — the wall you see is the wall you
 * hit:
 *   renderer: one diagonal quad per segment over its band; the square
 *             half-faces a cut replaces are suppressed; fold tops and
 *             undersides are clipped at cut corners; wedge caps close
 *             every band edge that exposes horizontal area.
 *   engine:   collision against the diagonals; cut wedges are air (no
 *             box, no ground); fill wedges are solid (segment collision,
 *             ground on an exposed fill top).
 *
 * Solidity comes from the COLUMN DATA (what is actually world) and a
 * band only emits when every solid tile in the group is fold-MADE there
 * (foldTileIntervals of a preset with `smooth`) — terrain, rock, pillar
 * and wall solids are never touched, the same way pit rims decline on
 * arches and occupied pits. Effect distance: one tile (2x2 groups).
 * Corner indices: 0=NW 1=NE 2=SW 3=SE (the roads/pit convention).
 */

import { TILE_SIZE, type WorldData } from '../types';
import { PIT_LEVEL } from './heightfield';
import { PILLAR_CELL_TILES } from './pillar-layer';
import { FOLD_PRESETS, foldTileIntervals } from './fold-structure';

export interface FoldSeg {
  x0: number; z0: number; x1: number; z1: number;
  /** Unit normal toward the AIR side of the diagonal */
  nx: number; nz: number;
  yLo: number; yHi: number;
  /** 'cut': wedge tile is the solid; 'fill': wedge tile is the air tile */
  kind: 'cut' | 'fill';
  /** The wedge tile (flat index) and its corner at the group centre */
  tile: number;
  corner: number;
  preset: number;
  /** The band bottom is a TERRAIN floor (an owner-0 span floor of the
   *  group's air): the diagonal's bottom edge follows the corner-blended
   *  ground (bilinear-exact at edge midpoints), like the XOR faces do */
  terrain: boolean;
}
export interface FoldWedgeBand {
  yLo: number;
  yHi: number;
  /** Bitmask of wedge corners (bit c set = corner c) */
  corners: number;
  /** Corner bits whose band bottom rests on terrain (see FoldSeg) */
  terrain: number;
  /** Corner bits (CUT bands) whose bottom is an exposed cap — standable
   *  ground inside the wedge (set by the caps pass) */
  ground: number;
}
/** Horizontal triangle closing a wedge's exposed top/bottom */
export interface FoldWedgeCap {
  pts: [number, number][];
  y: number;
  up: boolean;
  preset: number;
  /** Vertex heights come from the terrain corner field, not y */
  terrain: boolean;
}
export interface FoldContour {
  w: number;
  /** Per SOLID tile: bands whose corner wedges are CUT (air) */
  cuts: Map<number, FoldWedgeBand[]>;
  /** Per AIR tile: bands whose corner wedges are FILLED (solid) */
  fills: Map<number, FoldWedgeBand[]>;
  /** Segments registered to every tile of their group (3x3 queries) */
  segsByTile: Map<number, FoldSeg[]>;
  segs: FoldSeg[];
  caps: FoldWedgeCap[];
}

/** Is (x,z) inside the corner-c wedge of tile (tx,tz) — the triangle
 *  between the corner and its two edge midpoints? */
export function inFoldWedge(tx: number, tz: number, corner: number, x: number, z: number): boolean {
  const lx = x - tx * TILE_SIZE;
  const lz = z - tz * TILE_SIZE;
  const h = TILE_SIZE / 2;
  switch (corner) {
    case 0: return lx + lz < h;
    case 1: return (TILE_SIZE - lx) + lz < h;
    case 2: return lx + (TILE_SIZE - lz) < h;
    default: return (TILE_SIZE - lx) + (TILE_SIZE - lz) < h;
  }
}

/** Wedge corner bitmask of the tile's bands covering height y */
export function foldWedgesAt(bands: Map<number, FoldWedgeBand[]>, tile: number, y: number): number {
  const list = bands.get(tile);
  if (!list) return 0;
  let m = 0;
  for (const b of list) if (y > b.yLo - 1e-9 && y < b.yHi + 1e-9) m |= b.corners;
  return m;
}

/** The wedge triangle of corner c of tile (tx,tz): corner, then the two
 *  edge midpoints (the diagonal's endpoints) */
export function wedgeTriangle(tx: number, tz: number, c: number): [number, number][] {
  const s = TILE_SIZE, x0 = tx * s, z0 = tz * s, hh = s / 2;
  switch (c) {
    case 0: return [[x0, z0], [x0 + hh, z0], [x0, z0 + hh]];
    case 1: return [[x0 + s, z0], [x0 + s, z0 + hh], [x0 + s - hh, z0]];
    case 2: return [[x0, z0 + s], [x0, z0 + s - hh], [x0 + hh, z0 + s]];
    default: return [[x0 + s, z0 + s], [x0 + s - hh, z0 + s], [x0 + s, z0 + s - hh]];
  }
}

/** Terrain sample guard: PIT sentinel corners (-901) bilinear into
 *  plausible-looking garbage (the documented sentinel-contamination
 *  trap) — a sample that is not real ground falls back to the band
 *  bottom, exactly as the XOR faces' refine does */
export function terrainOr(h: number, fallback: number): number {
  return Number.isFinite(h) && h > PIT_LEVEL ? h : fallback;
}

/** Corner-field sample for contour points (tile corners and edge
 *  midpoints only): bilinear over the corners that carry weight, NaN if
 *  any of them is a pit sentinel — never blend a sentinel */
export function contourTerrain(corners: number[][], baseY: number, px: number, pz: number): number {
  const fx = px / TILE_SIZE;
  const fz = pz / TILE_SIZE;
  const x0 = Math.floor(fx + 1e-6);
  const z0 = Math.floor(fz + 1e-6);
  const u = fx - x0;
  const v = fz - z0;
  const xs = u > 1e-6 ? [x0, x0 + 1] : [x0];
  const zs = v > 1e-6 ? [z0, z0 + 1] : [z0];
  let sum = 0;
  for (const cz of zs) {
    for (const cx of xs) {
      const h = corners[cz]?.[cx];
      if (h === undefined || !(h > PIT_LEVEL)) return NaN;
      const wgt = (xs.length === 1 ? 1 : (cx === x0 ? 1 - u : u)) * (zs.length === 1 ? 1 : (cz === z0 ? 1 - v : v));
      sum += h * wgt;
    }
  }
  return baseY + sum;
}

/** Height on the wedge triangle's plane at (x,z), heights sampled by
 *  heightAt at the three wedge points — the plane the renderer draws */
export function wedgePlaneHeight(
  tx: number, tz: number, c: number, x: number, z: number,
  heightAt: (px: number, pz: number) => number,
  fallback: number,
): number {
  const [p0, p1, p2] = wedgeTriangle(tx, tz, c);
  const h0 = terrainOr(heightAt(p0![0], p0![1]), fallback);
  const h1 = terrainOr(heightAt(p1![0], p1![1]), fallback);
  const h2 = terrainOr(heightAt(p2![0], p2![1]), fallback);
  const v0x = p1![0] - p0![0], v0z = p1![1] - p0![1];
  const v1x = p2![0] - p0![0], v1z = p2![1] - p0![1];
  const v2x = x - p0![0], v2z = z - p0![1];
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 1e-9) return h0;
  const b1 = (v2x * v1z - v1x * v2z) / den;
  const b2 = (v0x * v2z - v2x * v0z) / den;
  return h0 + b1 * (h1 - h0) + b2 * (h2 - h0);
}

export function buildFoldContour(world: WorldData): FoldContour {
  const L = world.levels[0]!;
  const w = L.width;
  const h = L.height;
  const stackSeed = world.seed + world.stack * 100000;
  const absTx0 = world.originPcx * PILLAR_CELL_TILES;
  const absTz0 = world.originPcz * PILLAR_CELL_TILES;
  const out: FoldContour = { w, cuts: new Map(), fills: new Map(), segsByTile: new Map(), segs: [], caps: [] };

  // Fold-made intervals per tile (smooth presets only), memoized
  const memo = new Map<string, boolean>();
  const ivCache = new Map<number, { bands: [number, number][]; preset: number } | null>();
  const foldIvs = (tx: number, tz: number): { bands: [number, number][]; preset: number } | null => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return null;
    const k = tz * w + tx;
    let v = ivCache.get(k);
    if (v === undefined) {
      const t = foldTileIntervals(L.tiles, L.floorHeights, L.cellBiomes, w, stackSeed, absTx0, absTz0, tx, tz, L.pillarGround, L.pillarWall, memo);
      v = t && FOLD_PRESETS[t.preset]!.smooth ? { bands: t.bands, preset: t.preset } : null;
      ivCache.set(k, v);
    }
    return v;
  };
  const foldMadeAt = (iv: { bands: [number, number][] } | null, y: number): boolean =>
    !!iv && iv.bands.some(([a, b]) => y > a + 1e-9 && y < b - 1e-9);
  /** Column-data solidity: no air span covers y (off-map = solid) */
  const colSolidAt = (tx: number, tz: number, y: number): boolean => {
    if (tx < 0 || tz < 0 || tx >= w || tz >= h) return true;
    const col = world.columns[tz * w + tx]!;
    return !col.some((sp) => sp.floor <= y && sp.ceil >= y);
  };

  const s = TILE_SIZE;
  const addBand = (m: Map<number, FoldWedgeBand[]>, tile: number, yLo: number, yHi: number, corner: number, terrain: boolean): void => {
    let list = m.get(tile);
    if (!list) { list = []; m.set(tile, list); }
    const same = list.find((b) => Math.abs(b.yLo - yLo) < 1e-9 && Math.abs(b.yHi - yHi) < 1e-9);
    if (same) { same.corners |= 1 << corner; if (terrain) same.terrain |= 1 << corner; }
    else list.push({ yLo, yHi, corners: 1 << corner, terrain: terrain ? 1 << corner : 0, ground: 0 });
  };
  /** Does (tx,tz) carry a TERRAIN (owner 0) span floor at y? */
  const terrainFloorAt = (tx: number, tz: number, y: number): boolean =>
    world.columns[tz * w + tx]!.some((sp) => sp.owner === 0 && Math.abs(sp.floor - y) < 0.02);
  const register = (tile: number, seg: FoldSeg): void => {
    let sl = out.segsByTile.get(tile);
    if (!sl) { sl = []; out.segsByTile.set(tile, sl); }
    sl.push(seg);
  };

  // Group tiles: 0=TL (gx,gz) 1=TR 2=BL 3=BR. The group-centre corner of
  // each: TL→SE(3) TR→SW(2) BL→NE(1) BR→NW(0). Diagonal endpoints are
  // the two edge midpoints flanking that corner (em: 0 top, 1 right,
  // 2 bottom, 3 left of the group centre).
  const CENTRE_CORNER = [3, 2, 1, 0];
  const DIAG: [number, number][] = [[3, 0], [0, 1], [2, 3], [1, 2]];
  for (let gz = 0; gz + 1 < h; gz++) {
    for (let gx = 0; gx + 1 < w; gx++) {
      const ivs = [foldIvs(gx, gz), foldIvs(gx + 1, gz), foldIvs(gx, gz + 1), foldIvs(gx + 1, gz + 1)];
      if (!ivs[0] && !ivs[1] && !ivs[2] && !ivs[3]) continue;
      const txs = [gx, gx + 1, gx, gx + 1];
      const tzs = [gz, gz, gz + 1, gz + 1];
      // Band breaks: fold interval ends + every span boundary of the four
      // columns inside the fold range (solidity can change at any of them)
      let fLo = Infinity, fHi = -Infinity;
      const ys = new Set<number>();
      for (const iv of ivs) if (iv) for (const [a, b] of iv.bands) { ys.add(a); ys.add(b); fLo = Math.min(fLo, a); fHi = Math.max(fHi, b); }
      for (let i = 0; i < 4; i++) {
        for (const sp of world.columns[tzs[i]! * w + txs[i]!]!) {
          if (sp.floor > fLo && sp.floor < fHi) ys.add(sp.floor);
          if (sp.ceil > fLo && sp.ceil < fHi) ys.add(sp.ceil);
        }
      }
      const breaks = [...ys].sort((p, q) => p - q);
      const cx = (gx + 1) * s;
      const cz = (gz + 1) * s;
      const em: [number, number][] = [[cx, cz - s / 2], [cx + s / 2, cz], [cx, cz + s / 2], [cx - s / 2, cz]];
      for (let i = 0; i + 1 < breaks.length; i++) {
        const yLo = breaks[i]!;
        const yHi = breaks[i + 1]!;
        if (yHi - yLo < 1e-6) continue;
        const ym = (yLo + yHi) / 2;
        const solid = [0, 1, 2, 3].map((k) => colSolidAt(txs[k]!, tzs[k]!, ym));
        const n = solid.filter(Boolean).length;
        if (n !== 1 && n !== 3) continue; // straight / empty / full / saddle: square faces are exact
        // every solid here must be FOLD-MADE (smooth preset)
        let ok = true;
        for (let k = 0; k < 4; k++) if (solid[k] && !foldMadeAt(ivs[k] ?? null, ym)) { ok = false; break; }
        if (!ok) continue;
        const kind: 'cut' | 'fill' = n === 1 ? 'cut' : 'fill';
        // wedge tile: the lone solid (cut) or the lone air (fill)
        const k = solid.findIndex((v) => v === (kind === 'cut'));
        const tx = txs[k]!, tz = tzs[k]!;
        const corner = CENTRE_CORNER[k]!;
        const tile = tz * w + tx;
        // preset: cut → the wedge tile's own; fill → any solid neighbour's
        const preset = kind === 'cut' ? ivs[k]!.preset : ivs[solid.findIndex(Boolean)]!.preset;
        const [e0, e1] = DIAG[k]!;
        const p0 = em[e0]!, p1 = em[e1]!;
        // normal toward air: away from the wedge tile centre for cuts,
        // toward it for fills
        let nx = -(p1[1] - p0[1]);
        let nz = p1[0] - p0[0];
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        const tcx = (tx + 0.5) * s, tcz = (tz + 0.5) * s;
        const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
        const towardCentre = (tcx - mx) * nx + (tcz - mz) * nz > 0;
        if (towardCentre === (kind === 'cut')) { nx = -nx; nz = -nz; }
        // Band bottom on terrain: an air tile of the group has its
        // terrain floor exactly here (cut: any of the three; fill: A)
        let terrain = false;
        for (let q = 0; q < 4; q++) if (!solid[q] && terrainFloorAt(txs[q]!, tzs[q]!, yLo)) { terrain = true; break; }
        const seg: FoldSeg = { x0: p0[0], z0: p0[1], x1: p1[0], z1: p1[1], nx, nz, yLo, yHi, kind, tile, corner, preset, terrain };
        out.segs.push(seg);
        for (let q = 0; q < 4; q++) register(tzs[q]! * w + txs[q]!, seg);
        addBand(kind === 'cut' ? out.cuts : out.fills, tile, yLo, yHi, corner, terrain);
      }
    }
  }

  // Wedge caps — every band edge where the wedge's horizontal area is
  // exposed: CUT wedge (air) under/over continuing uncut solid; FILL
  // wedge (solid) under/over air that is not filled.
  const continues = (list: FoldWedgeBand[], b: FoldWedgeBand, c: number, up: boolean): boolean =>
    list.some((o) => o !== b && (o.corners & (1 << c))
      && (up ? (o.yLo <= b.yHi + 1e-9 && o.yHi > b.yHi + 1e-9) : (o.yHi >= b.yLo - 1e-9 && o.yLo < b.yLo - 1e-9)));
  const presetOf = (tx: number, tz: number): number => {
    const iv = foldIvs(tx, tz);
    if (iv) return iv.preset;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = foldIvs(tx + dx, tz + dz);
      if (n) return n.preset;
    }
    return 0;
  };
  for (const [tile, list] of out.cuts) {
    list.sort((a, b) => a.yLo - b.yLo);
    const tx = tile % w, tz = Math.floor(tile / w);
    const preset = presetOf(tx, tz);
    for (const b of list) {
      for (let c = 0; c < 4; c++) {
        if (!(b.corners & (1 << c))) continue;
        if (colSolidAt(tx, tz, b.yHi + 1e-3) && !continues(list, b, c, true)) out.caps.push({ pts: wedgeTriangle(tx, tz, c), y: b.yHi, up: false, preset, terrain: false });
        if (colSolidAt(tx, tz, b.yLo - 1e-3) && !continues(list, b, c, false)) {
          // the wedge floor: standable ground, on terrain where the band
          // bottom is a terrain floor (the cap follows the ground)
          b.ground |= 1 << c;
          out.caps.push({ pts: wedgeTriangle(tx, tz, c), y: b.yLo, up: true, preset, terrain: (b.terrain & (1 << c)) !== 0 });
        }
      }
    }
  }
  for (const [tile, list] of out.fills) {
    list.sort((a, b) => a.yLo - b.yLo);
    const tx = tile % w, tz = Math.floor(tile / w);
    const preset = presetOf(tx, tz);
    for (const b of list) {
      for (let c = 0; c < 4; c++) {
        if (!(b.corners & (1 << c))) continue;
        if (!colSolidAt(tx, tz, b.yHi + 1e-3) && !continues(list, b, c, true)) out.caps.push({ pts: wedgeTriangle(tx, tz, c), y: b.yHi, up: true, preset, terrain: false });
        if (!colSolidAt(tx, tz, b.yLo - 1e-3) && !continues(list, b, c, false)) out.caps.push({ pts: wedgeTriangle(tx, tz, c), y: b.yLo, up: false, preset, terrain: false });
      }
    }
  }
  return out;
}

/** Ground from a FILL wedge top at (x,z): the highest exposed fill top
 *  at or below limitY (+0.6 step), or null */
export function foldFillGround(fc: FoldContour, tx: number, tz: number, x: number, z: number, limitY: number): number | null {
  const list = fc.fills.get(tz * fc.w + tx);
  if (!list) return null;
  let best: number | null = null;
  for (const b of list) {
    if (b.yHi > limitY + 0.6) continue;
    for (let c = 0; c < 4; c++) {
      if (!(b.corners & (1 << c)) || !inFoldWedge(tx, tz, c, x, z)) continue;
      // exposed: no fill band continues above at this corner
      const cont = list.some((o) => o !== b && (o.corners & (1 << c)) && o.yLo <= b.yHi + 1e-9 && o.yHi > b.yHi + 1e-9);
      if (!cont && (best === null || b.yHi > best)) best = b.yHi;
    }
  }
  return best;
}

/** Ground inside a CUT wedge at (x,z): the wedge floor cap (terrain
 *  plane where the band rests on terrain, else flat yLo), highest at or
 *  below limitY (+0.6 step), or null */
export function foldCutGround(
  fc: FoldContour, tx: number, tz: number, x: number, z: number, limitY: number,
  heightAt: (px: number, pz: number) => number,
): number | null {
  const list = fc.cuts.get(tz * fc.w + tx);
  if (!list) return null;
  let best: number | null = null;
  for (const b of list) {
    if (b.ground === 0 || b.yLo > limitY + 1.0) continue;
    for (let c = 0; c < 4; c++) {
      if (!(b.ground & (1 << c)) || !inFoldWedge(tx, tz, c, x, z)) continue;
      const g = (b.terrain & (1 << c)) ? wedgePlaneHeight(tx, tz, c, x, z, heightAt, b.yLo) : b.yLo;
      if (g <= limitY + 0.6 && (best === null || g > best)) best = g;
    }
  }
  return best;
}
