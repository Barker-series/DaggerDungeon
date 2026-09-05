/**
 * Pillar layer — assembles one kebab per PILLAR cell.
 *
 * This is a proper LayerProcGen coarse layer: pillars live on their own
 * grid, one pillar cell = PILLAR_FACTOR x PILLAR_FACTOR dungeon cells.
 * The dungeon layers below read the pillar layer's output (footprints)
 * the way LayerProcGen fine layers read coarse ones.
 *
 * INFINITE-WORLD DISCIPLINE (non-negotiable for everything added here
 * and downstream of here):
 *   - A pillar is a PURE FUNCTION of (worldSeed, pcx, pcz). No grid
 *     bounds, no global scans, no shared mutable state. Negative
 *     coordinates are first-class.
 *   - Cross-pillar logic (bridges) may read a bounded neighbor radius
 *     only.
 * A bounded world is just this function evaluated over a window; an
 * infinite world evaluates it lazily around the player. Same function.
 *
 * CLIMBABILITY BY CONSTRUCTION: every chunk carries a ramp up one face,
 * and the ramp face advances one quarter-turn (clockwise) per chunk.
 * Chunk i's ramp ends at the corner where chunk i+1's ramp begins, so
 * the spiral from grade to crown is continuous — never verified,
 * simply unbreakable.
 */

import { cellSeed, mulberry32 } from './rng';
import { sampleNoise } from './noise';
import { regionAtCell } from './region-layer';
import {
  CHUNK_BY_ID, CHUNK_LIBRARY,
  type ChunkSocket, type PillarChunkDef, type SocketFace,
} from './pillar-chunks';
import {
  roomSocketsForChunks,
  type PillarRoomSocket,
} from './pillar-rooms';

// ── The coarse grid ──

/** Dungeon cells per pillar cell (per axis) */
export const PILLAR_FACTOR = 4;
/** Tiles per pillar cell (= PILLAR_FACTOR * dungeon CELL_TILE_SIZE) */
export const PILLAR_CELL_TILES = 56;

// ── Tuning ──

/** Pillar cells per height-noise feature */
const HEIGHT_NOISE_SCALE = 3;
/** Occupancy works at two scales: local variation breaks up silhouettes,
 * while the broad field creates whole clusters and negative-space tracts. */
const OCCUPANCY_LOCAL_SCALE = 1.8;
const OCCUPANCY_MACRO_SCALE = 7;
const MIN_HEIGHT = 36;
const MAX_HEIGHT = 80;
/** HEAVY TAIL — the slab-breakers. A few pillars ignore the common
 *  range: supertowers climbing far beyond the skyline (likelier in
 *  city districts) and wells sinking far below the foundation line
 *  (likelier in machine districts). The megastructure has no uniform
 *  ceiling; render clips derive from what actually got built. */
const TOWER_TAIL_CHANCE = 0.04;
const TOWER_TAIL_MAX_MULT = 3;
const WELL_TAIL_CHANCE = 0.05;
const WELL_TAIL_MAX_MULT = 2.5;
/** Below-grade reach. ~45% of pillars stay surface-only; the rest sink
 *  8..32 units of stacked chunks into the foundation (which bottoms out
 *  at -40, so the deepest shaft keeps margin). */
const DOWN_THRESHOLD = 0.45;
const MAX_DOWN = 32;
const MIN_DOWN = 8;
/** Chance an otherwise-eligible deep pillar builds NOTHING above grade —
 *  a well: crown plinth at the surface, spiral descending below. */
const WELL_CHANCE = 0.15;
/** Rare occupied cells replace the kebab with a true vertical transit shaft. */
const ELEVATOR_SHAFT_CHANCE = 0.06;
const PILLAR_SALT = 4141;

/**
 * The shared ELEVATION field: pillar heights read it, and the biome
 * layer mixes it into wildness so surface districts correlate with the
 * tall-pillar districts the player can see. Continuous pillar-cell
 * coordinates (fractional values sample between cells).
 */
