/**
 * Whole-building architecture, not another exterior-ramp chunk.
 * Unequal occupied wings, a tall open atrium, supported floor/beam bands,
 * an internal switchback core, and selected transfer-level bridge portals.
 * The entire plan is owned by one absolute pillar cell. No neighbor reads,
 * renderer state, or window coordinates participate in its composition.
 */
import type { PillarSpec, PlacedChunk, ResolvedSocket } from './pillar-layer';
import type { PillarRoomSocket } from './pillar-rooms';
import type { SocketFace } from './pillar-chunks';

export const FRAME_PITCH = 9;
export const FRAME_SLAB = 1.5;
export const FRAME_ROOF_CLEARANCE = 6;
/** A fixed opening proportion for the taller occupied storeys; width stays
 *  two tiles and the remaining lintel/floor band stays structural. */
export const FRAME_DOOR_HEIGHT = 6;
const BEAM_DEPTH = 2.5;
const MIN_AIR = 1.5;
const POSTS = [15, 20, 25, 31, 36, 40];
const FACES: SocketFace[] = ['north', 'east', 'south', 'west'];

export interface FrameBuildingPlan {
  aboveLevels: number;
  belowLevels: number;
  southLevels: number;
  setbackLevel: number;
  rotation: number;
  industrial: boolean;
}

export function createFramePlan(
  height: number,
  depth: number,
  rotation: number,
  industrial: boolean,
): FrameBuildingPlan {
  const aboveLevels = Math.max(4, Math.ceil(height / FRAME_PITCH));
  return {
    aboveLevels,
    belowLevels: Math.max(0, Math.ceil(depth / FRAME_PITCH)),
    southLevels: Math.max(2, Math.floor(aboveLevels * 0.65)),
    setbackLevel: Math.max(3, aboveLevels - 3),
    rotation: rotation & 3,
    industrial,
  };
}

export function frameFloorY(level: number): number {
  return level * FRAME_PITCH + 0.5;
}

function transferLevel(p: FrameBuildingPlan, level: number): boolean {
  return level >= 2 && level <= p.southLevels && (level - 2) % (p.industrial ? 4 : 3) === 0;
}

/** Horizontal floor mass at a storey. Roof terraces occupy the last floor
 *  of a retreating wing; they do not hang beyond unsupported upper rooms. */
export function framePlatformAt(
  p: FrameBuildingPlan,
  x: number,
  z: number,
  level: number,
): boolean {
  if (x < 14 || x > 41 || z < 14 || z > 41 || level < -p.belowLevels || level > p.aboveLevels)
    return false;
  if (level <= 0 || x <= 26) return true;
  const occupied = level >= 2 && (!p.industrial || level % 2 === 0);
  if (z <= 21) {
    const maxX = level <= p.setbackLevel ? 41 : 36;
    return x <= maxX && (occupied || level === p.aboveLevels || level === p.setbackLevel);
  }
  if (z >= 34) return level <= p.southLevels && (occupied || level === p.southLevels);
  return transferLevel(p, level) && ((x >= 33 && x <= 35) || (x >= 35 && z >= 26 && z <= 29));
}

function rotate(x: number, z: number, k: number): [number, number] {
  for (let i = 0; i < k; i++) [x, z] = [55 - z, x];
  return [x, z];
}

function pierAt(x: number, z: number): boolean {
  const corner = (x <= 15 || x >= 40) && (z <= 15 || z >= 40);
  return (
    corner ||
    ((z === 14 || z === 21 || z === 34 || z === 41) && POSTS.includes(x)) ||
    ((x === 14 || x === 41) && POSTS.includes(z))
  );
}

/** Air within the authored building envelope. The caller compiles it into
 *  the normal pillar columns, including deep foundation excavation. */
