/**
 * Layer 0 — Noise Field
 *
 * Base layer. No neighbor dependencies (this IS the base).
 * Each cell gets a noise value 0-1. High = dungeon here. Low = void.
 */

import type { DungeonCell } from './cells';
import { windowOrigin } from './cells';
import { sampleNoiseOctaves } from './noise';

const BOUNDARY_THRESHOLD = 0.45;

export function generateLayer0(cell: DungeonCell, worldSeed: number): void {
  if (cell.layer >= 0) return;

  const { ocx, ocz } = windowOrigin();
  cell.noise = sampleNoiseOctaves(ocx + cell.cx, ocz + cell.cz, worldSeed, 3, 2, 0.5);
  cell.active = cell.noise > BOUNDARY_THRESHOLD;

  cell.layer = 0;
}
