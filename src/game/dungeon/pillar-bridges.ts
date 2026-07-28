/**
 * Pillar bridges — the neighbor-pair pass.
 *
 * For each adjacent pair of pillars, match bridge sockets on the facing
 * sides and span the gap with a walkway. This is LayerProcGen's sweet
 * spot: a bridge depends on exactly two cells' data, nothing else.
 *
 * INFINITE DISCIPLINE: planBridges is a pure function of the two specs
 * and the pair's own seed (derived from the LOWER cell coordinate, so
 * both sides of the pair compute the identical result independently).
 * No window knowledge, no global state.
 *
 * Geometry: a walkway two tiles wide crossing the inter-core gap at
 * socket height, sloping linearly if the two sockets differ. Carved into
 * the column model as a solid slab plus guaranteed walk clearance —
 * through open air it reads as a bridge; through solid it reads as a
 * carved passage. Faces derive as always.
 */

import type { ColumnSpan } from '../types';
import { cellSeed, mulberry32 } from './rng';
import { regionAtCell } from './region-layer';
import type { PillarSpec, ResolvedSocket } from './pillar-layer';

const MAX_BRIDGES_PER_PAIR = 2;
/** Max socket height difference a bridge will slope across. The gap
 *  between massive-pillar footprints is 26 tiles (78 units), so even
 *  10 is a gentle 0.13 grade. */
const MAX_DY = 10;
/** Forced (degree-guarantee) bridges accept much steeper ramps — a lone
 *  pillar takes any walkable connection over none. 24 over 78 units is
 *  a 0.31 grade, well under the engine's 1.1 climb limit. */
const FORCED_MAX_DY = 24;
/** Chosen bridges on one pair keep at least this much vertical space */
const MIN_SEPARATION = 10;
/** Sockets below this height never bridge: a bridge skimming the
 *  rolling ground crosses nothing you couldn't walk, and its slab
 *  z-fights and slits against the terrain it grazes. */
const MIN_BRIDGE_Y = 6;
/** Not every compatible pair bridges — the world stays airy */
const BRIDGE_CHANCE = 0.65;
const BRIDGE_SALT = 5252;

const SLAB = 0.5;
const CLEARANCE = 3.5;
/** Enclosed PIPE crossings — sewer-scale ducts between pillars. Tighter
 *  bore than an open walkway, sealed by a roof slab. */
const PIPE_CHANCE = 0.35;
const PIPE_BORE = 2.6;
const PIPE_ROOF = 0.5;
/** Free-standing ARCHES between crowns — the canyon-of-arches
 *  silhouette. Pure mass, no walkway: beams the insane machines left. */
const ARCH_SALT = 6161;
const ARCH_CHANCE_CANYON = 0.6;
const ARCH_CHANCE_ELSE = 0.08;
const ARCH_THICK = 1.4;
/** SUBWAY bores: deep roofed tunnels linking below-grade pillar pairs */
const SUBWAY_SALT = 8383;
const SUBWAY_CHANCE = 0.55;
export const SUBWAY_Y = -10;
/** Air spans thinner than this are uninhabitable and merge into solid */
const MIN_AIR = 1.5;

/** PILLAR-cell size in tiles (see pillar-layer PILLAR_CELL_TILES) */
const CELL = 56;
/** Footprint ring spans tiles 14..41; the gap is 42..55 + 0..13 */
const RING_HI = 41;
const GAP_TILES = 28;

export interface BridgeSpec {
  /** Lower cell of the pair (window-local; tile math) */
  cx: number;
  cz: number;
  /** Absolute pillar-grid coords of the owner (seeding) */
  acx: number;
  acz: number;
  /** 'east' = toward (cx+1, cz); 'south' = toward (cx, cz+1) */
  dir: 'east' | 'south';
  /** Walk height at the near (this cell's) core face */
  yA: number;
  /** Walk height at the far (neighbor's) core face */
  yB: number;
  /** Enclosed pipe crossing: tight bore, roofed — a duct, not a walkway */
  pipe: boolean;
}

/** Workable socket pairings for a pair, best height match first */
function pairCandidates(
  a: PillarSpec,
  b: PillarSpec,
  dir: 'east' | 'south',
  maxDy: number = MAX_DY,
): { sa: ResolvedSocket; sb: ResolvedSocket; dy: number }[] {
  const outFace = dir === 'east' ? 'east' : 'south';
  const inFace = dir === 'east' ? 'west' : 'north';
  const fromA = a.sockets.filter((s) => s.kind === 'bridge' && s.face === outFace);
  const fromB = b.sockets.filter((s) => s.kind === 'bridge' && s.face === inFace);
  const candidates: { sa: ResolvedSocket; sb: ResolvedSocket; dy: number }[] = [];
  for (const sa of fromA) {
    for (const sb of fromB) {
      if (sa.yAbs < MIN_BRIDGE_Y || sb.yAbs < MIN_BRIDGE_Y) continue;
      const dy = Math.abs(sa.yAbs - sb.yAbs);
      if (dy <= maxDy) candidates.push({ sa, sb, dy });
    }
  }
  candidates.sort((p, q) => p.dy - q.dy);
  return candidates;
}

