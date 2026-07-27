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

export type RegionType = 'city' | 'machine' | 'canyon' | 'frontier';

/** Biome-selector thresholds a region imposes (see layer2-biome) */
export interface RegionPalette {
  organic: number;
  outside: number;
  crypt: number;
  ember: number;
}

/** Weighted character of each district type */
const REGION_WEIGHTS: [RegionType, number][] = [
  ['city', 0.35],
  ['machine', 0.3],
  ['canyon', 0.2],
  ['frontier', 0.15],
];

/**
 * Palettes push the shared wildness/depth fields toward the district's
 * character without abandoning them — the fields stay continuous across
 * borders, so a canyon region still runs its open cut where wildness is
 * highest, and a city region puts its rare crypt strata where depth
 * peaks. Same geography, different zoning.
 */
const PALETTES: Record<RegionType, RegionPalette> = {
  // Mostly built: organic pockets are rare intrusions; sky is rarer;
  // compressed residential (crypt) claims more of the depth range
  city: { organic: 0.6, outside: 0.68, crypt: 0.555, ember: 0.605 },
  // The builders' domain: organic carving dominates, heat is common
  machine: { organic: 0.44, outside: 0.66, crypt: 0.572, ember: 0.55 },
  // Open cuts: the surface breaks easily; what stays enclosed is carved
  canyon: { organic: 0.5, outside: 0.545, crypt: 0.572, ember: 0.605 },
  // The current global mix — everything meets here
  frontier: { organic: 0.525, outside: 0.612, crypt: 0.572, ember: 0.605 },
};

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

export function regionPalette(type: RegionType): RegionPalette {
  return PALETTES[type];
}
