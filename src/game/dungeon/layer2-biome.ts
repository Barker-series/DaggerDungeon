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
import { sampleNoise3D } from './noise';

const WILDNESS_SCALE = 3; // cells per region feature
const DEPTH_SCALE = 4;
/** Level-to-level drift of the biome fields — regions persist a couple of
 *  levels before morphing, so descending a shaft feels like moving through
 *  strata rather than into a random new map */
const LEVEL_Y_STEP = 0.45;
const ORGANIC_THRESHOLD = 0.52; // above = cave/ember/outside
const OUTSIDE_THRESHOLD = 0.72; // wildness beyond this breaks the surface
const CRYPT_THRESHOLD = 0.62; // built cells above this depth = crypt
const EMBER_THRESHOLD = 0.66; // organic cells above this depth = ember

/**
 * Assign biomes from two 3D noise fields sampled at this level's depth.
 * `stackSeed` is shared by every level of a stack so the fields are
 * vertically continuous. Only the top level may be `outside` — below it
 * there is always structure overhead, so surface-break wildness becomes
 * cave instead.
 */
export function assignBiomes(_cellTileSize: number, stackSeed: number, level: number): void {
  const wildSeed = stackSeed + 1313;
  const depthSeed = stackSeed + 2626;
  const y = level * LEVEL_Y_STEP;

  for (const cell of getAllCells()) {
    if (!cell.active) continue;

    const wildness = sampleNoise3D(cell.cx / WILDNESS_SCALE, y, cell.cz / WILDNESS_SCALE, wildSeed);
    const depth = sampleNoise3D(cell.cx / DEPTH_SCALE, y, cell.cz / DEPTH_SCALE, depthSeed);

    if (wildness > OUTSIDE_THRESHOLD) {
      cell.biome = level === 0 ? 'outside' : 'cave';
    } else if (wildness > ORGANIC_THRESHOLD) {
      cell.biome = depth > EMBER_THRESHOLD ? 'ember' : 'cave';
    } else {
      cell.biome = depth > CRYPT_THRESHOLD ? 'crypt' : 'dungeon';
    }
  }
}
