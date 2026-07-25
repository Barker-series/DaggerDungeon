/**
 * Pillar geometry — turns a PillarSpec into tiles and column spans.
 *
 * v2 scale: a pillar cell is 56 tiles (168 world units); the pillar
 * occupies the central 30x30 tiles (90 units) — a monument, not a post.
 *
 * A pillar's footprint tiles are marked WALL in the tile grid early (so
 * connectivity, the golden path, and pathfinding route around it), and
 * after the column model is built those columns get the pillar's own
 * AIR spans carved in: the winding ramp, terrace plazas, gallery
 * interiors, the crown rooftop. Everything downstream — wall faces,
 * floors, collision, ground queries — derives from the spans exactly
 * as for every other column. Graybox: all surfaces are flat structural
 * rock (span owner -1).
 *
 * Pre-rotation layout within the 56-tile pillar cell:
 *   ring (max extent)   tiles 13..42
 *   full core           tiles 16..39
 *   slim core           tiles 20..35
 *   ramp band           z 13..15, x 13..42 on the NORTH face, ascending
 *                       west→east; rotation k turns everything clockwise
 * The assembler advances k per chunk, so ramp exits meet the next
 * ramp's entry at the shared corner — the spiral is continuous.
 */

import type { PillarSpec, PlacedChunk } from './pillar-layer';

/** Below the deepest rendered abyss — pillars never float */
const FOUNDATION_BOTTOM = -40;
/** Air gaps thinner than this merge back into solid (uncrawlable) */
const MIN_AIR = 1.5;
/** Standing room over the crown rooftop */
const CROWN_HEADROOM = 4;
const SLAB = 0.5;
/** Ramp slabs are chunky — thin floating stairs read as jank */
const RAMP_SLAB = 1;
/** Extra treads the ground-floor flight runs PAST the pillar face,
 *  continuing down at the same slope until it reaches grade. Adding
 *  descent by steepening the flight instead makes it unclimbable — it
 *  needs run, not pitch. Steps below the terrain are buried by the
 *  foundation, so the stair meets whatever grade it lands on. */
const RAMP_ENTRY_STEPS = 10;
/** Guaranteed headroom over every ramp surface — generous: the spiral
 *  stairs are a marquee traversal experience, not a crawlspace. The
 *  punch is capped near landings (chunk top + landing headroom) so it
 *  never blasts through features two chunks up. */
const RAMP_CLEARANCE = 9.5;
const LANDING_CLEARANCE = 4.75;

const CELL = 56;

// One tile of margin to the dungeon-cell boundary: tiles 14..41 touch
// only the middle 2x2 of the pillar cell's 4x4 dungeon cells, so the
// outer ring of cells stays free for rooms, spawn, and exit
const RING = { lo: 14, hi: 41 };
const FULL = { lo: 17, hi: 38 };
const SLIM = { lo: 21, hi: 34 };
/** Doorway tiles along a wall (pre-rotation x range) */
const DOOR = { lo: 26, hi: 29 };
const DOOR_HEIGHT = 4;

/** Rotate a local tile coordinate a quarter-turn clockwise, k times */
function rot(lx: number, lz: number, k: number): [number, number] {
  let x = lx, z = lz;
  for (let i = 0; i < (k & 3); i++) {
    const nx = CELL - 1 - z;
    z = x;
    x = nx;
  }
  return [x, z];
}

const key = (lx: number, lz: number): string => `${lx},${lz}`;

interface TileSolids {
  intervals: [number, number][];
  /** PUNCHING clearances — subtracted from the solids AFTER merging.
   *  Ramp headroom cuts through whatever hangs overhead (plaza slabs,
   *  roof plates): the opening is the stair opening. Also count as
   *  allowed zones for the roofline cull. */
  clear: [number, number][];
  /** ALLOW-ONLY zones — exempt from the roofline cull but never punch
   *  solids (a plaza's headroom must not erase the ramp slabs crossing
   *  its own ring). */
  allow: [number, number][];
}

