/**
 * Layer 00 — Vertical Skeleton
 *
 * Runs BEFORE everything else and is shared by every level of the stack.
 * This is what makes the world one building instead of stacked maps: the
 * skeleton places intentional vertical structure in 3D — footprints with
 * level spans — and each level's 2D generation then organizes around it.
 *
 * Elements:
 * - STAIRWELL GALLERY: an enclosed ramp descending one full LEVEL_HEIGHT
 *   across a cell. The primary, walkable, two-way connection between
 *   levels. Its top door is the level's golden-path target; its bottom
 *   door is the next level's entrance. One per adjacent level pair,
 *   placed in different cells so descending traverses each floor.
 * - ATRIUM WELL: a multi-level open shaft with walkable balcony rims on
 *   every floor it pierces, a slab-edge fascia at each opening, a grand
 *   hall floor at its base, and a monolithic column through the middle.
 * - MEGACOLUMN: solid structure present identically on every level.
 *
 * The imprint writes tiles and exact heights, and locks them: later
 * layers (fine noise, pits, smoothing, path relaxation, pillars,
 * hallway carving) must not touch locked tiles. Noise holes are banned
 * on any column that any level's skeleton occupies, so nothing ever
 * drills into a gallery from above.
 */

import { TileType, RoomType, LEVEL_HEIGHT, type GridPos, type RoomData, type WorldLink } from '../types';
import { PIT_FLOOR } from './layer6-heights';
import { mulberry32 } from './rng';

const GALLERY_CEIL = 4.6; // clearance above the ramp surface
const GALLERY_HALF = 2; // corridor half-width incl. walls (5 wide total)
/** Height of each balcony opening in an atrium well. The slab fascia
 *  above a balcony spans down to exactly this plane — the well's
 *  perimeter is sealed from rim floor to rim floor. */
export const ATRIUM_BALCONY_CLEAR = 3.5;
const ATRIUM_INNER = { lo: 3, hi: 10 }; // interior span within the cell (8x8)
const ATRIUM_RIM = { lo: 2, hi: 11 }; // balcony ring boundary
const COLUMN_SIZE = 3;

export interface StairwellSpec {
  /** Connects `upper` and `upper + 1` */
  upper: number;
  cx: number;
  cz: number;
  axis: 'x' | 'z';
  reversed: boolean;
  /** Upper level's golden-path target: the landing outside the top door */
  exitPos: GridPos;
  /** Lower level's entrance: the landing outside the bottom door */
  entrancePos: GridPos;
  link: WorldLink;
  roomCenter: GridPos;
}

export interface AtriumSpec {
  top: number;
  bottom: number;
  cx: number;
  cz: number;
}

export interface ColumnSpec {
  cx: number;
  cz: number;
}

export interface WorldSkeleton {
  stairwells: StairwellSpec[];
  atria: AtriumSpec[];
  columns: ColumnSpec[];
  /** Columns (x,z) where noise holes may never open, on any level —
   *  the union of every level's skeleton footprints */
  pitBan: boolean[][];
  usedCells: Set<string>;
}

/** Per-level output of the imprint — consumed by the height layer and
 *  carried (partly) on DungeonData for the renderer. */
export interface SkeletonImprint {
  locked: boolean[][];
  presetFloor: (number | null)[][];
  presetCeil: (number | null)[][];
  openUp: boolean[][];
  skelVoid: boolean[][];
  fascia: boolean[][];
}

// ── Placement ──

