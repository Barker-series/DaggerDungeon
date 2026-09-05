/**
 * SILOS — the structure that replaced the "rodrigues" fold preset (user,
 * Aug 22 2026: that preset was noise by construction). Giant HOLLOW
 * concrete tubes (user: "structural stuff, not tanks"): a ring wall of
 * siloWall tiles, open ends — standing ones straight on the ground (look
 * down into them), FALLEN ones lying on the ground as walk-through
 * tunnels.
 *
 * Infinite-world discipline: one silo per dungeon cell at most, specced
 * from (stackSeed, absolute cell); a tile evaluates the silos of the
 * cells within reach (bounded by the largest possible footprint) — a
 * pure function of seed + absolute position, no window dependence.
 * Output: solid Y-intervals in ABSOLUTE world height (base SILO_BASE_Y;
 * outside ground here is flat, 0..2), which the column model owns (so
 * the silos are walkable, collidable, smoothed by the fold contour like
 * any mass).
 *
 * A SILO OWNS ITS FOOTPRINT (user, Aug 22 2026: "don't chop them up"):
 * the placing cell decides the silo exists; every tile under it emits —
 * pits, neighbouring districts included — instead of each tile asking
 * whether IT is silo ground. Only Wall tiles, pillar plazas/rings and
 * interior rooms still win (foldColumnBand).
 */

import { TILE_SIZE } from '../types';
import { cellSeed, mulberry32 } from './rng';
import { TUNABLES } from './tunables';

/** Dungeon cell size in tiles (mirrors CELL_TILE_SIZE without a cycle) */
const CELL = 14;
const SILO_SALT = 31337;
/** Absolute base height of every silo (legs/fallen cylinders start here) */
export const SILO_BASE_Y = -1;

export interface SiloSpec {
  /** Placing cell (absolute dungeon cell) */
  acx: number;
  acz: number;
  /** Centre in ABSOLUTE tile units (fractional) */
  cx: number;
  cz: number;
  /** Radius in tiles */
  r: number;
  /** Tube height (standing) / length (fallen), world units */
  h: number;
  /** Fallen: lies on the ground along yaw (radians) */
  fallen: boolean;
  yaw: number;
}

/** Placement context: which cells may place, and whether a candidate's
 *  whole footprint is OPEN (no real wall, pillar or interior under it —
 *  user, Aug 22 2026: tubes merging into walls look bad, so those
 *  candidates are rejected instead of chopped) */
export interface SiloPlacement {
  cellHasSilos: (acx: number, acz: number) => boolean;
  footprintOpen: (spec: SiloSpec) => boolean;
}

function siloSpecFor(stackSeed: number, acx: number, acz: number, pl: SiloPlacement): SiloSpec | null {
  if (!pl.cellHasSilos(acx, acz)) return null;
  const rng = mulberry32(cellSeed(acx, acz, stackSeed, SILO_SALT));
  if (rng() > TUNABLES.siloDensity) return null;
  const r = TUNABLES.siloRadius * (0.8 + rng() * 0.4);
  const fallen = rng() < TUNABLES.siloFallenFraction;
  const h = (fallen ? TUNABLES.siloFallenLength : TUNABLES.siloHeight) * (0.75 + rng() * 0.5);
  // centre away from the cell edge so the footprint rarely crosses into
  // more than the neighbouring cells (bounded reach either way)
  const cx = acx * CELL + CELL * 0.25 + rng() * CELL * 0.5;
  const cz = acz * CELL + CELL * 0.25 + rng() * CELL * 0.5;
  const spec: SiloSpec = { acx, acz, cx, cz, r, h, fallen, yaw: rng() * Math.PI * 2 };
  return spec;
}

/** Every absolute tile a silo's footprint covers (standing: disc of
 *  radius r+0.5; fallen: the lying rectangle) — the placement check
 *  walks this */
export function siloFootprintTiles(s: SiloSpec): [number, number][] {
  const out: [number, number][] = [];
  if (!s.fallen) {
    const R = s.r + 0.5;
    for (let tz = Math.floor(s.cz - R); tz <= Math.ceil(s.cz + R); tz++) {
      for (let tx = Math.floor(s.cx - R); tx <= Math.ceil(s.cx + R); tx++) {
        if (Math.hypot(tx + 0.5 - s.cx, tz + 0.5 - s.cz) <= R) out.push([tx, tz]);
      }
    }
    return out;
  }
  const ux = Math.cos(s.yaw), uz = Math.sin(s.yaw);
  const halfLen = s.h / TILE_SIZE / 2 + 0.5;
  const ext = halfLen + s.r + 1;
  for (let tz = Math.floor(s.cz - ext); tz <= Math.ceil(s.cz + ext); tz++) {
    for (let tx = Math.floor(s.cx - ext); tx <= Math.ceil(s.cx + ext); tx++) {
      const dx = tx + 0.5 - s.cx, dz = tz + 0.5 - s.cz;
      const along = dx * ux + dz * uz;
      const perp = Math.abs(-dx * uz + dz * ux);
      if (Math.abs(along) <= halfLen && perp <= s.r + 0.5) out.push([tx, tz]);
    }
  }
  return out;
}