/**
 * Bridges between a pillar and its east/south neighbor. Called once per
 * directed pair; returns [] when either side is void or nothing matches.
 */
export function planBridges(
  worldSeed: number,
  a: PillarSpec | null,
  b: PillarSpec | null,
  dir: 'east' | 'south',
): BridgeSpec[] {
  if (!a || !b) return [];
  const candidates = pairCandidates(a, b, dir);
  if (candidates.length === 0) return [];

  const rng = mulberry32(cellSeed(a.acx, a.acz, worldSeed, BRIDGE_SALT + (dir === 'east' ? 0 : 1)));

  const bridges: BridgeSpec[] = [];
  for (const c of candidates) {
    if (bridges.length >= MAX_BRIDGES_PER_PAIR) break;
    // Separation must hold at BOTH ends — bridges that converge at the
    // far side carve through each other's walkways
    if (bridges.some((br) =>
      Math.abs(br.yA - c.sa.yAbs) < MIN_SEPARATION ||
      Math.abs(br.yB - c.sb.yAbs) < MIN_SEPARATION)) continue;
    if (rng() > BRIDGE_CHANCE) continue;
    bridges.push({ cx: a.cx, cz: a.cz, acx: a.acx, acz: a.acz, dir, yA: c.sa.yAbs, yB: c.sb.yAbs, pipe: rng() < PIPE_CHANCE });
  }
  return bridges;
}

/**
 * Arches OWNED by cell (cx,cz): high solid beams spanning to the east
 * and south neighbors' crowns. Silhouette mass only — carved as solid,
 * never walked. Canyon districts grow forests of them.
 */
export function planOwnedArches(
  worldSeed: number,
  cx: number,
  cz: number,
  at: (cx2: number, cz2: number) => PillarSpec | null,
): BridgeSpec[] {
  const a = at(cx, cz);
  if (!a) return [];
  const out: BridgeSpec[] = [];
  const district = regionAtCell(worldSeed, cx * 4 + 2, cz * 4 + 2);
  const chance = district === 'canyon' ? ARCH_CHANCE_CANYON : ARCH_CHANCE_ELSE;
  for (const dir of ['east', 'south'] as const) {
    const b = at(dir === 'east' ? cx + 1 : cx, dir === 'south' ? cz + 1 : cz);
    if (!b) continue;
    const rng = mulberry32(cellSeed(a.acx, a.acz, worldSeed, ARCH_SALT + (dir === 'east' ? 0 : 1)));
    if (rng() > chance) continue;
    // Above BOTH pillars' walkable tops so the beam can never block a
    // flight or an attic — pure skyline
    const y = Math.max(a.totalHeight, b.totalHeight) + 6 + rng() * 10;
    out.push({ cx, cz, acx: a.acx, acz: a.acz, dir, yA: y, yB: y, pipe: false });
  }
  return out;
}

/** Carve one ARCH tile: pure solid beam [y-ARCH_THICK, y] — air is
 *  removed, nothing is added. */
export function carveArchIntoColumn(spans: ColumnSpan[], y: number): ColumnSpan[] {
  const lo = y - ARCH_THICK;
  const out: ColumnSpan[] = [];
  for (const s of spans) {
    if (y <= s.floor || lo >= s.ceil) {
      out.push(s);
      continue;
    }
    if (s.floor < lo) out.push({ floor: s.floor, ceil: lo, owner: s.owner, ceilOwner: -1 });
    if (s.ceil > y) out.push({ floor: y, ceil: s.ceil, owner: -1, ceilOwner: s.ceilOwner });
  }
  return out;
}

/**
 * SUBWAY bores owned by cell (cx,cz): deep roofed tunnels at SUBWAY_Y
 * between adjacent pillars that both continue below grade — abandoned
 * transit lines through the foundation. Carved with the pipe profile
 * (slab, 2.6 bore, roof), crossing whatever lies between: rock reads as
 * a bore, a pit crossing reads as an exposed elevated duct.
 */
