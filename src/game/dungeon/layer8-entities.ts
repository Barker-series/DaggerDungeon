/**
 * Layer 8 — Entity Placement
 *
 * Reads: Everything below
 * Places: Enemies, loot, traps, props
 */

import { type DungeonCell, neighborsAtLayer } from './cells';
import { cellSeed, mulberry32 } from './rng';

export function generateLayer8(cell: DungeonCell, worldSeed: number, spineDistance: number, layerNum: number = 7): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  const rng = mulberry32(cellSeed(cell.cx, cell.cz, worldSeed, 800));
  cell.entities = [];

  if (!cell.active || cell.subtracted) {
    cell.layer = layerNum;
    return;
  }

  const hasContent = cell.isSpine || cell.branchBlocks.length > 0;
  if (!hasContent) {
    cell.layer = layerNum;
    return;
  }

  // Enemy placement — harder enemies further from spawn along the spine
  const difficultyScale = Math.min(1, spineDistance / 10);

  if (cell.isSpine) {
    // Spine rooms get combat encounters
    if (rng() < 0.6 + difficultyScale * 0.2) {
      const enemyType = difficultyScale < 0.3 ? 'rat'
        : difficultyScale < 0.6 ? 'skeleton'
        : rng() < 0.5 ? 'orc' : 'imp';
      cell.entities.push({ type: 'enemy', subtype: enemyType, tileX: 0, tileZ: 0 });

      // Additional enemies at higher difficulty
      if (difficultyScale > 0.4 && rng() < 0.5) {
        cell.entities.push({ type: 'enemy', subtype: 'skeleton', tileX: 2, tileZ: 2 });
      }
    }
  }

  // Branch cells get loot and occasional enemies
  if (cell.branchBlocks.length > 0 && !cell.isSpine) {
    if (rng() < 0.4) {
      cell.entities.push({ type: 'loot', subtype: 'chest', tileX: 1, tileZ: 1 });
    }
    if (rng() < 0.3) {
      cell.entities.push({ type: 'enemy', subtype: rng() < 0.5 ? 'rat' : 'bat', tileX: 0, tileZ: 0 });
    }
  }

  // Traps near dead ends
  if (cell.branchBlocks.length > 0 && !cell.isSpine && rng() < 0.2) {
    cell.entities.push({ type: 'trap', subtype: 'spike', tileX: 0, tileZ: 0 });
  }

  cell.layer = layerNum;
}