export function elevationField(worldSeed: number, pcx: number, pcz: number): number {
  return sampleNoise(pcx, pcz, worldSeed + 909, HEIGHT_NOISE_SCALE);
}

/**
 * Whether an absolute pillar cell contains a kebab.
 *
 * The grid remains the invisible ownership layer, but no longer dictates a
 * visible checkerboard. Districts compose their mass differently:
 * city clusters around courts, machine districts form broken structural rows,
 * canyons leave broad empty cuts, and frontiers scatter isolated monuments.
 */
export function pillarOccupied(worldSeed: number, pcx: number, pcz: number): boolean {
  const district = regionAtCell(
    worldSeed,
    pcx * PILLAR_FACTOR + Math.floor(PILLAR_FACTOR / 2),
    pcz * PILLAR_FACTOR + Math.floor(PILLAR_FACTOR / 2),
  );
  const local = sampleNoise(pcx, pcz, worldSeed + 707, OCCUPANCY_LOCAL_SCALE);
  const macro = sampleNoise(pcx, pcz, worldSeed + 1707, OCCUPANCY_MACRO_SCALE);

  switch (district) {
    case 'city':
      // Dense blocks separated by coherent courts and demolition tracts.
      return local * 0.55 + macro * 0.45 >= 0.47;
    case 'machine': {
      // Long but broken processional rows. Orientation changes only across
      // broad tracts so the rhythm reads as infrastructure, not a pattern.
      const northSouth = sampleNoise(pcx, pcz, worldSeed + 2707, 12) >= 0.5;
      const axis = northSouth ? pcx : pcz;
      const phase = Math.floor(sampleNoise(pcx, pcz, worldSeed + 3707, 9) * 4);
      const onRow = ((axis + phase) % 4 + 4) % 4 === 0;
      const rowBias = onRow ? 0.78 : 0.25;
      return local * 0.35 + macro * 0.35 + rowBias * 0.3 >= 0.5;
    }
    case 'canyon':
      // Most cells are the cut; surviving mass gathers in chunky escarpments.
      return local * 0.4 + macro * 0.6 >= 0.59;
    case 'roads':
      // Street-vein district: mostly open plane so the carved network reads;
      // rare isolated monuments punctuate the long avenues.
      return local * 0.4 + macro * 0.6 >= 0.74;
    case 'frontier':
      // Looser isolated monuments and small, irregular groups.
      return local * 0.6 + macro * 0.4 >= 0.55;
    case 'fold':
      // Fold district: mostly open plane — the fold architecture is the
      // mass; rare monuments punctuate it.
      return local * 0.4 + macro * 0.6 >= 0.74;
  }
}

// ── Output ──

export interface PlacedChunk {
  def: PillarChunkDef;
  /** Chunk base height above the pillar base (pillar base = 0) */
  baseY: number;
  /** Which face carries this chunk's ramp (quarter-turns clockwise
   *  from north); features rotate with it */
  rotation: number;
}

/** A socket resolved into pillar-local space */
export interface ResolvedSocket extends ChunkSocket {
  /** Absolute height above the pillar base */
  yAbs: number;
  chunkIndex: number;
}

export interface PillarSpec {
  /** WINDOW-LOCAL pillar-grid coordinates (all tile/placement math) */
  cx: number;
  cz: number;
  /** ABSOLUTE pillar-grid coordinates on the infinite plane (all
   *  seeding/sampling — two overlapping windows agree) */
  acx: number;
  acz: number;
  /** Top of the crown, above grade */
  totalHeight: number;
  /** Base of the lowest chunk — 0 for surface-only pillars, negative
   *  when the kebab continues below grade */
  baseDepth: number;
  /** This cell is a purpose-built bottom/ground/crown transit shaft,
   *  replacing the exterior-stair kebab rather than decorating it. */
  elevator: boolean;
  chunks: PlacedChunk[];
  sockets: ResolvedSocket[];
  /** Authored navigation contract for gallery/residential interiors. */
  roomSockets: PillarRoomSocket[];
}

