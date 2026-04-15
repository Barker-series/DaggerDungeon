/**
 * Layer 3 — Spawn & Exit Rooms
 *
 * Reads: Layer 2 (spawn/exit positions), Layer 1 (tile grid)
 * Writes: Carves a dedicated room at spawn and exit.
 *         Connects each room to the nearest active floor tile
 *         by routing through the existing level (not a direct line).
 *
 * These rooms are safe spaces — guaranteed to exist even in void.
 * The connections go through the dungeon so the player navigates.
 */

import { type DungeonCell } from './cells';
import { TileType, RoomType, type GridPos, type RoomData } from '../types';
import { Path } from 'rot-js';

const SPAWN_ROOM_SIZE = 5; // 5x5 room
const EXIT_ROOM_SIZE = 5;

export function generateLayer3SpawnRooms(
  cell: DungeonCell,
  tiles: TileType[][],
  rooms: RoomData[],
  spawnCx: number, spawnCz: number,
  exitCx: number, exitCz: number,
  cellTileSize: number,
  gridTiles: number,
  layerNum: number = 3,
): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;

  const isSpawnCell = cell.cx === spawnCx && cell.cz === spawnCz;
  const isExitCell = cell.cx === exitCx && cell.cz === exitCz;

  if (isSpawnCell) {
    const centerX = cell.cx * cellTileSize + Math.floor(cellTileSize / 2);
    const centerZ = cell.cz * cellTileSize + Math.floor(cellTileSize / 2);

    if (!cell.active) {
      // Void cell — carve a room and connect it to the dungeon
      carveRoom(tiles, centerX, centerZ, SPAWN_ROOM_SIZE, gridTiles);
      rooms.push({
        center: { x: centerX, y: centerZ },
        left: centerX - Math.floor(SPAWN_ROOM_SIZE / 2),
        top: centerZ - Math.floor(SPAWN_ROOM_SIZE / 2),
        width: SPAWN_ROOM_SIZE, height: SPAWN_ROOM_SIZE,
        ceilingHeight: 3.5,
        type: RoomType.Entrance,
        doors: [],
      });
      const nearest = findNearestFloor(tiles, centerX, centerZ, gridTiles);
      if (nearest) {
        carvePathThrough(tiles, centerX, centerZ, nearest.x, nearest.y, gridTiles);
      }
    }
    // If cell is active, Layer 1 already carved the full cell as floor.
    // Just tag the existing room as entrance.
    const existingRoom = rooms.find((r) =>
      centerX >= r.left && centerX < r.left + r.width &&
      centerZ >= r.top && centerZ < r.top + r.height,
    );
    if (existingRoom) existingRoom.type = RoomType.Entrance;
  }

  if (isExitCell) {
    const centerX = cell.cx * cellTileSize + Math.floor(cellTileSize / 2);
    const centerZ = cell.cz * cellTileSize + Math.floor(cellTileSize / 2);

    if (!cell.active) {
      // Void cell — carve a room and connect it to the dungeon
      carveRoom(tiles, centerX, centerZ, EXIT_ROOM_SIZE, gridTiles);
      rooms.push({
        center: { x: centerX, y: centerZ },
        left: centerX - Math.floor(EXIT_ROOM_SIZE / 2),
        top: centerZ - Math.floor(EXIT_ROOM_SIZE / 2),
        width: EXIT_ROOM_SIZE, height: EXIT_ROOM_SIZE,
        ceilingHeight: 3.5,
        type: RoomType.Boss,
        doors: [],
      });
      const nearest = findNearestFloor(tiles, centerX, centerZ, gridTiles);
      if (nearest) {
        carvePathThrough(tiles, centerX, centerZ, nearest.x, nearest.y, gridTiles);
      }
    }

    // Place stairs
    if (centerX >= 0 && centerZ >= 0 && centerX < gridTiles && centerZ < gridTiles) {
      tiles[centerZ]![centerX] = TileType.StairsDown;
    }
  }

  cell.layer = layerNum;
}

/** Carve a square room centered at (cx, cz) */
function carveRoom(tiles: TileType[][], cx: number, cz: number, size: number, gridTiles: number): void {
  const half = Math.floor(size / 2);
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      const tx = cx + dx;
      const tz = cz + dz;
      if (tx >= 1 && tz >= 1 && tx < gridTiles - 1 && tz < gridTiles - 1) {
        tiles[tz]![tx] = TileType.Floor;
      }
    }
  }
}

/** Find the nearest existing floor tile to (cx, cz) using BFS */
function findNearestFloor(tiles: TileType[][], cx: number, cz: number, gridTiles: number): GridPos | null {
  const visited = new Set<string>();
  const queue: GridPos[] = [{ x: cx, y: cz }];
  visited.add(`${cx},${cz}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;

    // Skip the spawn room itself — we want the DUNGEON floor, not our own room
    const dx = Math.abs(cur.x - cx);
    const dz = Math.abs(cur.y - cz);
    if (dx > 3 || dz > 3) {
      // Far enough from center — check if this is an existing floor tile
      if (tiles[cur.y]?.[cur.x] === TileType.Floor) {
        return cur;
      }
    }

    for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cur.x + off[0]!;
      const ny = cur.y + off[1]!;
      if (nx < 0 || ny < 0 || nx >= gridTiles || ny >= gridTiles) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  return null;
}

/**
 * Carve a path from (x1,z1) to (x2,z2) using A* on the tile grid.
 * Prefers routing through existing floor tiles (cheap) over carving
 * new floor through walls (expensive). This makes the path follow
 * the existing dungeon layout instead of cutting straight through.
 */
function carvePathThrough(
  tiles: TileType[][],
  x1: number, z1: number,
  x2: number, z2: number,
  gridTiles: number,
): void {
  const passable = (x: number, y: number): boolean => {
    return x >= 1 && y >= 1 && x < gridTiles - 1 && y < gridTiles - 1;
  };

  // Use ROT.js A* — it finds the path, we carve floor along it
  const astar = new Path.AStar(x2, z2, passable, { topology: 4 });
  const path: GridPos[] = [];
  astar.compute(x1, z1, (x, y) => {
    path.push({ x, y });
  });

  // Carve floor along the path
  for (const p of path) {
    if (tiles[p.y]?.[p.x] === TileType.Wall) {
      tiles[p.y]![p.x] = TileType.Floor;
    }
  }
}
