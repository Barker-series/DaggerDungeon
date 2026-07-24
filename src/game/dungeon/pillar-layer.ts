/**
 * Pillar layer — assembles one kebab per cell.
 *
 * INFINITE-WORLD DISCIPLINE (non-negotiable for everything added here
 * and downstream of here):
 *   - A pillar is a PURE FUNCTION of (worldSeed, cx, cz). No grid
 *     bounds, no global scans, no "farthest cell", no shared mutable
 *     state. Negative coordinates are first-class.
 *   - Cross-pillar logic (bridges, next phase) may read a bounded
 *     neighbor radius only.
 * A bounded world is just this function evaluated over a window; an
 * infinite world evaluates it lazily around the player. Same function.
 *
 * Phase 1 is DATA ONLY: specs feed the debug map. Geometry, column
 * spans, and bridges consume the same specs in later phases.
 */

import { cellSeed, mulberry32 } from './rng';
import { sampleNoise } from './noise';
import {
  CHUNK_BY_ID, CHUNK_LIBRARY,
  type ChunkSocket, type PillarChunkDef, type SocketFace,
} from './pillar-chunks';

// ── Tuning ──

/** Fraction of cells (roughly) that carry no pillar — open void gaps */
const VOID_THRESHOLD = 0.3;
/** Cells per pillar-height noise feature — neighbors trend together so
 *  the skyline rolls instead of strobing */
const HEIGHT_NOISE_SCALE = 5;
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 64;

// ── Output ──

export interface PlacedChunk {
  def: PillarChunkDef;
  /** Chunk base height above the pillar base (pillar base = 0) */
  baseY: number;
  /** Quarter-turns applied to the def's socket faces (0-3, clockwise) */
  rotation: number;
}

/** A def socket resolved into pillar-local space */
export interface ResolvedSocket extends ChunkSocket {
  /** Absolute height above the pillar base */
  yAbs: number;
  chunkIndex: number;
}

export interface PillarSpec {
  cx: number;
  cz: number;
  totalHeight: number;
  chunks: PlacedChunk[];
  sockets: ResolvedSocket[];
}

// ── The pure function ──

const PILLAR_SALT = 4141;

const FACE_ORDER: readonly SocketFace[] = ['north', 'east', 'south', 'west'];

function rotateFace(face: SocketFace, quarterTurns: number): SocketFace {
  if (face === 'interior') return face;
  const i = FACE_ORDER.indexOf(face);
  return FACE_ORDER[(i + quarterTurns) % 4]!;
}

/**
 * The kebab assembler. Returns null for void cells (no pillar).
 * Deterministic in (worldSeed, cx, cz) and nothing else.
 */
export function assemblePillar(worldSeed: number, cx: number, cz: number): PillarSpec | null {
  // Density and height come from smooth noise so neighborhoods read as
  // districts; everything else comes from the cell's own RNG stream.
  const density = sampleNoise(cx, cz, worldSeed + 707, HEIGHT_NOISE_SCALE);
  if (density < VOID_THRESHOLD) return null;

  const rng = mulberry32(cellSeed(cx, cz, worldSeed, PILLAR_SALT));
  const heightNoise = sampleNoise(cx, cz, worldSeed + 909, HEIGHT_NOISE_SCALE);
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
  let prevId = '';
  while (y + crown.height < targetHeight) {
    let def = pick();
    // No two identical featureless shafts in a row — kebabs stay varied
    if (def.id === prevId && def.id === 'shaft') def = pick();
    chunks.push({ def, baseY: y, rotation: Math.floor(rng() * 4) });
    y += def.height;
    prevId = def.id;
  }
  chunks.push({ def: crown, baseY: y, rotation: Math.floor(rng() * 4) });
  y += crown.height;

  const sockets: ResolvedSocket[] = [];
  chunks.forEach((placed, chunkIndex) => {
    for (const s of placed.def.sockets) {
      sockets.push({
        ...s,
        face: rotateFace(s.face, placed.rotation),
        yAbs: placed.baseY + s.y,
        chunkIndex,
      });
    }
  });

  return { cx, cz, totalHeight: y, chunks, sockets };
}

/**
 * Evaluate the pillar function over a rectangular window — how a bounded
 * world (or a streaming frontier) materializes specs. Keyed "cx,cz".
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
