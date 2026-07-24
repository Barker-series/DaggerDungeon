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
import {
  CHUNK_BY_ID, CHUNK_LIBRARY,
  type ChunkSocket, type PillarChunkDef, type SocketFace,
} from './pillar-chunks';

// ── The coarse grid ──

/** Dungeon cells per pillar cell (per axis) */
export const PILLAR_FACTOR = 4;
/** Tiles per pillar cell (= PILLAR_FACTOR * dungeon CELL_TILE_SIZE) */
export const PILLAR_CELL_TILES = 56;

// ── Tuning ──

/** Fraction of pillar cells (roughly) with no pillar — void gaps */
const VOID_THRESHOLD = 0.18;
/** Pillar cells per height-noise feature */
const HEIGHT_NOISE_SCALE = 3;
const MIN_HEIGHT = 36;
const MAX_HEIGHT = 80;
const PILLAR_SALT = 4141;

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
  /** PILLAR-grid coordinates */
  cx: number;
  cz: number;
  totalHeight: number;
  chunks: PlacedChunk[];
  sockets: ResolvedSocket[];
}

const FACE_ORDER: readonly SocketFace[] = ['north', 'east', 'south', 'west'];

export function rotateFace(face: SocketFace, quarterTurns: number): SocketFace {
  if (face === 'interior') return face;
  const i = FACE_ORDER.indexOf(face);
  return FACE_ORDER[(i + quarterTurns) % 4]!;
}

/** Sockets a placed chunk exposes, in chunk-local heights */
function chunkSockets(placed: PlacedChunk): ChunkSocket[] {
  const k = placed.rotation;
  switch (placed.def.id) {
    case 'terrace':
      // The plaza ring: bridges and footing on all four faces
      return FACE_ORDER.flatMap((face) => [
        { face, y: 0.5, kind: 'bridge' as const },
        { face, y: 0.5, kind: 'ledge' as const },
      ]);
    case 'gallery':
      // Doorway on the face opposite the ramp
      return [
        { face: rotateFace('north', k + 2), y: 0.5, kind: 'bridge' },
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
  // Density and height come from smooth noise so districts read
  // coherently; composition comes from the cell's own RNG stream.
  const density = sampleNoise(pcx, pcz, worldSeed + 707, HEIGHT_NOISE_SCALE);
  if (density < VOID_THRESHOLD) return null;

  const rng = mulberry32(cellSeed(pcx, pcz, worldSeed, PILLAR_SALT));
  const heightNoise = sampleNoise(pcx, pcz, worldSeed + 909, HEIGHT_NOISE_SCALE);
  const targetHeight = MIN_HEIGHT + heightNoise * (MAX_HEIGHT - MIN_HEIGHT);

  const crown = CHUNK_BY_ID.get('crown')!;
  const pickable = CHUNK_LIBRARY.filter((c) => c.weight > 0);
  const totalWeight = pickable.reduce((s, c) => s + c.weight, 0);
  const pick = (): PillarChunkDef => {
    let r = rng() * totalWeight;
    for (const c of pickable) {
      r -= c.weight;
      if (r <= 0) return c;
    }
    return pickable[pickable.length - 1]!;
  };

  const chunks: PlacedChunk[] = [];
  let y = 0;
  // The spiral: ramp face starts anywhere, advances clockwise per chunk
  let face = Math.floor(rng() * 4);
  while (y + crown.height < targetHeight) {
    const def = pick();
    chunks.push({ def, baseY: y, rotation: face });
    y += def.height;
    face = (face + 1) % 4;
  }
  chunks.push({ def: crown, baseY: y, rotation: face });
  y += crown.height;

  const sockets: ResolvedSocket[] = [];
  chunks.forEach((placed, chunkIndex) => {
    for (const s of chunkSockets(placed)) {
      sockets.push({ ...s, yAbs: placed.baseY + s.y, chunkIndex });
    }
  });

  return { cx: pcx, cz: pcz, totalHeight: y, chunks, sockets };
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
): Map<string, PillarSpec> {
  const field = new Map<string, PillarSpec>();
  for (let cz = cz0; cz < cz1; cz++) {
    for (let cx = cx0; cx < cx1; cx++) {
      const spec = assemblePillar(worldSeed, cx, cz);
      if (spec) field.set(`${cx},${cz}`, spec);
    }
  }
  return field;
}
