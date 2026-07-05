/**
 * Cell Grid — LayerProcGen architecture
 *
 * The dungeon floor is divided into a grid of cells.
 * Each cell tracks its layer progression.
 * Layers read and write the shared tile grid directly.
 */

// ── The cell ──

export type BiomeType = 'dungeon' | 'cave' | 'crypt' | 'ember' | 'outside';

/** Biomes with organic (noise-sculpted, marching-squares) walls and rolling floors */
export function isOrganicBiome(biome: BiomeType): boolean {
  return biome === 'cave' || biome === 'ember' || biome === 'outside';
}

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

// ── Per-level biome snapshots ──
// The cell map is a generation-time singleton: it only ever holds the level
// currently being generated. Anything that runs after generation (renderer,
// contour collision, lighting) reads a snapshot carried on the level data.

export const CELL_TILE_SIZE = 14;

/** Capture the current cell map's biomes as a plain grid (null = inactive). */
export function snapshotCellBiomes(cellGridSize: number): (BiomeType | null)[][] {
  const grid: (BiomeType | null)[][] = Array.from({ length: cellGridSize }, () =>
    Array.from({ length: cellGridSize }, () => null),
  );
  for (const cell of getAllCells()) {
    if (cell.cx >= 0 && cell.cz >= 0 && cell.cx < cellGridSize && cell.cz < cellGridSize) {
      grid[cell.cz]![cell.cx] = cell.active ? cell.biome : null;
    }
  }
  return grid;
}

/** Biome of the cell containing a tile, from a snapshot. */
export function tileBiome(cellBiomes: (BiomeType | null)[][], tx: number, tz: number): BiomeType | null {
  return cellBiomes[Math.floor(tz / CELL_TILE_SIZE)]?.[Math.floor(tx / CELL_TILE_SIZE)] ?? null;
}