function eachTile(lo: number, hi: number, fn: (lx: number, lz: number) => void): void {
  for (let lz = lo; lz <= hi; lz++) {
    for (let lx = lo; lx <= hi; lx++) fn(lx, lz);
  }
}

function tileAt(solids: Map<string, TileSolids>, lx: number, lz: number, k: number): TileSolids {
  const [x, z] = rot(lx, lz, k);
  let t = solids.get(key(x, z));
  if (!t) {
    t = { intervals: [], clear: [], allow: [] };
    solids.set(key(x, z), t);
  }
  return t;
}

function addSolid(
  solids: Map<string, TileSolids>,
  lx: number, lz: number, k: number,
  lo: number, hi: number,
): void {
  tileAt(solids, lx, lz, k).intervals.push([lo, hi]);
}

function addClear(
  solids: Map<string, TileSolids>,
  lx: number, lz: number, k: number,
  lo: number, hi: number,
): void {
  tileAt(solids, lx, lz, k).clear.push([lo, hi]);
}

function addAllow(
  solids: Map<string, TileSolids>,
  lx: number, lz: number, k: number,
  lo: number, hi: number,
): void {
  tileAt(solids, lx, lz, k).allow.push([lo, hi]);
}

/**
 * The winding ramp: every chunk carries one on its rotation face.
 * The first and last 3 tiles are FLAT LANDINGS at the chunk's base and
 * top. Adjacent chunks' bands overlap in the 3x3 corner squares; with
 * landings, chunk i's exit landing (at its top) and chunk i+1's entry
 * landing (at its base — the same height) merge into one flat platform
 * instead of a mismatched step. The spiral chains corner to corner.
 */
function rampSolids(placed: PlacedChunk, solids: Map<string, TileSolids>, isFirst = false): void {
  const b = placed.baseY;
  const h = placed.def.height;
  const k = placed.rotation;
  const run = RING.hi - RING.lo; // 29 steps across the band
  // The ground flight keeps descending past the face until it hits grade
  const first = isFirst ? -RAMP_ENTRY_STEPS : 0;
  for (let i = first; i <= run; i++) {
    const tRaw = (i - 2.5) / (run - 5);
    const t = Math.min(1, i < 0 ? tRaw : Math.max(0, tRaw));
    const surface = b + h * t;
    const clearTop = Math.min(surface + RAMP_CLEARANCE, b + h + LANDING_CLEARANCE);
    for (let z = RING.lo; z <= RING.lo + 2; z++) {
      addSolid(solids, RING.lo + i, z, k, surface - RAMP_SLAB, surface);
      addClear(solids, RING.lo + i, z, k, surface, clearTop);
    }
  }
}

