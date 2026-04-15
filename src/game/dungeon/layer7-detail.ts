/**
 * Layer 7 — Detail + Architecture
 *
 * Reads: Themed blocks from self + neighbors
 * Adds: Architectural details (pillars, alcoves, torches, rubble)
 */

import { type DungeonCell, neighborsAtLayer } from './cells';
import { cellSeed, mulberry32 } from './rng';

export function generateLayer7(cell: DungeonCell, worldSeed: number, layerNum: number = 6): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  const rng = mulberry32(cellSeed(cell.cx, cell.cz, worldSeed, 700));
  cell.details = [];

  if (!cell.active || cell.subtracted) {
    cell.layer = layerNum;
    return;
  }

  const hasContent = cell.isSpine || cell.branchBlocks.length > 0;
  if (!hasContent) {
    cell.layer = layerNum;
    return;
  }

  // Spine rooms get grander decoration
  if (cell.isSpine) {
    if (rng() < 0.6) cell.details.push({ type: 'torch', tileX: 0, tileZ: 0 });
    if (rng() < 0.3) cell.details.push({ type: 'pillar', tileX: 1, tileZ: 1 });
  }

  // Branch dead ends get loot indicators
  const isDeadEnd = cell.branchBlocks.length > 0 && !cell.isSpine;
  if (isDeadEnd && rng() < 0.5) {
    cell.details.push({ type: 'alcove', tileX: 0, tileZ: 0 });
  }

  // All content cells can get torches
  if (rng() < 0.4) {
    cell.details.push({ type: 'torch', tileX: 0, tileZ: 0 });
  }

  // Rubble near subtracted neighbors
  if (rng() < 0.3) {
    cell.details.push({ type: 'rubble', tileX: 0, tileZ: 0 });
  }

  cell.layer = layerNum;
}
