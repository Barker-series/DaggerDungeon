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
import { regionCellAt, regionType, foldDistrictPreset, type RegionType } from './region-layer';
import { cellSeed, mulberry32 } from './rng';
import { sampleNoise } from './noise';
import { siloIntervalsAt, siloFootprintTiles, siloMaxTop, SILO_BASE_Y, type SiloPlacement, type SiloSpec } from './silo-structure';
import { cellCrest } from './layer6-heights';
import { TUNABLES } from './tunables';

/** Cell size in tiles (mirrors CELL_TILE_SIZE without an import cycle) */
const CELL = 14;

// ── PRESETS — faithful ports of the reference recipes (RedKef's
// Megastructure series on Shadertoy; SETTINGS ported as starting points
// per the license doctrine in docs/PLAN.md — the code is ours).
// NO-INFRINGEMENT NOTE: nothing here is copied or transliterated from
// the reference shaders (CC BY-NC-SA covers their GLSL, which this
// project does not contain); this file is an independent implementation
// of the public kaleidoscopic-fold technique, using the reference only
// as concept + parameter values. Per-octave op
// order matches the reference: rotate about Y → tile → fold → permute
// (swaps, then sign flips) → d = max(d, min(q)). Selected live via
// TUNABLES.foldPreset; the destination is a preset per district. ──
export interface FoldPreset {
  name: string;
  base: number;
  decay: number;
  offset: number;
  /** Rotation about the vertical axis per octave (radians) */
  rot: number;
  maxOctaves: number;
  /** Octave-index bitmasks: the op applies when (k & mask) !== 0 */
  swapXY: number;
  swapXZ: number;
  flipX: number;
  flipY: number;
  flipZ: number;
  /** Spans crest-to-abyss when TUNABLES.foldCrestToAbyss is on */
  fullHeight?: boolean;
  /** Solid THICKENING (world units): the field's distance bound is a
   *  signed distance, so treating d <= thicken as solid offsets the
   *  surface outward — thin members survive tile quantization as
   *  connected beams instead of floating cubes */
  thicken?: number;
  /** Marching-squares smoothing of this preset's mass (fold-contour.ts):
   *  convex corners cut, concave notches filled, per solid band */
  smooth?: boolean;
  /** 'silo' = not a fold at all: silo-structure.ts supplies the mass
   *  (tanks on legs + fallen cylinders); fold params unused */
  kind?: 'silo';
}
export const FOLD_PRESETS: FoldPreset[] = [
  // "city" — OURS: #5's recipe pushed toward #7 (rot TAU/6, offset 0.7,
  // decay 0.55, 14 octaves; #5's flips). User-picked Aug 22 2026 as
  // "city with structured interiors": continuous mass with regular
  // courts/cells cut in, towers rising out. (#5 as-published was base
  // 500 / 0.75 / 0.5 / TAU/24 / 24 octaves.)
  { name: 'city', base: 500, decay: 0.55, offset: 0.7, rot: Math.PI / 6, maxOctaves: 14,
    swapXY: 0, swapXZ: 0, flipX: 2, flipY: 8, flipZ: 2, fullHeight: true },
  // #6 "industrial girders": base 200, decay 0.25, offset 0.95, TAU/16, swaps xy k&1 / xz k&2, flips x k&4, y k&8, z k&16
  { name: 'girders (#6)', base: 200, decay: 0.25, offset: 0.95, rot: Math.PI / 8, maxOctaves: 8,
    swapXY: 1, swapXZ: 2, flipX: 4, flipY: 8, flipZ: 16, thicken: 1.5, smooth: true },
  // #7 "carved interior": base 500, decay 0.5, offset 0.75, TAU/8, #5's flips
  { name: 'interior (#7)', base: 500, decay: 0.5, offset: 0.75, rot: Math.PI / 4, maxOctaves: 12,
    swapXY: 0, swapXZ: 0, flipX: 2, flipY: 8, flipZ: 2 },
  // SILOS (replaced 'rodrigues' — noise by construction; user, Aug 22
  // 2026): giant tanks on legs with X-braces + fallen cylinders. Fold
  // params are placeholders; silo-structure.ts owns the shape.
  { name: 'silos', base: 250, decay: 0.75, offset: 0.9, rot: 0, maxOctaves: 1,
    swapXY: 0, swapXZ: 0, flipX: 0, flipY: 0, flipZ: 0, kind: 'silo', smooth: true },
];
/** PRESET PER DISTRICT — the destination of the preset work: each
 *  region gets its own generated architecture. PLACEHOLDER MAPPING
 *  pending the user's in-game picks (Aug 22 2026). Roads districts are
 *  excluded (plinths are their own architecture). */
