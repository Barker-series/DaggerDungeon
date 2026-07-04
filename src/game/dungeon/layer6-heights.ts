/**
 * Layer 6 — Ceiling Heights
 *
 * Reads: final tile grid, cell biomes (Layer 2)
 * Writes: a per-tile ceiling height field.
 *
 * Height is generation data, not a renderer afterthought:
 * - Cave biome: broad noise swells — low crawls opening into tall caverns
 * - Dungeon biome: one architectural height per cell, so merged cells
 *   read as distinct halls stepping into each other
 * - Carved connections through void: low tunnels, for contrast
 *
 * The renderer averages heights at tile corners, so single-tile jumps
 * become slopes and per-cell steps become short transition bands.
 */

import { TileType } from '../types';
import { getCell } from './cells';
import { sampleNoise } from './noise';

// World units. TILE_SIZE is 3 — corridors stay tighter than they are wide,
// halls and caverns open well past it.
const TUNNEL_HEIGHT = 3.5;
const DUNGEON_MIN = 5;
const DUNGEON_MAX = 8.5;
const CAVE_MIN = 4;
const CAVE_MAX = 13;
const CAVE_SWELL_SCALE = 14; // tiles per noise feature — broad swells
const CAVE_DETAIL_SCALE = 4; // small rock detail
const HEIGHT_STEP = 0.5; // dungeon heights quantize to this

export function computeCeilingHeights(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  worldSeed: number,
): number[][] {
  const heightSeed = worldSeed + 4242;
  const heights: number[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => TUNNEL_HEIGHT),
  );

  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall) continue;

      const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));

      if (!cell?.active) {
        // Carved connection through void — low tunnel
        heights[tz]![tx] = TUNNEL_HEIGHT;
        continue;
      }

      if (cell.biome === 'cave') {
        const swell = sampleNoise(tx, tz, heightSeed, CAVE_SWELL_SCALE);
        const detail = sampleNoise(tx, tz, heightSeed + 99, CAVE_DETAIL_SCALE);
        const h = CAVE_MIN + swell * (CAVE_MAX - CAVE_MIN) + (detail - 0.5) * 1.5;
        heights[tz]![tx] = Math.max(TUNNEL_HEIGHT, h);
      } else {
        // Dungeon — one flat architectural height per cell
        const cellNoise = sampleNoise(cell.cx, cell.cz, heightSeed + 7, 2);
        const raw = DUNGEON_MIN + cellNoise * (DUNGEON_MAX - DUNGEON_MIN);
        heights[tz]![tx] = Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP;
      }
    }
  }

  return heights;
}