function chunkSolids(placed: PlacedChunk, solids: Map<string, TileSolids>, below?: PlacedChunk): void {
  const b = placed.baseY;
  const k = placed.rotation;
  const top = b + placed.def.height;

  rampSolids(placed, solids, below === undefined);

  switch (placed.def.id) {
    case 'terrace':
      // Slim waist inside a flat plaza — the bridge landing. The plaza
      // OMITS its band over the ramp arriving from the chunk below
      // (pre-rotation: the west strip, which rotation k maps onto face
      // k-1): stairs climb under open air instead of a 3-unit-low
      // plaza overhang. That face also exposes no sockets.
      eachTile(SLIM.lo, SLIM.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      eachTile(RING.lo, RING.hi, (x, z) => {
        const inCore = x >= SLIM.lo && x <= SLIM.hi && z >= SLIM.lo && z <= SLIM.hi;
        // Wider than the ramp band itself: open air over the stairs
        // reads better than a plaza lid hanging just above them
        const overLowerRamp = x <= RING.lo + 4; // pre-rot west strip
        if (!inCore && !overLowerRamp) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addAllow(solids, x, z, k, b + SLAB, b + SLAB + 3.5);
          // SUPPORTS under the cantilevered plaza edge. Two styles by
          // what's underneath: stepped CORBELS when the chunk below has
          // a full core to back them; STANDING COLUMNS down onto the
          // lower plaza when the chunk below is a slim-waist terrace —
          // corbels hanging in front of a distant waist look silly.
          const dOut = Math.max(
            x < FULL.lo ? FULL.lo - x : x > FULL.hi ? x - FULL.hi : 0,
            z < FULL.lo ? FULL.lo - z : z > FULL.hi ? z - FULL.hi : 0,
          );
          if (dOut > 0 && b >= 2) {
            const along = (x < FULL.lo || x > FULL.hi) ? z : x;
            // A support may not stand where the stairs climb through it:
            // the ramp clearance punches it away and leaves a floating
            // stub hanging under the rim. Skip those tiles entirely.
            const clears = tileAt(solids, x, z, k).clear;
            const free = (lo: number, hi: number): boolean =>
              !clears.some(([clo, chi]) => chi > lo + 0.01 && clo < hi - 0.01);
            if (below?.def.id === 'terrace') {
              // Colonnade posts stand on the INNER ledge (the ring tile
              // against the core), where the balcony below is solid —
              // out at the rim they hang over the drop
              if (dOut === 1 && along % 5 === 2 && free(below.baseY + SLAB, b)) {
                addSolid(solids, x, z, k, below.baseY + SLAB, b);
              }
            } else if (along % 5 === 2) {
              const depth = dOut === 1 ? 2.5 : dOut === 2 ? 1.5 : 0.75;
              if (free(b - depth, b)) addSolid(solids, x, z, k, b - depth, b);
            }
          }
        }
      });
      break;

    case 'gallery':
      // Hollow hall: full-core walls, floor + ceiling slabs, doorway on
      // the face opposite the ramp (pre-rotation: ramp north, door south)
      eachTile(FULL.lo, FULL.hi, (x, z) => {
        const perimeter = x === FULL.lo || x === FULL.hi || z === FULL.lo || z === FULL.hi;
        if (!perimeter) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addSolid(solids, x, z, k, top - 1, top);
          addAllow(solids, x, z, k, b + SLAB, top - 1);
          return;
        }
        const doorway = z === FULL.hi && x >= DOOR.lo && x <= DOOR.hi;
        if (doorway) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addSolid(solids, x, z, k, b + SLAB + DOOR_HEIGHT, top);
          addAllow(solids, x, z, k, b + SLAB, b + SLAB + DOOR_HEIGHT);
        } else {
          addSolid(solids, x, z, k, b, top);
        }
      });
      // Landing apron outside the doorway so a bridge has footing
      for (let z = FULL.hi + 1; z <= RING.hi; z++) {
        for (let x = DOOR.lo - 1; x <= DOOR.hi + 1; x++) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addAllow(solids, x, z, k, b + SLAB, b + SLAB + 3.5);
        }
      }
      break;

    case 'crown':
      // Solid cap — its top face is the rooftop
      eachTile(FULL.lo, FULL.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      break;

    default: // 'plain' and anything unknown: the full core
      eachTile(FULL.lo, FULL.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      break;
  }
}

function collectSolids(spec: PillarSpec): Map<string, TileSolids> {
  const solids = new Map<string, TileSolids>();
  spec.chunks.forEach((placed, i) => chunkSolids(placed, solids, spec.chunks[i - 1]));
  return solids;
}

/**
 * All local tiles any chunk of this pillar touches — the tiles to mark
 * WALL in the tile grid so 2D generation routes around the pillar.
 */
export function pillarFootprint(spec: PillarSpec): [number, number][] {
  return [...collectSolids(spec).keys()].map((s) => {
    const [x, z] = s.split(',').map(Number);
    return [x!, z!] as [number, number];
  });
}

export interface AirSpanLite {
  floor: number;
  ceil: number;
}

/**
 * Per-tile AIR spans of the pillar, keyed by local "lx,lz". A footprint
 * tile's column is otherwise solid from the foundation to above the
 * crown; these are the habitable gaps (ramps, plazas, interiors,
 * rooftop).
 */
