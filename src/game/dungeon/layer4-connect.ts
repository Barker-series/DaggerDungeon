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

  for (let safety = 0; safety < 20; safety++) {
    const spawnIsland = floodFill(tiles, entrance, gridTiles);

    // Find all floor tiles NOT in the spawn island. Skeleton voids are
    // never targets — carving "to" open air connects nothing.
    const unreached: GridPos[] = [];
    for (let z = 0; z < gridTiles; z++) {
      for (let x = 0; x < gridTiles; x++) {
        if (tiles[z]![x] !== TileType.Wall && !spawnIsland.has(`${x},${z}`) && !locked?.[z]?.[x]) {
          unreached.push({ x, y: z });
        }
      }
    }

    if (unreached.length === 0) break;

    // Find border tiles of spawn island (adjacent to wall). Skeleton voids
    // can't start a carve — a hallway can't begin over open air.
    const border: GridPos[] = [];
    for (const key of spawnIsland) {
      const parts = key.split(',');
      const x = parseInt(parts[0]!, 10);
      const z = parseInt(parts[1]!, 10);
      if (locked?.[z]?.[x]) continue;
      for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + off[0]!;
        const nz = z + off[1]!;
        if (nx >= 0 && nz >= 0 && nx < gridTiles && nz < gridTiles) {
          if (tiles[nz]![nx] === TileType.Wall) {
            border.push({ x, y: z });
            break;
          }
        }
      }
    }

    // Find closest pair
    let bestDist = Infinity;
    let bestFrom: GridPos | null = null;
    let bestTo: GridPos | null = null;

    for (const from of border) {
      for (const to of unreached) {
        const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestFrom = from;
          bestTo = to;
        }
      }
    }

    if (!bestFrom || !bestTo) break;

    // Carve hallway between them and register as rooms
    carveHallway(tiles, rooms, bestFrom.x, bestFrom.y, bestTo.x, bestTo.y, gridTiles, cellTileSize, locked);
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
): void {
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
  if (route.length === 0) return; // fully sealed off — leave the island be

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
