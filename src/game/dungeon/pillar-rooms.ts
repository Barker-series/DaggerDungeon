/**
 * Pillar interior module grammar.
 *
 * One procedural tile is 3 world units. These dimensions are deliberately
 * shared by every room layout so authored replacements can target a stable
 * kit instead of reverse-engineering arbitrary holes in the pillar mass.
 */

import type { PlacedChunk } from './pillar-layer';

export const ROOM_MODULE = {
  /** Structural perimeter/partition thickness. */
  wallTiles: 1,
  /** Clear door width: 6 world units. */
  doorTiles: 2,
  /** Clear window width: 6 world units. */
  windowTiles: 2,
  /** Repeating façade/room bay: 15 world units. */
  bayTiles: 5,
  /** Main internal circulation width: 6 world units. */
  corridorTiles: 2,
  /** Flat stair-to-room/plaza transfer zone: 18 world units. */
  stairLandingTiles: 6,
  /** Residential floor-to-floor height. */
  storeyPitch: 4.5,
  /** Concrete floor plate thickness. */
  slabHeight: 0.5,
  /** Window sill above the walk surface. */
  windowSill: 1.25,
  /** Window opening height. */
  windowHeight: 2,
} as const;

export type PillarRoomLayoutId = 'gallery-hall' | 'residential-corridor';

export interface PillarRoomLayout {
  id: PillarRoomLayoutId;
  description: string;
  /** Minimum clear interior dimensions, excluding the perimeter wall. */
  clearWidthTiles: number;
  clearDepthTiles: number;
  /** Every layout entry is required to meet the exterior stair. */
  entry: 'stair-landing';
  windows: boolean;
}

export interface PillarRoomSocket {
  /** Pillar-local tile coordinate after chunk rotation. */
  lx: number;
  lz: number;
  /** Absolute height within the pillar. */
  y: number;
  /** Sockets in one group must be mutually reachable. */
  group: string;
  role: 'entry' | 'room';
}

/**
 * This is the start of the authored room library. Geometry code consumes
 * these contracts; later GLB modules can implement the same dimensions and
 * sockets without changing world generation.
 */
export const PILLAR_ROOM_LIBRARY: readonly PillarRoomLayout[] = [
  {
    id: 'gallery-hall',
    description: 'One tall public hall entered directly from the stair landing.',
    clearWidthTiles: 20,
    clearDepthTiles: 20,
    entry: 'stair-landing',
    windows: true,
  },
  {
    id: 'residential-corridor',
    description: 'Two-room wings served by a continuous central corridor.',
    clearWidthTiles: 20,
    clearDepthTiles: 20,
    entry: 'stair-landing',
    windows: true,
  },
] as const;

/** Repeating two-tile façade openings, kept away from structural corners. */
export function isWindowBay(
  coordinate: number,
  wallLo: number,
  wallHi: number,
): boolean {
  const inset = coordinate - wallLo;
  if (inset < 3 || coordinate > wallHi - 3) return false;
  return inset % ROOM_MODULE.bayTiles < ROOM_MODULE.windowTiles;
}

/** Two paired doors from a central corridor into the room wings. */
export function isResidentialRoomDoor(z: number, wallLo: number): boolean {
  const local = z - wallLo;
  return (local >= 5 && local < 5 + ROOM_MODULE.doorTiles)
    || (local >= 14 && local < 14 + ROOM_MODULE.doorTiles);
}

/** North-façade two-tile doorway aligned with each authored stair landing. */
export function residentialDoorStart(floorIndex: number): number {
  return floorIndex === 0 ? 18 : 28;
}

/**
 * Two-storey residential stair profile. Landings are deliberate flat
 * transfers; the remaining treads use the standard 0.6 rise and reach the
 * 10-unit chunk top with a final shared-corner landing.
 */
export function residentialRampSurface(baseY: number, i: number): number {
  if (i <= 2) return baseY;
  if (i <= 5) return baseY + ROOM_MODULE.slabHeight;
  if (i <= 13) return baseY + Math.min(5, 0.5 + (i - 5) * 0.6);
  if (i <= 15) return baseY + 5;
  if (i <= 24) return baseY + Math.min(10, 5 + (i - 15) * 0.6);
  return baseY + 10;
}

function rotateTile(lx: number, lz: number, quarterTurns: number): [number, number] {
  let x = lx;
  let z = lz;
  for (let i = 0; i < (quarterTurns & 3); i++) {
    const nextX = 55 - z;
    z = x;
    x = nextX;
  }
  return [x, z];
}

/**
 * Navigation sockets published by the authored graybox layouts. These are
 * generation data, not inferred afterward from rendered triangles.
 */
export function roomSocketsForChunks(chunks: readonly PlacedChunk[]): PillarRoomSocket[] {
  const sockets: PillarRoomSocket[] = [];
  chunks.forEach((placed, chunkIndex) => {
    const publish = (
      lx: number,
      lz: number,
      y: number,
      group: string,
      role: PillarRoomSocket['role'],
    ): void => {
      const [x, z] = rotateTile(lx, lz, placed.rotation);
      sockets.push({ lx: x, lz: z, y, group, role });
    };

    if (placed.def.id === 'gallery') {
      const group = `gallery-${chunkIndex}`;
      // Start on the guaranteed interior threshold and require the exterior
      // apron as one of the reachable authored targets.
      publish(18, 19, placed.baseY + ROOM_MODULE.slabHeight, group, 'entry');
      // The spiral's shared corner landing is guaranteed by construction;
      // the wrapped apron must connect the doorway to this stable anchor.
      publish(16, 16, placed.baseY, group, 'room');
      publish(27, 27, placed.baseY + ROOM_MODULE.slabHeight, group, 'room');
    } else if (placed.def.id === 'residential') {
      const floors = Math.floor((placed.def.height - 1) / ROOM_MODULE.storeyPitch);
      for (let floorIndex = 0; floorIndex < floors; floorIndex++) {
        const floorY = placed.baseY
          + floorIndex * ROOM_MODULE.storeyPitch
          + ROOM_MODULE.slabHeight;
        const stairX = residentialDoorStart(floorIndex);
        const group = `residential-${chunkIndex}-${floorIndex}`;
        // Exterior stair band, immediately outside the storey doorway.
        publish(stairX, 16, floorY, group, 'entry');
        // One target in each room wing, reached through the paired corridor
        // doors. More detailed layouts can publish additional sockets.
        publish(24, 22, floorY, group, 'room');
        publish(31, 22, floorY, group, 'room');
        publish(24, 31, floorY, group, 'room');
        publish(31, 31, floorY, group, 'room');
      }
    }
  });
  return sockets;
}
