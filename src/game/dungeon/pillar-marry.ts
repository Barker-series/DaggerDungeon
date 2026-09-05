/**
 * Pillar → column application: air spans, terrain marriage, roofline
 * culling, sky/straddler crown rules. Extracted verbatim from
 * generateWorld's inline loop so the per-chunk generation path
 * (src/game/gen/) applies pillars with the exact same code — the two
 * paths must never drift.
 *
 * Frame-agnostic: `baseTx/baseTz` is the window position of the
 * pillar's footprint origin; everything else is read/written through
 * the ctx grids in that same window frame. The LayerProcGen contract
 * (BOUNDED ROOFLINE DEPENDENCY) is unchanged: the pillar reads only
 * room ceilings immediately bordering its own footprint.
 */

import { TileType, SKY_CEIL, type ColumnSpan } from '../types';
import { tileBiome, type BiomeType } from './cells';
import { PIT_FLOOR } from './layer6-heights';
import { pillarFootprint, pillarAirSpans } from './pillar-geometry';
import type { PillarSpec } from './pillar-layer';

export interface PillarApplyCtx {
  gridTiles: number;
  tiles: TileType[][];
  pillarWall: boolean[][];
  /** Per-cell biome grid in this window's cell frame */
  cellBiomes: (BiomeType | null)[][];
  /** Mutated: married surfaces write their height here */
  floorHeights: number[][];
  ceilingHeights: number[][];
  /** Terrain as it was BEFORE any pillar married — marry decisions must
   *  not see earlier marriages */
  origFloors: number[][];
  /** Mutated: married tiles are flagged */
  pillarGround: boolean[][];
  /** Mutated: footprint columns are replaced by the pillar's air spans */
  columns: ColumnSpan[][];
}

