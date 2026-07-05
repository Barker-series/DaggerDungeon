/**
 * Layer 4.5 — Pillars
 *
 * Reads: connected tile grid (Layer 4), cell biomes (Layer 2)
 * Writes: single-tile columns in built-biome cells.
 *
 * Big flat halls need something holding the ceiling up. Pillars are placed
 * on a per-cell grid — sparse in dungeon halls, dense in crypts so they
 * read as an ossuary forest.
 *
 * Placement is conservative so connectivity can't break: a pillar only
 * lands where all 8 surrounding tiles are floor, and never adjacent to
 * spawn or exit. It runs before the golden path, which then routes
 * around them.
 */

import { TileType, type GridPos } from '../types';
import { getCell } from './cells';
import { cellSeed, mulberry32 } from './rng';

const DUNGEON_SPACING = 5; // tiles between pillars
const CRYPT_SPACING = 3;
const JITTER_CHANCE = 0.25; // some grid slots stay empty for variety

export function placePillars(
  tiles: TileType[][],
  entrance: GridPos,
  exit: GridPos,
  gridTiles: number,
  cellTileSize: number,
  worldSeed: number = 0,
  locked?: boolean[][],
): void {
  const cellCount = Math.ceil(gridTiles / cellTileSize);

  for (let cz = 0; cz < cellCount; cz++) {
    for (let cx = 0; cx < cellCount; cx++) {
      const cell = getCell(cx, cz);
      if (!cell?.active) continue;
      if (cell.biome !== 'dungeon' && cell.biome !== 'crypt') continue;

      const spacing = cell.biome === 'crypt' ? CRYPT_SPACING : DUNGEON_SPACING;
      const rng = mulberry32(cellSeed(cx, cz, worldSeed, 4545));

      const baseX = cx * cellTileSize;
      const baseZ = cz * cellTileSize;

      // Offset the grid so pillars sit away from cell edges
      for (let tz = baseZ + 2; tz < baseZ + cellTileSize - 1; tz += spacing) {
        for (let tx = baseX + 2; tx < baseX + cellTileSize - 1; tx += spacing) {
          if (rng() < JITTER_CHANCE) continue;
          if (locked?.[tz]?.[tx]) continue; // skeleton space stays clear
          if (!canPlacePillar(tiles, tx, tz, entrance, exit, gridTiles)) continue;
          tiles[tz]![tx] = TileType.Wall;
        }
      }
    }
  }
}

function canPlacePillar(
  tiles: TileType[][],
  tx: number,
  tz: number,
  entrance: GridPos,
  exit: GridPos,
  gridTiles: number,
): boolean {
  if (tx < 1 || tz < 1 || tx >= gridTiles - 1 || tz >= gridTiles - 1) return false;

  // Keep clear of spawn and exit
  if (Math.abs(tx - entrance.x) <= 2 && Math.abs(tz - entrance.y) <= 2) return false;
  if (Math.abs(tx - exit.x) <= 2 && Math.abs(tz - exit.y) <= 2) return false;

  // The tile and all 8 neighbors must be plain floor — never narrows a
  // passage, never touches stairs or doors
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tiles[tz + dz]![tx + dx] !== TileType.Floor) return false;
    }
  }
  return true;
}
