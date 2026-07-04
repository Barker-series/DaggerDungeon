/**
 * Layer 6 — Height Fields (floor + ceiling)
 *
 * Reads: final tile grid, cell biomes (Layer 2), golden path (Layer 5)
 * Writes: per-tile floor elevation and ceiling height.
 *
 * Grade-level terrain is ALWAYS walkable — rolling, lumpy, but never
 * needing a jump. The vertical drama is PITS: bottomless voids. Broad
 * noise drops whole areas to a floor so deep it reads as black nothing;
 * fall in and you are gone (the engine respawns you at the entrance).
 * Smoothing never crosses a pit rim, so edges stay knife-sharp.
 *
 * The golden path is still relaxed into a walkable channel — where it
 * crosses a pit, that becomes a narrow causeway over the void.
 * Spawn and exit neighborhoods are always kept out of pits.
 *
 * Ceiling = floor + biome clearance. Outside has no drawn ceiling but a
 * huge clearance value, and interior ceilings within a few tiles of an
 * outside region sweep upward toward it — the cave-mouth reveal.
 */

import { TileType, type GridPos } from '../types';
import { getCell, isOrganicBiome, type BiomeType } from './cells';
import { sampleNoise } from './noise';
import { goldenPath } from './layer5-goldenpath';

const TUNNEL_CLEARANCE = 3.5;
const HEIGHT_STEP = 0.5; // built-biome clearances quantize to this
const FLOOR_SMOOTH_PASSES = 2;

const FLOOR_SWELL_SCALE = 9; // tiles per rolling-floor feature
const PIT_SCALE = 14; // tiles per pit feature
const PIT_FLOOR = -30; // deep enough to read as void; falling here = respawn
const SAFE_RADIUS = 3; // spawn/exit neighborhoods never sink into pits
const RAMP_STEP = 0.7; // max per-tile rise along the golden-path channel
const PATH_SHOULDER = 1.0; // neighbors of the golden path stay within this

const CEIL_SWELL_SCALE = 14;
const CEIL_DETAIL_SCALE = 4;

// Cave-mouth sweep: interior ceilings within this many tiles of an
// outside region rise toward it
const MOUTH_RANGE = 4;
const MOUTH_RISE = 16;

interface BiomeHeightProfile {
  rollAmp: number; // rolling detail amplitude — always walkable, never a wall
  pitThreshold: number; // broad noise below this drops into the void (0 = no pits)
  clearMin: number;
  clearMax: number;
}

