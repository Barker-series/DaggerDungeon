/**
 * Block Library — pre-authored dungeon blocks (the vocabulary)
 *
 * Each block is a tile pattern with connection points.
 * The layer system arranges blocks. CryptJS prefabs fill their interiors.
 * This is Daggerfall's approach: assemble designed pieces, don't generate from scratch.
 *
 * Tile values: 0=wall, 1=floor (matching TileType enum)
 */

// ── Types ──

export interface BlockExit {
  side: 'north' | 'south' | 'east' | 'west';
  offset: number; // position along that edge (tiles from left/top)
  width: number;  // opening width in tiles
}

export interface BlockDef {
  id: string;
  tiles: number[][];          // 2D tile grid (0=wall, 1=floor)
  width: number;
  height: number;
  ceilingHeight: number;
  exits: BlockExit[];
  tags: string[];             // 'room', 'corridor', 'junction', 'dead_end', 'stairwell'
  themes: string[];           // which themes this supports
  difficulty: number;         // 0-1
}

/** A placed block in the dungeon grid */
export interface BlockPlacement {
  def: BlockDef;
  gridX: number; // top-left tile X in the dungeon grid
  gridZ: number; // top-left tile Z
  rotation: 0 | 1 | 2 | 3; // 90-degree rotations (0=none, 1=90cw, 2=180, 3=270)
}

// ── Block Definitions ──
// Authored by hand. These are the building blocks of the dungeon.
// 1 = floor, 0 = wall.

const ROOM_SMALL: BlockDef = {
  id: 'room_small',
  width: 6, height: 6,
  ceilingHeight: 3,
  tiles: [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 2, width: 2 },
    { side: 'south', offset: 2, width: 2 },
    { side: 'east', offset: 2, width: 2 },
    { side: 'west', offset: 2, width: 2 },
  ],
  tags: ['room'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.2,
};

const ROOM_MEDIUM: BlockDef = {
  id: 'room_medium',
  width: 8, height: 8,
  ceilingHeight: 4,
  tiles: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 3, width: 2 },
    { side: 'south', offset: 3, width: 2 },
    { side: 'east', offset: 3, width: 2 },
    { side: 'west', offset: 3, width: 2 },
  ],
  tags: ['room'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.5,
};

const ROOM_LARGE: BlockDef = {
  id: 'room_large',
  width: 10, height: 10,
  ceilingHeight: 5,
  tiles: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 4, width: 2 },
    { side: 'south', offset: 4, width: 2 },
    { side: 'east', offset: 4, width: 2 },
    { side: 'west', offset: 4, width: 2 },
  ],
  tags: ['room', 'large'],
  themes: ['crypt', 'castle'],
  difficulty: 0.8,
};

const CORRIDOR_STRAIGHT_H: BlockDef = {
  id: 'corridor_straight_h',
  width: 8, height: 3,
  ceilingHeight: 2.5,
  tiles: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'west', offset: 1, width: 1 },
    { side: 'east', offset: 1, width: 1 },
  ],
  tags: ['corridor'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.1,
};