export const DISTRICT_PRESET: Partial<Record<RegionType, number>> = {
  // Canyon keeps its pits readable: only the sparse girders (purple) —
  // no city/interior/rodrigues mass in canyon (user, Aug 22 2026)
  canyon: 1,
  machine: 1, // girders (#6) — pits only (no open-sky cells)
  frontier: 3, // silos
  city: 2, // carved interior (#7) — pits only
};
/** The silo preset's index in FOLD_PRESETS */
export const SILO_PRESET = 3;
/** Which dungeon cells may PLACE silos: cells whose preset is the silo
 *  slot (memoized per stackSeed for the hot per-tile footprint scan) */
const siloCellMemo = new Map<string, Map<string, boolean>>();
function cellHasSilos(stackSeed: number): (acx: number, acz: number) => boolean {
  // keyed by seed AND the live preset override (it changes which cells place)
  const mk = `${stackSeed}|${Math.round(TUNABLES.foldPreset)}`;
  let m = siloCellMemo.get(mk);
  if (!m) { if (siloCellMemo.size > 8) siloCellMemo.clear(); m = new Map(); siloCellMemo.set(mk, m); }
  const memo = m;
  return (acx, acz) => {
    const k = `${acx},${acz}`;
    let v = memo.get(k);
    if (v === undefined) {
      v = presetIndexFor(stackSeed, acx, acz) === SILO_PRESET;
      if (memo.size >= 50000) memo.clear();
      memo.set(k, v);
    }
    return v;
  };
}
/** Is a tile OPEN for a silo footprint: no pillar, and either open
 *  ground / pit in an outside cell, or the no-biome filler between cells
 *  (Wall tiles there are ground-level slabs). Real walls and interiors
 *  are not open. */
function siloTileOpen(
  tiles: TileType[][], floorHeights: number[][], cellBiomes: (BiomeType | null)[][],
  pillarGround: boolean[][] | undefined, pillarWall: boolean[][] | undefined,
  tx: number, tz: number,
): boolean {
  if (pillarGround?.[tz]?.[tx] || pillarWall?.[tz]?.[tx]) return false;
  // ANY Wall tile blocks: claiming a wall adds no visible mass but makes
  // the fold contour treat the wall as fold-made and chamfer whatever
  // room/corridor it borders (DDSNAP, Aug 23 2026 — 45° slivers in a
  // tunnel corridor next to a tube footprint)
  if (tiles[tz]![tx] === TileType.Wall) return false;
  const biome = tileBiome(cellBiomes, tx, tz);
  const f0 = floorHeights[tz]![tx] ?? 0;
  return f0 <= PIT_LEVEL || biome === 'outside' || biome === null;
}
/** Placement context for this immutable input frame. Retained generation
 *  tiles have a full diameter of terrain padding. A cropped render query
 *  without that context must not accept an unverified footprint. */