export function frameBuildingAir(
  p: FrameBuildingPlan,
  x: number,
  z: number,
  roofClosed = false,
): [number, number][] {
  const bottom = frameFloorY(-p.belowLevels);
  const top = frameFloorY(p.aboveLevels);
  const cap = top + FRAME_ROOF_CLEARANCE;
  const solids: [number, number][] = [];
  const slab = (y: number, depth = FRAME_SLAB): void => {
    solids.push([y - depth, y]);
  };
  const inCore = x >= 18 && x <= 23 && z >= 18 && z <= 29;
  const coreWall = x >= 17 && x <= 24 && z >= 17 && z <= 30 && !inCore;

  if (inCore) {
    // A taller storey needs more treads, not larger risers. Seven rises on
    // the outward flight and eight on the return keep the fixed 0.6 step;
    // the final outward tread joins a generous flat turning landing.
    slab(bottom);
    const lastFlight = p.aboveLevels - (roofClosed ? 2 : 1);
    for (let level = -p.belowLevels; level <= lastFlight; level++) {
      const y = frameFloorY(level);
      if (z <= 19) slab(y);
      else if (z >= 28) slab(y + 4.2);
      else if (x <= 19) slab(y + Math.min(7, z - 19) * 0.6);
      else if (x >= 22) slab(y + 4.2 + (28 - z) * 0.6);
    }
    // Only the arrival landing closes the top. A plate over the entire well
    // would block the last flight; the surrounding roof is reached here.
    if (z <= 19 || (x >= 22 && z === 20)) slab(frameFloorY(p.aboveLevels - (roofClosed ? 1 : 0)));
    if (roofClosed) solids.push([top - FRAME_SLAB, cap]);
  } else {
    const levels: number[] = [];
    for (let level = -p.belowLevels; level <= p.aboveLevels; level++) {
      if (!framePlatformAt(p, x, z, level)) continue;
      levels.push(level);
      const beam = (x >= 27 && z >= 22 && z <= 33) || POSTS.includes(x);
      slab(frameFloorY(level), beam ? BEAM_DEPTH : FRAME_SLAB);
    }
    if (pierAt(x, z) && levels.length) {
      solids.push([bottom - FRAME_SLAB, frameFloorY(levels[levels.length - 1]!)]);
    } else if (coreWall) {
      for (let level = -p.belowLevels; level < p.aboveLevels; level++) {
        const y = frameFloorY(level);
        // One deliberate landing entrance per storey, opening onto the
        // atrium-side internal circulation spine.
        const door = x === 24 && (z === 18 || z === 19);
        solids.push([door ? y + FRAME_DOOR_HEIGHT : y, frameFloorY(level + 1)]);
      }
    } else {
      // Occupied room bays behind the open/recessed facade galleries. Fixed
      // door sizes; thick crosswalls carry the floors instead of perforating
      // an otherwise featureless perimeter with deep tiny windows.
      const backWall = (z === 18 || z === 37) && x >= 27;
      const partition = (x === 31 || x === 36) && ((z >= 15 && z <= 17) || (z >= 38 && z <= 40));
      const door = [27, 28, 32, 33, 37, 38].includes(x);
      if (backWall || partition) {
        for (let i = 0; i + 1 < levels.length; i++) {
          const level = levels[i]!;
          if (level === 0) continue; // double-height entrance lobby
          const y = frameFloorY(level);
          solids.push([backWall && door ? y + FRAME_DOOR_HEIGHT : y, frameFloorY(levels[i + 1]!)]);
        }
      }
    }
  }

  solids.sort((a, b) => a[0] - b[0]);
  const air: [number, number][] = [];
  let cursor = bottom;
  for (const [lo, hi] of solids) {
    if (lo - cursor >= MIN_AIR) air.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cap - cursor >= MIN_AIR) air.push([cursor, cap]);
  return air;
}

export function createFrameSpec(frame: FrameBuildingPlan, pcx: number, pcz: number): PillarSpec {
  const chunks: PlacedChunk[] = [];
  const sockets: ResolvedSocket[] = [];
  const roomSockets: PillarRoomSocket[] = [];
  const publish = (x: number, z: number, level: number, role: 'entry' | 'room'): void => {
    const [lx, lz] = rotate(x, z, frame.rotation);
    roomSockets.push({ lx, lz, y: frameFloorY(level), group: `frame-${level}`, role });
  };
  for (let level = -frame.belowLevels; level < frame.aboveLevels; level++) {
    chunks.push({
      def: {
        id: frame.industrial ? 'frame-machine-storey' : 'frame-atrium-storey',
        height: FRAME_PITCH,
        weight: 0,
      },
      baseY: level * FRAME_PITCH,
      rotation: frame.rotation,
    });
    publish(22, 18, level, 'entry');
    publish(25, 20, level, 'room');
    publish(25, 29, level, 'room');
    for (const [x, z] of [
      [30, 19],
      [30, 35],
      [28, 16],
      [33, 16],
      [38, 16],
      [28, 39],
      [33, 39],
      [38, 39],
      [39, 19],
    ]) {
      if (framePlatformAt(frame, x!, z!, level)) publish(x!, z!, level, 'room');
    }
    if (transferLevel(frame, level)) {
      publish(34, 28, level, 'room');
      publish(41, 28, level, 'room');
      for (const face of FACES) {
        const rotatedFace = FACES[(FACES.indexOf(face) + frame.rotation) % 4]!;
        sockets.push({
          face: rotatedFace,
          y: 0.5,
          yAbs: frameFloorY(level),
          kind: 'bridge',
          chunkIndex: level + frame.belowLevels,
        });
      }
    }
  }
  chunks.push({
    def: { id: 'frame-roof', height: 0.5, weight: 0 },
    baseY: frame.aboveLevels * FRAME_PITCH,
    rotation: frame.rotation,
  });
  return {
    cx: pcx,
    cz: pcz,
    acx: pcx,
    acz: pcz,
    elevator: false,
    frame,
    chunks,
    sockets,
    roomSockets,
    totalHeight: frameFloorY(frame.aboveLevels),
    baseDepth: -frame.belowLevels * FRAME_PITCH,
  };
}
