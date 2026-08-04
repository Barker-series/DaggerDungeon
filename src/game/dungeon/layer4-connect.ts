/**
 * Layer 4 — Permanent pillar-cell transit
 *
 * The old implementation connected islands by flood-filling the complete
 * temporary window. Those corridors changed when the window moved. This layer
 * instead gives every absolute pillar cell four stable shared sockets. Each
 * cell routes and publishes only inside its own 56×56-tile bounds, then
 * attaches every local floor component to that permanent network.
 *
 * TRANSIT v2 (Aug 2026) — route SHAPING. The v1 look was pure algorithm:
 * a hub in a random corner, four uniform-cost A* spokes (L-legs and
 * staircases), and every isolated component carving its own private route
 * to the hub (entrance clusters that merged two cells later). v2 keeps the
 * exact connectivity guarantee and the same sockets but changes how routes
 * are found:
 *   - WEIGHTED A*: step cost carries a seeded noise field (the canonical
 *     LayerProcGen natural-paths technique — corridors wander like they
 *     were bored through weakness, docs/layerprocgen/ContextualGeneration.md),
 *     a turn penalty (long straight runs, deliberate bends, no staircases),
 *     and a strong discount for stepping on EXISTING transit — later routes
 *     are attracted into earlier tunnels and merge instead of paralleling.
 *   - THROUGH-ROUTES: the backbone is west↔east and north↔south paths
 *     (the reuse discount fuses them where they meet), not four spokes
 *     radiating from a corner. Cells read as places a tunnel passes
 *     through. Sockets that a failed through-route stranded fall back to
 *     a spoke toward the nearest transit (or a central hub, worst case).
 *   - NEAREST ATTACHMENT: components connect to the nearest existing
 *     transit tile (multi-source BFS picks the exit), not to the hub —
 *     a tree instead of a star, one entrance where there were three.
 * Everything stays clipped to the owning cell: same effect distance, same
 * window-stability. verify-world's unreachable=0 and the 100% seam gate
 * are the ratchets.
 */

import { RoomType, TileType, type GridPos, type RoomData } from '../types';
import { cellSeed, mulberry32 } from './rng';
import { sampleNoise } from './noise';
import { PILLAR_CELL_TILES } from './pillar-layer';

const TRANSIT_SALT = 0x4d335431;
const HALLWAY_HALF_WIDTH = 1;
const SOCKET_MARGIN = 6;

// ── Route-shaping tuning ──
/** How strongly the wander field bends a route (step cost 1..1+W) */
const NOISE_WEIGHT = 2.5;
/** Wander feature size in tiles */
const NOISE_SCALE = 9;
/** Cost added when a step changes direction — buys straight runs */
const TURN_PENALTY = 2.0;
/** Step-cost multiplier on existing transit — routes merge into tunnels */
const REUSE_DISCOUNT = 0.3;
const WANDER_SALT = TRANSIT_SALT + 77;

/** Dungeon-cell keys touched by transit, consumed by the debug map. */
export const hallwayCells = new Set<string>();
/** Tile keys owned by the permanent network; later layers must preserve them. */
export const permanentTransitTiles = new Set<string>();

type Axis = 'east' | 'south';

/** Stable offset for a pair owned by its west/north absolute pillar cell. */
export function transitSocketOffset(
  worldSeed: number,
  ownerPcx: number,
  ownerPcz: number,
  axis: Axis,
): number {
  const salt = TRANSIT_SALT + (axis === 'east' ? 0 : 1);
  const rng = mulberry32(cellSeed(ownerPcx, ownerPcz, worldSeed, salt));
  const span = PILLAR_CELL_TILES - SOCKET_MARGIN * 2;
  return SOCKET_MARGIN + Math.floor(rng() * span);
}

function nearestUnlocked(
  targetX: number,
  targetZ: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  locked?: boolean[][],
): GridPos | null {
  for (let radius = 0; radius < PILLAR_CELL_TILES; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = targetX + dx;
        const z = targetZ + dz;
        if (x < x0 || z < z0 || x >= x1 || z >= z1 || locked?.[z]?.[x]) continue;
        return { x, y: z };
      }
    }
  }
  return null;
}

function carveSpot(
  tiles: TileType[][],
  cx: number,
  cz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cellTileSize: number,
  locked?: boolean[][],
): void {
  for (let dz = -HALLWAY_HALF_WIDTH; dz <= HALLWAY_HALF_WIDTH; dz++) {
    for (let dx = -HALLWAY_HALF_WIDTH; dx <= HALLWAY_HALF_WIDTH; dx++) {
      if (dx * dx + dz * dz > HALLWAY_HALF_WIDTH * HALLWAY_HALF_WIDTH) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (x < x0 || z < z0 || x >= x1 || z >= z1 || locked?.[z]?.[x]) continue;
      tiles[z]![x] = TileType.Floor;
      permanentTransitTiles.add(`${x},${z}`);
      hallwayCells.add(`${Math.floor(x / cellTileSize)},${Math.floor(z / cellTileSize)}`);
    }
  }
}

