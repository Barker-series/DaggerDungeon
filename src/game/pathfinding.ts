import { TileType, type DungeonData, type GridPos } from './types';

/**
 * Grid pathfinding with 8-direction movement, matching how the player
 * actually walks (free FPS movement — diagonals are as cheap as they
 * geometrically are).
 *
 * Diagonal steps cost √2 and are only allowed when both adjacent cardinal
 * tiles are open: the player has a collision radius, so cutting a corner
 * between two diagonally-touching walls is not walkable and must not be
 * suggested.
 *
 * Cliff rule: an edge is blocked when the floor rises or drops more than
 * MAX_CLIMB between tiles — routes go around terraces or through their
 * carved ramps, matching what the player can actually walk.
 */

const SQRT2 = Math.SQRT2;
const MAX_CLIMB = 0.75; // per-tile floor height change a route may use

// dx, dy, cost
const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Octile distance — admissible heuristic for 8-direction movement */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: number; // flat index of predecessor, -1 for start
}

/** A* route between two tiles. Returns tile steps excluding `from`;
 *  empty if from === to or no route exists. */
export function findPath(dungeon: DungeonData, from: GridPos, to: GridPos): GridPos[] {
  const w = dungeon.width;
  const h = dungeon.height;
  const open: Node[] = [];
  const best = new Map<number, Node>();

  const passable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return dungeon.tiles[y]![x] !== TileType.Wall;
  };

  const start: Node = { x: from.x, y: from.y, g: 0, f: octile(from.x, from.y, to.x, to.y), parent: -1 };
  open.push(start);
  best.set(from.y * w + from.x, start);

  const closed = new Set<number>();
  let found: Node | null = null;

  while (open.length > 0) {
    // Extract lowest f (array scan — open set stays small on these maps)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0]!;
    const curKey = cur.y * w + cur.x;
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (cur.x === to.x && cur.y === to.y) {
      found = cur;
      break;
    }

    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!passable(nx, ny)) continue;
      // No corner cutting: a diagonal needs both cardinals open
      if (dx !== 0 && dy !== 0 && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue;
      // No cliffs: the route must stay walkable in both directions
      const hCur = dungeon.floorHeights[cur.y]![cur.x]!;
      if (Math.abs(dungeon.floorHeights[ny]![nx]! - hCur) > MAX_CLIMB) continue;
      // Diagonals also need both cardinal intermediates near our height —
      // the walk surface at the crossing corner is pulled by all 4 tiles
      if (dx !== 0 && dy !== 0 && (
        Math.abs(dungeon.floorHeights[cur.y]![cur.x + dx]! - hCur) > MAX_CLIMB ||
        Math.abs(dungeon.floorHeights[cur.y + dy]![cur.x]! - hCur) > MAX_CLIMB
      )) continue;

      const nKey = ny * w + nx;
      if (closed.has(nKey)) continue;

      const g = cur.g + cost;
      const existing = best.get(nKey);
      if (existing && existing.g <= g) continue;

      const node: Node = { x: nx, y: ny, g, f: g + octile(nx, ny, to.x, to.y), parent: curKey };
      best.set(nKey, node);
      open.push(node);
    }
  }

  if (!found) return [];

  // Trace back through parents
  const reverse: GridPos[] = [];
  let cur: Node | undefined = found;
  while (cur && cur.parent !== -1) {
    reverse.push({ x: cur.x, y: cur.y });
    cur = best.get(cur.parent);
  }
  return reverse.reverse();
}

// ── Live route to exit (memoized per tile for compass + minimap) ──

let cacheKey = '';
let cachePath: GridPos[] = [];

export function findPathToExit(dungeon: DungeonData, from: GridPos): GridPos[] {
  const key = `${dungeon.seed}:${dungeon.floor}:${from.x},${from.y}`;
  if (key === cacheKey) return cachePath;
  cacheKey = key;
  cachePath = findPath(dungeon, from, dungeon.exit);
  return cachePath;
}