export function planOwnedSubways(
  worldSeed: number,
  cx: number,
  cz: number,
  at: (cx2: number, cz2: number) => PillarSpec | null,
): BridgeSpec[] {
  const a = at(cx, cz);
  if (!a || a.baseDepth > -8) return [];
  const out: BridgeSpec[] = [];
  for (const dir of ['east', 'south'] as const) {
    const b = at(dir === 'east' ? cx + 1 : cx, dir === 'south' ? cz + 1 : cz);
    if (!b || b.baseDepth > -8) continue;
    const rng = mulberry32(cellSeed(a.acx, a.acz, worldSeed, SUBWAY_SALT + (dir === 'east' ? 0 : 1)));
    if (rng() > SUBWAY_CHANCE) continue;
    out.push({ cx, cz, acx: a.acx, acz: a.acz, dir, yA: SUBWAY_Y, yB: SUBWAY_Y, pipe: true });
  }
  return out;
}

/** Accessor for a pillar spec by cell — how the guarantee reads its
 *  radius-1 neighborhood without ever seeing the whole window */
export type SpecAt = (cx: number, cz: number) => PillarSpec | null;

/** The four pairs a pillar participates in, in the fixed order the
 *  degree guarantee scans them. Each entry is expressed as its OWNING
 *  pair (owner = the west/north cell), so both endpoints of a pair
 *  derive the identical description. */
function pairsOf(spec: PillarSpec, at: SpecAt): { a: PillarSpec | null; b: PillarSpec | null; dir: 'east' | 'south' }[] {
  return [
    { a: spec, b: at(spec.cx + 1, spec.cz), dir: 'east' },
    { a: spec, b: at(spec.cx, spec.cz + 1), dir: 'south' },
    { a: at(spec.cx - 1, spec.cz), b: spec, dir: 'east' },
    { a: at(spec.cx, spec.cz - 1), b: spec, dir: 'south' },
  ];
}

/**
 * LOCAL CONNECTIVITY GUARANTEE — every pillar with any workable
 * neighbor pairing gets at least one bridge. Pure radius-1: a pillar
 * whose four pairs all rolled empty forces the best candidate on its
 * first eligible pair. Both endpoints of a pair run the same
 * deterministic scan, so a forced bridge is derived identically from
 * either side — no coordination, no global pass. Returns the forced
 * bridge for the pair (a,b,dir) if EITHER endpoint's scan forces it.
 */
function forcedBridge(
  worldSeed: number,
  a: PillarSpec,
  b: PillarSpec,
  dir: 'east' | 'south',
  at: SpecAt,
): BridgeSpec | null {
  if (planBridges(worldSeed, a, b, dir).length > 0) return null;

  const isFirstEligible = (p: PillarSpec): boolean => {
    let degree = 0;
    let firstEligible: string | null = null;
    for (const pair of pairsOf(p, at)) {
      if (!pair.a || !pair.b) continue;
      const cands = pairCandidates(pair.a, pair.b, pair.dir, FORCED_MAX_DY);
      if (cands.length === 0) continue;
      if (firstEligible === null) firstEligible = `${pair.a.cx},${pair.a.cz},${pair.dir}`;
      degree += planBridges(worldSeed, pair.a, pair.b, pair.dir).length;
    }
    return degree === 0 && firstEligible === `${a.cx},${a.cz},${dir}`;
  };

  if (!isFirstEligible(a) && !isFirstEligible(b)) return null;
  const best = pairCandidates(a, b, dir, FORCED_MAX_DY)[0];
  if (!best) return null;
  // Forced (guarantee) bridges are never pipes: the one guaranteed
  // route onto a pillar should read as an open walkway
  return { cx: a.cx, cz: a.cz, acx: a.acx, acz: a.acz, dir, yA: best.sa.yAbs, yB: best.sb.yAbs, pipe: false };
}

/**
 * All bridges OWNED by cell (cx,cz) — its east and south pairs, chance
 * bridges plus degree-guarantee forces. The full bridge set of any
 * region is the union of this over its cells.
 */
export function planOwnedBridges(worldSeed: number, cx: number, cz: number, at: SpecAt): BridgeSpec[] {
  const a = at(cx, cz);
  if (!a) return [];
  const out: BridgeSpec[] = [];
  for (const dir of ['east', 'south'] as const) {
    const b = dir === 'east' ? at(cx + 1, cz) : at(cx, cz + 1);
    if (!b) continue;
    const planned = planBridges(worldSeed, a, b, dir);
    if (planned.length > 0) {
      out.push(...planned);
    } else {
      const forced = forcedBridge(worldSeed, a, b, dir, at);
      if (forced) out.push(forced);
    }
  }
  return out;
}

/** Every world tile a bridge occupies, with its walk height there.
 *  Walkways on the massive grid are 3 tiles wide. */