// Input grids are immutable during fold evaluation. Weak ownership releases
// each frame's memo with its grids; replacement terrain/masks start fresh.
const siloOpenMemo = new WeakMap<TileType[][], {
  floorHeights: number[][]; cellBiomes: (BiomeType | null)[][];
  pillarGround: boolean[][] | undefined; pillarWall: boolean[][] | undefined;
  memo: Map<string, boolean>;
}>();
function siloPlacement(
  tiles: TileType[][], floorHeights: number[][], cellBiomes: (BiomeType | null)[][],
  pillarGround: boolean[][] | undefined, pillarWall: boolean[][] | undefined,
  stackSeed: number, absTx0: number, absTz0: number,
): SiloPlacement {
  const gridTiles = tiles.length;
  const frame = `${stackSeed}|${absTx0},${absTz0}|${gridTiles}|${Math.round(TUNABLES.foldPreset)}`;
  let context = siloOpenMemo.get(tiles);
  if (!context || context.floorHeights !== floorHeights || context.cellBiomes !== cellBiomes
    || context.pillarGround !== pillarGround || context.pillarWall !== pillarWall) {
    context = { floorHeights, cellBiomes, pillarGround, pillarWall, memo: new Map() };
    siloOpenMemo.set(tiles, context);
  }
  const memo = context.memo;
  return {
    cellHasSilos: cellHasSilos(stackSeed),
    footprintOpen: (spec: SiloSpec): boolean => {
      const key = `${frame}|${JSON.stringify([spec.acx, spec.acz, spec.cx, spec.cz, spec.r, spec.h, spec.fallen, spec.yaw])}`;
      let v = memo.get(key);
      if (v === undefined) {
        if (memo.size >= 50000) memo.clear();
        v = true;
        for (const [ax, az] of siloFootprintTiles(spec)) {
          const tx = ax - absTx0;
          const tz = az - absTz0;
          if (tx < 0 || tz < 0 || tx >= gridTiles || tz >= gridTiles) { v = false; break; }
          if (!siloTileOpen(tiles, floorHeights, cellBiomes, pillarGround, pillarWall, tx, tz)) { v = false; break; }
        }
        memo.set(key, v);
      }
      return v;
    },
  };
}
/** Preset index for a dungeon cell: the global override when TUNABLES.
 *  foldPreset >= 0; in a FOLD district the district's own preset (pure
 *  per region cell); elsewhere the sprinkle mapping (undefined = none) */
export function presetIndexFor(stackSeed: number, cx: number, cz: number): number | undefined {
  const o = Math.round(TUNABLES.foldPreset);
  if (o >= 0) return Math.min(FOLD_PRESETS.length - 1, o);
  const { rcx, rcz } = regionCellAt(stackSeed, cx, cz);
  const district = regionType(stackSeed, rcx, rcz);
  if (district === 'fold') return foldDistrictPreset(stackSeed, rcx, rcz, FOLD_PRESETS.length);
  return DISTRICT_PRESET[district];
}
/** Band: fold solid lives in [foldDeep, foldTop] (live tunables; the
 *  cap plane is the reference's ground plane placed at our band top) */
function foldTop(): number { return TUNABLES.foldTop; }
function foldDeep(): number { return TUNABLES.foldDeep; }
/** The live fold band [deep, top] — renderers use it to recognise
 *  fold-owned faces (debug tinting) */
export function foldBandRange(): [number, number] { return [foldDeep(), foldTop()]; }

/** Walk clearance bored through fold mass on permanent transit tiles */
const TRANSIT_CLEAR = 3.5;
/** ABYSS floor for crest-to-abyss mode: pits render to worldBottom
 *  (RENDER_ABYSS_DROP = 300 below the deepest base); fold below that is
 *  never seen */
export const FOLD_ABYSS = -300;
/** Y-term table ceiling (field space) */
const TABLE_TOP = 600;
function crestToAbyss(P: FoldPreset): boolean {
  return P.fullHeight === true && Math.round(TUNABLES.foldCrestToAbyss) === 1;
}
/** Interior-pit rim search radius (tiles) — bounded effect distance */
const RIM_SCAN = 6;
/** Canyon guest girders: how far below the rim their tops stop */
const GUEST_DROP = 2;
/** Octave floor: features below ~a tile come from texture, not geometry
 *  (the human-scale vocabulary never scales) — the ONE cut we make in
 *  the reference octave stacks (grid Nyquist) */
const FOLD_MIN_SCALE = 4;
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
export const FOLD_STEP = 0.25;
const STEP = FOLD_STEP;
/** ARCHITECTURAL MODULE (0 = off): snap every fold slab's top and bottom
 *  to multiples of this height, and require slabs/gaps of at least one
 *  module. Per-column sampling of a continuous surface otherwise leaves
 *  sub-story jitter between neighbors that reads as noise; snapped, the
 *  same mass reads as stories and setbacks. */
