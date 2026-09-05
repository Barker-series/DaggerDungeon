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
import { crossingHallAir, crossingHallRampSurface } from './crossing-hall';
import { serviceGalleryAir } from './service-gallery';
import { frameBuildingAir, FRAME_ROOF_CLEARANCE } from './frame-building';
import {
  isResidentialRoomDoor,
  isWindowBay,
  residentialDoorStart,
  residentialRampSurface,
  ROOM_MODULE,
} from './pillar-rooms';

/** Baseline foundation reach below grade — pillars never float. Deep
 *  wells extend it: the per-pillar bottom is min(this, baseDepth - 8),
 *  so the foundation always continues below the deepest landing. */
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
const RAMP_ENTRY_STEPS = 11;
/** Rise per tread. Engine STEP_UP is 0.65; one tile (3 units) is one
 *  step, so this is as steep as a climbable stair can be here. */
const RAMP_RISE = 0.6;
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
const DOOR_HEIGHT = 4;

/** Rotate a local tile coordinate a quarter-turn clockwise, k times.
 *  Bit 4 of k mirrors the pillar: the pre-rotation x axis reflects, so
 *  the whole construction (ramps, plazas, interiors) winds the other
 *  way — one funnel, one flag. */
function rot(lx: number, lz: number, k: number): [number, number] {
  let x = (k & 4) ? CELL - 1 - lx : lx, z = lz;
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
  /** Structural floors restored after all cross-chunk clearance punches.
   *  Use sparingly for authored transfer landings whose walkable surface is
   *  part of the navigation contract, never for generic room slabs. */
  protected: [number, number][];
  /** PUNCHING clearances — subtracted from the solids AFTER merging.
   *  Ramp headroom cuts through whatever hangs overhead (plaza slabs,
   *  roof plates): the opening is the stair opening. Also count as
   *  allowed zones for the roofline cull. */
  clear: [number, number][];
  /** ALLOW-ONLY zones — exempt from the roofline cull but never punch
   *  solids (a plaza's headroom must not erase the ramp slabs crossing
   *  its own ring). */
  allow: [number, number][];
  /** DEEP clearances — punched like `clear` but NOT clamped to grade:
   *  below-grade chunks live inside the solid foundation, so their air
   *  exists only where these cut it. Also allowed zones for the cull. */
  clearDeep: [number, number][];
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
    t = { intervals: [], protected: [], clear: [], allow: [], clearDeep: [] };
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

function addProtectedSolid(
  solids: Map<string, TileSolids>,
  lx: number, lz: number, k: number,
  lo: number, hi: number,
): void {
  const t = tileAt(solids, lx, lz, k);
  t.intervals.push([lo, hi]);
  t.protected.push([lo, hi]);
}

function addClear(
  solids: Map<string, TileSolids>,
  lx: number, lz: number, k: number,
  lo: number, hi: number,
  deep = false,
): void {
  const t = tileAt(solids, lx, lz, k);
  (deep ? t.clearDeep : t.clear).push([lo, hi]);
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
function rampSolids(
  placed: PlacedChunk,
  solids: Map<string, TileSolids>,
  isFirst = false,
  /** Straddler crowns: no climb — the band is a flat sheltered landing
   *  at the chunk base and the tower continues up as solid mass. */
  flatten = false,
): void {
  const b = placed.baseY;
  const h = flatten ? 0 : placed.def.height;
  const k = placed.rotation;
  const run = RING.hi - RING.lo; // tiles available across the band
  // STAIRS, NOT A SLOPE. Spreading the chunk height across the whole
  // band gave a 0.27 rise per 3-unit tread — a 1:11 ramp with lips,
  // which is what it looked like. A flight climbs at a FIXED stair
  // rise instead and lands out when it reaches the chunk top; the band
  // is a budget, not a slope to fill. RAMP_RISE is the steepest tread
  // the player can actually mount (engine STEP_UP is 0.65), and one
  // tile is one step because the column model holds one span per tile.
  const rise = RAMP_RISE;
  // Below-grade chunks carve their air out of the solid foundation:
  // their clears must NOT clamp to grade
  const deep = b < 0;
  const first = isFirst ? -RAMP_ENTRY_STEPS : 0;
  // Terraces are circulation transfers, not just another piece of the
  // exterior flight. Hold a full six-tile landing flat so the player can
  // enter/leave the plaza deliberately before the stair starts climbing.
  // Other chunks retain the three-tile corner handoff required by the
  // continuous spiral.
  const landingEnd = placed.def.id === 'terrace'
    ? ROOM_MODULE.stairLandingTiles - 1
    : 2;
  for (let i = first; i <= run; i++) {
    // The first 3 treads stay FLAT at the chunk base: that entry landing
    // is what merges with the previous chunk's exit landing in the shared
    // 3x3 corner square. Both corner squares must stay flat — a climbing
    // tread there gets erased by the neighbor flight's headroom punch.
    const surface = placed.def.id === 'residential'
      ? residentialRampSurface(b, i)
      : placed.def.id === 'crossing-hall'
        ? crossingHallRampSurface(b, i)
        : b + Math.min(h, Math.max(0, i - landingEnd) * rise);
    const clearTop = Math.min(surface + RAMP_CLEARANCE, b + h + LANDING_CLEARANCE);
    for (let z = RING.lo; z <= RING.lo + 2; z++) {
      addSolid(solids, RING.lo + i, z, k, surface - RAMP_SLAB, surface);
      addClear(solids, RING.lo + i, z, k, surface, clearTop, deep);
    }
  }
}

/** Flat wrapped entry shared by the public and service galleries. */
function galleryEntryApron(placed: PlacedChunk, solids: Map<string, TileSolids>): void {
  const b = placed.baseY, k = placed.rotation;
  // Keep only the inner strip: a wide apron would cross the arriving flight.
  for (let z = FULL.lo; z < FULL.lo + 2 + ROOM_MODULE.doorTiles; z++) {
    const x = FULL.lo - 1;
    addProtectedSolid(solids, x, z, k, b, b + SLAB);
    addClear(solids, x, z, k, b + SLAB, b + SLAB + 3.5, b < 0);
    addAllow(solids, x, z, k, b + SLAB, b + SLAB + 3.5);
  }
}

function chunkSolids(
  placed: PlacedChunk,
  solids: Map<string, TileSolids>,
  below?: PlacedChunk,
  flattenRamp = false,
): void {
  const b = placed.baseY;
  const k = placed.rotation;
  const top = b + placed.def.height;

  rampSolids(placed, solids, placed.baseY === 0, flattenRamp);

  switch (placed.def.id) {
    case 'crossing-hall':
    case 'service-gallery': {
      // Compile local air plans to solids. Deep rooms cut only their declared
      // air through the foundation; ordinary rooms reserve it against culling.
      const service = placed.def.id === 'service-gallery';
      for (let z = FULL.lo; z <= FULL.hi; z++) for (let x = FULL.lo; x <= (service ? 40 : FULL.hi); x++) {
        const air = service ? serviceGalleryAir(x, z) : crossingHallAir(x, z);
        if (air === undefined) continue;
        let cursor = b;
        for (const [floor, ceil] of air) {
          if (b + floor > cursor) addSolid(solids, x, z, k, cursor, b + floor);
          if (b < 0) addClear(solids, x, z, k, b + floor, b + ceil, true);
          else addAllow(solids, x, z, k, b + floor, b + ceil);
          cursor = b + ceil;
        }
        if (cursor < top) addSolid(solids, x, z, k, cursor, top);
      }
      if (service) galleryEntryApron(placed, solids);
      break;
    }

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
      // Tall public hall. The flat stair landing turns the near corner and
      // enters through the adjacent west façade. Putting the opening directly
      // in the ramp-face corner made it read as an accidental hole; this gives
      // it a real approach and a full wall bay. It never depends on a bridge.
      eachTile(FULL.lo, FULL.hi, (x, z) => {
        const perimeter = x === FULL.lo || x === FULL.hi || z === FULL.lo || z === FULL.hi;
        if (!perimeter) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addSolid(solids, x, z, k, top - 1, top);
          addAllow(solids, x, z, k, b + SLAB, top - 1);
          return;
        }
        const doorway = x === FULL.lo
          && z >= FULL.lo + 2
          && z < FULL.lo + 2 + ROOM_MODULE.doorTiles;
        if (doorway) {
          addSolid(solids, x, z, k, b, b + SLAB);
          addSolid(solids, x, z, k, b + SLAB + DOOR_HEIGHT, top);
          addAllow(solids, x, z, k, b + SLAB, b + SLAB + DOOR_HEIGHT);
        } else if (
          (z === FULL.hi && isWindowBay(x, FULL.lo, FULL.hi))
          || ((x === FULL.lo || x === FULL.hi) && isWindowBay(z, FULL.lo, FULL.hi))
        ) {
          const sill = b + SLAB + ROOM_MODULE.windowSill;
          const head = Math.min(top - 1, sill + ROOM_MODULE.windowHeight);
          addSolid(solids, x, z, k, b, sill);
          addSolid(solids, x, z, k, head, top);
          addAllow(solids, x, z, k, sill, head);
        } else {
          addSolid(solids, x, z, k, b, top);
        }
      });
      // The spiral owns its 3x3 corner landing. From its inside edge, a flat
      // structural apron wraps to the west-façade doorway. The apron is a
      // protected navigation transfer: another chunk's broad headroom punch
      // may clear above it, but may not erase its floor.
      galleryEntryApron(placed, solids);
      break;

    case 'residential': {
      // Repeated residential modules: each storey has a two-tile central
      // corridor and two large room wings, with paired internal doors and
      // exterior window bays. Every storey still opens where the exterior
      // stair passes its floor, but the opening now feeds real circulation
      // instead of an undivided empty plate.
      const PITCH = ROOM_MODULE.storeyPitch;
      const floors = Math.floor((placed.def.height - 1) / PITCH); // roof takes the rest
      const deepRes = b < 0;
      eachTile(FULL.lo, FULL.hi, (x, z) => {
        const perimeter = x === FULL.lo || x === FULL.hi || z === FULL.lo || z === FULL.hi;
        for (let f = 0; f < floors; f++) {
          const fy = b + f * PITCH;
          if (perimeter) {
            // Band-side doorway slit: where the flight outside is within
            // a step of this floor, the wall opens (pre-rot north face,
            // z = FULL.lo — the ramp band runs just outside it)
            const doorStart = residentialDoorStart(f);
            const door = z === FULL.lo && x >= doorStart
              && x < doorStart + ROOM_MODULE.doorTiles;
            if (door) {
              addSolid(solids, x, z, k, fy, fy + SLAB);
              addClear(solids, x, z, k, fy + SLAB, fy + PITCH, deepRes);
            } else if (
              (z === FULL.hi && isWindowBay(x, FULL.lo, FULL.hi))
              || ((x === FULL.lo || x === FULL.hi) && isWindowBay(z, FULL.lo, FULL.hi))
            ) {
              const sill = fy + SLAB + ROOM_MODULE.windowSill;
              const head = Math.min(fy + PITCH, sill + ROOM_MODULE.windowHeight);
              addSolid(solids, x, z, k, fy, sill);
              addSolid(solids, x, z, k, head, fy + PITCH);
              addClear(solids, x, z, k, sill, head, deepRes);
            } else {
              addSolid(solids, x, z, k, fy, fy + PITCH);
            }
          } else {
            addSolid(solids, x, z, k, fy, fy + SLAB);
            // Two walls bound a continuous north/south corridor. Paired
            // door openings lead into both room wings.
            const partition = x === 26 || x === 29;
            if (partition && !isResidentialRoomDoor(z, FULL.lo)) {
              addSolid(solids, x, z, k, fy + SLAB, fy + PITCH);
            }
            if (deepRes) addClear(solids, x, z, k, fy + SLAB, fy + PITCH, true);
            else addAllow(solids, x, z, k, fy + SLAB, fy + PITCH);
          }
        }
        // Roof plate seals the top stratum to the chunk top
        addSolid(solids, x, z, k, b + floors * PITCH, top);
      });
      break;
    }

    case 'vent': {
      // Full core threaded by a crawl duct: north-south at x 27-28,
      // 2.0 tall off the chunk base. Both ends open through the faces.
      const deepV = b < 0;
      eachTile(FULL.lo, FULL.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      for (let z = FULL.lo; z <= FULL.hi; z++) {
        for (const x of [27, 28]) {
          addClear(solids, x, z, k, b + SLAB, b + SLAB + 2, deepV);
        }
      }
      break;
    }

    case 'crown':
      // Solid cap — its top face is the rooftop
      eachTile(FULL.lo, FULL.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      break;

    default: // 'plain' and anything unknown: the full core
      eachTile(FULL.lo, FULL.hi, (x, z) => addSolid(solids, x, z, k, b, top));
      break;
  }
}

function collectSolids(spec: PillarSpec, flattenCrownRamp = false): Map<string, TileSolids> {
  if (spec.elevator) return collectElevatorSolids(spec);
  const solids = new Map<string, TileSolids>();
  if (spec.frame) {
    eachTile(RING.lo, RING.hi, (x,z) => {
      let cursor = spec.baseDepth - 2;
      for (const [floor,ceil] of frameBuildingAir(spec.frame!,x,z,flattenCrownRamp)) {
        if (floor > cursor) addSolid(solids,x,z,spec.frame!.rotation,cursor,floor);
        if (floor < 0) addClear(solids,x,z,spec.frame!.rotation,floor,ceil,true);
        else addAllow(solids,x,z,spec.frame!.rotation,floor,ceil);
        cursor = ceil;
      }
      const cap = spec.totalHeight + FRAME_ROOF_CLEARANCE;
      if (cursor < cap) addSolid(solids,x,z,spec.frame!.rotation,cursor,cap);
    });
    return solids;
  }
  spec.chunks.forEach((placed, i) => chunkSolids(
    placed, solids, spec.chunks[i - 1],
    flattenCrownRamp && i === spec.chunks.length - 1,
  ));
  return solids;
}

/**
 * A real transit-shaft pillar: solid structural mass around a continuous
 * central hoistway, a ground entrance lobby, a bottom service lobby, and an
 * open crown stop. There is deliberately no exterior spiral staircase.
 */
function collectElevatorSolids(spec: PillarSpec): Map<string, TileSolids> {
  const solids = new Map<string, TileSolids>();
  const shaft = { lo: 26, hi: 29 };
  const bottom = spec.baseDepth + SLAB;
  const top = spec.totalHeight + CROWN_HEADROOM;

  eachTile(FULL.lo, FULL.hi, (x, z) => {
    addSolid(solids, x, z, 0, spec.baseDepth, spec.totalHeight);
    if (x >= shaft.lo && x <= shaft.hi && z >= shaft.lo && z <= shaft.hi) {
      addClear(solids, x, z, 0, bottom, top, true);
    }
  });

  // Ground lobby: a two-tile corridor from the west façade to the shaft,
  // plus a three-tile exterior threshold. Its 0.5-high plate meets the
  // elevator's ground stop exactly.
  for (let z = 27; z <= 28; z++) {
    for (let x = RING.lo; x <= shaft.hi; x++) {
      addSolid(solids, x, z, 0, 0, SLAB);
      addClear(solids, x, z, 0, SLAB, SLAB + 4.5, true);
      addAllow(solids, x, z, 0, SLAB, SLAB + 4.5);
    }
  }

  // Bottom service lobby is internal for now; later rail/service modules can
  // claim its west socket without changing the elevator's vertical contract.
  for (let z = 27; z <= 28; z++) {
    for (let x = FULL.lo; x <= shaft.hi; x++) {
      addClear(solids, x, z, 0, bottom, bottom + 4.5, true);
    }
  }
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
  /** Straddler pillars: the crown ramp does not climb — the spiral tops
   *  out at a sheltered landing at crown base and the tower continues
   *  up as one solid mass into the boundary cliff. */
  flattenCrownRamp = false,
): Map<string, AirSpanLite[]> {
  const out = new Map<string, AirSpanLite[]>();
  const capTop = spec.totalHeight + (spec.frame ? FRAME_ROOF_CLEARANCE : CROWN_HEADROOM);
  const foundationBottom = Math.min(FOUNDATION_BOTTOM, spec.baseDepth - 8);
  for (const [k, t] of collectSolids(spec, flattenCrownRamp)) {
    const [lx, lz] = k.split(',').map(Number);
    const ground = Math.max(0, groundAt?.(lx!, lz!) ?? 0);
    // Every footprint tile is founded from below the abyss up to the
    // terrain surface — the pillar stands IN the ground, never on a
    // plinth. Air is the complement of the solids within
    // [foundation, capTop]; above capTop stays solid.
    const intervals: [number, number][] = [
      [foundationBottom, ground],
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
    // Deep clears cut the foundation itself (floored well above the
    // render abyss); surface clears never cut below grade.
    const punches: [number, number][] = [
      ...t.clear.map(([lo, hi]) => [Math.max(lo, ground), hi] as [number, number]),
      ...t.clearDeep.map(([lo, hi]) => [Math.max(lo, foundationBottom + 4), hi] as [number, number]),
    ];
    for (const [clo, chi] of punches) {
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
    // Reapply the very small set of authored navigation floors after every
    // chunk has contributed its clearances. This gives composition an
    // explicit priority rule instead of relying on generation order.
    if (t.protected.length > 0) {
      merged.push(...t.protected);
      merged.sort((a, b) => a[0] - b[0]);
      const restored: [number, number][] = [];
      for (const [lo, up] of merged) {
        const prev = restored[restored.length - 1];
        if (prev && lo <= prev[1]) prev[1] = Math.max(prev[1], up);
        else restored.push([lo, up]);
      }
      merged = restored;
    }

    let air: AirSpanLite[] = [];
    let hi = foundationBottom;
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
        [foundationBottom, cap],
        [spec.totalHeight, capTop],
        ...t.clear,
        ...t.clearDeep,
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