export function pillarAirSpans(
  spec: PillarSpec,
  /** Terrain ground height at a local tile — the rolling surface
   *  continues UNDER the pillar and its foundation rises to meet it, so
   *  the ground-level air floor IS the terrain. Chunks near the base
   *  submerge into rising ground and ramps emerge from hillsides. */
  groundAt?: (lx: number, lz: number) => number,
  /** Local interior roofline at a tile, or null under open sky. ABOVE
   *  the roofline generic between-slab air is CULLED — the pillar is a
   *  solid mass passing through the roof. Reserved clearances (ramps),
   *  allow zones (plazas, interiors, doors), and the crown attic stay
   *  open as enclosed passages. */
  capAt?: (lx: number, lz: number) => number | null,
): Map<string, AirSpanLite[]> {
  const out = new Map<string, AirSpanLite[]>();
  const capTop = spec.totalHeight + CROWN_HEADROOM;
  for (const [k, t] of collectSolids(spec)) {
    const [lx, lz] = k.split(',').map(Number);
    const ground = Math.max(0, groundAt?.(lx!, lz!) ?? 0);
    // Every footprint tile is founded from below the abyss up to the
    // terrain surface — the pillar stands IN the ground, never on a
    // plinth. Air is the complement of the solids within
    // [foundation, capTop]; above capTop stays solid.
    const intervals: [number, number][] = [
      [FOUNDATION_BOTTOM, ground],
      ...t.intervals,
    ];
    intervals.sort((a, b) => a[0] - b[0]);

    // Merge solids…
    let merged: [number, number][] = [];
    for (const [lo, up] of intervals) {
      const prev = merged[merged.length - 1];
      if (prev && lo <= prev[1]) prev[1] = Math.max(prev[1], up);
      else merged.push([lo, up]);
    }
    // …then punch the guaranteed clearances through them. A clearance
    // NEVER cuts below grade: stair headroom is for passing under
    // structure, and letting it reach the foundation excavates a trench
    // in the ground wherever the flight runs below the terrain.
    for (const [clo0, chi] of t.clear) {
      const clo = Math.max(clo0, ground);
      if (chi <= clo + 0.01) continue;
      const next: [number, number][] = [];
      for (const [lo, up] of merged) {
        if (chi <= lo || clo >= up) {
          next.push([lo, up]);
          continue;
        }
        if (lo < clo) next.push([lo, clo]);
        if (up > chi) next.push([chi, up]);
      }
      merged = next;
    }

    let air: AirSpanLite[] = [];
    let hi = FOUNDATION_BOTTOM;
    for (const [lo, up] of merged) {
      if (lo > hi && lo - hi >= MIN_AIR) air.push({ floor: hi, ceil: lo });
      hi = Math.max(hi, up);
    }
    if (capTop - hi >= MIN_AIR) air.push({ floor: hi, ceil: capTop });

    // Roofline cull (interior biomes): the pillar passes through the
    // roof as SOLID. Only air below the roofline, reserved clearances,
    // allow zones, and the crown attic survive above it.
    const cap = capAt?.(lx!, lz!) ?? null;
    if (cap !== null) {
      const allowed: [number, number][] = [
        [FOUNDATION_BOTTOM, cap],
        [spec.totalHeight, capTop],
        ...t.clear,
        ...t.allow,
      ];
      allowed.sort((a, b) => a[0] - b[0]);
      const am: [number, number][] = [];
      for (const [lo, up] of allowed) {
        const prev = am[am.length - 1];
        if (prev && lo <= prev[1]) prev[1] = Math.max(prev[1], up);
        else am.push([lo, up]);
      }
      const culled: AirSpanLite[] = [];
      for (const sp of air) {
        for (const [alo, aup] of am) {
          const f = Math.max(sp.floor, alo);
          const c = Math.min(sp.ceil, aup);
          if (c - f >= MIN_AIR) culled.push({ floor: f, ceil: c });
        }
      }
      air = culled;
    }
    out.set(k, air);
  }
  return out;
}
