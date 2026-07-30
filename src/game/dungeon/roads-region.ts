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

import { TileType, TILE_SIZE, SKY_CEIL, type ColumnSpan } from '../types';
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
    const acx = ocx + cell.cx;
    const acz = ocz + cell.cz;
    if (regionAtCell(stackSeed, acx, acz) !== 'roads') continue;

    // ARTERIES NEVER BREAK: the layer-0 activity gate exists to cull room
    // generation, which roads districts don't use. An inactive cell here
    // would be an uncut full-height mega-block with streets dead-ending
    // into it. Roads cells are always active, always 'outside' at grade.
    if (!cell.active) {
      cell.active = true;
      cell.biome = 'outside';
    }

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

/**
 * Suppress void-field pits on roads-district street tiles. Streets are
 * arteries — a bottomless hole mid-path breaks the "arteries never
 * break" contract and reads as a trap, not a feature. Blocks are solid
 * mass and never pit anyway. (A future canyon-flavored district could
 * invert this and push pits to the extreme instead — see PLAN.)
 * Runs between computePitMask and computeHeightFields.
 */
export function suppressRoadPits(
  pitMask: boolean[][],
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  stackSeed: number,
): void {
  const { ocx, ocz } = windowOrigin();
  for (const cell of getAllCells()) {
    if (regionAtCell(stackSeed, ocx + cell.cx, ocz + cell.cz) !== 'roads') continue;
    const tx0 = cell.cx * cellTileSize;
    const tz0 = cell.cz * cellTileSize;
    for (let tz = tz0; tz < Math.min(tz0 + cellTileSize, gridTiles); tz++) {
      for (let tx = tx0; tx < Math.min(tx0 + cellTileSize, gridTiles); tx++) {
        if (tiles[tz]![tx] === TileType.Floor) pitMask[tz]![tx] = false;
      }
    }
  }
}

/**
 * Flatten roads-district street floors to grade (0.5). The organic
 * outside-biome terrain otherwise rolls streets up and down against the
 * quantized block tops, recreating the knee-high un-steppable lips the
 * quantization exists to eliminate. Pits (bottomless) are preserved.
 * Runs after computeHeightFields, before the column build.
 */
export function flattenRoadStreets(
  floorHeights: number[][],
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  stackSeed: number,
): void {
  const { ocx, ocz } = windowOrigin();
  for (const cell of getAllCells()) {
    if (regionAtCell(stackSeed, ocx + cell.cx, ocz + cell.cz) !== 'roads') continue;
    const tx0 = cell.cx * cellTileSize;
    const tz0 = cell.cz * cellTileSize;
    for (let tz = tz0; tz < Math.min(tz0 + cellTileSize, gridTiles); tz++) {
      for (let tx = tx0; tx < Math.min(tx0 + cellTileSize, gridTiles); tx++) {
        if (tiles[tz]![tx] !== TileType.Floor) continue;
        if (floorHeights[tz]![tx]! <= -900) continue; // keep bottomless pits
        floorHeights[tz]![tx] = 0.5;
      }
    }
  }
}

/**
 * Cut the negative space between streets down to walkable plinths.
 *
 * Solid block mass (Wall columns in roads districts) becomes a flat-topped
 * plinth under open sky: one air span from the block's top to SKY_CEIL.
 * Height is a pure per-BLOCK value (every tile of a block shares its
 * Voronoi site's hash), so each block is one clean flat mass and the
 * street walls vary block to block: sunken courts, low plazas, tall
 * monoliths — building sites shaped by the street flow, not the grid.
 *
 * Flat structural tops at one height per block obey the seam doctrine
 * (no flat-vs-blended contact at equal height; street edges differ in
 * height and get real sealing wall faces).
 */
export function cutRoadBlockTops(
  columns: ColumnSpan[][],
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  stackSeed: number,
  pillarWall: boolean[][],
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
        if (tiles[tz]![tx] !== TileType.Wall || pillarWall[tz]![tx]) continue;
        const wx = (ocx * cellTileSize + tx + 0.5) * TILE_SIZE;
        const wz = (ocz * cellTileSize + tz + 0.5) * TILE_SIZE;
        const s = roadVeinsAt(stackSeed, wx, wz, GAME_ROAD_PARAMS);
        if (s.road) continue;
        // Per-block top, QUANTIZED to the 3-unit structural module
        // (pillar-rooms kit). Courts sit 0.6 above the flat street grade
        // (0.5): a walkable 0.1 step. Masses are 3/6/9/12. Every edge in
        // the district is therefore ≤0.65 (steppable) or ≥2.4 (a real
        // wall) — no knee-high lips in the un-steppable dead zone to get
        // stuck on. blockHash is constant per block.
        const top = s.blockHash < 0.22
          ? 0.6
          : 3 * (1 + Math.min(3, Math.floor(((s.blockHash - 0.22) / 0.78) * 4)));
        columns[tz * gridTiles + tx] = [
          { floor: top, ceil: SKY_CEIL, owner: -1, ceilOwner: -1 },
        ];
      }
    }
  }
}
