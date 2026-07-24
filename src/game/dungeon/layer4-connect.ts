/**
 * Layer 4 — Island Connectivity
 *
 * Reads: Layer 3 (tile grid with rooms carved)
 * Writes: Carves hallways through void to connect disconnected islands.
 *
 * Algorithm:
 * 1. Flood fill from spawn to find the spawn island
 * 2. Find the nearest island not connected to spawn
 * 3. Find closest cell pair between the two islands
 * 4. Carve a proper hallway between them (wide enough to walk, not a slit)
 * 5. Merge and repeat until all floor is reachable
 *
 * Tracks which cells become hallways for the debug map.
 */

import { TileType, RoomType, type GridPos, type RoomData } from '../types';
import { Path } from 'rot-js';

const HALLWAY_HALF_WIDTH = 1; // tiles from center — total width = 3: tight
// passages make the open biomes hit harder when they arrive

/** Set of cell keys that became hallways. Read by debug map. */
export const hallwayCells = new Set<string>();

export function connectIslands(
  tiles: TileType[][],
  rooms: RoomData[],
  entrance: GridPos,
  gridTiles: number,
  cellTileSize: number,
  /** Skeleton-owned tiles hallways must never carve through */
  locked?: boolean[][],
): void {
  hallwayCells.clear();

  // Islands a carve already failed to reach — never target them again
  const sealed = new Set<string>();

  // Each pass: flood the spawn network once, label EVERY disconnected
  // component, and carve each one toward the network. Big grids fragment
  // into hundreds of islands; one-island-per-flood-fill does not scale.
  for (let pass = 0; pass < 8; pass++) {
    const spawnIsland = floodFill(tiles, entrance, gridTiles);

    // Border tiles of the spawn network (adjacent to wall, carveable),
    // subsampled — hallway starts don't need tile-exact optimality
    const border: GridPos[] = [];
    let bi = 0;
    for (const key of spawnIsland) {
      const parts = key.split(',');
      const x = parseInt(parts[0]!, 10);
      const z = parseInt(parts[1]!, 10);
      if (locked?.[z]?.[x]) continue;
      let edge = false;
      for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + off[0]!;
        const nz = z + off[1]!;
        if (nx >= 0 && nz >= 0 && nx < gridTiles && nz < gridTiles && tiles[nz]![nx] === TileType.Wall) {
          edge = true;
          break;
        }
      }
      if (edge && bi++ % 3 === 0) border.push({ x, y: z });
    }
    if (border.length === 0) break;

    // Label disconnected components (floor, not spawn network, not
    // locked/sealed). Skeleton voids are never targets — carving "to"
    // open air connects nothing.
    const assigned = new Set<string>();
    const components: GridPos[][] = [];
    for (let z = 0; z < gridTiles; z++) {
      for (let x = 0; x < gridTiles; x++) {
        const k = `${x},${z}`;
        if (tiles[z]![x] === TileType.Wall || spawnIsland.has(k) || assigned.has(k)) continue;
        if (locked?.[z]?.[x] || sealed.has(k)) continue;
        const comp = [...floodFill(tiles, { x, y: z }, gridTiles)].map((s) => {
          const p = s.split(',');
          return { x: parseInt(p[0]!, 10), y: parseInt(p[1]!, 10) };
        });
        for (const t of comp) assigned.add(`${t.x},${t.y}`);
        components.push(comp);
      }
    }
    if (components.length === 0) break;

    let anyCarved = false;
    for (const comp of components) {
      // Closest pair between a sample of the component and the border
      const step = Math.max(1, Math.floor(comp.length / 48));
      let bestDist = Infinity;
      let bestFrom: GridPos | null = null;
      let bestTo: GridPos | null = null;
      for (let i = 0; i < comp.length; i += step) {
        const to = comp[i]!;
        for (const from of border) {
          const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
          if (dist < bestDist) {
            bestDist = dist;
            bestFrom = from;
            bestTo = to;
          }
        }
      }
      if (!bestFrom || !bestTo) continue;
      // The carve A* can't start or end on the outermost tile ring —
      // clamp endpoints inward; the 3-wide carve still reaches the edge
      const cl = (v: number): number => Math.max(1, Math.min(gridTiles - 2, v));
      const ok = carveHallway(tiles, rooms, cl(bestFrom.x), cl(bestFrom.y), cl(bestTo.x), cl(bestTo.y), gridTiles, cellTileSize, locked);
      if (ok) {
        anyCarved = true;
      } else {
        for (const t of comp) sealed.add(`${t.x},${t.y}`);
      }
    }
    if (!anyCarved) break;
  }
}

