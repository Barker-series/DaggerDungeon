/**
 * Roads region — crude walkable slice (step 2 of docs/roads-layer-design.md).
 *
 * Rasterizes the arterial vein field (road-field.ts, --veins mode) into the
 * tile grid for dungeon cells inside 'roads' districts: road tiles become
 * floor, everything else becomes solid mass. Runs BEFORE the permanent
 * transit layer, so layer 4's hubs/sockets still guarantee connectivity as
 * the fallback skeleton while the street network earns its own invariant.
 *
 * Pure per-tile evaluation of the (seed, world-position) field — shifted
 * windows agree by construction; no ownership machinery needed.
 */

import { TileType } from '../types';
import { TILE_SIZE } from '../types';
import { getAllCells, windowOrigin } from './cells';
import { regionAtCell } from './region-layer';
import { roadVeinsAt, DEFAULT_ROAD_PARAMS, type RoadFieldParams } from './road-field';

/** In-game tuning of the vein field (world units). Zoomed preset: wider
 *  streets, farther apart (mask reference /tmp/rm-zoom2 proportions). */
export const GAME_ROAD_PARAMS: RoadFieldParams = {
  ...DEFAULT_ROAD_PARAMS,
  spacing: 64,
  streetWidth: 9,
  terrainScale: 2600,
};

/**
 * Carve street veins into all 'roads'-district cells of the window.
 * `cellTileSize` is dungeon-cell tiles; absolute tile coords come from the
 * window origin so the field is sampled at permanent world positions.
 */
export function carveRoadsRegion(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  stackSeed: number,
): void {
  const { ocx, ocz } = windowOrigin();
  for (const cell of getAllCells()) {
    if (!cell.active) continue;
    const acx = ocx + cell.cx;
    const acz = ocz + cell.cz;
    if (regionAtCell(stackSeed, acx, acz) !== 'roads') continue;

    const tx0 = cell.cx * cellTileSize;
    const tz0 = cell.cz * cellTileSize;
    for (let tz = tz0; tz < Math.min(tz0 + cellTileSize, gridTiles); tz++) {
      for (let tx = tx0; tx < Math.min(tx0 + cellTileSize, gridTiles); tx++) {
        // Absolute world position of the tile center.
        const wx = (ocx * cellTileSize + tx + 0.5) * TILE_SIZE;
        const wz = (ocz * cellTileSize + tz + 0.5) * TILE_SIZE;
        const s = roadVeinsAt(stackSeed, wx, wz, GAME_ROAD_PARAMS);
        tiles[tz]![tx] = s.road ? TileType.Floor : TileType.Wall;
      }
    }
  }
}
