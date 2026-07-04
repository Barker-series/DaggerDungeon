/**
 * Layer 3 — Fine Noise (Cave Sculpting)
 *
 * Reads: Layer 2 (biome assignments), Layer 1 (tile grid)
 * Writes: Subtracts tiles in cave biome cells for organic shapes.
 *         Runs cellular automata smoothing passes to create
 *         natural rounded cave walls instead of jagged noise.
 *
 * Dungeon biome cells are untouched — clean rectangular walls.
 */

import { TileType } from '../types';
import { getCell, isOrganicBiome } from './cells';
import { sampleNoiseOctaves } from './noise';

const FINE_THRESHOLD = 0.38;
const SMOOTH_PASSES = 3; // cellular automata iterations

export function applyFineNoise(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  worldSeed: number,
): void {
  const fineSeed = worldSeed + 7777;

  // Pass 1: Noise-based subtraction on cave cells only
  for (let tz = 1; tz < gridTiles - 1; tz++) {
    for (let tx = 1; tx < gridTiles - 1; tx++) {
      if (tiles[tz]![tx] !== TileType.Floor) continue;

      const cx = Math.floor(tx / cellTileSize);
      const cz = Math.floor(tz / cellTileSize);
      const cell = getCell(cx, cz);
      if (!cell || !isOrganicBiome(cell.biome)) continue;

      const noise = sampleNoiseOctaves(tx, tz, fineSeed, 2, 2.5, 0.6);
      if (noise < FINE_THRESHOLD) {
        tiles[tz]![tx] = TileType.Wall;
      }
    }
  }

  // Pass 2: Cellular automata smoothing — only on cave biome tiles.
  // Rule: a tile becomes wall if 5+ of its 8 neighbors are wall,
  //        becomes floor if 4+ of its 8 neighbors are floor.
  // This rounds off jagged edges into organic cave shapes.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    // Build a snapshot so we read from old state while writing new state
    const snapshot: TileType[][] = tiles.map((row) => [...row]);

    for (let tz = 1; tz < gridTiles - 1; tz++) {
      for (let tx = 1; tx < gridTiles - 1; tx++) {
        // Only smooth organic biome cells
        const cx = Math.floor(tx / cellTileSize);
        const cz = Math.floor(tz / cellTileSize);
        const cell = getCell(cx, cz);
        if (!cell || !isOrganicBiome(cell.biome)) continue;

        // Count wall neighbors (8-directional)
        let wallCount = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            if (snapshot[tz + dz]![tx + dx] === TileType.Wall) wallCount++;
          }
        }

        if (wallCount >= 5) {
          tiles[tz]![tx] = TileType.Wall;
        } else if (wallCount <= 3) {
          tiles[tz]![tx] = TileType.Floor;
        }
        // 4 neighbors = keep current state (hysteresis)
      }
    }
  }
}