export function applyPillarSpans(
  spec: PillarSpec,
  baseTx: number,
  baseTz: number,
  ctx: PillarApplyCtx,
): void {
  const {
    gridTiles, tiles, pillarWall, cellBiomes,
    floorHeights: topFloors, ceilingHeights: topCeils,
    origFloors, pillarGround, columns,
  } = ctx;

  // ── BOUNDED ROOFLINE DEPENDENCY ──
  // A pillar may only read room ceilings immediately bordering its own
  // footprint. Those boundary samples propagate through this footprint,
  // never through the whole moving window. This is the LayerProcGen
  // effect-distance contract for roof culling: the pillar is the owned
  // output bounds; its one-tile perimeter is the complete dependency
  // padding. Equal-distance contests choose the lower roof.
  const footprint = new Set(pillarFootprint(spec).map(([lx, lz]) => `${lx},${lz}`));
  const capDistance = new Map<string, number>();
  const localCaps = new Map<string, number>();
  const capFrontier: [number, number][] = [];
  for (const key of footprint) {
    const [lx, lz] = key.split(',').map(Number);
    const gx = baseTx + lx!;
    const gz = baseTz + lz!;
    let boundaryCap = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) continue;
      if (pillarWall[nz]![nx] || tiles[nz]![nx] === TileType.Wall) continue;
      if (tileBiome(cellBiomes, nx, nz) === 'outside') continue;
      boundaryCap = Math.min(boundaryCap, topCeils[nz]![nx]!);
    }
    if (Number.isFinite(boundaryCap)) {
      capDistance.set(key, 0);
      localCaps.set(key, boundaryCap);
      capFrontier.push([lx!, lz!]);
    }
  }
  for (let head = 0; head < capFrontier.length; head++) {
    const [lx, lz] = capFrontier[head]!;
    const key = `${lx},${lz}`;
    const distance = capDistance.get(key)!;
    const cap = localCaps.get(key)!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = lx + dx;
      const nz = lz + dz;
      const nextKey = `${nx},${nz}`;
      if (!footprint.has(nextKey)) continue;
      const nextDistance = distance + 1;
      const knownDistance = capDistance.get(nextKey);
      const knownCap = localCaps.get(nextKey);
      if (knownDistance !== undefined
        && (knownDistance < nextDistance
          || (knownDistance === nextDistance && knownCap! <= cap))) continue;
      capDistance.set(nextKey, nextDistance);
      localCaps.set(nextKey, cap);
      capFrontier.push([nx, nz]);
    }
  }

  const groundAt = (lx: number, lz: number): number =>
    spec.frame ? Math.min(0.5, topFloors[baseTz + lz]?.[baseTx + lx] ?? 0)
      : topFloors[baseTz + lz]?.[baseTx + lx] ?? 0;
  const capAt = (lx: number, lz: number): number | null => {
    const gx = baseTx + lx;
    const gz = baseTz + lz;
    if (tileBiome(cellBiomes, gx, gz) === 'outside') return null;
    const cap = localCaps.get(`${lx},${lz}`);
    return cap !== undefined ? cap + 0.5 : 8;
  };
  // Terrain flows under the pillar (footprint tiles carry real ground
  // heights) — the foundation rises to meet it per tile
  let airSpans = pillarAirSpans(spec, groundAt, capAt);
  // Sky-open is a PER-PILLAR decision: only a pillar standing entirely
  // in the outside biome gets an open rooftop. A straddler is partly
  // embedded in the boundary cliff — opening its outside tiles would
  // cut a notch out of the cliff mass above its crown (missing geo up
  // to the skyline). Straddlers stay capped; the cliff continues.
  let outsideTiles = 0, totalTiles = 0;
  for (const k of airSpans.keys()) {
    const [lx, lz] = k.split(',').map(Number);
    totalTiles++;
    if (tileBiome(cellBiomes, baseTx + lx!, baseTz + lz!) === 'outside') outsideTiles++;
  }
  const fullyOutside = totalTiles > 0 && outsideTiles === totalTiles;
  const straddler = outsideTiles > 0 && !fullyOutside;
  // A straddler removes the crown attic below (the tower merges into
  // the cliff) — so its crown ramp must not CLIMB, or the flight dead
  // ends into the stripped attic as a wall across the stairs. Rebuild
  // its air with the crown band as a flat sheltered landing instead.
  if (straddler) airSpans = pillarAirSpans(spec, groundAt, capAt, true);
  for (const [k, air] of airSpans) {
    const [lx, lz] = k.split(',').map(Number);
    const gx = baseTx + lx!;
    const gz = baseTz + lz!;
    let spans = air.map((s) => ({
      floor: s.floor, ceil: s.ceil, owner: -1, ceilOwner: -1,
    }));
    // Ground surfaces near the terrain JOIN the level system: owner 0,
    // and the surface height replaces the buried-terrain value in the
    // height field, so renderer and physics corner-sample one
    // continuous surface — terrain, plaza slabs, and ramp entries
    // blend like worn stone, and the footprint boundary stops being a
    // seam at all. "Near" is judged against the whole 3x3 terrain
    // neighborhood: a surface within a step of ANY adjacent ground
    // must blend with it (only equal-height joints crack — anything
    // still structural has a real ≥1 wall face sealing it).
    // The GROUND span is not always spans[0]: deep foundation
    // clearances put a below-grade span first, and testing only that
    // one skipped the marry entirely — leaving the real ground slab
    // flat-structural beside corner-blended terrain (the crack
    // condition, observed as footprint-edge holes). Marry whichever
    // span actually sits at terrain height.
    for (const span of spans) {
      const f0 = span.floor;
      if (spec.frame && Math.abs(f0 - 0.5) < 0.01) {
        // The framed building owns a flat podium, not rooms that rolling
        // terrain may fill. Its ground joins the shared corner field so the
        // outside ground banks into it. Upstairs/basement floors stay owned
        // by the structure; only the declared grade floor gets this rule.
        span.owner = 0;
        topFloors[gz]![gx] = 0.5;
        pillarGround[gz]![gx] = true;
        break;
      }
      if (f0 < -100 || f0 > 30) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) {
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const t = origFloors[gz + dz]?.[gx + dx];
          // ASYMMETRIC window: a slab at or below nearby terrain must
          // marry (blended ground could rise past its lip — the crack
          // condition), but a slab more than a step ABOVE the terrain
          // is architecture: flat ground can't climb over its lip and
          // the riser gets a real sealing face. Marrying those (stair
          // treads over streets) tented the ground into humps.
          if (t === undefined || t <= PIT_FLOOR) continue;
          // Bankable window is NEAR-FLUSH only (< 0.35): anything
          // higher reads as a deliberate step and keeps a hard riser
          // face — a 0.6 riser is still under STEP_UP, so it stays
          // walkable without the terrain humping up to meet it.
          const d = f0 - Math.max(0, t);
          if (d < 0.35 && d > -1.0) near = true;
        }
      }
      if (near) {
        span.owner = 0;
        topFloors[gz]![gx] = f0;
        pillarGround[gz]![gx] = true;
        break;
      }
    }
    if (spans.length > 0 && fullyOutside) {
      // Under open sky the pillar's top is a real rooftop, not an
      // attic carved into rock — the highest air continues into sky
      spans[spans.length - 1]!.ceil = SKY_CEIL;
    } else if (straddler && spans.length > 0) {
      // A boundary-cliff pillar merges into the skyline as one solid
      // mass: no crown attic, no recessed ring under a hanging slab —
      // the spiral tops out at a sheltered landing and the tower
      // continues up. (Interior pillars keep their attic rooms.)
      const top = spans[spans.length - 1]!;
      if (Math.abs(top.floor - spec.totalHeight) < 0.01) spans = spans.slice(0, -1);
    }
    columns[gz * gridTiles + gx] = spans;
  }
}
