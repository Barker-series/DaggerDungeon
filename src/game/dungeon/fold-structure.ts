/**
 * FOLD STRUCTURES — kaleidoscopic-fold megastructure mass for canyon
 * districts, columnized into the column model so it is fully PLAYABLE:
 * every fold terrace is a floor, every face collides, the bot routes
 * around it — because once it's in the columns, it's world.
 *
 * The technique (public fractal-community knowledge — kaleidoscopic
 * IFS folding; see docs/PLAN.md "Fold-generated biome areas" for the
 * reference series and the license note; this is a from-scratch
 * implementation with our own constants):
 *   solid(p) = p.y below a cap plane AND every octave's mirror-folded
 *   coordinate lands inside its slab. Each octave rotates about Y,
 *   tiles space, mirror-folds, and shrinks — one rule at shrinking
 *   scales gives Big/Medium/Small for free.
 *
 * PLAYABILITY CONTRACT (permanent navigation is sacred):
 * - The fold OWNS the volume in its districts: mass stands on the
 *   ground, and its carved air IS the playable space — every fold room,
 *   slot, court, and terrace is a floor/face in the column model, so it
 *   is walkable, collidable, and bot-routable with no extra machinery.
 *   No clearance band, no floater filters: a structure that stands on
 *   the ground is a building, and "the ground is blocked here" is just
 *   a wall, like every other wall in the world.
 * - The ONE guard: permanent transit tiles keep a walk-clearance bore
 *   through fold mass (the same "guarantee clearance, carve through
 *   solid" rule bridges use), so the sacred network and spawn survive
 *   by construction. Pillar footprints (Wall) and married pillar ground
 *   (plazas) are exempt from fold mass.
 * - Interior tiles (rooms, corridors, tunnels) are skipped entirely.
 *
 * Infinite-world discipline: solidity is a pure function of
 * (stackSeed, absolute world position) — pointwise, zero neighbor
 * radius. Both generation paths call the same entry with absolute tile
 * offsets, so chunked and legacy windows agree bit-for-bit.
 */

import { TileType, TILE_SIZE, type ColumnSpan } from '../types';
import { PIT_LEVEL } from './heightfield';
import { tileBiome, type BiomeType } from './cells';
import { regionAtCell } from './region-layer';
import { cellSeed, mulberry32 } from './rng';

/** Cell size in tiles (mirrors CELL_TILE_SIZE without an import cycle) */
const CELL = 14;

// ── FAITHFUL PORT of the reference preset ("Megastructure Path Trace
// 5", RedKef — settings ported as the STARTING POINT per the license
// doctrine in docs/PLAN.md; the code is ours, the recipe is theirs
// until we evolve it). Their values: base 500, decay 0.75, offset 0.5,
// rotation TAU/24 about vertical, flips x&z on k&2 / y on k&8, flat
// cap plane, 24 octaves (our grid's Nyquist floors it at ~17). ──
/** Flat cap plane (their ground plane, placed at our band top) */
export const FOLD_TOP = 60;
/** Pit columns grow fold mass from this depth — tower roots in the void */
const FOLD_DEEP = -60;
/** Walk clearance bored through fold mass on permanent transit tiles */
const TRANSIT_CLEAR = 3.5;
/** Base octave scale in world units, and per-octave shrink */
const FOLD_BASE = 500;
const FOLD_DECAY = 0.75;
/** Fold offset as a fraction of the octave scale */
const FOLD_OFFSET = 0.5;
/** Rotation about the vertical axis per octave (radians) */
const FOLD_ROT = Math.PI / 12;
/** Octave floor: features below ~a tile come from texture, not geometry
 *  (the human-scale vocabulary never scales) — the ONE cut we make in
 *  their 24-octave stack (grid Nyquist) */
const FOLD_MIN_SCALE = 4;
const FOLD_MAX_OCTAVES = 24;
/** Air gaps thinner than this merge into solid (uninhabitable) */
const MIN_AIR = 1.5;
/** Solid slabs thinner than this are dropped (no paper shelves) */
const MIN_SOLID = 1.0;
/** Column scan resolution — matches the world height quantum */
/** FINER than the world's usual 0.5: spans are floats, so fold columns
 *  can quantize at 0.25 locally — halves every terrace/tread step in
 *  the DATA (physics-exact, seal-exact) without touching the grid.
 *  The 3wu horizontal tile stays the Nyquist floor for feature SIZE;
 *  this only sharpens vertical placement. */