const CORRIDOR_STRAIGHT_V: BlockDef = {
  id: 'corridor_straight_v',
  width: 3, height: 8,
  ceilingHeight: 2.5,
  tiles: [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  exits: [
    { side: 'north', offset: 1, width: 1 },
    { side: 'south', offset: 1, width: 1 },
  ],
  tags: ['corridor'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.1,
};

const CORRIDOR_L_BEND: BlockDef = {
  id: 'corridor_l_bend',
  width: 5, height: 5,
  ceilingHeight: 2.5,
  tiles: [
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 1, width: 1 },
    { side: 'east', offset: 2, width: 1 },
  ],
  tags: ['corridor'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.1,
};

const CORRIDOR_T_JUNCTION: BlockDef = {
  id: 'corridor_t_junction',
  width: 5, height: 5,
  ceilingHeight: 2.8,
  tiles: [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 2, width: 1 },
    { side: 'west', offset: 2, width: 1 },
    { side: 'east', offset: 2, width: 1 },
  ],
  tags: ['junction'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.2,
};

const CORRIDOR_CROSS: BlockDef = {
  id: 'corridor_cross',
  width: 5, height: 5,
  ceilingHeight: 3,
  tiles: [
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 2, width: 1 },
    { side: 'south', offset: 2, width: 1 },
    { side: 'west', offset: 2, width: 1 },
    { side: 'east', offset: 2, width: 1 },
  ],
  tags: ['junction'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.3,
};

const DEAD_END: BlockDef = {
  id: 'dead_end',
  width: 4, height: 4,
  ceilingHeight: 2.5,
  tiles: [
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ],
  exits: [
    { side: 'north', offset: 1, width: 2 },
  ],
  tags: ['dead_end'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.1,
};

const STAIRWELL: BlockDef = {
  id: 'stairwell',
  width: 4, height: 4,
  ceilingHeight: 5,
  tiles: [
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
  ],
  exits: [
    { side: 'north', offset: 1, width: 2 },
    { side: 'south', offset: 1, width: 2 },
  ],
  tags: ['stairwell', 'vertical'],
  themes: ['crypt', 'sewer', 'cave', 'castle'],
  difficulty: 0.1,
};

// ── Block Library Access ──

export const ALL_BLOCKS: BlockDef[] = [
  ROOM_SMALL, ROOM_MEDIUM, ROOM_LARGE,
  CORRIDOR_STRAIGHT_H, CORRIDOR_STRAIGHT_V, CORRIDOR_L_BEND,
  CORRIDOR_T_JUNCTION, CORRIDOR_CROSS,
  DEAD_END, STAIRWELL,
];

export function getBlocksByTag(tag: string): BlockDef[] {
  return ALL_BLOCKS.filter((b) => b.tags.includes(tag));
}

export function getBlockById(id: string): BlockDef | undefined {
  return ALL_BLOCKS.find((b) => b.id === id);
}

export function getRandomBlock(tag: string, rng: () => number): BlockDef {
  const options = getBlocksByTag(tag);
  return options[Math.floor(rng() * options.length)] ?? ROOM_SMALL;
}

// ── Rotation utilities ──

const SIDE_ROTATE_CW: Record<string, BlockExit['side']> = {
  north: 'east', east: 'south', south: 'west', west: 'north',
};

/** Rotate a 2D tile array 90° clockwise N times */
export function rotateTiles(tiles: number[][], times: number): number[][] {
  let result = tiles;
  for (let t = 0; t < (times % 4); t++) {
    const rows = result.length;
    const cols = result[0]!.length;
    const rotated: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rotated[c]![rows - 1 - r] = result[r]![c]!;
      }
    }
    result = rotated;
  }
  return result;
}

/** Rotate exit definitions 90° clockwise N times */
export function rotateExits(exits: BlockExit[], w: number, h: number, times: number): BlockExit[] {
  let result = exits;
  let curW = w;
  let curH = h;
  for (let t = 0; t < (times % 4); t++) {
    result = result.map((exit) => {
      const newSide = SIDE_ROTATE_CW[exit.side]!;
      // Offset remapping: depends on which edge we're rotating from
      let newOffset: number;
      switch (exit.side) {
        case 'north': newOffset = exit.offset; break; // north→east: offset stays
        case 'east': newOffset = curH - 1 - exit.offset; break; // east→south: flip
        case 'south': newOffset = curW - 1 - exit.offset; break; // south→west: flip
        case 'west': newOffset = exit.offset; break; // west→north: stays
      }
      return { side: newSide, offset: newOffset, width: exit.width };
    });
    // After 90° CW rotation, width and height swap
    const tmp = curW;
    curW = curH;
    curH = tmp;
  }
  return result;
}

/** Get a block's exit position in tile coordinates (relative to block top-left) */
export function getExitTilePos(exit: BlockExit, blockW: number, blockH: number): { x: number; z: number } {
  switch (exit.side) {
    case 'north': return { x: exit.offset, z: 0 };
    case 'south': return { x: exit.offset, z: blockH - 1 };
    case 'west': return { x: 0, z: exit.offset };
    case 'east': return { x: blockW - 1, z: exit.offset };
  }
}

/** Get the opposite side */
export function oppositeSide(side: BlockExit['side']): BlockExit['side'] {
  switch (side) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
  }
}
