/**
 * Layer 2 — Branch Growth
 *
 * Reads: Layer 1 spine from self + neighbors, Layer 0 noise
 * Adds: Side branches growing outward from the spine
 *
 * Runs MULTIPLE passes so branches can chain off each other.
 * Each pass, new branches can see branches from previous passes.
 */

import { type DungeonCell, getCell, getAllCells, neighborsAtLayer } from './cells';
import { getRandomBlock } from './blocks';
import { cellSeed, mulberry32 } from './rng';

const BRANCH_PASSES = 5; // how many waves of branch growth
const BRANCH_PROBABILITY = 0.7; // base chance for an active cell adjacent to path

export function generateLayer2(cell: DungeonCell, _worldSeed: number, layerNum: number = 2): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  cell.layer = layerNum;
}

/**
 * Run after all cells reach Layer 2.
 * Multiple passes allow branches to chain off each other.
 */
export function growBranches(worldSeed: number): void {
  for (let pass = 0; pass < BRANCH_PASSES; pass++) {
    const cells = getAllCells();
    let grew = false;

    for (const cell of cells) {
      if (!cell.active || cell.isSpine || cell.subtracted) continue;
      if (cell.branchBlocks.length > 0) continue; // already a branch

      const rng = mulberry32(cellSeed(cell.cx, cell.cz, worldSeed, 200 + pass));

      // Check if any cardinal neighbor has content (spine or existing branch)
      let adjacentToPath = false;
      for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const neighbor = getCell(cell.cx + off[0]!, cell.cz + off[1]!);
        if (neighbor && (neighbor.isSpine || neighbor.branchBlocks.length > 0)) {
          adjacentToPath = true;
          break;
        }
      }

      if (!adjacentToPath) continue;

      // Waypoint proximity bonus — cells near waypoints are much more likely to branch
      let waypointBonus = 0;
      for (const off of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [0, 2], [-2, 0], [2, 0]]) {
        const nearby = getCell(cell.cx + off[0]!, cell.cz + off[1]!);
        if (nearby?.isWaypoint) { waypointBonus = 0.35; break; }
      }

      // Probability decreases with each pass (branches get less likely farther out)
      const passFalloff = 1 - (pass / BRANCH_PASSES) * 0.5;
      if (rng() < BRANCH_PROBABILITY * cell.noise * passFalloff + waypointBonus) {
        const def = rng() < 0.35
          ? getRandomBlock('room', rng)
          : getRandomBlock('corridor', rng);
        cell.branchBlocks.push({ def, gridX: 0, gridZ: 0, rotation: 0 });
        grew = true;
      }
    }

    if (!grew) break; // no new branches this pass, stop early
  }
}
