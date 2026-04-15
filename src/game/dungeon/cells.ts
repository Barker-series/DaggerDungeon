/**
 * Cell Grid — LayerProcGen architecture
 *
 * The dungeon floor is divided into a grid of cells.
 * Each cell tracks its layer progression.
 * Layers read and write the shared tile grid directly.
 */

// ── The cell ──

export type BiomeType = 'dungeon' | 'cave';

export interface DungeonCell {
  cx: number;
  cz: number;
  key: string;
  layer: number;

  // Layer 0 — Coarse Noise
  noise: number;
  active: boolean;

  // Layer 2 — Biome
  biome: BiomeType;

  // Waypoints (disabled — will be a proper numbered layer when enabled)
  isWaypoint: boolean;
  waypointOrder: number;
  waypointRole: 'spawn' | 'exit' | 'major' | 'minor' | 'none';
}

// ── Cell map ──

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
      biome: 'dungeon',
      isWaypoint: false,
      waypointOrder: -1,
      waypointRole: 'none',
    };
    cellMap.set(key, cell);
  }
  return cell;
}

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

export function resetCells(): void {
  cellMap.clear();
}

export function getAllCells(): DungeonCell[] {
  return [...cellMap.values()];
}
