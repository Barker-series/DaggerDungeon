/**
 * Dungeon Generator
 *
 * The layer system IS the system. Nothing happens outside it.
 *
 * Layer 0: Noise — decides which cells are active
 * Layer 1: Tile grid — reads Layer 0, writes floor/wall tiles
 * Layer 2: Spawn/exit — picks spawn and exit positions
 * Layer 3: Spawn rooms — carves rooms at spawn/exit, connects to dungeon
 * Layer 4: Connectivity — bridges disconnected islands with hallways
 */

import { TileType, type DungeonData, type RoomData, type GridPos } from './types';
import { getOrCreateCell, getCell, resetCells } from './dungeon/cells';
import { generateLayer0 } from './dungeon/layer0-noise';
import { generateLayer1TileGrid } from './dungeon/layer1-tilegrid';
import { findSpawnExit, generateLayer2SpawnExit } from './dungeon/layer2-spawnexit';
import { generateLayer3SpawnRooms } from './dungeon/layer3-spawnrooms';
import { connectIslands } from './dungeon/layer4-connect';

// ── Config ──

const CELL_GRID_SIZE = 8;
const CELL_TILE_SIZE = 14;
const GRID_TILES = CELL_GRID_SIZE * CELL_TILE_SIZE;

// ── Public API ──

interface GenerateOpts {
  seed: number;
  floor: number;
}

export function generateDungeon(opts: GenerateOpts): DungeonData {
  const { seed, floor } = opts;
  resetCells();

  // Shared tile grid — layers read and write this directly
  const tiles: TileType[][] = Array.from({ length: GRID_TILES }, () =>
    Array.from({ length: GRID_TILES }, () => TileType.Wall),
  );
  const rooms: RoomData[] = [];

  // ── Layer 0: Noise ──
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getOrCreateCell(cx, cz);
      generateLayer0(cell, seed + floor * 1000);
    }
  }

  // ── Layer 1: Tile grid ──
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      generateLayer1TileGrid(cell, tiles, rooms, CELL_TILE_SIZE, GRID_TILES, 1);
    }
  }

  // ── Layer 2: Pick spawn/exit positions ──
  // Red flag: findSpawnExit reads all cells globally (not per-cell).
  const { spawnCx, spawnCz, exitCx, exitCz } = findSpawnExit(CELL_GRID_SIZE);

  let entrance: GridPos = {
    x: spawnCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    y: spawnCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
  };
  let exit: GridPos = {
    x: exitCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    y: exitCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
  };

  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      const result = generateLayer2SpawnExit(
        cell, tiles, rooms,
        spawnCx, spawnCz, exitCx, exitCz,
        CELL_TILE_SIZE, GRID_TILES, 2,
      );
      if (result.entrance) entrance = result.entrance;
      if (result.exit) exit = result.exit;
    }
  }

  // ── Layer 3: Spawn/exit rooms + connections to dungeon ──
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      generateLayer3SpawnRooms(
        cell, tiles, rooms,
        spawnCx, spawnCz, exitCx, exitCz,
        CELL_TILE_SIZE, GRID_TILES, 3,
      );
    }
  }

  // ── Layer 4: Connect disconnected islands ──
  connectIslands(tiles, rooms, entrance, GRID_TILES, CELL_TILE_SIZE);

  // ── Output ──
  return {
    width: GRID_TILES,
    height: GRID_TILES,
    tiles,
    rooms,
    entrance,
    exit,
    seed,
    floor,
  };
}
