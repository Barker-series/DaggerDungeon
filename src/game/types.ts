// ── Dungeon Grid ──

export enum TileType {
  Wall = 0,
  Floor = 1,
  Door = 2,
  StairsDown = 3,
  StairsUp = 4,
}

export enum Direction {
  North = 0, // -Z in world space
  East = 1, // +X
  South = 2, // +Z
  West = 3, // -X
}

export interface GridPos {
  x: number;
  y: number;
}

export enum RoomType {
  Entrance = 'entrance',
  Combat = 'combat',
  Treasure = 'treasure',
  Trap = 'trap',
  Boss = 'boss',
}

export interface RoomData {
  center: GridPos;
  left: number;
  top: number;
  width: number;
  height: number;
  ceilingHeight: number; // world units, varies per room
  type: RoomType;
  doors: GridPos[];
}

export interface DungeonData {
  width: number;
  height: number;
  tiles: TileType[][];
  /** Per-tile ceiling height in world units (Layer 6). Walls hold a filler value. */
  ceilingHeights: number[][];
  rooms: RoomData[];
  entrance: GridPos;
  exit: GridPos;
  seed: number;
  floor: number;
}

// ── Constants ──

export const TILE_SIZE = 3;
export const WALL_HEIGHT = 3;
export const EYE_HEIGHT = 1.6;
export const MOVE_DURATION = 0.18; // seconds
export const TURN_DURATION = 0.12; // seconds

/** Direction offsets: [dx, dy] for N/E/S/W */
export const DIR_OFFSETS: Record<Direction, GridPos> = {
  [Direction.North]: { x: 0, y: -1 },
  [Direction.East]: { x: 1, y: 0 },
  [Direction.South]: { x: 0, y: 1 },
  [Direction.West]: { x: -1, y: 0 },
};

/** Direction to Y-axis rotation in radians */
export const DIR_ANGLES: Record<Direction, number> = {
  [Direction.North]: 0,
  [Direction.East]: -Math.PI / 2,
  [Direction.South]: Math.PI,
  [Direction.West]: Math.PI / 2,
};