const FACE_ORDER: readonly SocketFace[] = ['north', 'east', 'south', 'west'];

export function rotateFace(face: SocketFace, quarterTurns: number): SocketFace {
  if (face === 'interior') return face;
  // Bit 4 of the rotation encodes a MIRRORED pillar (the spiral winds
  // counterclockwise). Reflection about the pre-rotation x axis swaps
  // east and west before the quarter-turns apply — matching the lx
  // reflection the geometry mapping performs.
  let f = face;
  if (quarterTurns & 4) {
    if (f === 'east') f = 'west';
    else if (f === 'west') f = 'east';
  }
  const i = FACE_ORDER.indexOf(f);
  return FACE_ORDER[(i + (quarterTurns & 3)) % 4]!;
}

/** Sockets a placed chunk exposes, in chunk-local heights */
function chunkSockets(placed: PlacedChunk): ChunkSocket[] {
  // Below-grade chunks expose no sockets: bridges are a surface system
  // (and MIN_BRIDGE_Y would reject them anyway)
  if (placed.baseY < 0) return [];
  const k = placed.rotation;
  switch (placed.def.id) {
    case 'terrace': {
      // The plaza ring: bridges and footing — except on the face where
      // the ramp from the chunk below arrives (the plaza omits its band
      // there so the stairs climb under open air; no landing, no socket)
      const rampFace = rotateFace('west', k);
      return FACE_ORDER.filter((face) => face !== rampFace).flatMap((face) => [
        { face, y: 0.5, kind: 'bridge' as const },
        { face, y: 0.5, kind: 'ledge' as const },
      ]);
    }
    case 'gallery':
    case 'service-gallery':
      // The room entry sits one façade around the ramp's starting corner,
      // reached by its wrapped landing apron. A bridge may share that authored
      // threshold; the interior is never bridge-only.
      return [
        { face: rotateFace('west', k), y: 0.5, kind: 'bridge' },
        { face: 'interior', y: 0.5, kind: 'ledge' },
      ];
    case 'crown':
      return FACE_ORDER.map((face) => (
        { face, y: placed.def.height, kind: 'ledge' as const }
      ));
    default:
      return [];
  }
}

/**
 * The kebab assembler. Returns null for void cells (no pillar).
 * Deterministic in (worldSeed, pcx, pcz) and nothing else.
 */