const STEP = 0.25;
/** ARCHITECTURAL MODULE (0 = off): snap every fold slab's top and bottom
 *  to multiples of this height, and require slabs/gaps of at least one
 *  module. Per-column sampling of a continuous surface otherwise leaves
 *  sub-story jitter between neighbors that reads as noise; snapped, the
 *  same mass reads as stories and setbacks. */
const FOLD_MODULE = 0;

const FOLD_SALT = 9797;

/** Per-world domain offset so every seed gets a different fold city */
export function foldOrigin(stackSeed: number): [number, number] {
  const rng = mulberry32(cellSeed(11, 17, stackSeed, FOLD_SALT));
  return [rng() * 4096, rng() * 4096];
}

const COS_R = Math.cos(FOLD_ROT);
const SIN_R = Math.sin(FOLD_ROT);

/**
 * Signed "air distance" of the fold field at a world point (positive =
 * air, <= 0 = solid), a conservative distance bound usable for skip
 * stepping. Pure function of (offset domain, position).
 */
export function foldFieldAt(ox: number, oz: number, wx: number, wy: number, wz: number): number {
  let qx = wx + ox;
  let qy = wy;
  let qz = wz + oz;
  // Air above the flat cap plane; the folds carve air below it
  let d = wy - FOLD_TOP;
  let scale = FOLD_BASE;
  for (let k = 0; k < FOLD_MAX_OCTAVES; k++) {
    // Rotate about Y, tile, mirror-fold toward the octave slab
    const rx = qx * COS_R - qz * SIN_R;
    const rz = qx * SIN_R + qz * COS_R;
    const two = scale * 2;
    const cx = ((rx % two) + two) % two - scale;
    const cy = ((qy % two) + two) % two - scale;
    const cz = ((rz % two) + two) % two - scale;
    qx = scale * FOLD_OFFSET - Math.abs(cx);
    qy = scale * FOLD_OFFSET - Math.abs(cy);
    qz = scale * FOLD_OFFSET - Math.abs(cz);
    // Reference flip pattern: x and z on k&2, y on k&8, no swaps
    if ((k & 2) !== 0) { qx = -qx; qz = -qz; }
    if ((k & 8) !== 0) qy = -qy;
    d = Math.max(d, Math.min(qx, Math.min(qy, qz)));
    scale *= FOLD_DECAY;
    if (scale < FOLD_MIN_SCALE) break;
  }
  return d;
}

// ── FAST SEPARABLE EVALUATION ── Rotation mixes only x/z; each axis
// folds independently; the flips are per-axis. So the per-octave
// min(qx,qy,qz) splits into a per-COLUMN term min(qx_k,qz_k) and a
// per-HEIGHT term qy_k, and d(y) = max(y-TOP, max_k min(mxz_k, qy_k)).
// Bit-identical to foldFieldAt (same ops, same order per axis; SHA-
// verified over a whole world), ~10× cheaper per sample: no trig/mod
// in the inner loop.
const OCTAVES_USED = (() => {
  let n = 0;
  let scale = FOLD_BASE;
  while (n < FOLD_MAX_OCTAVES) {
    n++;
    scale *= FOLD_DECAY;
    if (scale < FOLD_MIN_SCALE) break;
  }
  return n;
})();
/** Per-column x/z terms: min(qx_k, qz_k) for each octave */
function foldColumnXZ(ox: number, oz: number, wx: number, wz: number): Float64Array {
  const out = new Float64Array(OCTAVES_USED);
  let qx = wx + ox;
  let qz = wz + oz;
  let scale = FOLD_BASE;
  for (let k = 0; k < OCTAVES_USED; k++) {
    const rx = qx * COS_R - qz * SIN_R;
    const rz = qx * SIN_R + qz * COS_R;
    const two = scale * 2;
    const cx = ((rx % two) + two) % two - scale;
    const cz = ((rz % two) + two) % two - scale;
    qx = scale * FOLD_OFFSET - Math.abs(cx);
    qz = scale * FOLD_OFFSET - Math.abs(cz);
    if ((k & 2) !== 0) { qx = -qx; qz = -qz; }
    out[k] = Math.min(qx, qz);
    scale *= FOLD_DECAY;
  }
  return out;
}
/** Per-height y terms: qy_k for each octave */
function foldHeightY(wy: number): Float64Array {
  const out = new Float64Array(OCTAVES_USED);
  let qy = wy;
  let scale = FOLD_BASE;
  for (let k = 0; k < OCTAVES_USED; k++) {
    const two = scale * 2;
    const cy = ((qy % two) + two) % two - scale;
    qy = scale * FOLD_OFFSET - Math.abs(cy);
    if ((k & 8) !== 0) qy = -qy;
    out[k] = qy;
    scale *= FOLD_DECAY;
  }
  return out;
}
/** Y-term table over the fold band at STEP resolution (built once;
 *  every scanned y lands on this lattice) */
