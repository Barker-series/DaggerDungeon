/**
 * Layer 6 — Height Fields (floor + ceiling)
 *
 * Reads: final tile grid, cell biomes (Layer 2)
 * Writes: per-tile floor elevation and ceiling height.
 *
 * Height is generation data, not a renderer afterthought:
 * - Organic biomes (cave, ember) get rolling floors and swelling vaults;
 *   ember runs deeper and far taller — a rift, not a room
 * - Built biomes (dungeon, crypt) stay flat with one architectural
 *   clearance per cell; crypt is deliberately low and oppressive
 * - Carved connections through void are tight flat tunnels, so the big
 *   spaces feel big by contrast
 *
 * Ceiling = floor + clearance, so headroom is guaranteed everywhere.
 * Floors are smoothed so every gradient stays walkable, and the renderer
 * corner-averages both fields into continuous surfaces.
 */

import { TileType } from '../types';
import { getCell, isOrganicBiome, type BiomeType } from './cells';
import { sampleNoise } from './noise';

const TUNNEL_CLEARANCE = 3.5;
const HEIGHT_STEP = 0.5; // built-biome clearances quantize to this
const FLOOR_SMOOTH_PASSES = 2;

const FLOOR_SWELL_SCALE = 9; // tiles per floor feature
const CEIL_SWELL_SCALE = 14; // tiles per ceiling feature
const CEIL_DETAIL_SCALE = 4;

interface BiomeHeightProfile {
  floorMin: number;
  floorMax: number;
  clearMin: number;
  clearMax: number;
}

const PROFILES: Record<BiomeType, BiomeHeightProfile> = {
  dungeon: { floorMin: 0, floorMax: 0, clearMin: 5, clearMax: 8.5 },
  crypt: { floorMin: 0, floorMax: 0, clearMin: 3.8, clearMax: 5 },
  cave: { floorMin: 0, floorMax: 2.2, clearMin: 4, clearMax: 13 },
  ember: { floorMin: -1.8, floorMax: 2, clearMin: 8, clearMax: 16 },
};

export interface HeightFields {
  floor: number[][];
  ceiling: number[][];
}

export function computeHeightFields(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  worldSeed: number,
): HeightFields {
  const heightSeed = worldSeed + 4242;
  const floor: number[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => 0),
  );
  const ceiling: number[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => TUNNEL_CLEARANCE),
  );

  // ── Floor elevation ──
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall) continue;

      const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));
      if (!cell?.active || !isOrganicBiome(cell.biome)) continue; // built + tunnels stay flat

      const p = PROFILES[cell.biome];
      const swell = sampleNoise(tx, tz, heightSeed + 55, FLOOR_SWELL_SCALE);
      floor[tz]![tx] = p.floorMin + swell * (p.floorMax - p.floorMin);
    }
  }

  // Smooth floors so every gradient stays walkable — average each floor
  // tile with its floor neighbors (walls excluded, flat tiles pull toward 0)
  for (let pass = 0; pass < FLOOR_SMOOTH_PASSES; pass++) {
    const snapshot = floor.map((row) => [...row]);
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        if (tiles[tz]![tx] === TileType.Wall) continue;
        let sum = snapshot[tz]![tx]!;
        let count = 1;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = tx + dx!;
          const nz = tz + dz!;
          if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) continue;
          if (tiles[nz]![nx] === TileType.Wall) continue;
          sum += snapshot[nz]![nx]!;
          count++;
        }
        floor[tz]![tx] = sum / count;
      }
    }
  }

  // ── Ceiling = floor + biome clearance ──
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall) continue;

      const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));
      const f = floor[tz]![tx]!;

      if (!cell?.active) {
        ceiling[tz]![tx] = f + TUNNEL_CLEARANCE;
        continue;
      }

      const p = PROFILES[cell.biome];
      let clearance: number;
      if (isOrganicBiome(cell.biome)) {
        const swell = sampleNoise(tx, tz, heightSeed, CEIL_SWELL_SCALE);
        const detail = sampleNoise(tx, tz, heightSeed + 99, CEIL_DETAIL_SCALE);
        clearance = p.clearMin + swell * (p.clearMax - p.clearMin) + (detail - 0.5) * 1.5;
        clearance = Math.max(TUNNEL_CLEARANCE, clearance);
      } else {
        // One flat architectural clearance per cell
        const cellNoise = sampleNoise(cell.cx, cell.cz, heightSeed + 7, 2);
        const raw = p.clearMin + cellNoise * (p.clearMax - p.clearMin);
        clearance = Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP;
      }

      ceiling[tz]![tx] = f + clearance;
    }
  }

  return { floor, ceiling };
}
