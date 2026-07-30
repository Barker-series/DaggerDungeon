/**
 * Region layer — the coarsest LayerProcGen layer: districts of the
 * megastructure.
 *
 * A region is a vast tract (REGION_CELLS dungeon cells per axis) with
 * one character, and it DICTATES the biome palette inside it. Biomes
 * stop being a global soup: you traverse a district — a compressed
 * city, a machine stratum, a canyon of endless arches — and the
 * biome layer picks only from what that district offers. Growing the
 * world means adding region types and palettes here, never touching
 * the biome selector again.
 *
 * INFINITE-WORLD DISCIPLINE: a region is a pure function of
 * (worldSeed, region coords). Lookup is domain-warped so district
 * borders meander instead of tracing the region lattice. Negative
 * coordinates first-class.
 *
 * Region types (the megastructure's districts):
 * - city:     built mass — endless corridors and compressed
 *             residential strata (dungeon/crypt heavy)
 * - machine:  the builders' domain — carved voids, heat, reactors
 *             (cave/ember heavy)
 * - canyon:   vast open cuts through the structure, sky far above,
 *             arch country (outside heavy)
 * - frontier: contested edges where everything interleaves — the
 *             current global mix
 */

import { cellSeed, mulberry32 } from './rng';
import { sampleNoise3D } from './noise';

/** Dungeon cells per region axis (= 2x2 pillar cells, 336 wu) */
export const REGION_CELLS = 8;

export type RegionType = 'city' | 'machine' | 'canyon' | 'frontier' | 'roads';

/** Weighted character of each district type */
const REGION_WEIGHTS: [RegionType, number][] = [
  ['city', 0.3],
  ['machine', 0.25],
  ['canyon', 0.17],
  ['frontier', 0.13],
  // The street-vein experiment district (docs/roads-layer-design.md):
  // arterial road networks carved under open sky.
  ['roads', 0.15],
];

const REGION_SALT = 7373;
/** Dungeon cells of meander applied to the region lookup */
const BORDER_WARP = 2.5;

/** The district at REGION coordinates — pure (worldSeed, rcx, rcz) */
export function regionType(worldSeed: number, rcx: number, rcz: number): RegionType {
  const rng = mulberry32(cellSeed(rcx, rcz, worldSeed, REGION_SALT));
  let r = rng();
  for (const [type, w] of REGION_WEIGHTS) {
    r -= w;
    if (r <= 0) return type;
  }
  return 'frontier';
}

/**
 * The district containing a dungeon cell, with meandering borders:
 * the lookup position is pushed around by low-frequency noise before
 * quantizing to the region grid.
 */
export function regionAtCell(worldSeed: number, cx: number, cz: number): RegionType {
  const wx = (sampleNoise3D(cx / REGION_CELLS, 0, cz / REGION_CELLS, worldSeed + 4747) - 0.5) * 2 * BORDER_WARP;
  const wz = (sampleNoise3D(cx / REGION_CELLS, 0, cz / REGION_CELLS, worldSeed + 4747 + 77) - 0.5) * 2 * BORDER_WARP;
  const rcx = Math.floor((cx + wx) / REGION_CELLS);
  const rcz = Math.floor((cz + wz) / REGION_CELLS);
  return regionType(worldSeed, rcx, rcz);
}
