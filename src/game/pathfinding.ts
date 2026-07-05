import { TileType, type WorldData, type GridPos } from './types';
import { PIT_LEVEL } from './dungeon/heightfield';

/**
 * World pathfinding: 8-direction movement across the whole stack. Nodes
 * are (level, x, z); stairwell doorways (WorldData.links) join levels, so
 * a route walks down ramps between floors instead of stopping at the
 * level it started on.
 *
 * Diagonal steps cost √2 and are only allowed when both adjacent cardinal
 * tiles are open: the player has a collision radius, so cutting a corner
 * between two diagonally-touching walls is not walkable and must not be
 * suggested.
 *
 * Cliff rule: an edge is blocked when the floor changes more than
 * MAX_CLIMB between tiles. This matches the physics slope limit:
 * smoothstep interpolation peaks at 1.5× a tile's average slope, so with
 * MAX_SLOPE 1.1 the walkable per-tile change is 1.1 / 1.5 × 3 = 2.2 —
 * any step the router accepts, the player can physically walk, stairwell
 * ramps (2.0/tile) included. Hole tiles (no floor slab) are impassable.
 */

const SQRT2 = Math.SQRT2;
const MAX_CLIMB = 2.2;

// dx, dy, cost
const DIRS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export interface WorldStep {
  level: number;
  x: number;
  y: number;
}

/** Octile distance — admissible heuristic (level changes cost ≥ 0) */
function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

interface Node {
  level: number;
  x: number;
  y: number;
  g: number;
  f: number;
  parent: number; // flat key of predecessor, -1 for start
}

function passable(world: WorldData, level: number, x: number, y: number): boolean {
  const L = world.levels[level];
  if (!L) return false;
  if (x < 0 || y < 0 || x >= L.width || y >= L.height) return false;
  if (L.tiles[y]![x] === TileType.Wall) return false;
  return L.floorHeights[y]![x]! > PIT_LEVEL;
}

/** The level whose walkable floor is nearest a world-space y at a tile —
 *  mid-ramp the position belongs to the level that owns the ramp, not the
 *  band it happens to pass through. Null if no level is walkable there. */
export function startLevelFor(world: WorldData, pos: GridPos, worldY: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (let li = 0; li < world.levels.length; li++) {
    if (!passable(world, li, pos.x, pos.y)) continue;
    const L = world.levels[li]!;
    const d = Math.abs(L.baseY + L.floorHeights[pos.y]![pos.x]! - worldY);
    if (d < bestDist) {
      bestDist = d;
      best = li;
    }
  }
  return best;
}

/** A* route across the stack. Returns steps excluding `from`; empty if
 *  from === to or no route exists. */
export function findWorldPath(
  world: WorldData,
  from: WorldStep,
  to: WorldStep,
): WorldStep[] {
  const w = world.levels[0]!.width;
  const h = world.levels[0]!.height;
  const layer = w * h;
  const key = (level: number, x: number, y: number): number => level * layer + y * w + x;

  // Cross-level doorways, both directions
  const links = new Map<number, WorldStep>();
  for (const l of world.links) {
    links.set(key(l.a.level, l.a.x, l.a.y), { level: l.b.level, x: l.b.x, y: l.b.y });
    links.set(key(l.b.level, l.b.x, l.b.y), { level: l.a.level, x: l.a.x, y: l.a.y });
  }

  const open: Node[] = [];
  const best = new Map<number, Node>();
  const closed = new Set<number>();

  const start: Node = { ...from, g: 0, f: octile(from.x, from.y, to.x, to.y), parent: -1 };
  open.push(start);
  best.set(key(from.level, from.x, from.y), start);

  let found: Node | null = null;

  while (open.length > 0) {
    // Extract lowest f (array scan — open set stays small on these maps)
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const cur = open.splice(bestIdx, 1)[0]!;
    const curKey = key(cur.level, cur.x, cur.y);
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (cur.level === to.level && cur.x === to.x && cur.y === to.y) {
      found = cur;
      break;
    }

    const consider = (level: number, nx: number, ny: number, cost: number): void => {
      const nKey = key(level, nx, ny);
      if (closed.has(nKey)) return;
      const g = cur.g + cost;
      const existing = best.get(nKey);
      if (existing && existing.g <= g) return;
      const node: Node = { level, x: nx, y: ny, g, f: g + octile(nx, ny, to.x, to.y), parent: curKey };
      best.set(nKey, node);
      open.push(node);
    };

    const L = world.levels[cur.level]!;
    const hCur = L.floorHeights[cur.y]![cur.x]!;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!passable(world, cur.level, nx, ny)) continue;
      // No corner cutting: a diagonal needs both cardinals open
      if (dx !== 0 && dy !== 0 && (
        !passable(world, cur.level, cur.x + dx, cur.y) ||
        !passable(world, cur.level, cur.x, cur.y + dy)
      )) continue;
      // No cliffs in either direction
      if (Math.abs(L.floorHeights[ny]![nx]! - hCur) > MAX_CLIMB) continue;
      // Diagonals also need both cardinal intermediates near our height —
      // the walk surface at the crossing corner is pulled by all 4 tiles
      if (dx !== 0 && dy !== 0 && (
        Math.abs(L.floorHeights[cur.y]![cur.x + dx]! - hCur) > MAX_CLIMB ||
        Math.abs(L.floorHeights[cur.y + dy]![cur.x]! - hCur) > MAX_CLIMB
      )) continue;
      consider(cur.level, nx, ny, cost);
    }

    // Stairwell doorway — step through to the other level
    const through = links.get(curKey);
    if (through && passable(world, through.level, through.x, through.y)) {
      consider(through.level, through.x, through.y, 1);
    }
  }

  if (!found) return [];

  const reverse: WorldStep[] = [];
  let cur: Node | undefined = found;
  while (cur && cur.parent !== -1) {
    reverse.push({ level: cur.level, x: cur.x, y: cur.y });
    cur = best.get(cur.parent);
  }
  return reverse.reverse();
}

// ── Live route to the stack exit (memoized per tile for compass + maps) ──

let cacheKey = '';
let cachePath: WorldStep[] = [];

/** Route from a position to the bottom level's stairs — the real way out
 *  of the stack, down every stairwell in between. */
export function findWorldPathToExit(world: WorldData, from: WorldStep): WorldStep[] {
  const k = `${world.seed}:${world.stack}:${from.level}:${from.x},${from.y}`;
  if (k === cacheKey) return cachePath;
  cacheKey = k;
  const bottom = world.levels[world.levels.length - 1]!;
  cachePath = findWorldPath(world, from, {
    level: bottom.level,
    x: bottom.exit.x,
    y: bottom.exit.y,
  });
  return cachePath;
}
