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

const HALLWAY_HALF_WIDTH = 3; // tiles from center — total width = 7

/** Set of cell keys that became hallways. Read by debug map. */
export const hallwayCells = new Set<string>();

export function connectIslands(
  tiles: TileType[][],
  rooms: RoomData[],
  entrance: GridPos,
  gridTiles: number,
  cellTileSize: number,
): void {
  hallwayCells.clear();

  for (let safety = 0; safety < 20; safety++) {
    const spawnIsland = floodFill(tiles, entrance, gridTiles);

    // Find all floor tiles NOT in the spawn island
    const unreached: GridPos[] = [];
    for (let z = 0; z < gridTiles; z++) {
      for (let x = 0; x < gridTiles; x++) {
        if (tiles[z]![x] !== TileType.Wall && !spawnIsland.has(`${x},${z}`)) {
          unreached.push({ x, y: z });
        }
      }
    }

    if (unreached.length === 0) break;

    // Find border tiles of spawn island (adjacent to wall)
    const border: GridPos[] = [];
    for (const key of spawnIsland) {
      const parts = key.split(',');
      const x = parseInt(parts[0]!, 10);
      const z = parseInt(parts[1]!, 10);
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
    carveHallway(tiles, rooms, bestFrom.x, bestFrom.y, bestTo.x, bestTo.y, gridTiles, cellTileSize);
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
): void {
  // Track the bounding box of the hallway for room registration
  let minX = Math.min(x1, x2);
  let maxX = Math.max(x1, x2);
  let minZ = Math.min(z1, z2);
  let maxZ = Math.max(z1, z2);

  let x = x1;
  let z = z1;

  while (x !== x2 || z !== z2) {
    carveSpot(tiles, x, z, gridTiles);

    const cx = Math.floor(x / cellTileSize);
    const cz = Math.floor(z / cellTileSize);
    hallwayCells.add(`${cx},${cz}`);

    const dx = x2 - x;
    const dz = z2 - z;

    if (Math.abs(dx) > Math.abs(dz)) {
      x += Math.sign(dx);
    } else if (Math.abs(dz) > 0) {
      z += Math.sign(dz);
    } else {
      x += Math.sign(dx);
    }
  }

  carveSpot(tiles, x2, z2, gridTiles);
  hallwayCells.add(`${Math.floor(x2 / cellTileSize)},${Math.floor(z2 / cellTileSize)}`);

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
function carveSpot(tiles: TileType[][], cx: number, cz: number, gridTiles: number): void {
  for (let dz = -HALLWAY_HALF_WIDTH; dz <= HALLWAY_HALF_WIDTH; dz++) {
    for (let dx = -HALLWAY_HALF_WIDTH; dx <= HALLWAY_HALF_WIDTH; dx++) {
      // Circle shape — skip corners for rounded hallway
      if (dx * dx + dz * dz > HALLWAY_HALF_WIDTH * HALLWAY_HALF_WIDTH) continue;

      const tx = cx + dx;
      const tz = cz + dz;
      if (tx >= 1 && tz >= 1 && tx < gridTiles - 1 && tz < gridTiles - 1) {
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