/** Carve a proper hallway — wide enough to walk through, registered as rooms */
function carveHallway(
  tiles: TileType[][],
  rooms: RoomData[],
  x1: number, z1: number,
  x2: number, z2: number,
  gridTiles: number,
  cellTileSize: number,
  locked?: boolean[][],
): boolean {
  // Track the bounding box of the hallway for room registration
  let minX = Math.min(x1, x2);
  let maxX = Math.max(x1, x2);
  let minZ = Math.min(z1, z2);
  let maxZ = Math.max(z1, z2);

  // Route with A* so the hallway goes AROUND skeleton structure (stairwell
  // galleries, atrium wells) instead of stopping dead against it
  const passable = (x: number, z: number): boolean =>
    x >= 1 && z >= 1 && x < gridTiles - 1 && z < gridTiles - 1 && !locked?.[z]?.[x];
  const astar = new Path.AStar(x2, z2, passable, { topology: 4 });
  const route: GridPos[] = [];
  astar.compute(x1, z1, (x, z) => route.push({ x, y: z }));
  if (route.length === 0) return false; // fully sealed off — leave the island be

  for (const p of route) {
    carveSpot(tiles, p.x, p.y, gridTiles, locked);
    hallwayCells.add(`${Math.floor(p.x / cellTileSize)},${Math.floor(p.y / cellTileSize)}`);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.y);
    maxZ = Math.max(maxZ, p.y);
  }

  // Register hallway as a room so the renderer gives it proper ceiling height
  minX -= HALLWAY_HALF_WIDTH;
  maxX += HALLWAY_HALF_WIDTH;
  minZ -= HALLWAY_HALF_WIDTH;
  maxZ += HALLWAY_HALF_WIDTH;
  minX = Math.max(1, minX);
  minZ = Math.max(1, minZ);
  maxX = Math.min(gridTiles - 2, maxX);
  maxZ = Math.min(gridTiles - 2, maxZ);

  rooms.push({
    center: { x: Math.floor((minX + maxX) / 2), y: Math.floor((minZ + maxZ) / 2) },
    left: minX,
    top: minZ,
    width: maxX - minX + 1,
    height: maxZ - minZ + 1,
    ceilingHeight: 3,
    type: RoomType.Combat,
    doors: [],
  });
  return true;
}

/** Carve a circular-ish area around a point for hallway width */
function carveSpot(tiles: TileType[][], cx: number, cz: number, gridTiles: number, locked?: boolean[][]): void {
  for (let dz = -HALLWAY_HALF_WIDTH; dz <= HALLWAY_HALF_WIDTH; dz++) {
    for (let dx = -HALLWAY_HALF_WIDTH; dx <= HALLWAY_HALF_WIDTH; dx++) {
      // Circle shape — skip corners for rounded hallway
      if (dx * dx + dz * dz > HALLWAY_HALF_WIDTH * HALLWAY_HALF_WIDTH) continue;

      const tx = cx + dx;
      const tz = cz + dz;
      if (tx >= 1 && tz >= 1 && tx < gridTiles - 1 && tz < gridTiles - 1) {
        if (locked?.[tz]?.[tx]) continue; // never breach skeleton structure
        tiles[tz]![tx] = TileType.Floor;
      }
    }
  }
}

function floodFill(tiles: TileType[][], start: GridPos, gridTiles: number): Set<string> {
  const visited = new Set<string>();
  const queue: GridPos[] = [start];
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cur.x + off[0]!;
      const ny = cur.y + off[1]!;
      if (nx < 0 || ny < 0 || nx >= gridTiles || ny >= gridTiles) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (tiles[ny]![nx] === TileType.Wall) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return visited;
}