/** Per-cell routing context: bounds, wander field, bookkeeping. */
interface CellCtx {
  tiles: TileType[][];
  rooms: RoomData[];
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  cellTileSize: number;
  locked?: boolean[][];
  /** Precomputed wander noise per local tile (absolute-coord seeded) */
  wander: Float64Array;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Routing moves: 4 orthogonal + 4 diagonal. Diagonal runs carve clean
 *  1:1 staircase boundaries that the wall contour then renders as ONE
 *  flat 45° plane (marching squares chains colinear corner cuts) — the
 *  flat diagonal walls the machined look wants. Turns are priced by
 *  ANGLE so gentle 45° bends beat sharp 90° corners. */
const MOVES = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;
const MOVE_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
/** turnFactor[a][b] — penalty multiplier for switching move a → move b */
const TURN_FACTOR: number[][] = MOVES.map(([ax, az]) => MOVES.map(([bx, bz]) => {
  const dot = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
  if (dot > 0.99) return 0;       // straight
  if (dot > 0.5) return 0.4;      // 45° bend
  if (dot > -0.5) return 1.2;     // 90° turn
  return 2.5;                     // reversal
}));

/**
 * Weighted A* over the cell: noise wander + turn penalty + transit-reuse
 * discount. State includes the entry direction so turning has a price.
 * Heuristic = manhattan × cheapest possible step (admissible).
 */
function findWeightedRoute(ctx: CellCtx, from: GridPos, to: GridPos): GridPos[] | null {
  const { x0, z0, x1, z1, locked, wander } = ctx;
  const w = x1 - x0;
  const h = z1 - z0;
  const states = w * h * 9;
  const gScore = new Float64Array(states).fill(Infinity);
  const cameFrom = new Int32Array(states).fill(-1);
  const stateOf = (x: number, z: number, dir: number): number =>
    ((z - z0) * w + (x - x0)) * 9 + dir;
  const minStep = REUSE_DISCOUNT;

  // Binary min-heap of [f, state]
  const heap: number[] = [];
  const push = (f: number, s: number): void => {
    heap.push(f, s);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p * 2]! <= heap[i * 2]!) break;
      const tf = heap[p * 2]!, ts = heap[p * 2 + 1]!;
      heap[p * 2] = heap[i * 2]!; heap[p * 2 + 1] = heap[i * 2 + 1]!;
      heap[i * 2] = tf; heap[i * 2 + 1] = ts;
      i = p;
    }
  };
  const pop = (): [number, number] | null => {
    if (heap.length === 0) return null;
    const top: [number, number] = [heap[0]!, heap[1]!];
    const lastS = heap.pop()!;
    const lastF = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = lastF; heap[1] = lastS;
      let i = 0;
      const n = heap.length / 2;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && heap[l * 2]! < heap[m * 2]!) m = l;
        if (r < n && heap[r * 2]! < heap[m * 2]!) m = r;
        if (m === i) break;
        const tf = heap[m * 2]!, ts = heap[m * 2 + 1]!;
        heap[m * 2] = heap[i * 2]!; heap[m * 2 + 1] = heap[i * 2 + 1]!;
        heap[i * 2] = tf; heap[i * 2 + 1] = ts;
        i = m;
      }
    }
    return top;
  };

  // Chebyshev heuristic: with diagonal moves every step reduces
  // chebyshev distance by at most 1, so h = chebyshev × cheapest step
  // stays admissible.
  const hDist = (x: number, z: number): number =>
    Math.max(Math.abs(x - to.x), Math.abs(z - to.y)) * minStep;

  const start = stateOf(from.x, from.y, 8);
  gScore[start] = 0;
  push(hDist(from.x, from.y), start);

  let goalState = -1;
  for (;;) {
    const next = pop();
    if (!next) break;
    const [, s] = next;
    const dir = s % 9;
    const cell = (s - dir) / 9;
    const x = x0 + (cell % w);
    const z = z0 + Math.floor(cell / w);
    if (x === to.x && z === to.y) { goalState = s; break; }
    const g = gScore[s]!;
    for (let d = 0; d < 8; d++) {
      const nx = x + MOVES[d]![0];
      const nz = z + MOVES[d]![1];
      if (nx < x0 || nz < z0 || nx >= x1 || nz >= z1 || locked?.[nz]?.[nx]) continue;
      const onTransit = permanentTransitTiles.has(`${nx},${nz}`);
      let step = MOVE_COST[d]! * (1 + NOISE_WEIGHT * wander[(nz - z0) * w + (nx - x0)]!)
        * (onTransit ? REUSE_DISCOUNT : 1);
      if (dir !== 8) step += TURN_PENALTY * TURN_FACTOR[dir]![d]!;
      const ns = stateOf(nx, nz, d);
      const ng = g + step;
      if (ng >= gScore[ns]!) continue;
      gScore[ns] = ng;
      cameFrom[ns] = s;
      push(ng + hDist(nx, nz), ns);
    }
  }
  if (goalState < 0) return null;

  const route: GridPos[] = [];
  for (let s = goalState; s >= 0; s = cameFrom[s]!) {
    const dir = s % 9;
    const cell = (s - dir) / 9;
    route.push({ x: x0 + (cell % w), y: z0 + Math.floor(cell / w) });
  }
  route.reverse();
  return route;
}