const Y_ROWS = Math.round((FOLD_TOP - FOLD_DEEP) / STEP) + 1;
let yTable: Float64Array[] | null = null;
function yTerms(wy: number): Float64Array {
  if (!yTable) {
    yTable = new Array<Float64Array>(Y_ROWS);
    for (let i = 0; i < Y_ROWS; i++) yTable[i] = foldHeightY(FOLD_DEEP + i * STEP);
  }
  const i = Math.round((wy - FOLD_DEEP) / STEP);
  if (i >= 0 && i < Y_ROWS && Math.abs(FOLD_DEEP + i * STEP - wy) < 1e-9) return yTable[i]!;
  return foldHeightY(wy);
}
/** d(y) for a precomputed column — identical to foldFieldAt */
function foldFastAt(mxz: Float64Array, wy: number): number {
  const qy = yTerms(wy);
  let d = wy - FOLD_TOP;
  for (let k = 0; k < OCTAVES_USED; k++) {
    const m = mxz[k]! < qy[k]! ? mxz[k]! : qy[k]!;
    if (m > d) d = m;
  }
  return d;
}

/** Solid Y-intervals of the fold field along one column, clipped to
 *  [yLo, yHi], quantized to STEP. The field is a Lipschitz-1 distance
 *  bound on BOTH sides of the surface, so |d| bounds the distance to
 *  the next boundary in air AND in solid: sphere-trace through both
 *  (boundaries still land at STEP resolution as |d| shrinks below
 *  STEP — bit-identical to a 0.25 crawl, just faster). */
function foldIntervals(ox: number, oz: number, wx: number, wz: number, yLo: number, yHi: number): [number, number][] {
  const out: [number, number][] = [];
  const mxz = foldColumnXZ(ox, oz, wx, wz);
  let y = yHi;
  let solidTop: number | null = null;
  while (y >= yLo) {
    const d = foldFastAt(mxz, y);
    if (d <= 0) {
      if (solidTop === null) solidTop = y;
      y -= Math.max(STEP, Math.floor(-d / STEP) * STEP);
    } else {
      if (solidTop !== null) {
        if (solidTop - (y + STEP) + STEP >= MIN_SOLID) out.push([y + STEP, solidTop]);
        solidTop = null;
      }
      y -= Math.max(STEP, Math.floor(d / STEP) * STEP);
    }
  }
  if (solidTop !== null && solidTop - yLo >= MIN_SOLID) out.push([yLo, solidTop]);
  return out;
}

/** Insert one solid band into a column: air spans split around it,
 *  crushed air slivers merge into the solid (uninhabitable). */
function addSolid(spans: ColumnSpan[], lo: number, hi: number): ColumnSpan[] {
  const out: ColumnSpan[] = [];
  for (const s of spans) {
    if (hi <= s.floor || lo >= s.ceil) {
      out.push(s);
      continue;
    }
    if (lo - s.floor >= MIN_AIR) out.push({ floor: s.floor, ceil: lo, owner: s.owner, ceilOwner: -1 });
    if (s.ceil - hi >= MIN_AIR) out.push({ floor: hi, ceil: s.ceil, owner: -1, ceilOwner: s.ceilOwner });
  }
  return out;
}

/** The band a tile's column may carry fold mass in ([yLo, FOLD_TOP]),
 *  or null where the fold is gated off. Mass starts AT the ground on
 *  walkable open-sky tiles and at FOLD_DEEP in pits. */
export function foldColumnBand(
  tiles: TileType[][],
  floorHeights: number[][],
  cellBiomes: (BiomeType | null)[][],
  pillarGround: boolean[][] | undefined,
  stackSeed: number,
  absTx0: number,
  absTz0: number,
  tx: number,
  tz: number,
): number | null {
  if (tiles[tz]![tx] === TileType.Wall) return null;
  if (pillarGround?.[tz]?.[tx]) return null;
  const absTx = absTx0 + tx;
  const absTz = absTz0 + tz;
  // District gate: canyon districts only (absolute dungeon cells)
  if (regionAtCell(stackSeed, Math.floor(absTx / CELL), Math.floor(absTz / CELL)) !== 'canyon') return null;
  const f = floorHeights[tz]![tx]!;
  const isPit = f <= PIT_LEVEL;
  // Interior rooms/corridors are untouchable; fold lives in pits and
  // open-sky terrain
  if (!isPit && tileBiome(cellBiomes, tx, tz) !== 'outside') return null;
  const yLo = isPit ? FOLD_DEEP : f;
  return yLo >= FOLD_TOP ? null : yLo;
}