const FOLD_MODULE = 0;

const FOLD_SALT = 9797;

/** Per-world horizontal shift for SKY girders (quarter..three-quarter of
 *  the girder base period, so overhead never mirrors the ground) */
export function skyShift(stackSeed: number): [number, number] {
  const rng = mulberry32(cellSeed(23, 29, stackSeed, FOLD_SALT + 1));
  const P = FOLD_PRESETS[1]!;
  const period = P.base * 2;
  return [period * (0.25 + rng() * 0.5), period * (0.25 + rng() * 0.5)];
}

/** Per-world domain offset so every seed gets a different fold city */
export function foldOrigin(stackSeed: number): [number, number] {
  const rng = mulberry32(cellSeed(11, 17, stackSeed, FOLD_SALT));
  return [rng() * 4096, rng() * 4096];
}


/** Octaves a preset actually evaluates before the grid floor */
export function octavesUsed(P: FoldPreset): number {
  let n = 0;
  let scale = P.base;
  while (n < P.maxOctaves) {
    n++;
    scale *= P.decay;
    if (scale < FOLD_MIN_SCALE) break;
  }
  return n;
}

/**
 * Signed "air distance" of the fold field at a world point (positive =
 * air, <= 0 = solid), a conservative distance bound. Pure function of
 * (preset, domain offset, position). The general evaluator — used
 * directly for presets whose permutes mix y into x/z (swapXY).
 */
export function foldFieldAt(P: FoldPreset, ox: number, oz: number, wx: number, wy: number, wz: number, top = foldTop()): number {
  const cr = Math.cos(P.rot);
  const sr = Math.sin(P.rot);
  let qx = wx + ox;
  let qy = wy;
  let qz = wz + oz;
  let d = wy - top;
  let scale = P.base;
  const n = octavesUsed(P);
  for (let k = 0; k < n; k++) {
    const rx = qx * cr - qz * sr;
    const rz = qx * sr + qz * cr;
    const two = scale * 2;
    const cx = ((rx % two) + two) % two - scale;
    const cy = ((qy % two) + two) % two - scale;
    const cz = ((rz % two) + two) % two - scale;
    qx = scale * P.offset - Math.abs(cx);
    qy = scale * P.offset - Math.abs(cy);
    qz = scale * P.offset - Math.abs(cz);
    if ((k & P.swapXY) !== 0) { const t = qx; qx = qy; qy = t; }
    if ((k & P.swapXZ) !== 0) { const t = qx; qx = qz; qz = t; }
    if ((k & P.flipX) !== 0) qx = -qx;
    if ((k & P.flipY) !== 0) qy = -qy;
    if ((k & P.flipZ) !== 0) qz = -qz;
    d = Math.max(d, Math.min(qx, Math.min(qy, qz)));
    scale *= P.decay;
  }
  return d;
}