/** Carve a weighted route and record its hallway room. */
function carveRoute(ctx: CellCtx, from: GridPos, to: GridPos): boolean {
  const route = findWeightedRoute(ctx, from, to);
  if (!route) return false;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of route) {
    carveSpot(ctx.tiles, p.x, p.y, ctx.x0, ctx.z0, ctx.x1, ctx.z1, ctx.cellTileSize, ctx.locked);
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.y);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.y);
  }
  ctx.rooms.push({
    center: { x: Math.floor((minX + maxX) / 2), y: Math.floor((minZ + maxZ) / 2) },
    left: Math.max(ctx.x0, minX - HALLWAY_HALF_WIDTH),
    top: Math.max(ctx.z0, minZ - HALLWAY_HALF_WIDTH),
    width: Math.min(ctx.x1 - 1, maxX + HALLWAY_HALF_WIDTH) - Math.max(ctx.x0, minX - HALLWAY_HALF_WIDTH) + 1,
    height: Math.min(ctx.z1 - 1, maxZ + HALLWAY_HALF_WIDTH) - Math.max(ctx.z0, minZ - HALLWAY_HALF_WIDTH) + 1,
    ceilingHeight: 3,
    type: RoomType.Combat,
    doors: [],
  });
  return true;
}

/**
 * Multi-source BFS from every transit tile in the cell, over unlocked
 * tiles (routes may carve walls). Returns per-tile distance and the
 * nearest transit tile, or null when the cell has no transit yet.
 */
function transitField(ctx: CellCtx): { dist: Int32Array; nearest: Int32Array } | null {
  const { x0, z0, x1, z1, locked } = ctx;
  const w = x1 - x0;
  const h = z1 - z0;
  const dist = new Int32Array(w * h).fill(-1);
  const nearest = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      if (!permanentTransitTiles.has(`${x},${z}`)) continue;
      const i = (z - z0) * w + (x - x0);
      dist[i] = 0;
      nearest[i] = i;
      queue.push(i);
    }
  }
  if (queue.length === 0) return null;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = x0 + (i % w);
    const z = z0 + Math.floor(i / w);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < x0 || nz < z0 || nx >= x1 || nz >= z1 || locked?.[nz]?.[nx]) continue;
      const ni = (nz - z0) * w + (nx - x0);
      if (dist[ni] !== -1) continue;
      dist[ni] = dist[i]! + 1;
      nearest[ni] = nearest[i]!;
      queue.push(ni);
    }
  }
  return { dist, nearest };
}

function localComponents(
  tiles: TileType[][],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): GridPos[][] {
  const seen = new Set<number>();
  const components: GridPos[][] = [];
  const width = x1 - x0;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const startKey = (z - z0) * width + x - x0;
      if (seen.has(startKey) || tiles[z]![x] === TileType.Wall) continue;
      const component: GridPos[] = [];
      const queue: GridPos[] = [{ x, y: z }];
      seen.add(startKey);
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head]!;
        component.push(p);
        for (const [dx, dz] of DIRS) {
          const nx = p.x + dx;
          const nz = p.y + dz;
          if (nx < x0 || nz < z0 || nx >= x1 || nz >= z1 || tiles[nz]![nx] === TileType.Wall) continue;
          const key = (nz - z0) * width + nx - x0;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ x: nx, y: nz });
        }
      }
      components.push(component);
    }
  }
  return components;
}

/**
 * Materialize the permanent coarse graph for the current window. Every route
 * is owned and clipped by one pillar cell, so shifted windows regenerate the
 * same transit tiles for every overlapping absolute cell.
 */