export function bridgeTiles(br: BridgeSpec): { tx: number; tz: number; h: number; support: boolean }[] {
  const out: { tx: number; tz: number; h: number; support: boolean }[] = [];
  for (let i = 0; i < GAP_TILES; i++) {
    const t = (i + 0.5) / GAP_TILES;
    const h = br.yA + (br.yB - br.yA) * t;
    const along = (br.dir === 'east' ? br.cx : br.cz) * CELL + RING_HI + 1 + i;
    for (const c of [27, 28, 29]) {
      const cross = (br.dir === 'east' ? br.cz : br.cx) * CELL + c;
      // One centered pier holds each exposed end of an open bridge. Whether
      // finite ground actually exists below is decided by the column pass.
      const support = !br.pipe && c === 28 && (i === 0 || i === GAP_TILES - 1);
      out.push(br.dir === 'east'
        ? { tx: along, tz: cross, h, support }
        : { tx: cross, tz: along, h, support });
    }
  }
  return out;
}

/**
 * Carve one bridge tile into a column: solid slab [h-SLAB, h], walkable
 * air [h, h+CLEARANCE]. Existing air is split around the slab; carving
 * through solid opens a passage. New surfaces are structural rock.
 */
export function carveBridgeIntoColumn(spans: ColumnSpan[], h: number, pipe = false): ColumnSpan[] {
  const slabLo = h - SLAB;
  const slabHi = h;
  const bore = pipe ? PIPE_BORE : CLEARANCE;

  // Where the existing ground is already at bridge height (rolling
  // outdoor terrain, plaza edges), the terrain IS the bridge — slicing
  // a flat slab through it makes sliver spans and z-fighting rock cuts.
  // Leave the column untouched; the walker steps between terrain and
  // slab at the transition (differences stay under the step limit).
  if (spans.some((s) => s.floor > -100 && s.floor >= h - 0.6 && s.floor <= h + 0.6)) {
    return spans;
  }

  // Split existing air around the slab
  const split: ColumnSpan[] = [];
  for (const s of spans) {
    if (slabLo >= s.ceil || slabHi <= s.floor) {
      split.push(s);
      continue;
    }
    split.push({ floor: s.floor, ceil: slabLo, owner: s.owner, ceilOwner: -1 });
    split.push({ floor: slabHi, ceil: s.ceil, owner: -1, ceilOwner: s.ceilOwner });
  }

  // A pipe seals itself: remove any air crossing the roof band, so the
  // tube reads as a duct from outside instead of an open trough
  if (pipe) {
    const roofLo = slabHi + bore;
    const roofHi = roofLo + PIPE_ROOF;
    const roofed: ColumnSpan[] = [];
    for (const s of split) {
      if (roofHi <= s.floor || roofLo >= s.ceil) {
        roofed.push(s);
        continue;
      }
      if (s.floor < roofLo) roofed.push({ floor: s.floor, ceil: roofLo, owner: s.owner, ceilOwner: -1 });
      if (s.ceil > roofHi) roofed.push({ floor: roofHi, ceil: s.ceil, owner: -1, ceilOwner: s.ceilOwner });
    }
    split.length = 0;
    split.push(...roofed);
  }

  // Guarantee the walk clearance exists (carves a passage through solid)
  split.push({ floor: slabHi, ceil: slabHi + bore, owner: -1, ceilOwner: -1 });

  // Merge overlaps, drop crushed slivers
  split.sort((p, q) => p.floor - q.floor);
  const merged: ColumnSpan[] = [];
  for (const s of split) {
    const prev = merged[merged.length - 1];
    if (prev && s.floor <= prev.ceil + 0.01) {
      if (s.ceil > prev.ceil) {
        prev.ceil = s.ceil;
        prev.ceilOwner = s.ceilOwner;
      }
    } else {
      merged.push({ ...s });
    }
  }
  return merged.filter((s) => s.ceil - s.floor >= MIN_AIR);
}

/**
 * Replace the air directly below a bridge-end slab with a structural pier.
 * The lower span's floor is the terrain/foundation surface the pier stands
 * on. Bottomless columns deliberately remain unsupported rather than growing
 * arbitrary mass down to the abyss sentinel.
 */
export function addBridgeEndSupport(spans: ColumnSpan[], h: number): ColumnSpan[] {
  const slabLo = h - SLAB;
  const supportSpan = spans.find((s) =>
    s.floor > -100
    && s.floor < slabLo - 0.1
    && Math.abs(s.ceil - slabLo) < 0.05);
  if (!supportSpan) return spans;
  return spans.filter((s) => s !== supportSpan);
}
