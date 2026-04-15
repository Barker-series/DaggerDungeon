/**
 * Layer 4 — Subtraction
 *
 * Reads: Everything below from self + neighbors
 * Removes: Sections of the dungeon (collapsed tunnels, chasms, etc.)
 * NEVER removes spine cells.
 */

import { type DungeonCell, getCell, neighborsAtLayer } from './cells';
import { cellSeed, mulberry32 } from './rng';

export function generateLayer4(cell: DungeonCell, worldSeed: number, layerNum: number = 3): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  cell.subtracted = false;
  // Subtraction disabled — was removing content without adding value
  cell.layer = layerNum;
  return;

  const rng = mulberry32(cellSeed(cell.cx, cell.cz, worldSeed, 400));

  // Never subtract spine cells
  if (cell.isSpine) {
    cell.layer = layerNum;
    return;
  }

  // Never subtract waypoint cells or cells adjacent to waypoints
  if (cell.isWaypoint) {
    cell.layer = layerNum;
    return;
  }
  for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nearby = getCell(cell.cx + off[0]!, cell.cz + off[1]!);
    if (nearby?.isWaypoint) {
      cell.layer = layerNum;
      return;
    }
  }

  // Skip cells with no content
  if (!cell.active || cell.branchBlocks.length === 0) {
    cell.layer = layerNum;
    return;
  }

  // Low-noise branch cells near the boundary are candidates for subtraction
  if (cell.noise < 0.45 && rng() < 0.35) {
    cell.subtracted = true;
    cell.branchBlocks = [];
  }

  cell.layer = layerNum;
}