// ── FAST SEPARABLE EVALUATION ── Rotation mixes only x/z; each axis
// folds independently; sign flips and the xz swap stay within the x/z
// pair. So for presets WITHOUT an xy swap, the per-octave min(qx,qy,qz)
// splits into a per-COLUMN term min(qx_k,qz_k) and a per-HEIGHT term
// qy_k, and d(y) = max(y-TOP, max_k min(mxz_k, qy_k)). Bit-identical to
// foldFieldAt (same ops, same order per axis), ~10× cheaper per sample.
export function separable(P: FoldPreset): boolean { return P.swapXY === 0; }
/** Per-column x/z terms: min(qx_k, qz_k) for each octave */
export function foldColumnXZ(P: FoldPreset, ox: number, oz: number, wx: number, wz: number): Float64Array {
  const n = octavesUsed(P);
  const out = new Float64Array(n);
  const cr = Math.cos(P.rot);
  const sr = Math.sin(P.rot);
  let qx = wx + ox;
  let qz = wz + oz;
  let scale = P.base;
  for (let k = 0; k < n; k++) {
    const rx = qx * cr - qz * sr;
    const rz = qx * sr + qz * cr;
    const two = scale * 2;
    const cx = ((rx % two) + two) % two - scale;
    const cz = ((rz % two) + two) % two - scale;
    qx = scale * P.offset - Math.abs(cx);
    qz = scale * P.offset - Math.abs(cz);
    if ((k & P.swapXZ) !== 0) { const t = qx; qx = qz; qz = t; }
    if ((k & P.flipX) !== 0) qx = -qx;
    if ((k & P.flipZ) !== 0) qz = -qz;
    out[k] = Math.min(qx, qz);
    scale *= P.decay;
  }
  return out;
}
/** Per-height y terms: qy_k for each octave */
export function foldHeightY(P: FoldPreset, wy: number): Float64Array {
  const n = octavesUsed(P);
  const out = new Float64Array(n);
  let qy = wy;
  let scale = P.base;
  for (let k = 0; k < n; k++) {
    const two = scale * 2;
    const cy = ((qy % two) + two) % two - scale;
    qy = scale * P.offset - Math.abs(cy);
    if ((k & P.flipY) !== 0) qy = -qy;
    out[k] = qy;
    scale *= P.decay;
  }
  return out;
}
/** Y-term table over the fold band at STEP resolution, rebuilt when the
 *  preset or band changes (every scanned y lands on this lattice) */
