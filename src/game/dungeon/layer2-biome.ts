/**
 * Layer 2 — Biome Assignment
 *
 * Reads: Layer 0 (noise values), Layer 1 (tile grid)
 * Writes: Assigns a biome type to each active cell.
 *
 * Two noise fields drive assignment so biomes form contiguous regions:
 * - "wildness" separates built space (dungeon/crypt) from organic space
 *   (cave/ember)
 * - "depth" splits each side into its common and rare variant
 *
 * Biomes:
 * - dungeon: brick halls, flat floor, mid ceilings (common built)
 * - crypt:   cold, low, dense pillars — oppressive (rare built)
 * - cave:    warm organic, rolling floor, swelling ceilings (common organic)
 * - ember:   vast red-lit rifts, tall vaults, deep floors (rare organic)
 * - outside: open sky — no ceiling at all, moonlit canyon walls
 *   (the wildest extreme of the wildness field)
 */

import { getAllCells } from './cells';
import { sampleNoise } from './noise';

const WILDNESS_SCALE = 3; // cells per region feature
const DEPTH_SCALE = 4;
const ORGANIC_THRESHOLD = 0.52; // above = cave/ember/outside
const OUTSIDE_THRESHOLD = 0.72; // wildness beyond this breaks the surface
const CRYPT_THRESHOLD = 0.62; // built cells above this depth = crypt
const EMBER_THRESHOLD = 0.66; // organic cells above this depth = ember

export function assignBiomes(_cellTileSize: number, worldSeed: number): void {
  const wildSeed = worldSeed + 1313;
  const depthSeed = worldSeed + 2626;

  for (const cell of getAllCells()) {
    if (!cell.active) continue;

    const wildness = sampleNoise(cell.cx, cell.cz, wildSeed, WILDNESS_SCALE);
    const depth = sampleNoise(cell.cx, cell.cz, depthSeed, DEPTH_SCALE);

    if (wildness > OUTSIDE_THRESHOLD) {
      cell.biome = 'outside';
    } else if (wildness > ORGANIC_THRESHOLD) {
      cell.biome = depth > EMBER_THRESHOLD ? 'ember' : 'cave';
    } else {
      cell.biome = depth > CRYPT_THRESHOLD ? 'crypt' : 'dungeon';
    }
  }
}