export function connectPermanentTransit(
  tiles: TileType[][],
  rooms: RoomData[],
  worldSeed: number,
  originPcx: number,
  originPcz: number,
  gridTiles: number,
  cellTileSize: number,
  locked?: boolean[][],
): void {
  hallwayCells.clear();
  permanentTransitTiles.clear();
  const pillarGrid = Math.ceil(gridTiles / PILLAR_CELL_TILES);

  for (let pcz = 0; pcz < pillarGrid; pcz++) {
    for (let pcx = 0; pcx < pillarGrid; pcx++) {
      const x0 = pcx * PILLAR_CELL_TILES;
      const z0 = pcz * PILLAR_CELL_TILES;
      const x1 = Math.min(gridTiles, x0 + PILLAR_CELL_TILES);
      const z1 = Math.min(gridTiles, z0 + PILLAR_CELL_TILES);
      const apx = originPcx + pcx;
      const apz = originPcz + pcz;
      const w = x1 - x0;
      const h = z1 - z0;

      // Wander field sampled at ABSOLUTE tile coords — identical from
      // every window that covers this cell
      const wander = new Float64Array(w * h);
      const absX0 = (originPcx * PILLAR_CELL_TILES) + x0;
      const absZ0 = (originPcz * PILLAR_CELL_TILES) + z0;
      for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
          wander[z * w + x] = sampleNoise(absX0 + x, absZ0 + z, worldSeed + WANDER_SALT, NOISE_SCALE);
        }
      }
      const ctx: CellCtx = { tiles, rooms, x0, z0, x1, z1, cellTileSize, locked, wander };

      const westOffset = transitSocketOffset(worldSeed, apx - 1, apz, 'east');
      const eastOffset = transitSocketOffset(worldSeed, apx, apz, 'east');
      const northOffset = transitSocketOffset(worldSeed, apx, apz - 1, 'south');
      const southOffset = transitSocketOffset(worldSeed, apx, apz, 'south');
      const west = nearestUnlocked(x0, z0 + westOffset, x0, z0, x1, z1, locked);
      const east = nearestUnlocked(x1 - 1, z0 + eastOffset, x0, z0, x1, z1, locked);
      const north = nearestUnlocked(x0 + northOffset, z0, x0, z0, x1, z1, locked);
      const south = nearestUnlocked(x0 + southOffset, z1 - 1, x0, z0, x1, z1, locked);

      // Backbone: two through-routes. The transit-reuse discount fuses
      // the second into the first where they meet.
      if (west && east) carveRoute(ctx, west, east);
      if (north && south) carveRoute(ctx, north, south);

      // Any socket a failed/missing through-route left stranded gets a
      // spoke to the nearest transit — or, worst case, a central hub.
      const strandedTargets = [west, east, north, south].filter((s): s is GridPos =>
        s !== null && !permanentTransitTiles.has(`${s.x},${s.y}`));
      if (strandedTargets.length > 0) {
        let field = transitField(ctx);
        for (const socket of strandedTargets) {
          if (permanentTransitTiles.has(`${socket.x},${socket.y}`)) continue;
          let target: GridPos | null = null;
          if (field) {
            const ni = field.nearest[(socket.y - z0) * w + (socket.x - x0)]!;
            if (ni >= 0) target = { x: x0 + (ni % w), y: z0 + Math.floor(ni / w) };
          }
          target ??= nearestUnlocked(
            x0 + Math.floor(w / 2), z0 + Math.floor(h / 2), x0, z0, x1, z1, locked,
          );
          if (target && carveRoute(ctx, socket, target)) field = transitField(ctx);
        }
      }

      // Attach each local floor component to the NEAREST transit tile —
      // a tree, not a star: one entrance where v1 carved three.
      const field = transitField(ctx);
      if (!field) continue;
      const components = localComponents(tiles, x0, z0, x1, z1);
      for (const component of components) {
        if (component.some((p) => permanentTransitTiles.has(`${p.x},${p.y}`))) continue;
        let exit = component[0]!;
        let exitDist = Infinity;
        for (const p of component) {
          const d = field.dist[(p.y - z0) * w + (p.x - x0)]!;
          if (d >= 0 && d < exitDist) {
            exit = p;
            exitDist = d;
          }
        }
        if (!Number.isFinite(exitDist)) continue;
        const ni = field.nearest[(exit.y - z0) * w + (exit.x - x0)]!;
        const target = { x: x0 + (ni % w), y: z0 + Math.floor(ni / w) };
        carveRoute(ctx, exit, target);
      }
    }
  }
}
