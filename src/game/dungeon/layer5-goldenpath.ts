/**
 * Layer 5 — Golden Path
 *
 * Reads: Layer 4 (connected tile grid with spawn and exit)
 * Writes: A* path from spawn to exit through floor tiles.
 *
 * The golden path is the guaranteed route from spawn to exit.
 * It exists so later layers can add obstacles (locked doors, puzzles)
 * without ever making the exit unreachable — they just check
 * if their obstacle blocks the golden path and provide a key/solution.
 *
 * Stored as a set of tile coordinates. Viewable in the debug map.
 */

import { TileType, type GridPos } from '../types';

/** The golden path tile coordinates. Read by debug map. */
export const goldenPath: GridPos[] = [];

export function computeGoldenPath(
  tiles: TileType[][],
  entrance: GridPos,
  exit: GridPos,
  gridTiles: number,
): void {
  goldenPath.length = 0;

  // A* from entrance to exit through floor tiles
  const openSet: Array<{ x: number; z: number; g: number; f: number; parent: string | null }> = [];
  const closed = new Map<string, string | null>();

  const endKey = `${exit.x},${exit.y}`;

  openSet.push({
    x: entrance.x, z: entrance.y,
    g: 0,
    f: Math.abs(exit.x - entrance.x) + Math.abs(exit.y - entrance.y),
    parent: null,
  });

  while (openSet.length > 0) {
    // Find lowest f
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i]!.f < openSet[bestIdx]!.f) bestIdx = i;
    }
    const current = openSet.splice(bestIdx, 1)[0]!;
    const key = `${current.x},${current.z}`;

    if (closed.has(key)) continue;
    closed.set(key, current.parent);

    if (key === endKey) break;

    for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = current.x + off[0]!;
      const nz = current.z + off[1]!;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) continue;

      const nKey = `${nx},${nz}`;
      if (closed.has(nKey)) continue;

      const tile = tiles[nz]![nx];
      if (tile === TileType.Wall) continue;

      const g = current.g + 1;
      const h = Math.abs(exit.x - nx) + Math.abs(exit.y - nz);

      openSet.push({ x: nx, z: nz, g, f: g + h, parent: key });
    }
  }

  // Trace back from exit to entrance
  let traceKey: string | null = endKey;
  const reversePath: GridPos[] = [];

  while (traceKey) {
    const parts = traceKey.split(',');
    reversePath.push({ x: parseInt(parts[0]!, 10), y: parseInt(parts[1]!, 10) });
    traceKey = closed.get(traceKey) ?? null;
  }

  // Reverse so it goes spawn → exit
  reversePath.reverse();

  // Store
  for (const p of reversePath) {
    goldenPath.push(p);
  }
}