export function assemblePillar(worldSeed: number, pcx: number, pcz: number): PillarSpec | null {
  if (!pillarOccupied(worldSeed, pcx, pcz)) return null;

  const rng = mulberry32(cellSeed(pcx, pcz, worldSeed, PILLAR_SALT));
  const elevator = mulberry32(cellSeed(pcx, pcz, worldSeed, 8181))() < ELEVATOR_SHAFT_CHANCE;
  const district = regionAtCell(worldSeed, pcx * PILLAR_FACTOR + 2, pcz * PILLAR_FACTOR + 2);
  const heightNoise = elevationField(worldSeed, pcx, pcz);
  let targetHeight = MIN_HEIGHT + heightNoise * (MAX_HEIGHT - MIN_HEIGHT);
  // The DOWN direction has its own smooth field, so sunken districts
  // cluster the way tall districts do
  const downNoise = sampleNoise(pcx, pcz, worldSeed + 606, HEIGHT_NOISE_SCALE);
  let targetDown = downNoise < DOWN_THRESHOLD
    ? 0
    : MIN_DOWN + ((downNoise - DOWN_THRESHOLD) / (1 - DOWN_THRESHOLD)) * (MAX_DOWN - MIN_DOWN);
  // Regional silhouettes need to read from a distance, not merely change
  // decoration odds: cities rise, machines squat and burrow, canyon remnants
  // stand as sparse escarpments, and frontier structures stay lower.
  const heightMult = district === 'city' ? 1.25
    : district === 'machine' ? 0.82
      : district === 'canyon' ? 1.45
        : 0.78;
  const depthMult = district === 'city' ? 0.7
    : district === 'machine' ? 1.5
      : district === 'canyon' ? 0.45
        : 1;
  targetHeight *= heightMult;
  targetDown *= depthMult;
  if (elevator) {
    // A transit shaft needs meaningful vertical territory in both
    // directions even when the surrounding district is low and flat.
    targetHeight = Math.max(targetHeight, 80);
    targetDown = Math.max(targetDown, 28);
  }
  // Heavy tails, weighted by district: the city grows supertowers,
  // the machine sinks the deepest wells. rng draws happen for every
  // pillar so the stream stays aligned regardless of district.
  const towerRoll = rng();
  const towerMult = rng();
  const wellRoll = rng();
  const wellMult = rng();
  const towerChance = TOWER_TAIL_CHANCE * (district === 'city' ? 2 : district === 'canyon' ? 0.5 : 1);
  const wellChance = WELL_TAIL_CHANCE * (district === 'machine' ? 2 : 1);
  if (towerRoll < towerChance) {
    targetHeight *= 1.5 + towerMult * (TOWER_TAIL_MAX_MULT - 1.5);
  }
  if (targetDown > 0 && wellRoll < wellChance) {
    targetDown *= 1.4 + wellMult * (WELL_TAIL_MAX_MULT - 1.4);
  }

  const crown = CHUNK_BY_ID.get('crown')!;
  const pickable = CHUNK_LIBRARY.filter((c) => c.weight > 0);
  // Districts zone their meats: the city stacks compressed residential,
  // the machine favors plain mass and express shafts, the canyon grows
  // plaza terraces. Multipliers, not hard bans — every meat can appear
  // anywhere, the district shifts the odds.
  const DISTRICT_MULT: Record<string, Record<string, number>> = {
    city: { residential: 3, gallery: 1.5, terrace: 1, plain: 0.7, shaft: 0.7, 'crossing-hall': 0.5 },
    machine: { plain: 1.5, shaft: 1.5, gallery: 1, terrace: 0.6, residential: 0.3, 'crossing-hall': 3 },
    canyon: { terrace: 2, plain: 1, shaft: 1, gallery: 0.8, residential: 0.5, 'crossing-hall': 3 },
    frontier: {},
  };
  const mult = DISTRICT_MULT[district] ?? {};
  const weightOf = (c: PillarChunkDef): number => c.weight * (mult[c.id] ?? 1);
  const totalWeight = pickable.reduce((s, c) => s + weightOf(c), 0);
  const pick = (): PillarChunkDef => {
    let r = rng() * totalWeight;
    for (const c of pickable) {
      r -= weightOf(c);
      if (r <= 0) return c;
    }
    return pickable[pickable.length - 1]!;
  };
  // Buried circulation now opens into explorable split-level chambers too.
  // Machine foundations favor them; the bottom chunk stays a plain landing.
  const deepPickable = pickable.filter((c) => c.id === 'plain' || c.id === 'shaft' || c.id === 'crossing-hall');
  if (district === 'machine') deepPickable.push(CHUNK_BY_ID.get('crossing-hall')!);
  const pickDeep = (): PillarChunkDef =>
    deepPickable[Math.floor(rng() * deepPickable.length)]!;

  // A well builds nothing above grade: crown plinth + descent only
  const well = !elevator && targetDown >= MIN_DOWN && rng() < WELL_CHANCE;

  // ── The DOWN section: stacked below grade, chunk boundaries land
  // exactly ON grade so the at-grade chunk owns the ground entry ──
  const downDefs: PillarChunkDef[] = [];
  let depth = 0;
  while (depth < targetDown) {
    const def = downDefs.length === 0 ? CHUNK_BY_ID.get('plain')! : pickDeep();
    downDefs.push(def); // [0] is the BOTTOM chunk — always 'landings'
    depth += def.height;
  }
  const downTotal = downDefs.reduce((a, c) => a + c.height, 0);

  // ── The UP section as before (skipped for wells) ──
  const upDefs: PillarChunkDef[] = [];
  let y = 0;
  if (!well) {
    while (y + crown.height < targetHeight) {
      // Grade is where rolling terrain meets authored structure. Always use
      // the tolerant terrace transfer here; fixed-height gallery/residential
      // doorways start above it instead of being half-buried by the ground.
      const def = upDefs.length === 0 ? CHUNK_BY_ID.get('terrace')! : pick();
      upDefs.push(def);
      y += def.height;
    }
  }
  upDefs.push(crown);

  // ── Stack bottom-to-top with one continuous spiral: the ramp face
  // advances clockwise per chunk across the WHOLE kebab, so the climb
  // from the deepest landing to the crown is unbroken through grade ──
  const allDefs = [...downDefs, ...upDefs];
  const chunks: PlacedChunk[] = [];
  let face = Math.floor(rng() * 4);
  // Half of pillars MIRROR: the spiral winds counterclockwise instead.
  // Uniform chirality was a procedural tell. The mirror is encoded as
  // bit 4 of the rotation, and the whole pre-rotation construction
  // passes through one reflected mapping — continuity holds by the same
  // theorem, reflected. (Drawn AFTER the face roll so earlier draws are
  // untouched: existing pillars keep their composition, only handedness
  // varies.)
  const mirror = rng() < 0.5;
  let base = -downTotal;
  for (const def of allDefs) {
    // Independent same-height variation: no reroll of tower height, chirality,
    // or gallery bridge sockets. Buried machine rooms gain this vocabulary too.
    const serviceChance = district === 'machine' ? 0.75 : district === 'city' ? 0.35 : 0.2;
    const serviceEligible = def.id === 'gallery'
      || (base < 0 && def.id === 'crossing-hall' && district === 'machine');
    const serviceRoll = mulberry32(cellSeed(pcx, pcz, worldSeed, 9393 + Math.round(base * 10)))();
    const placedDef = serviceEligible && serviceRoll < serviceChance
      ? CHUNK_BY_ID.get('service-gallery')! : def;
    chunks.push({ def: placedDef, baseY: base, rotation: face | (mirror ? 4 : 0) });
    base += def.height;
    face = (face + (mirror ? 3 : 1)) % 4;
  }

  const sockets: ResolvedSocket[] = [];
  if (!elevator) {
    chunks.forEach((placed, chunkIndex) => {
      for (const s of chunkSockets(placed)) {
        sockets.push({ ...s, yAbs: placed.baseY + s.y, chunkIndex });
      }
    });
  }

  return {
    cx: pcx, cz: pcz, acx: pcx, acz: pcz,
    totalHeight: base, baseDepth: -downTotal,
    elevator, chunks, sockets,
    roomSockets: elevator ? [] : roomSocketsForChunks(chunks),
  };
}

/**
 * Evaluate the pillar function over a rectangular window of PILLAR
 * cells — how a bounded world (or a streaming frontier) materializes
 * specs. Keyed "pcx,pcz".
 */
export function buildPillarField(
  worldSeed: number,
  cx0: number,
  cz0: number,
  cx1: number,
  cz1: number,
  /** Absolute pillar-cell origin of the window — assembly samples the
   *  infinite plane there while keys/placement stay window-local */
  originPcx = 0,
  originPcz = 0,
): Map<string, PillarSpec> {
  const field = new Map<string, PillarSpec>();
  for (let cz = cz0; cz < cz1; cz++) {
    for (let cx = cx0; cx < cx1; cx++) {
      const spec = assemblePillar(worldSeed, originPcx + cx, originPcz + cz);
      if (spec) {
        spec.cx = cx;
        spec.cz = cz;
        field.set(`${cx},${cz}`, spec);
      }
    }
  }
  return field;
}
