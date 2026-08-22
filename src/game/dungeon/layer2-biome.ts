/**
 * Layer 2 — Biome Assignment
 *
 * Reads: Layer 0 (noise values), Layer 1 (tile grid), and the pillar
 * layer's elevation field.
 * Writes: Assigns a biome type to each active cell.
 *
 * Biomes are DERIVED from smooth world-scale fields, then quantized to
 * the cell grid — regions flow like geography, but every cell still has
 * exactly one biome and built biomes keep hard grid edges:
 * - "wildness" separates built space (dungeon/crypt) from organic space
 *   (cave/ember/outside). Three octaves (each twice the detail, half the
 *   strength) so region outlines have coastline detail instead of the
 *   soap-bubble blobs single-octave noise makes; the sample position is
 *   domain-warped by a low-frequency offset field so boundaries meander.
 *   The shared ELEVATION field (the one pillar heights read) is mixed in,
 *   so the wild, sky-open districts correlate with the tall-pillar
 *   districts — the world reads as one geography, not stacked layers of
 *   unrelated noise.
 * - "depth" splits each side into its common and rare variant.
 *
 * Everything is a pure function of (stackSeed, cx, cz, level): no grid
 * bounds, no scans — infinite-world discipline holds.
 *
 * Biomes:
 * - dungeon: brick halls, flat floor, mid ceilings (common built)
 * - crypt:   cold, low, dense pillars — oppressive (rare built)
 * - cave:    warm organic, rolling floor, swelling ceilings (common organic)
 * - ember:   vast red-lit rifts, tall vaults, deep floors (rare organic)
 * - outside: open sky — no ceiling at all, moonlit canyon walls
 *   (the wildest extreme of the wildness field)
 */

import { getAllCells, windowOrigin } from './cells';
import { sampleNoise3D } from './noise';
import { elevationField, PILLAR_FACTOR } from './pillar-layer';
import { regionAtCell } from './region-layer';

const WILDNESS_SCALE = 3; // cells per region feature
const DEPTH_SCALE = 4;
/** Level-to-level drift of the biome fields — regions persist a couple of
 *  levels before morphing, so descending a shaft feels like moving through
 *  strata rather than into a random new map */
const LEVEL_Y_STEP = 0.45;
/** Cells of lateral meander applied to the wildness sample position */
const WARP_AMP = 1.6;
/** How much of wildness comes from the shared elevation field */
const ELEVATION_MIX = 0.3;

// Thresholds are PERCENTILES of the field distribution. Since the
// region layer, these come from the cell's DISTRICT (region-layer.ts
// palettes) — the 'frontier' palette holds the old global values.

/** Three-octave fractal noise: big layer sculpts regions, smaller ones
 *  give the boundary its coastline. y (level drift) stays unscaled so
 *  strata continuity is unchanged. */
function fbm3(x: number, y: number, z: number, seed: number): number {
  let v = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    v += sampleNoise3D(x * freq, y, z * freq, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / norm;
}

/**
 * The continuous wildness field at cell coordinates (fractional ok).
 * Exposed so anything wanting biome-consistent shading or debug can
 * sample between cells.
 */
export function wildnessAt(stackSeed: number, cxf: number, czf: number, level: number): number {
  const wildSeed = stackSeed + 1313;
  const warpSeed = stackSeed + 3939;
  const y = level * LEVEL_Y_STEP;
  // Domain warp: push the sample point around by a low-frequency offset
  // field so region boundaries meander instead of tracing noise-lattice
  // blobs
  const wx = (sampleNoise3D(cxf / WILDNESS_SCALE, y, czf / WILDNESS_SCALE, warpSeed) - 0.5) * 2 * WARP_AMP;
  const wz = (sampleNoise3D(cxf / WILDNESS_SCALE, y, czf / WILDNESS_SCALE, warpSeed + 77) - 0.5) * 2 * WARP_AMP;
  const wild = fbm3((cxf + wx) / WILDNESS_SCALE, y, (czf + wz) / WILDNESS_SCALE, wildSeed);
  const elev = elevationField(stackSeed, cxf / PILLAR_FACTOR, czf / PILLAR_FACTOR);
  return wild * (1 - ELEVATION_MIX) + elev * ELEVATION_MIX;
}

/**
 * Assign biomes from the smooth fields sampled at this level's depth.
 * `stackSeed` is shared by every level of a stack so the fields are
 * vertically continuous. Only the top level may be `outside` — below it
 * there is always structure overhead, so surface-break wildness becomes
 * cave instead.
 */
export function assignBiomes(_cellTileSize: number, stackSeed: number, level: number): void {
  const depthSeed = stackSeed + 2626;
  const y = level * LEVEL_Y_STEP;

  for (const cell of getAllCells()) {
    if (!cell.active) continue;

    const { ocx, ocz } = windowOrigin();
    const acx = ocx + cell.cx;
    const acz = ocz + cell.cz;
    const wildness = wildnessAt(stackSeed, acx, acz, level);
    const depth = fbm3(acx / DEPTH_SCALE, y, acz / DEPTH_SCALE, depthSeed);
    const region = regionAtCell(stackSeed, acx, acz);

    // Regions own distinct vocabularies. Shared continuous fields still
    // shape boundaries and rare/common variants, but no longer turn every
    // district into the same five-biome soup.
    switch (region) {
      case 'city':
        cell.biome = depth > 0.52 ? 'crypt' : 'dungeon';
        break;
      case 'machine':
        cell.biome = depth > 0.48 ? 'ember' : 'cave';
        break;
      case 'canyon':
        cell.biome = wildness > 0.43 && level === 0 ? 'outside' : 'cave';
        break;
      case 'roads':
        // Street-vein district: open sky at grade for iteration headroom
        // (crude slice — see docs/roads-layer-design.md). Below grade it
        // reads as cave until the region gets its own vertical vocabulary.
        cell.biome = level === 0 ? 'outside' : 'cave';
        break;
      case 'fold':
        // Fold district: open sky at grade — the fold structures ARE the
        // architecture here (fold-structure.ts builds on outside tiles)
        cell.biome = level === 0 ? 'outside' : 'cave';
        break;
      case 'frontier':
        if (wildness > 0.612) {
          cell.biome = level === 0 ? 'outside' : 'cave';
        } else if (wildness > 0.525) {
          cell.biome = depth > 0.605 ? 'ember' : 'cave';
        } else {
          cell.biome = depth > 0.572 ? 'crypt' : 'dungeon';
        }
        break;
    }
  }
}