export function buildSkeleton(
  stackSeed: number,
  levelCount: number,
  cellGrid: number,
  cellTile: number,
  gridTiles: number,
): WorldSkeleton {
  const rng = mulberry32(stackSeed + 8888);
  const usedCells = new Set<string>();

  // Inner cells only — footprints and door landings stay off the map edge
  const candidates: { cx: number; cz: number }[] = [];
  for (let cz = 1; cz < cellGrid - 1; cz++) {
    for (let cx = 1; cx < cellGrid - 1; cx++) {
      candidates.push({ cx, cz });
    }
  }
  // Fisher-Yates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }

  const takeCell = (farFrom?: { cx: number; cz: number }, minDist = 0): { cx: number; cz: number } => {
    let best: { cx: number; cz: number } | null = null;
    for (const c of candidates) {
      if (usedCells.has(`${c.cx},${c.cz}`)) continue;
      if (farFrom && Math.abs(c.cx - farFrom.cx) + Math.abs(c.cz - farFrom.cz) < minDist) continue;
      best = c;
      break;
    }
    if (!best) {
      // Relax the distance constraint rather than fail
      best = candidates.find((c) => !usedCells.has(`${c.cx},${c.cz}`)) ?? { cx: 1, cz: 1 };
    }
    usedCells.add(`${best.cx},${best.cz}`);
    return best;
  };

  // Stairwells: one per adjacent level pair, consecutive ones far apart so
  // each floor must actually be crossed
  const stairwells: StairwellSpec[] = [];
  let prevCell: { cx: number; cz: number } | undefined;
  for (let li = 0; li < levelCount - 1; li++) {
    const cell = takeCell(prevCell, 5);
    const axis: 'x' | 'z' = rng() < 0.5 ? 'x' : 'z';
    const reversed = rng() < 0.5;
    stairwells.push(makeStairwell(li, cell.cx, cell.cz, axis, reversed, cellTile));
    prevCell = cell;
  }

  // Atria: 1-2 wells spanning 2..levelCount levels
  const atria: AtriumSpec[] = [];
  const atriumCount = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < atriumCount; i++) {
    const cell = takeCell();
    const top = Math.floor(rng() * (levelCount - 1));
    const maxSpan = levelCount - top;
    const span = 2 + Math.floor(rng() * (maxSpan - 1));
    atria.push({ top, bottom: Math.min(levelCount - 1, top + span - 1), cx: cell.cx, cz: cell.cz });
  }

  // Megacolumns: continuity you can see on every floor
  const columns: ColumnSpec[] = [];
  const colCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < colCount; i++) {
    const cell = takeCell();
    columns.push({ cx: cell.cx, cz: cell.cz });
  }

  // Pit ban: union of all footprints — nothing drills into the skeleton
  const pitBan: boolean[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => false),
  );
  const ban = (tx0: number, tz0: number, tx1: number, tz1: number): void => {
    for (let z = Math.max(0, tz0); z <= Math.min(gridTiles - 1, tz1); z++) {
      for (let x = Math.max(0, tx0); x <= Math.min(gridTiles - 1, tx1); x++) {
        pitBan[z]![x] = true;
      }
    }
  };
  for (const s of stairwells) {
    ban(s.cx * cellTile - 1, s.cz * cellTile - 1, (s.cx + 1) * cellTile, (s.cz + 1) * cellTile);
  }
  for (const a of atria) {
    ban(a.cx * cellTile + ATRIUM_RIM.lo - 1, a.cz * cellTile + ATRIUM_RIM.lo - 1,
      a.cx * cellTile + ATRIUM_RIM.hi + 1, a.cz * cellTile + ATRIUM_RIM.hi + 1);
  }
  for (const c of columns) {
    const t0 = Math.floor((14 - COLUMN_SIZE) / 2);
    ban(c.cx * cellTile + t0 - 1, c.cz * cellTile + t0 - 1,
      c.cx * cellTile + t0 + COLUMN_SIZE, c.cz * cellTile + t0 + COLUMN_SIZE);
  }

  return { stairwells, atria, columns, pitBan, usedCells };
}

function makeStairwell(
  upper: number,
  cx: number,
  cz: number,
  axis: 'x' | 'z',
  reversed: boolean,
  cellTile: number,
): StairwellSpec {
  const at = (a: number, c: number): GridPos => {
    const along = reversed ? 13 - a : a;
    const tx0 = cx * cellTile;
    const tz0 = cz * cellTile;
    return axis === 'z'
      ? { x: tx0 + c, y: tz0 + along }
      : { x: tx0 + along, y: tz0 + c };
  };
  const C = 7; // corridor center within the cell
  const exitPos = at(0, C); // upper landing outside the top door
  const entrancePos = at(13, C); // lower landing outside the bottom door
  const rampBottom = at(11, C); // last ramp tile (upper grid)
  const doorBottom = at(12, C); // bottom door (lower grid)
  return {
    upper, cx, cz, axis, reversed,
    exitPos,
    entrancePos,
    link: {
      a: { level: upper, x: rampBottom.x, y: rampBottom.y },
      b: { level: upper + 1, x: doorBottom.x, y: doorBottom.y },
    },
    roomCenter: at(6, C),
  };
}

// ── Imprint ──