/** Solid intervals (ABSOLUTE world height) of every silo touching
 *  absolute tile (absTx, absTz); empty when none. `cellHasSilos` says
 *  which dungeon cells may PLACE silos (silo districts) — footprints
 *  then extend wherever they reach. */
export function siloIntervalsAt(
  stackSeed: number, absTx: number, absTz: number,
  pl: SiloPlacement,
): [number, number][] {
  const out: [number, number][] = [];
  // reach in cells: fallen length/2 + radius, in tiles, over the cell size
  const reachTiles = (TUNABLES.siloFallenLength * 1.25) / TILE_SIZE / 2 + TUNABLES.siloRadius * 1.2 + 1;
  const reach = Math.ceil(reachTiles / CELL);
  const acx = Math.floor(absTx / CELL);
  const acz = Math.floor(absTz / CELL);
  const px = absTx + 0.5;
  const pz = absTz + 0.5;
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const s = siloSpecFor(stackSeed, acx + dx, acz + dz, pl);
      if (!s) continue;
      // Only an emitting candidate may read terrain context. Checking every
      // nearby cell's footprint would exceed the diameter dependency.
      const start = out.length;
      if (s.fallen) fallenIntervals(s, px, pz, out);
      else standingIntervals(s, px, pz, out);
      if (out.length > start && !pl.footprintOpen(s)) out.length = start;
    }
  }
  for (const iv of out) { iv[0] += SILO_BASE_Y; iv[1] += SILO_BASE_Y; }
  if (out.length <= 1) return out;
  // merge overlaps
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [out[0]!];
  for (let i = 1; i < out.length; i++) {
    const last = merged[merged.length - 1]!;
    const cur = out[i]!;
    if (cur[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], cur[1]);
    else merged.push(cur);
  }
  return merged;
}

/** Standing silo: a hollow tube straight on the ground (supports removed —
 *  user, Aug 23 2026) */
function standingIntervals(s: SiloSpec, px: number, pz: number, out: [number, number][]): void {
  const d = Math.hypot(px - s.cx, pz - s.cz);
  const ri = Math.max(0, s.r - TUNABLES.siloWall);
  if (d <= s.r && d >= ri) out.push([0, s.h]);
}

/** Fallen silo: horizontal cylinder of radius r lying along yaw, axis at
 *  height r - sink (slightly sunk into the ground), length h */
function fallenIntervals(s: SiloSpec, px: number, pz: number, out: [number, number][]): void {
  const ux = Math.cos(s.yaw), uz = Math.sin(s.yaw);
  const halfLen = s.h / TILE_SIZE / 2; // tiles
  const dx = px - s.cx, dz = pz - s.cz;
  const along = dx * ux + dz * uz;
  if (Math.abs(along) > halfLen) return;
  const perp = Math.abs(-dx * uz + dz * ux);
  if (perp >= s.r) return;
  const rW = s.r * TILE_SIZE; // radius in world units
  const pW = perp * TILE_SIZE;
  const half = Math.sqrt(rW * rW - pW * pW);
  const axisY = rW - TUNABLES.siloFallenSink;
  // hollow: inner radius carves a tunnel; at |perp| < ri the column holds
  // the floor arc and the roof arc, beyond it the full chord
  const riW = Math.max(0, (s.r - TUNABLES.siloWall) * TILE_SIZE);
  if (pW < riW) {
    const halfIn = Math.sqrt(riW * riW - pW * pW);
    const lo1 = Math.max(0, axisY - half), hi1 = axisY - halfIn;
    const lo2 = axisY + halfIn, hi2 = axisY + half;
    if (hi1 - lo1 > 0.25) out.push([lo1, hi1]);
    if (hi2 - lo2 > 0.25) out.push([lo2, hi2]);
  } else {
    const lo = Math.max(0, axisY - half);
    const hi = axisY + half;
    if (hi - lo > 0.5) out.push([lo, hi]);
  }
}

/** Highest ABSOLUTE point any silo can occupy (band cap) */
export function siloMaxTop(): number {
  return SILO_BASE_Y + Math.max(TUNABLES.siloHeight * 1.25, TUNABLES.siloRadius * TILE_SIZE * 2.4) + 2;
}

/** Conservative footprint half-extent, including the eligibility fringe.
 *  An emitted tile can read the opposite end: dependency is TWICE this. */
export function siloMaxReachTiles(): number {
  const r = TUNABLES.siloRadius * 1.2 + 0.5;
  return Math.max(r, TUNABLES.siloFallenLength * 1.25 / TILE_SIZE / 2 + 0.5 + r + 1);
}