const yTables = new Map<string, Float64Array[]>();
function yTerms(P: FoldPreset, wy: number): Float64Array {
  const deep = Math.min(foldDeep(), -60);
  const key = `${P.name}|${deep}`;
  let table = yTables.get(key);
  if (!table) {
    if (yTables.size > 16) yTables.clear();
    const rows = Math.round((Math.max(foldTop(), TABLE_TOP) - deep) / STEP) + 1;
    table = new Array<Float64Array>(rows);
    for (let i = 0; i < rows; i++) table[i] = foldHeightY(P, deep + i * STEP);
    yTables.set(key, table);
  }
  const i = Math.round((wy - deep) / STEP);
  if (i >= 0 && i < table.length && Math.abs(deep + i * STEP - wy) < 1e-9) return table[i]!;
  return foldHeightY(P, wy);
}
/** d(y) for a precomputed column — identical to foldFieldAt */
export function foldFastAt(P: FoldPreset, mxz: Float64Array, wy: number, top = foldTop()): number {
  const qy = yTerms(P, wy);
  let d = wy - top;
  for (let k = 0; k < mxz.length; k++) {
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
function foldIntervals(P: FoldPreset, ox: number, oz: number, wx: number, wz: number, yLo: number, yHi: number): [number, number][] {
  const out: [number, number][] = [];
  const fast = separable(P);
  const mxz = fast ? foldColumnXZ(P, ox, oz, wx, wz) : null;
  const cap = yHi;
  const thick = P.thicken ?? 0;
  let y = yHi;
  let solidTop: number | null = null;
  while (y >= yLo) {
    // Offset surface: solid where the distance bound is within `thicken`
    const d = (mxz ? foldFastAt(P, mxz, y, cap) : foldFieldAt(P, ox, oz, wx, y, wz, cap)) - thick;
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

/** The band a tile's column may carry fold mass in ([yLo, top]) and the
 *  preset that shapes it, or null where the fold is gated off. Mass
 *  starts AT the ground on walkable open-sky tiles and at foldDeep in
 *  pits. */
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
  /** Pillar footprints — exempt from every structure (monument territory) */
  pillarWall?: boolean[][],
): { yLo: number; yHi: number; fLo: number; fHi: number; preset: number; sky?: boolean } | null {
  if (pillarGround?.[tz]?.[tx]) return null;
  const absTx = absTx0 + tx;
  const absTz = absTz0 + tz;
  const acx = Math.floor(absTx / CELL);
  const acz = Math.floor(absTz / CELL);
  const isWall = tiles[tz]![tx] === TileType.Wall;
  const biome = tileBiome(cellBiomes, tx, tz);
  // SILO FOOTPRINT CLAIM (before every gate but pillars): a silo placed
  // by any silo-district cell owns every tile under it — open ground,
  // pits, other districts, the no-biome filler between cells — so the
  // tube is never chopped at an edge. Candidates whose footprint touches
  // a Wall tile, a pillar footprint or an interior are REJECTED at
  // placement (siloPlacement), never chopped.
  if (siloTileOpen(tiles, floorHeights, cellBiomes, pillarGround, pillarWall, tx, tz)) {
    const pl = siloPlacement(tiles, floorHeights, cellBiomes, pillarGround, pillarWall, stackSeed, absTx0, absTz0);
    if (siloIntervalsAt(stackSeed, absTx, absTz, pl).length > 0) {
      const top = siloMaxTop();
      return { yLo: SILO_BASE_Y, yHi: top, fLo: SILO_BASE_Y, fHi: top, preset: SILO_PRESET };
    }
  }
  if (isWall) return null;
  const f = floorHeights[tz]![tx]!;
  const isPit = f <= PIT_LEVEL;
  const outside = biome === 'outside';
  // Interior rooms/corridors are untouchable; fold lives in pits and
  // open-sky terrain
  if (!isPit && !outside) return null;
  // District gate + preset (absolute dungeon cells)
  const preset = presetIndexFor(stackSeed, acx, acz);
  if (preset === undefined) return null;
  const P = FOLD_PRESETS[preset]!;
  if (P.kind === 'silo') return null; // silo districts carry silos only (claimed above)
  // CANYON GUEST RULES (user, Aug 22 2026): canyon is the pits' biome.
  // Three girder flavours share one engine:
  //  - LAND girders: the preset in its own homes (machine districts,
  //    fold districts) — untouched by these rules;
  //  - PIT girders: in canyon pits only, BELOW the rim, partial coverage
  //    (low-frequency gate) so canyons read as canyons;
  //  - SKY girders: in canyon open-sky tiles, a HIGH band slung between
  //    the outer walls (within canyonSkyReach tiles of a Wall tile),
  //    partial coverage — look up and see them; scale.
  let guest = false;
  if (Math.round(TUNABLES.foldPreset) < 0) {
    const { rcx, rcz } = regionCellAt(stackSeed, acx, acz);
    guest = regionType(stackSeed, rcx, rcz) === 'canyon';
  }
  let sky = false;
  if (guest) {
    if (isPit) {
      // ~3-cell blobs of girder zones inside the pits
      if (sampleNoise(absTx, absTz, stackSeed + 4242, 42) > TUNABLES.canyonGirderCover) return null;
    } else {
      // SKY girders: no trimming (user, Aug 22 2026 — the coverage /
      // wall-reach gates thinned them to nothing). Optional gates stay
      // available as tunables but default OFF (cover 1, reach 0).
      if (TUNABLES.canyonSkyCover < 1
        && sampleNoise(absTx, absTz, stackSeed + 7373, 42) > TUNABLES.canyonSkyCover) return null;
      const reach = Math.round(TUNABLES.canyonSkyReach);
      if (reach > 0) {
        const gridTiles = tiles.length;
        let nearWall = false;
        for (let r = 1; r <= reach && !nearWall; r++) {
          for (let dz = -r; dz <= r && !nearWall; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const nx = tx + dx;
              const nz = tz + dz;
              if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) continue;
              if (tiles[nz]![nx] === TileType.Wall) { nearWall = true; break; }
            }
          }
        }
        if (!nearWall) return null;
      }
      sky = true;
    }
  }
  const full = crestToAbyss(P) && !guest;
  // FIELD band (the designed structure): pits from foldDeep, ground
  // tiles from their floor, up to foldTop. MOVE TARGETS (crest-to-abyss):
  // the structure's TOPMOST geometry is moved up to the cell's CREST —
  // where this cell's walls crown — and in pits the BOTTOMMOST geometry
  // is moved down to the pit bottom (where pit walls end). Everything
  // between is untouched: same rooms, same stories.
  const fLo = sky ? TUNABLES.canyonSkyLo : (isPit ? foldDeep() : f);
  const fHi = sky ? Math.max(TUNABLES.canyonSkyHi, TUNABLES.canyonSkyLo + 5) : foldTop();
  const yLo = isPit && full ? FOLD_ABYSS : fLo;
  let yHi = full ? Math.max(fHi, cellCrest(acx, acz, stackSeed)) : fHi;
  // INTERIOR PITS (no open sky above): the mass stays INSIDE the shaft —
  // capped at the surrounding rim's floor — instead of climbing out of
  // the pit into the room above.
  if (isPit && (!outside || guest)) {
    const gridTiles = tiles.length;
    let rim = Infinity;
    for (let r = 1; r <= RIM_SCAN && rim === Infinity; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = tx + dx;
          const nz = tz + dz;
          if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) continue;
          if (tiles[nz]![nx] === TileType.Wall) continue;
          const nf = floorHeights[nz]![nx]!;
          if (nf > PIT_LEVEL && nf < rim) rim = nf;
        }
      }
    }
    if (rim !== Infinity) yHi = Math.min(yHi, rim);
    // Guest girders stay clearly BELOW ground: the rim (or, beyond the
    // scan, grade ≈ 0) minus a drop — tops never stand flush with the
    // canyon floor, the pit stays a pit
    if (guest) yHi = Math.min(yHi, (rim === Infinity ? 0 : rim) - GUEST_DROP);
  }
  if (fLo >= Math.min(fHi, yHi)) return null;
  return { yLo, yHi, fLo, fHi, preset, sky };
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
/** The solid Y-bands the fold inserts for ONE tile — the single
 *  authority for "which solid is fold-made" (generation inserts exactly
 *  these; the fold contour shapes exactly these). Includes the district
 *  gate, interior-pit rim cap, pillar-ring exemption and module snap.
 *  Null = tile carries no fold. */
