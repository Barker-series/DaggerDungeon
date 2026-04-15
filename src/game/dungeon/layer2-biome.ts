/**
 * Layer 2 — Biome Assignment
 *
 * Reads: Layer 0 (noise values), Layer 1 (tile grid)
 * Writes: Assigns a biome type to each active cell.
 *
 * Rules:
 * - If there are disconnected islands, the smallest island becomes cave
 * - If there's only one island, 50% chance the whole thing is cave
 * - Only one island gets cave, rest stay dungeon
 */

import { type DungeonCell, getAllCells, getCell } from './cells';

export function assignBiomes(_cellTileSize: number, worldSeed: number): void {
  const activeCells = getAllCells().filter((c) => c.active);
  if (activeCells.length === 0) return;

  // Find islands via flood fill on the cell grid
  const visited = new Set<string>();
  const islands: DungeonCell[][] = [];

  for (const cell of activeCells) {
    if (visited.has(cell.key)) continue;

    // Flood fill this island
    const island: DungeonCell[] = [];
    const queue: DungeonCell[] = [cell];
    visited.add(cell.key);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      island.push(cur);

      for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cur.cx + off[0]!;
        const nz = cur.cz + off[1]!;
        const neighbor = getCell(nx, nz);
        if (!neighbor?.active) continue;
        if (visited.has(neighbor.key)) continue;
        visited.add(neighbor.key);
        queue.push(neighbor);
      }
    }

    islands.push(island);
  }

  // Default everything to dungeon
  for (const cell of activeCells) {
    cell.biome = 'dungeon';
  }

  if (islands.length >= 2) {
    // Multiple islands — smallest one becomes cave
    islands.sort((a, b) => a.length - b.length);
    const caveIsland = islands[0]!;
    for (const cell of caveIsland) {
      cell.biome = 'cave';
    }
  } else {
    // Single island — 50% chance it's cave
    // Use seed for determinism
    const roll = (worldSeed * 2654435761 >>> 0) / 4294967296;
    if (roll < 0.5) {
      for (const cell of activeCells) {
        cell.biome = 'cave';
      }
    }
  }
}
