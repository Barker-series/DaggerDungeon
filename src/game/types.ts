// ── Dungeon Grid ──

import type { BiomeType } from './dungeon/cells';
import type { PillarSpec } from './dungeon/pillar-layer';
import type { BridgeSpec } from './dungeon/pillar-bridges';

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

/**
 * One level of the megastructure. Levels stack in absolute world space:
 * this level's grade-0 floor sits at `baseY`, and heights inside the
 * level are local to that base. Tiles whose floorHeight is at/below
 * PIT_LEVEL are HOLES — no floor slab; you fall through to whatever
 * level below has solid ground at that column (or into the abyss if
 * nothing does).
 */
export interface DungeonData {
  width: number;
  height: number;
  tiles: TileType[][];
  /** Per-tile floor elevation in level-local units (Layer 6). Walls hold a filler value. */
  floorHeights: number[][];
  /** Per-tile ceiling height in level-local units (Layer 6). Walls hold a filler value. */
  ceilingHeights: number[][];
  rooms: RoomData[];
  /** Where you arrive on this level (top level: spawn; below: the shaft landing) */
  entrance: GridPos;
  /** Way down: descent shaft mouth on upper levels, real stairs on the bottom */
  exit: GridPos;
  seed: number;
  /** Stack index — which megastructure segment this level belongs to */
  floor: number;
  /** Level index within the stack, 0 = top */
  level: number;
  /** World-space y of this level's grade-0 floor (= -level * LEVEL_HEIGHT) */
  baseY: number;
  /** Per-cell biome snapshot (the global cell map only holds the last
   *  generated level, so each level carries its own) — null = inactive */
  cellBiomes: (BiomeType | null)[][];
  /** Debug-map snapshot of the generation-time cell map. Generation runs
   *  in workers with their own module instances, so main-thread reads of
   *  the cell-map singleton would show a stale window. */
  cellDebug: { cx: number; cz: number; noise: number; active: boolean; biome: BiomeType }[];
  /** Cells carved as permanent transit hallways (layer 4 snapshot — same
   *  worker-isolation reason as cellDebug) */
  transitCells: string[];
  /** Guaranteed entrance→exit route on this level (debug map) */
  goldenPath: GridPos[];
  /** Pillar footprint tiles. Wall in `tiles`, but STRUCTURAL, not
   *  organic: the contour system must never chamfer or fence them —
   *  their real shape (ramps, plazas, interiors) lives in the column
   *  spans, and collision must come from spans alone. */
  pillarWall: boolean[][];
  /** Footprint tiles whose ground surface joined the level floor system
   *  (owner-0 span; its height is in floorHeights). In the corner field
   *  these are DOMINANT: foundations stay dead flat and the terrain's
   *  edge bends to meet them — earth banked against a slab, never a
   *  slab rolling with the hills. */
  pillarGround: boolean[][];
  /** Per-CELL roads-district mask. Roads tiles are 'outside' biome but
   *  rectilinear architecture: the organic contour system must not fence
   *  their plinths with 2D cave-wall collision — plinth shape and
   *  collision live in the column spans. Travels with the level so
   *  worker-generated worlds agree with the engine thread. */
  roadsCells?: boolean[][];
}

// ── The column model: the single authority on solid vs air ──

/** Sky sentinel for a span's ceiling — open air above the structure */
export const SKY_CEIL = 1e9;
/** Abyss sentinel for a span's floor — a bottomless drop */
export const ABYSS_FLOOR = -1e9;

/**
 * One band of AIR in a world column, in WORLD-space Y. Everything in a
 * column outside its spans is SOLID. Renderer, physics, and agents all
 * derive from this — never from per-level conventions.
 */
export interface ColumnSpan {
  /** World Y of the walkable floor surface (ABYSS_FLOOR = bottomless) */
  floor: number;
  /** World Y of the ceiling above it (SKY_CEIL = open sky) */
  ceil: number;
  /** Level whose height field shapes the floor surface; -1 = flat
   *  structural rock (e.g. a shaft ending on the slab below) */
  owner: number;
  /** Level whose height field shapes the ceiling; -1 = sky/none */
  ceilOwner: number;
}

/** A stack of physically coexisting levels — one megastructure segment. */
export interface WorldData {
  seed: number;
  /** Stack index; the bottom level's stairs regenerate stack+1 */
  stack: number;
  levels: DungeonData[];
  /** The column model: air spans per (x,z), indexed z * width + x,
   *  sorted bottom-up. Built once after ALL generation mutations; nothing
   *  may modify the world after it exists. */
  columns: ColumnSpan[][];
  /** Pillar kebab specs, keyed "cx,cz" — the bounded window over the
   *  cell-local pillar function (see pillar-layer.ts). Data-only in
   *  Phase 1: drives the debug map; geometry/bridges come next. */
  pillars: Map<string, PillarSpec>;
  /** Planned pillar-to-pillar walkways (carved into `columns`) */
  bridges: BridgeSpec[];
  /** Window origin on the infinite plane, in pillar cells */
  originPcx: number;
  originPcz: number;
  /** Legacy short bore scaffolding. It carries no fake runtime trains;
   *  long-distance rail will replace it with a routed track layer. */
  subways: BridgeSpec[];
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