const PROFILES: Record<BiomeType, BiomeHeightProfile> = {
  dungeon: { rollAmp: 0, pitThreshold: 0, clearMin: 5, clearMax: 8.5 },
  crypt: { rollAmp: 0, pitThreshold: 0, clearMin: 3.8, clearMax: 5 },
  cave: { rollAmp: 1.2, pitThreshold: 0.22, clearMin: 4, clearMax: 13 },
  // Ember is pit country
  ember: { rollAmp: 1.2, pitThreshold: 0.34, clearMin: 8, clearMax: 16 },
  outside: { rollAmp: 1.6, pitThreshold: 0.25, clearMin: 34, clearMax: 40 },
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
  entrance: GridPos,
  exit: GridPos,
): HeightFields {
  const heightSeed = worldSeed + 4242;
  const floor: number[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => 0),
  );
  const pit: boolean[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => false),
  );
  const ceiling: number[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => TUNNEL_CLEARANCE),
  );

  const isFloor = (tx: number, tz: number): boolean =>
    tx >= 0 && tz >= 0 && tx < gridTiles && tz < gridTiles && tiles[tz]![tx] !== TileType.Wall;
  const biomeAt = (tx: number, tz: number): BiomeType | null => {
    const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));
    return cell?.active ? cell.biome : null;
  };
  const isSafe = (tx: number, tz: number): boolean =>
    (Math.abs(tx - entrance.x) <= SAFE_RADIUS && Math.abs(tz - entrance.y) <= SAFE_RADIUS) ||
    (Math.abs(tx - exit.x) <= SAFE_RADIUS && Math.abs(tz - exit.y) <= SAFE_RADIUS);

  // ── Floor: walkable rolling grade, with pit voids dropping out of it ──
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (!isFloor(tx, tz)) continue;
      const biome = biomeAt(tx, tz);
      if (!biome || !isOrganicBiome(biome)) continue; // built + tunnels stay flat

      const p = PROFILES[biome];
      if (p.pitThreshold > 0 && !isSafe(tx, tz)) {
        const pitNoise = sampleNoise(tx, tz, heightSeed + 21, PIT_SCALE);
        if (pitNoise < p.pitThreshold) {
          pit[tz]![tx] = true;
          floor[tz]![tx] = PIT_FLOOR;
          continue;
        }
      }

      const swell = sampleNoise(tx, tz, heightSeed + 55, FLOOR_SWELL_SCALE);
      floor[tz]![tx] = swell * p.rollAmp;
    }
  }

  // Smooth the rolling grade — never across a pit rim, so edges stay sheer
  for (let pass = 0; pass < FLOOR_SMOOTH_PASSES; pass++) {
    const snapshot = floor.map((row) => [...row]);
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        if (!isFloor(tx, tz) || pit[tz]![tx]) continue;
        let sum = snapshot[tz]![tx]!;
        let count = 1;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = tx + dx!;
          const nz = tz + dz!;
          if (!isFloor(nx, nz) || pit[nz]![nx]) continue;
          sum += snapshot[nz]![nx]!;
          count++;
        }
        floor[tz]![tx] = sum / count;
      }
    }
  }

  // ── Guarantee: the golden path is always walkable ──
  // Relax heights along the path, then pull its shoulders in. Where the
  // path crosses a pit this raises a narrow causeway over the void.
  relaxChannel(goldenPath, floor);
  for (const p of goldenPath) {
    const h = floor[p.y]?.[p.x];
    if (h === undefined) continue;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = p.x + dx;
        const nz = p.y + dz;
        if (!isFloor(nx, nz)) continue;
        floor[nz]![nx] = Math.max(h - PATH_SHOULDER, Math.min(h + PATH_SHOULDER, floor[nz]![nx]!));
      }
    }
  }

  // ── Ceiling = grade + biome clearance ──
  // Referenced to grade (not the pit floor), so the airspace over a pit
  // stays where the room's ceiling is
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (!isFloor(tx, tz)) continue;
      const biome = biomeAt(tx, tz);
      const f = Math.max(floor[tz]![tx]!, 0);

      if (!biome) {
        ceiling[tz]![tx] = f + TUNNEL_CLEARANCE;
        continue;
      }

      const p = PROFILES[biome];
      let clearance: number;
      if (isOrganicBiome(biome)) {
        const swell = sampleNoise(tx, tz, heightSeed, CEIL_SWELL_SCALE);
        const detail = sampleNoise(tx, tz, heightSeed + 99, CEIL_DETAIL_SCALE);
        clearance = p.clearMin + swell * (p.clearMax - p.clearMin) + (detail - 0.5) * 1.5;
        clearance = Math.max(TUNNEL_CLEARANCE, clearance);
      } else {
        const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize))!;
        const cellNoise = sampleNoise(cell.cx, cell.cz, heightSeed + 7, 2);
        const raw = p.clearMin + cellNoise * (p.clearMax - p.clearMin);
        clearance = Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP;
      }

      ceiling[tz]![tx] = f + clearance;
    }
  }

  // ── Cave-mouth sweep: ceilings rise toward outside regions ──
  applyMouthSweep(floor, ceiling, gridTiles, isFloor, biomeAt);

  return { floor, ceiling };
}

/** Clamp successive heights along a tile chain to a walkable ramp. */
function relaxChannel(chain: GridPos[], floor: number[][]): void {
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]!;
    const cur = chain[i]!;
    const ph = floor[prev.y]?.[prev.x];
    const ch = floor[cur.y]?.[cur.x];
    if (ph === undefined || ch === undefined) continue;
    floor[cur.y]![cur.x] = Math.max(ph - RAMP_STEP, Math.min(ph + RAMP_STEP, ch));
  }
  for (let i = chain.length - 2; i >= 0; i--) {
    const next = chain[i + 1]!;
    const cur = chain[i]!;
    const nh = floor[next.y]?.[next.x];
    const ch = floor[cur.y]?.[cur.x];
    if (nh === undefined || ch === undefined) continue;
    floor[cur.y]![cur.x] = Math.max(nh - RAMP_STEP, Math.min(nh + RAMP_STEP, ch));
  }
}

/** Interior ceilings sweep upward as they approach an outside region. */
function applyMouthSweep(
  floor: number[][],
  ceiling: number[][],
  gridTiles: number,
  isFloor: (tx: number, tz: number) => boolean,
  biomeAt: (tx: number, tz: number) => BiomeType | null,
): void {
  // Multi-source BFS from outside floor tiles across non-outside floor
  const dist = new Map<number, number>();
  const key = (x: number, z: number): number => z * gridTiles + x;
  let frontier: GridPos[] = [];

  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (isFloor(tx, tz) && biomeAt(tx, tz) === 'outside') {
        frontier.push({ x: tx, y: tz });
        dist.set(key(tx, tz), 0);
      }
    }
  }

  for (let d = 1; d <= MOUTH_RANGE && frontier.length > 0; d++) {
    const next: GridPos[] = [];
    for (const cur of frontier) {
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = cur.x + dx!;
        const nz = cur.y + dz!;
        const k = key(nx, nz);
        if (!isFloor(nx, nz) || dist.has(k)) continue;
        if (biomeAt(nx, nz) === 'outside') continue;
        dist.set(k, d);
        next.push({ x: nx, y: nz });
        const rise = MOUTH_RISE * (1 - d / (MOUTH_RANGE + 1));
        ceiling[nz]![nx] = Math.max(ceiling[nz]![nx]!, floor[nz]![nx]! + TUNNEL_CLEARANCE + rise);
      }
    }
    frontier = next;
  }
}
