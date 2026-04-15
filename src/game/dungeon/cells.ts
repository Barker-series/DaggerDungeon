/**
 * Cell Grid — LayerProcGen architecture from runGame Blame
 *
 * The dungeon floor is divided into a grid of cells.
 * Each cell tracks its layer progression (-1 through 8).
 * A cell can only advance to layer N when all 8 neighbors are at layer N-1.
 *
 * This is the skeleton. Layer functions are imported and called here.
 */

import type { GridPos } from '../types';
import type { BlockPlacement } from './blocks';

// ── Theme types ──

export type ThemeType = 'crypt' | 'sewer' | 'cave' | 'castle' | 'void';

// ── Entity spawn (Layer 8 output) ──

export interface EntitySpawn {
  type: 'enemy' | 'loot' | 'trap' | 'prop';
  subtype: string;
  tileX: number;
  tileZ: number;
}

// ── Detail placement (Layer 7 output) ──

export interface DetailPlacement {
  type: 'pillar' | 'alcove' | 'torch' | 'rubble';
  tileX: number;
  tileZ: number;
}

// ── The cell ──

export interface DungeonCell {
  cx: number;
  cz: number;
  key: string;
  layer: number; // -1 through 8

  // Layer 0 — Noise
  noise: number;
  active: boolean; // noise > threshold = dungeon exists here

  // Layer 0.5 — Waypoints (intent layer)
  isWaypoint: boolean;
  waypointOrder: number; // -1 if not a waypoint, else 0..N for visit order
  waypointRole: 'spawn' | 'exit' | 'major' | 'minor' | 'none';

  // Layer 1 — Spine
  isSpine: boolean;
  spineBlocks: BlockPlacement[];

  // Layer 2 — Branches
  branchBlocks: BlockPlacement[];


  // Layer 4 — Subtraction
  subtracted: boolean; // entire cell removed

  // Layer 5 — Correction
  correctionTiles: GridPos[];

  // Layer 6 — Theming
  theme: ThemeType;

  // Layer 7 — Detail
  details: DetailPlacement[];

  // Layer 8 — Entities
  entities: EntitySpawn[];
}

// ── Cell map (following runGame Blame exactly) ──

const cellMap = new Map<string, DungeonCell>();

export function getCellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function getCell(cx: number, cz: number): DungeonCell | undefined {
  return cellMap.get(getCellKey(cx, cz));
}

export function getOrCreateCell(cx: number, cz: number): DungeonCell {
  const key = getCellKey(cx, cz);
  let cell = cellMap.get(key);
  if (!cell) {
    cell = {
      cx, cz, key,
      layer: -1,
      noise: 0,
      active: false,
      isWaypoint: false,
      waypointOrder: -1,
      waypointRole: 'none',
      isSpine: false,
      spineBlocks: [],
      branchBlocks: [],
      subtracted: false,
      correctionTiles: [],
      theme: 'crypt',
      details: [],
      entities: [],
    };
    cellMap.set(key, cell);
  }
  return cell;
}

/**
 * Check if all 8 neighbors are at least at the given layer.
 * This is the core LayerProcGen dependency mechanism.
 */
export function neighborsAtLayer(cx: number, cz: number, minLayer: number): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const neighbor = getCell(cx + dx, cz + dz);
      if (!neighbor || neighbor.layer < minLayer) return false;
    }
  }
  return true;
}

/**
 * Get all 8 neighbors that exist.
 */
export function getNeighbors(cx: number, cz: number): DungeonCell[] {
  const result: DungeonCell[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const neighbor = getCell(cx + dx, cz + dz);
      if (neighbor) result.push(neighbor);
    }
  }
  return result;
}

/**
 * Clear the cell map. Call before generating a new dungeon.
 */
export function resetCells(): void {
  cellMap.clear();
}

/**
 * Get all cells in the map.
 */
export function getAllCells(): DungeonCell[] {
  return [...cellMap.values()];
}