export function newImprint(gridTiles: number): SkeletonImprint {
  const grid = <T,>(v: T): T[][] =>
    Array.from({ length: gridTiles }, () => Array.from({ length: gridTiles }, () => v)) as T[][];
  return {
    locked: grid(false),
    presetFloor: grid<number | null>(null),
    presetCeil: grid<number | null>(null),
    openUp: grid(false),
    skelVoid: grid(false),
    fascia: grid(false),
  };
}

/** Write the skeleton into one level's tile grid. Call after the noise
 *  layers, before spawn/exit and connectivity. */
export function imprintSkeleton(
  skel: WorldSkeleton,
  level: number,
  tiles: TileType[][],
  rooms: RoomData[],
  gridTiles: number,
  cellTile: number,
): SkeletonImprint {
  const imp = newImprint(gridTiles);

  const inGrid = (x: number, z: number): boolean =>
    x >= 0 && z >= 0 && x < gridTiles && z < gridTiles;
  const put = (
    p: GridPos, tile: TileType,
    floor: number | null, ceil: number | null,
    flags?: { openUp?: boolean; skelVoid?: boolean; fascia?: boolean },
  ): void => {
    if (!inGrid(p.x, p.y)) return;
    tiles[p.y]![p.x] = tile;
    imp.locked[p.y]![p.x] = true;
    imp.presetFloor[p.y]![p.x] = floor;
    imp.presetCeil[p.y]![p.x] = ceil;
    if (flags?.openUp) imp.openUp[p.y]![p.x] = true;
    if (flags?.skelVoid) imp.skelVoid[p.y]![p.x] = true;
    if (flags?.fascia) imp.fascia[p.y]![p.x] = true;
  };

  for (const s of skel.stairwells) {
    imprintStairwell(s, level, put, rooms, cellTile);
  }
  for (const a of skel.atria) {
    imprintAtrium(a, level, put, rooms, cellTile);
  }
  for (const c of skel.columns) {
    const t0x = c.cx * cellTile + Math.floor((cellTile - COLUMN_SIZE) / 2);
    const t0z = c.cz * cellTile + Math.floor((cellTile - COLUMN_SIZE) / 2);
    for (let dz = 0; dz < COLUMN_SIZE; dz++) {
      for (let dx = 0; dx < COLUMN_SIZE; dx++) {
        put({ x: t0x + dx, y: t0z + dz }, TileType.Wall, null, null);
      }
    }
  }

  return imp;
}

function imprintStairwell(
  s: StairwellSpec,
  level: number,
  put: (p: GridPos, t: TileType, f: number | null, c: number | null, fl?: { openUp?: boolean; skelVoid?: boolean; fascia?: boolean }) => void,
  rooms: RoomData[],
  cellTile: number,
): void {
  const isUpper = level === s.upper;
  const isLower = level === s.upper + 1;
  if (!isUpper && !isLower) return;

  const at = (a: number, c: number): GridPos => {
    const along = s.reversed ? 13 - a : a;
    const tx0 = s.cx * cellTile;
    const tz0 = s.cz * cellTile;
    return s.axis === 'z'
      ? { x: tx0 + c, y: tz0 + along }
      : { x: tx0 + along, y: tz0 + c };
  };
  const C = 7;

  /** Ramp height at interior row a (2..11): landing → landing, one
   *  LEVEL_HEIGHT down, walkable slope */
  const rampH = (a: number): number => {
    const t = Math.max(0, Math.min(1, (a - 2) / 9));
    return -LEVEL_HEIGHT * t;
  };

  for (let a = 1; a <= 12; a++) {
    for (let c = C - GALLERY_HALF; c <= C + GALLERY_HALF; c++) {
      const p = at(a, c);
      const isBoundary = c === C - GALLERY_HALF || c === C + GALLERY_HALF || a === 1 || a === 12;
      if (isBoundary) {
        const walkCol = c >= C - 1 && c <= C + 1;
        const isTopDoor = a === 1 && c === C;
        const isBottomDoor = a === 12 && c === C;
        if (isUpper && isTopDoor) {
          put(p, TileType.Floor, 0, GALLERY_CEIL);
        } else if (isLower && isBottomDoor) {
          put(p, TileType.Floor, 0, GALLERY_CEIL);
        } else if (isUpper && a === 12 && walkCol) {
          // The bottom doorway belongs to the LOWER grid — the upper grid
          // must render NOTHING here, or a phantom wall face closes the
          // ramp exit. skelVoid keeps it passable and invisible; its
          // ceiling value continues the ramp ceiling plane so the visible
          // gallery ceiling blends flat instead of flaring at the door.
          put(p, TileType.Floor, PIT_FLOOR, -LEVEL_HEIGHT + GALLERY_CEIL, { skelVoid: true });
        } else {
          put(p, TileType.Wall, null, null);
        }
      } else {
        // Interior: the ramp lives on the upper grid; the lower grid keeps
        // the space passable but renders nothing (skelVoid)
        if (isUpper) {
          const h = rampH(a);
          put(p, TileType.Floor, h, h + GALLERY_CEIL);
        } else {
          // Ceiling value matches the doorway so the lower grid's corner
          // blending never droops the door header
          put(p, TileType.Floor, PIT_FLOOR, GALLERY_CEIL, { skelVoid: true });
        }
      }
    }
  }

  // Door landings: a flat 3x3 pocket outside each door, so the doorway
  // always opens into walkable space that connectIslands can reach.
  // Ceilings stay unset — layer 6 computes them from the local biome, so
  // the pocket roof blends with the surrounding room instead of drooping.
  const landing = (center: GridPos): void => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        put({ x: center.x + dx, y: center.y + dz }, TileType.Floor, 0, null);
      }
    }
  };
  if (isUpper) landing(s.exitPos);
  if (isLower) landing(s.entrancePos);

  // Light the gallery like a room (upper level owns the geometry)
  if (isUpper) {
    const center = s.roomCenter;
    rooms.push({
      center,
      left: center.x - 2, top: center.y - 2, width: 5, height: 5,
      ceilingHeight: GALLERY_CEIL,
      type: RoomType.Combat,
      doors: [],
    });
  }
}

