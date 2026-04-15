/**
 * Layer 1 — Tile Grid
 *
 * Reads: Layer 0 (noise, active flags) from self + neighbors
 * Writes: Floor tiles for active cells. Walls form naturally where
 *         floor meets void — the renderer handles wall geometry.
 *
 * Simple rule: active cell = all tiles are floor. That's it.
 * No borders, no gaps, no corner fixes. Adjacent active cells
 * merge into one continuous floor space.
 */

import { type DungeonCell } from './cells';
import { TileType, RoomType, type RoomData } from '../types';

export function generateLayer1TileGrid(
  cell: DungeonCell,
  tiles: TileType[][],
  rooms: RoomData[],
  cellTileSize: number,
  gridTiles: number,
  layerNum: number = 1,
): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;

  if (!cell.active) {
    cell.layer = layerNum;
    return;
  }

  const baseX = cell.cx * cellTileSize;
  const baseZ = cell.cz * cellTileSize;

  // Fill entire cell with floor — no border, no gaps
  for (let tz = baseZ; tz < baseZ + cellTileSize; tz++) {
    for (let tx = baseX; tx < baseX + cellTileSize; tx++) {
      if (tx >= 0 && tz >= 0 && tx < gridTiles && tz < gridTiles) {
        tiles[tz]![tx] = TileType.Floor;
      }
    }
  }

  // Register as a room
  rooms.push({
    center: { x: baseX + Math.floor(cellTileSize / 2), y: baseZ + Math.floor(cellTileSize / 2) },
    left: baseX, top: baseZ,
    width: cellTileSize, height: cellTileSize,
    ceilingHeight: 3,
    type: RoomType.Combat,
    doors: [],
  });

  cell.layer = layerNum;
}
