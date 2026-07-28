/**
 * Pillar interior module grammar.
 *
 * One procedural tile is 3 world units. These dimensions are deliberately
 * shared by every room layout so authored replacements can target a stable
 * kit instead of reverse-engineering arbitrary holes in the pillar mass.
 */

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