function imprintAtrium(
  a: AtriumSpec,
  level: number,
  put: (p: GridPos, t: TileType, f: number | null, c: number | null, fl?: { openUp?: boolean; skelVoid?: boolean; fascia?: boolean }) => void,
  rooms: RoomData[],
  cellTile: number,
): void {
  if (level < a.top || level > a.bottom) return;
  const tx0 = a.cx * cellTile;
  const tz0 = a.cz * cellTile;
  const isBottom = level === a.bottom;
  const openUp = level > a.top; // the volume continues overhead

  for (let lz = ATRIUM_RIM.lo; lz <= ATRIUM_RIM.hi; lz++) {
    for (let lx = ATRIUM_RIM.lo; lx <= ATRIUM_RIM.hi; lx++) {
      const p = { x: tx0 + lx, y: tz0 + lz };
      const interior =
        lx >= ATRIUM_INNER.lo && lx <= ATRIUM_INNER.hi &&
        lz >= ATRIUM_INNER.lo && lz <= ATRIUM_INNER.hi;
      if (!interior) {
        // Balcony rim — walkable on every pierced floor. Its low ceiling
        // is the underside of the slab band; the fascia above meets it
        // exactly (see ATRIUM_BALCONY_CLEAR).
        put(p, TileType.Floor, 0, ATRIUM_BALCONY_CLEAR);
        continue;
      }
      if (isBottom) {
        // The hall floor at the well's base
        put(p, TileType.Floor, 0, ATRIUM_BALCONY_CLEAR, { openUp });
      } else {
        // Open well — fall through. Ceiling value matches the balcony rim
        // so rim ceilings blend flat to the well edge instead of drooping.
        put(p, TileType.Floor, PIT_FLOOR, ATRIUM_BALCONY_CLEAR, { openUp, fascia: true });
      }
    }
  }

  // The monolith: a column through the middle of the well, every level
  const mid = Math.floor((ATRIUM_INNER.lo + ATRIUM_INNER.hi) / 2);
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      put({ x: tx0 + mid + dx, y: tz0 + mid + dz }, TileType.Wall, null, null);
    }
  }

  // Light the hall floor
  if (isBottom) {
    const center = { x: tx0 + 7, y: tz0 + 7 };
    rooms.push({
      center: { x: tx0 + ATRIUM_INNER.lo + 1, y: tz0 + ATRIUM_INNER.lo + 1 },
      left: center.x - 4, top: center.y - 4, width: 9, height: 9,
      ceilingHeight: 8,
      type: RoomType.Treasure,
      doors: [],
    });
  }
}