/** Bore an air band [lo, hi] through whatever solid occupies it; air
 *  spans it touches merge into it (their owners survive at the ends). */
function boreAir(spans: ColumnSpan[], lo: number, hi: number, floorOwner: number): ColumnSpan[] {
  const out: ColumnSpan[] = [];
  let bLo = lo;
  let bHi = hi;
  let bOwner = floorOwner;
  let bCeilOwner = -1;
  for (const s of spans) {
    if (s.ceil < lo - 1e-9 || s.floor > hi + 1e-9) {
      out.push(s);
      continue;
    }
    if (s.floor < bLo) { bLo = s.floor; bOwner = s.owner; }
    if (s.ceil > bHi) { bHi = s.ceil; bCeilOwner = s.ceilOwner; }
  }
  out.push({ floor: bLo, ceil: bHi, owner: bOwner, ceilOwner: bCeilOwner });
  out.sort((a, b) => a.floor - b.floor);
  return out;
}

/**
 * Grow fold structures into a window's columns. Both generation paths
 * call this with the window's ABSOLUTE tile origin; everything inside
 * is a pure function of (stackSeed, absolute position).
 */
export function applyFoldStructures(
  columns: ColumnSpan[][],
  tiles: TileType[][],
  floorHeights: number[][],
  cellBiomes: (BiomeType | null)[][],
  gridTiles: number,
  stackSeed: number,
  /** Window origin in ABSOLUTE tiles */
  absTx0: number,
  absTz0: number,
  /** Optional tile sub-rectangle to process [x0,x1)×[z0,z1) — the
   *  fold is pointwise (zero effect distance), so a chunk only needs
   *  its CORE evaluated, never its padding */
  bounds?: { x0: number; z0: number; x1: number; z1: number },
  /** Married pillar ground (plazas) — exempt from fold mass */
  pillarGround?: boolean[][],
  /** Permanent transit tiles, window-frame "tx,tz" keys — these keep a
   *  walk-clearance bore through fold mass */
  transit?: ReadonlySet<string>,
): void {
  const [ox, oz] = foldOrigin(stackSeed);
  const bx0 = bounds?.x0 ?? 0;
  const bz0 = bounds?.z0 ?? 0;
  const bx1 = bounds?.x1 ?? gridTiles;
  const bz1 = bounds?.z1 ?? gridTiles;
  for (let tz = bz0; tz < bz1; tz++) {
    for (let tx = bx0; tx < bx1; tx++) {
      const yLo = foldColumnBand(tiles, floorHeights, cellBiomes, pillarGround, stackSeed, absTx0, absTz0, tx, tz);
      if (yLo === null) continue;
      // Column center in world units, ABSOLUTE frame
      const wx = (absTx0 + tx + 0.5) * TILE_SIZE;
      const wz = (absTz0 + tz + 0.5) * TILE_SIZE;
      let bands = foldIntervals(ox, oz, wx, wz, yLo, FOLD_TOP);
      if (FOLD_MODULE > 0) {
        const snapped: [number, number][] = [];
        for (const [lo, hi] of bands) {
          const slo = Math.max(yLo, Math.round(lo / FOLD_MODULE) * FOLD_MODULE);
          const shi = Math.min(FOLD_TOP, Math.round(hi / FOLD_MODULE) * FOLD_MODULE);
          if (shi - slo < FOLD_MODULE - 1e-6) continue;
          const prev = snapped[snapped.length - 1];
          // Gaps thinner than a module merge into solid
          if (prev && slo - prev[1] < FOLD_MODULE - 1e-6) prev[1] = shi;
          else snapped.push([slo, shi]);
        }
        bands = snapped;
      }
      if (bands.length === 0) continue;
      let col = columns[tz * gridTiles + tx]!;
      for (const [lo, hi] of bands) col = addSolid(col, lo, hi);
      // THE guard: the permanent network keeps its walk clearance
      const f = floorHeights[tz]![tx]!;
      if (transit?.has(`${tx},${tz}`) && f > PIT_LEVEL) {
        col = boreAir(col, f, f + TRANSIT_CLEAR, 0);
      }
      columns[tz * gridTiles + tx] = col;
    }
  }
}
