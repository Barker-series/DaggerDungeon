/**
 * Layer 2 — Spawn & Exit Placement
 *
 * Reads: Layer 1 (tile grid with floor tiles) from self + neighbors
 * Writes: Marks entrance tile as floor, exit tile as StairsDown.
 *         Tags the entrance and exit rooms.
 *
 * Finds the two farthest-apart active cells and places
 * spawn and exit at their centers.
 */

import { type DungeonCell, getAllCells } from './cells';
import { TileType, RoomType, type GridPos, type RoomData } from '../types';

/** Run once globally to find spawn/exit positions from active cells */
export function findSpawnExit(cellGridSize: number): { spawnCx: number; spawnCz: number; exitCx: number; exitCz: number } {
  const activeCells = getAllCells().filter((c) => c.active);

  // If no active cells, something is very wrong — force center cell active
  if (activeCells.length === 0) {
    const center = Math.floor(cellGridSize / 2);
    return { spawnCx: center, spawnCz: center, exitCx: center, exitCz: center };
  }

  // Default to first active cell (guaranteed active)
  let spawnCx = activeCells[0]!.cx;
  let spawnCz = activeCells[0]!.cz;
  let exitCx = spawnCx;
  let exitCz = spawnCz;
  let bestScore = 0;

  for (let i = 0; i < activeCells.length; i++) {
    for (let j = i + 1; j < activeCells.length; j++) {
      const a = activeCells[i]!;
      const b = activeCells[j]!;
      const dist = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
      const score = dist * (a.noise + b.noise);
      if (score > bestScore) {
        bestScore = score;
        spawnCx = a.cx; spawnCz = a.cz;
        exitCx = b.cx; exitCz = b.cz;
      }
    }
  }

  return { spawnCx, spawnCz, exitCx, exitCz };
}

/** Per-cell layer function — marks entrance/exit tiles */
export function generateLayer2SpawnExit(
  cell: DungeonCell,
  tiles: TileType[][],
  rooms: RoomData[],
  spawnCx: number, spawnCz: number,
  exitCx: number, exitCz: number,
  cellTileSize: number,
  gridTiles: number,
  layerNum: number = 2,
): { entrance: GridPos | null; exit: GridPos | null } {
  if (cell.layer >= layerNum) return { entrance: null, exit: null };
  if (cell.layer < layerNum - 1) return { entrance: null, exit: null };
  // No neighbor gate — Layer 2 only reads its own cell's position

  let entrance: GridPos | null = null;
  let exit: GridPos | null = null;

  if (cell.cx === spawnCx && cell.cz === spawnCz) {
    const tileX = cell.cx * cellTileSize + Math.floor(cellTileSize / 2);
    const tileZ = cell.cz * cellTileSize + Math.floor(cellTileSize / 2);
    if (tileX >= 0 && tileZ >= 0 && tileX < gridTiles && tileZ < gridTiles) {
      // Clear a 3x3 area around spawn so player never gets stuck
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = tileX + dx;
          const sz = tileZ + dz;
          if (sx >= 0 && sz >= 0 && sx < gridTiles && sz < gridTiles) {
            tiles[sz]![sx] = TileType.Floor;
          }
        }
      }
      entrance = { x: tileX, y: tileZ };
    }
    // Tag the room
    const room = rooms.find((r) =>
      tileX >= r.left && tileX < r.left + r.width &&
      tileZ >= r.top && tileZ < r.top + r.height,
    );
    if (room) room.type = RoomType.Entrance;
  }

  if (cell.cx === exitCx && cell.cz === exitCz) {
    const tileX = cell.cx * cellTileSize + Math.floor(cellTileSize / 2);
    const tileZ = cell.cz * cellTileSize + Math.floor(cellTileSize / 2);
    if (tileX >= 0 && tileZ >= 0 && tileX < gridTiles && tileZ < gridTiles) {
      tiles[tileZ]![tileX] = TileType.StairsDown;
      exit = { x: tileX, y: tileZ };
    }
  }

  cell.layer = layerNum;
  return { entrance, exit };
}