export function foldTileIntervals(
  tiles: TileType[][],
  floorHeights: number[][],
  cellBiomes: (BiomeType | null)[][],
  gridTiles: number,
  stackSeed: number,
  absTx0: number,
  absTz0: number,
  tx: number,
  tz: number,
  pillarGround?: boolean[][],
  pillarWall?: boolean[][],
  /** Optional memo for the pillar-cell scan (per build) */
  pillarCellMemo?: Map<string, boolean>,
): { bands: [number, number][]; preset: number; yLo: number } | null {
  const [ox, oz] = foldOrigin(stackSeed);
  const band = foldColumnBand(tiles, floorHeights, cellBiomes, pillarGround, stackSeed, absTx0, absTz0, tx, tz, pillarWall);
  if (band === null) return null;
  const PC = 56;
  const RING_LO = 14;
  const RING_HI = 41;
  const absTx = absTx0 + tx;
  const absTz = absTz0 + tz;
  // Pillar ring exemption
  {
    const lx = ((absTx % PC) + PC) % PC;
    const lz = ((absTz % PC) + PC) % PC;
    if (lx >= RING_LO && lx <= RING_HI && lz >= RING_LO && lz <= RING_HI && pillarWall) {
      const cx = Math.floor(absTx / PC);
      const cz = Math.floor(absTz / PC);
      const key = `${cx},${cz}`;
      let v = pillarCellMemo?.get(key);
      if (v === undefined) {
        v = false;
        for (let ttz = cz * PC - absTz0; ttz < (cz + 1) * PC - absTz0 && !v; ttz++) {
          if (ttz < 0 || ttz >= gridTiles) continue;
          const row = pillarWall[ttz]!;
          for (let ttx = Math.max(0, cx * PC - absTx0); ttx < Math.min(gridTiles, (cx + 1) * PC - absTx0); ttx++) {
            if (row[ttx]) { v = true; break; }
          }
        }
        pillarCellMemo?.set(key, v);
      }
      if (v) return null;
    }
  }
  const yLo = band.yLo;
  const yHi = band.yHi;
  const P = FOLD_PRESETS[band.preset]!;
  // Column center in world units, ABSOLUTE frame
  const wx = (absTx + 0.5) * TILE_SIZE;
  const wz = (absTz + 0.5) * TILE_SIZE;
  // Scan the DESIGNED band (interior-pit rim cap applies to the scan top)
  // SKY girders are the GROUND girder structure LIFTED (user, Aug 22
  // 2026): sample the field in ground space [0, bandHeight] and shift
  // the intervals up by the band base — same shape as land girders,
  // just high up; never a different (higher) slice of the field.
  let bands: [number, number][];
  if (P.kind === 'silo') {
    const pl = siloPlacement(tiles, floorHeights, cellBiomes, pillarGround, pillarWall, stackSeed, absTx0, absTz0);
    bands = siloIntervalsAt(stackSeed, absTx, absTz, pl);
    if (bands.length === 0) return null;
    return { bands, preset: band.preset, yLo: band.yLo };
  }
  if (band.sky) {
    const lift = band.fLo;
    // Horizontal OFFSET (user, Aug 22 2026): the sky chunk must not be the
    // ground pattern directly overhead — sample a different part of the
    // same lattice, shifted by a per-world seeded distance
    const [sx, sz] = skyShift(stackSeed);
    bands = foldIntervals(P, ox, oz, wx + sx, wz + sz, 0, Math.min(band.fHi, yHi) - lift)
      .map(([lo, hi]) => [lo + lift, hi + lift] as [number, number]);
  } else {
    bands = foldIntervals(P, ox, oz, wx, wz, band.fLo, Math.min(band.fHi, yHi));
  }
  if (FOLD_MODULE > 0) {
    const snapped: [number, number][] = [];
    for (const [lo, hi] of bands) {
      const slo = Math.max(yLo, Math.round(lo / FOLD_MODULE) * FOLD_MODULE);
      const shi = Math.min(yHi, Math.round(hi / FOLD_MODULE) * FOLD_MODULE);
      if (shi - slo < FOLD_MODULE - 1e-6) continue;
      const prev = snapped[snapped.length - 1];
      if (prev && slo - prev[1] < FOLD_MODULE - 1e-6) prev[1] = shi;
      else snapped.push([slo, shi]);
    }
    bands = snapped;
  }
  if (bands.length === 0) return null;
  // MOVE the structure's TOPMOST geometry (what touches the designed top
  // plane) up to the top target, and its BOTTOMMOST (what touches the
  // designed bottom plane) down to the bottom target. Lower roofs,
  // setbacks and ledges keep their heights — the detail stays.
  const scanTop = Math.min(band.fHi, yHi);
  const last = bands[bands.length - 1]!;
  if (yHi > last[1] && last[1] >= scanTop - STEP - 1e-6) last[1] = yHi;
  const first = bands[0]!;
  if (yLo < first[0] && first[0] <= band.fLo + STEP + 1e-6) first[0] = yLo;
  return { bands, preset: band.preset, yLo };
}

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
  /** Pillar footprints: a cell that holds a pillar keeps its whole RING
   *  (tiles 14..41 of the 56-tile cell) free of fold mass — the ring is
   *  the monument's own territory (ramps, plazas, climb targets) */
  pillarWall?: boolean[][],
): void {
  const bx0 = bounds?.x0 ?? 0;
  const bz0 = bounds?.z0 ?? 0;
  const bx1 = bounds?.x1 ?? gridTiles;
  const bz1 = bounds?.z1 ?? gridTiles;
  const memo = new Map<string, boolean>();
  for (let tz = bz0; tz < bz1; tz++) {
    for (let tx = bx0; tx < bx1; tx++) {
      const t = foldTileIntervals(tiles, floorHeights, cellBiomes, gridTiles, stackSeed, absTx0, absTz0, tx, tz, pillarGround, pillarWall, memo);
      if (!t) continue;
      let col = columns[tz * gridTiles + tx]!;
      for (const [lo, hi] of t.bands) col = addSolid(col, lo, hi);
      // THE guard: the permanent network keeps its walk clearance
      const f = floorHeights[tz]![tx]!;
      if (transit?.has(`${tx},${tz}`) && f > PIT_LEVEL) {
        col = boreAir(col, f, f + TRANSIT_CLEAR, 0);
      }
      columns[tz * gridTiles + tx] = col;
    }
  }
}
