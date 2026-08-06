/**
 * Layer 6 — Height Fields (floor + ceiling)
 *
 * Reads: final tile grid and cell biomes (Layer 2)
 * Writes: per-tile floor elevation and ceiling height.
 *
 * Grade-level terrain is ALWAYS walkable — rolling, lumpy, but never
 * needing a jump. The vertical drama is HOLES: a broad 3D noise field
 * (shared by every level of the stack, sampled at this level's depth)
 * drops whole areas out of the floor. Fall in and you land on whatever
 * level below has solid ground at that column — or nothing does, and the
 * shaft is a true bottomless pit. Where the field stays open across
 * several levels the holes align into vast vertical atria.
 * Smoothing never crosses a hole rim, so edges stay knife-sharp.
 *
 * Permanent transit tiles are kept out of pits. Objective routes are
 * observations of this terrain; they never reshape it.
 *
 * Ceiling = floor + biome clearance. Outside has no drawn ceiling but a
 * huge clearance value, and interior ceilings within a few tiles of an
 * outside region sweep upward toward it — the cave-mouth reveal.
 */

import { TileType, type GridPos } from '../types';
import { PIT_LEVEL } from './heightfield';
import { getCell, isOrganicBiome, type BiomeType } from './cells';
import { sampleNoise, sampleNoise3D } from './noise';
import { windowOrigin } from './cells';

const TUNNEL_CLEARANCE = 3.5;
const HEIGHT_STEP = 0.5; // built-biome clearances quantize to this
const FLOOR_SMOOTH_PASSES = 2;

const FLOOR_SWELL_SCALE = 9; // tiles per rolling-floor feature
const PIT_SCALE = 14; // tiles per hole feature
export const PIT_FLOOR = -1000; // hole sentinel: no floor slab at this tile

const CEIL_SWELL_SCALE = 14;
// Outside crest quantum: one flat crest per cell on this vertical
// module (2x the 3-unit structural module) — crowns are structure.
const CREST_MODULE = 6;
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

// One tall floor: clearances carry the verticality that stacked levels
// used to. Kebab pillar content lives inside this airspace, and the
// ground is FAILING under it — generous pit thresholds make grade
// terrain islands and causeways around pillar bases, with the golden
// path and forced bridges as the guaranteed crossings.
const PROFILES: Record<BiomeType, BiomeHeightProfile> = {
  // Even built floors breach — the structure is failing
  dungeon: { rollAmp: 0, pitThreshold: 0.2, clearMin: 18, clearMax: 30 },
  crypt: { rollAmp: 0, pitThreshold: 0.14, clearMin: 12, clearMax: 20 },
  cave: { rollAmp: 1.2, pitThreshold: 0.36, clearMin: 10, clearMax: 28 },
  // Ember is hole country
  ember: { rollAmp: 1.2, pitThreshold: 0.48, clearMin: 24, clearMax: 44 },
  // Crest ceiling bound: outside values ceil-quantize to CREST_MODULE
  // (see the outside branch), so the tallest possible crest is
  // ceil((clearMax + rollAmp) / CREST_MODULE) * CREST_MODULE = 96 —
  // strictly under the 100 sky-filler sentinel by construction.
  outside: { rollAmp: 1.6, pitThreshold: 0.38, clearMin: 66, clearMax: 90 },
};

export interface HeightFields {
  floor: number[][];
  ceiling: number[][];
}

/**
 * Where the 3D void field opens holes on this level. Computed separately
 * from the height fields so permanent construction can reserve stable
 * crossings before heights are finalized.
 */
export function computePitMask(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  stackSeed: number,
  protectedTiles?: ReadonlySet<string>,
): boolean[][] {
  const voidSeed = stackSeed + 21;
  const mask: boolean[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => false),
  );
  const isSafe = (tx: number, tz: number): boolean =>
    protectedTiles?.has(`${tx},${tz}`) ?? false;

  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall) continue;
      // BUFFER: a hole never touches a wall (diagonals included) — every
      // pit is ringed by walkable rim floor before any wall starts, so
      // wall geometry and pit geometry never meet edge-on. That contact
      // line is where every seam bug has bred; make it ungeneratable.
      let wallNear = false;
      for (let dz = -1; dz <= 1 && !wallNear; dz++) {
        for (let dx = -1; dx <= 1 && !wallNear; dx++) {
          const nx = tx + dx;
          const nz = tz + dz;
          if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) wallNear = true;
          else if (tiles[nz]![nx] === TileType.Wall) wallNear = true;
        }
      }
      if (wallNear) continue;
      const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));
      const biome = cell?.active ? cell.biome : null;
      if (!biome) continue;
      const p = PROFILES[biome];
      if (p.pitThreshold <= 0 || isSafe(tx, tz)) continue;
      const voidNoise = sampleNoise3D((windowOrigin().ocx * 14 + tx) / PIT_SCALE, 0, (windowOrigin().ocz * 14 + tz) / PIT_SCALE, voidSeed);
      if (voidNoise < p.pitThreshold) mask[tz]![tx] = true;
    }
  }

  // ── MORPHOLOGICAL OPENING (erode by R, dilate by R): pit slivers
  // thinner than ~2R+1 tiles vanish — the wall buffer above shaves big
  // void blobs into scattered 1x1 orphans wherever walkways tighten, and
  // those ambush holes were pure annoyance. Large pits keep their
  // footprint and lose their single-tile crenellations, so the map
  // outline reads as deliberate excavation instead of moth-eaten slab.
  // Bounded radius, deterministic; the outermost R tiles of a window can
  // differ across windows, well inside the discarded edge padding. ──
  const R = 2;
  const eroded: boolean[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => false),
  );
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (!mask[tz]![tx]) continue;
      let solid = true;
      for (let dz = -R; dz <= R && solid; dz++) {
        for (let dx = -R; dx <= R && solid; dx++) {
          const nx = tx + dx;
          const nz = tz + dz;
          if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles || !mask[nz]![nx]) solid = false;
        }
      }
      if (solid) eroded[tz]![tx] = true;
    }
  }
  const opened: boolean[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => false),
  );
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      let near = false;
      for (let dz = -R; dz <= R && !near; dz++) {
        for (let dx = -R; dx <= R && !near; dx++) {
          if (eroded[tz + dz]?.[tx + dx]) near = true;
        }
      }
      // Opening is a strict subset of the raw mask, so the wall buffer
      // and protection rules above keep holding by construction.
      if (near) opened[tz]![tx] = true;
    }
  }
  return opened;
}

export function computeHeightFields(
  tiles: TileType[][],
  gridTiles: number,
  cellTileSize: number,
  worldSeed: number,
  /** Where the void field opens holes (from computePitMask). */
  pitMask: boolean[][],
  /** Pillar footprint tiles — terrain flows under them and they carry
   *  real ground heights */
  pillarWall?: boolean[][],
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
  // Terrain flows UNDER pillars: footprint tiles are Wall for routing,
  // but they carry real ground heights so the rolling surface continues
  // through the footprint and the pillar's ground span rides it — the
  // joint uses the same corner field as every other floor connection.
  const carriesGround = (tx: number, tz: number): boolean =>
    isFloor(tx, tz) || (tx >= 0 && tz >= 0 && tx < gridTiles && tz < gridTiles && (pillarWall?.[tz]?.[tx] ?? false));
  const biomeAt = (tx: number, tz: number): BiomeType | null => {
    const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize));
    return cell?.active ? cell.biome : null;
  };
  // ── Floor: walkable rolling grade, with holes dropping out of it.
  // Pillar footprint tiles participate — their ground height IS the
  // terrain continuing beneath the structure. ──
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (!carriesGround(tx, tz)) continue;
      if (pitMask[tz]![tx]) {
        pit[tz]![tx] = true;
        floor[tz]![tx] = PIT_FLOOR;
        continue;
      }
      const biome = biomeAt(tx, tz);
      if (!biome || !isOrganicBiome(biome)) continue; // built floors stay flat between breaches
      const swell = sampleNoise(windowOrigin().ocx * 14 + tx, windowOrigin().ocz * 14 + tz, heightSeed + 55, FLOOR_SWELL_SCALE);
      floor[tz]![tx] = swell * PROFILES[biome].rollAmp;
    }
  }

  // Smooth the rolling grade — never across a pit rim, so edges stay sheer
  for (let pass = 0; pass < FLOOR_SMOOTH_PASSES; pass++) {
    const snapshot = floor.map((row) => [...row]);
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        if (!carriesGround(tx, tz) || pit[tz]![tx]) continue;
        let sum = snapshot[tz]![tx]!;
        let count = 1;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = tx + dx!;
          const nz = tz + dz!;
          if (!carriesGround(nx, nz) || pit[nz]![nx]) continue;
          if (snapshot[nz]![nx]! <= PIT_FLOOR + 1) continue; // holes never blend
          sum += snapshot[nz]![nx]!;
          count++;
        }
        floor[tz]![tx] = sum / count;
      }
    }
  }

  // ── Ceiling = grade + biome clearance ──
  // Referenced to grade (not the pit floor), so the airspace over a pit
  // stays where the room's ceiling is. Skeleton tiles with an EXPLICIT
  // ceiling keep it; locked floors without one (door landings) get the
  // local biome ceiling so they blend with the room around them.
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
      if (biome === 'outside') {
        // OUTSIDE crests are STRUCTURE, not cave rock: one flat crest
        // per cell, quantized to a 6-unit module — and ABSOLUTE, not
        // floor-relative: the rolling grade otherwise passes straight
        // through `floor + clearance` into the crest line, stepping
        // tower crowns 76/80/82 at a single corner ("height issue"
        // repro). Per-tile swell never draws as ceiling here (open
        // sky); it only fed wall crowns.
        const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize))!;
        const cellNoise = sampleNoise(windowOrigin().ocx + cell.cx, windowOrigin().ocz + cell.cz, heightSeed + 7, 2);
        const raw = p.clearMin + cellNoise * (p.clearMax - p.clearMin);
        // Crest referenced to the CELL's ground (the floor swell field
        // sampled once at the cell center, same noise the floors use):
        // purely absolute crests lost the ground height and read
        // SHORTER wherever outside terrain sits high. Flat per cell,
        // tracks terrain at cell scale, quantized to the module.
        const ccx2 = windowOrigin().ocx * 14 + (cell.cx + 0.5) * cellTileSize;
        const ccz2 = windowOrigin().ocz * 14 + (cell.cz + 0.5) * cellTileSize;
        const cellGround = sampleNoise(ccx2, ccz2, heightSeed + 55, FLOOR_SWELL_SCALE) * p.rollAmp;
        // Ceil-quantized to the crest module — nothing else. Height
        // lives in the PROFILE (clearMin raised one module over the
        // old swell mean, restoring the peak-riding crowns cap-max
        // used to read); the sub-100 sky-sentinel bound holds by
        // arithmetic on the profile values, not by a clamp.
        ceiling[tz]![tx] = Math.max(
          f + TUNNEL_CLEARANCE,
          Math.ceil((cellGround + raw) / CREST_MODULE) * CREST_MODULE,
        );
        continue;
      }
      if (isOrganicBiome(biome)) {
        const swell = sampleNoise(windowOrigin().ocx * 14 + tx, windowOrigin().ocz * 14 + tz, heightSeed, CEIL_SWELL_SCALE);
        const detail = sampleNoise(windowOrigin().ocx * 14 + tx, windowOrigin().ocz * 14 + tz, heightSeed + 99, CEIL_DETAIL_SCALE);
        clearance = p.clearMin + swell * (p.clearMax - p.clearMin) + (detail - 0.5) * 1.5;
        clearance = Math.max(TUNNEL_CLEARANCE, clearance);
      } else {
        const cell = getCell(Math.floor(tx / cellTileSize), Math.floor(tz / cellTileSize))!;
        const cellNoise = sampleNoise(windowOrigin().ocx + cell.cx, windowOrigin().ocz + cell.cz, heightSeed + 7, 2);
        const raw = p.clearMin + cellNoise * (p.clearMax - p.clearMin);
        clearance = Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP;
      }

      ceiling[tz]![tx] = f + clearance;
    }
  }

  // ── INTERIOR MOUTH SWEEP: a transit corridor meeting tall interior
  // space (a biome chamber) must not butt its 3.5 lid against the
  // room as a floating slab — the same problem the cave-mouth sweep
  // solves at outside rims. Corridor ceilings within MOUTH_RANGE of a
  // BIOME-tall walkable tile ramp from that ceiling down to the bore
  // clearance, landing at 3.5 BY CONSTRUCTION — no open-ended
  // relaxation, so a bore chained to a chamber re-roofs a fixed few
  // tiles in instead of hollowing to an arbitrary frontier shelf.
  // Seeds are biome tiles only (their ceilings are profile-derived,
  // never products of this sweep), outside rims stay with the
  // cave-mouth sweep, and floors may only step level-or-down toward
  // the chamber (never carving under higher ground). Bounded BFS on
  // window-local grids: seams stay exact.
  {
    const RANGE = 4;
    const dist = new Int16Array(gridTiles * gridTiles).fill(-1);
    const seedCeil = new Float64Array(gridTiles * gridTiles);
    let frontier: number[] = [];
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        if (!isFloor(tx, tz)) continue;
        const b = biomeAt(tx, tz);
        if (!b || b === 'outside') continue;
        const f = Math.max(floor[tz]![tx]!, 0);
        const c = ceiling[tz]![tx]!;
        if (c <= f + TUNNEL_CLEARANCE + 1.0) continue;
        const k = tz * gridTiles + tx;
        dist[k] = 0;
        seedCeil[k] = c;
        frontier.push(k);
      }
    }
    for (let d = 1; d <= RANGE && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const k of frontier) {
        const tx = k % gridTiles;
        const tz = Math.floor(k / gridTiles);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = tx + dx;
          const nz = tz + dz;
          if (!isFloor(nx, nz)) continue;
          if (biomeAt(nx, nz)) continue; // sweep null-biome corridors only
          const nk = nz * gridTiles + nx;
          if (dist[nk]! >= 0) continue;
          if (Math.max(floor[nz]![nx]!, 0) - Math.max(floor[tz]![tx]!, 0) > 1.5) continue;
          dist[nk] = d;
          seedCeil[nk] = seedCeil[k]!;
          next.push(nk);
        }
      }
      frontier = next;
    }
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        const k = tz * gridTiles + tx;
        const d = dist[k]!;
        if (d <= 0) continue; // seeds keep their own ceilings
        const f = Math.max(floor[tz]![tx]!, 0);
        const bore = f + TUNNEL_CLEARANCE;
        const t = d / (RANGE + 1);
        const swept = seedCeil[k]! * (1 - t) + bore * t;
        ceiling[tz]![tx] = Math.max(ceiling[tz]![tx]!, swept);
      }
    }
  }

  // ── Cave-mouth sweep: ceilings rise toward outside regions ──
  applyMouthSweep(floor, ceiling, gridTiles, isFloor, biomeAt);

  // ── BIOME-BORDER CEILING BUFFER: within a band along the outside
  // boundary, interior ceilings smooth toward their neighbors — the
  // mouth sweep and organic variation otherwise meet the boundary as a
  // jagged staircase that every downstream seam system (faces, caps,
  // chamfers) has to reconcile, and that junction breeds crashouts.
  // A smooth ramp into the border gives them one clean line. ──
  {
    const BUFFER = 3;
    const dist = new Int16Array(gridTiles * gridTiles).fill(-1);
    let frontier: number[] = [];
    for (let tz = 0; tz < gridTiles; tz++) {
      for (let tx = 0; tx < gridTiles; tx++) {
        if (!isFloor(tx, tz)) continue;
        if (biomeAt(tx, tz) === 'outside') continue;
        let borders = false;
        for (let dz = -1; dz <= 1 && !borders; dz++) {
          for (let dx = -1; dx <= 1 && !borders; dx++) {
            if (biomeAt(tx + dx, tz + dz) === 'outside') borders = true;
          }
        }
        if (borders) {
          dist[tz * gridTiles + tx] = 0;
          frontier.push(tz * gridTiles + tx);
        }
      }
    }
    for (let d = 1; d <= BUFFER && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const k of frontier) {
        const tx = k % gridTiles;
        const tz = Math.floor(k / gridTiles);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx!;
          const nz = tz + dz!;
          if (!isFloor(nx, nz)) continue;
          if (biomeAt(nx, nz) === 'outside') continue;
          const nk = nz * gridTiles + nx;
          if (dist[nk]! >= 0) continue;
          dist[nk] = d;
          next.push(nk);
        }
      }
      frontier = next;
    }
    for (let pass = 0; pass < 4; pass++) {
      const snap = ceiling.map((row) => [...row]);
      for (let tz = 0; tz < gridTiles; tz++) {
        for (let tx = 0; tx < gridTiles; tx++) {
          if (dist[tz * gridTiles + tx]! < 0) continue;
          let sum = snap[tz]![tx]!;
          let count = 1;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = tx + dx!;
            const nz = tz + dz!;
            if (!isFloor(nx, nz)) continue;
            if (biomeAt(nx, nz) === 'outside') continue;
            sum += snap[nz]![nx]!;
            count++;
          }
          ceiling[tz]![tx] = sum / count;
        }
      }
    }
  }

  // ── SNAP: every committed height sits on the vertical grid ──
  // Structure meets structure exactly or not at all; float mush from
  // blending and relaxing never reaches the world. (Holes keep their
  // sentinel; skeleton presets are already exact.)
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (!carriesGround(tx, tz)) continue;
      const f = floor[tz]![tx]!;
      if (f > PIT_LEVEL) floor[tz]![tx] = Math.round(f / HEIGHT_STEP) * HEIGHT_STEP;
      ceiling[tz]![tx] = Math.round(ceiling[tz]![tx]! / HEIGHT_STEP) * HEIGHT_STEP;
    }
  }

  return { floor, ceiling };
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


/**
 * DECK LEVELING — a land strip crossing a pit should hold the level of
 * its banks. Terrain quantization otherwise drops a deck section half a
 * unit below the approach and the walk across "dips" like a sagging
 * bridge. For every tile with pit on both sides of an axis (the arch
 * decks), the floor lifts to the max walkable floor within a bounded
 * reach ALONG the deck. Runs before the column build so physics,
 * rendering, and the arch carve all see one surface.
 */
export function levelPitDecks(
  floorHeights: number[][],
  tiles: TileType[][],
  gridTiles: number,
): void {
  const SPAN = 12; // matches MAX_ARCH_SPAN
  const REACH = 4; // along-deck leveling radius
  const isPit = (tx: number, tz: number): boolean =>
    floorHeights[tz]?.[tx] !== undefined && floorHeights[tz]![tx]! <= PIT_FLOOR;
  const pitBothSides = (tx: number, tz: number, dx: number, dz: number): boolean => {
    let fwd = false;
    for (let i = 1; i <= SPAN && !fwd; i++) {
      const nx = tx + dx * i, nz = tz + dz * i;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) return false;
      if (tiles[nz]![nx] === TileType.Wall) return false;
      if (isPit(nx, nz)) fwd = true;
    }
    if (!fwd) return false;
    for (let i = 1; i <= SPAN; i++) {
      const nx = tx - dx * i, nz = tz - dz * i;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) return false;
      if (tiles[nz]![nx] === TileType.Wall) return false;
      if (isPit(nx, nz)) return true;
    }
    return false;
  };
  // Read from a snapshot so lifts don't cascade (order-independence).
  const orig = floorHeights.map((r) => [...r]);
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall) continue;
      const f = orig[tz]![tx]!;
      if (f <= PIT_FLOOR) continue;
      const acrossX = pitBothSides(tx, tz, 1, 0);
      const acrossZ = pitBothSides(tx, tz, 0, 1);
      if (!acrossX && !acrossZ) continue;
      // Deck axis = the one NOT crossing the pit.
      const [ax, az] = acrossX ? [0, 1] : [1, 0];
      let lift = f;
      for (let i = -REACH; i <= REACH; i++) {
        const nx = tx + ax * i, nz = tz + az * i;
        const t = orig[nz]?.[nx];
        if (t === undefined || t <= PIT_FLOOR) continue;
        if (tiles[nz]![nx] === TileType.Wall) continue;
        if (t > lift && t - f <= 1.0) lift = t;
      }
      floorHeights[tz]![tx] = lift;
    }
  }
}

/**
 * PIT ARCHES — land strips spanning between bottomless pits stop being
 * flat walls straight down. Any walkable tile with pit on both sides
 * within MAX_ARCH_SPAN (checked on both axes; the tighter crossing
 * wins) gets its underside carved to a parabolic arch: thin deck at the
 * crown, legs thickening into the pit walls, open air joining the voids
 * below. Pure per-column with a bounded scan — infinite-world legal.
 * Runs on the finished column model; the walk surface is untouched.
 */
export function carvePitArches(
  columns: import('../types').ColumnSpan[][],
  tiles: TileType[][],
  floorHeights: number[][],
  gridTiles: number,
  pillarWall?: boolean[][],
): void {
  const MAX_ARCH_SPAN = 12;
  const DECK = 1.4; // minimum slab thickness at the crown
  const ABYSS = -1e9 as number; // matches ABYSS_FLOOR sentinel scale
  const isPit = (tx: number, tz: number): boolean =>
    floorHeights[tz]?.[tx] !== undefined && floorHeights[tz]![tx]! <= PIT_FLOOR;
  const spanAcross = (tx: number, tz: number, dx: number, dz: number): [number, number] | null => {
    let a = 0;
    for (let i = 1; i <= MAX_ARCH_SPAN; i++) {
      const nx = tx + dx * i;
      const nz = tz + dz * i;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) return null;
      if (tiles[nz]![nx] === TileType.Wall || pillarWall?.[nz]?.[nx]) return null;
      if (isPit(nx, nz)) { a = i; break; }
    }
    if (a === 0) return null;
    let b = 0;
    for (let i = 1; i <= MAX_ARCH_SPAN; i++) {
      const nx = tx - dx * i;
      const nz = tz - dz * i;
      if (nx < 0 || nz < 0 || nx >= gridTiles || nz >= gridTiles) return null;
      if (tiles[nz]![nx] === TileType.Wall || pillarWall?.[nz]?.[nx]) return null;
      if (isPit(nx, nz)) { b = i; break; }
    }
    if (b === 0 || a + b - 1 > MAX_ARCH_SPAN) return null;
    return [a, b];
  };

  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (tiles[tz]![tx] === TileType.Wall || pillarWall?.[tz]?.[tx]) continue;
      const f = floorHeights[tz]![tx]!;
      if (f <= PIT_FLOOR) continue;
      const sx = spanAcross(tx, tz, 1, 0);
      const sz = spanAcross(tx, tz, 0, 1);
      let best: [number, number] | null = null;
      if (sx && (!sz || sx[0] + sx[1] <= sz[0] + sz[1])) best = sx;
      else if (sz) best = sz;
      if (!best) continue;
      const [a, b] = best;
      const S = a + b; // tiles from pit edge to pit edge
      // Parameter across the span in [-1, 1]; 0 at the arch crown.
      const u = (b - a) / S;
      // Sag: how far below the deck the intrados drops at this tile.
      // Scaled to the span so wide crossings get grand arches.
      const sag = Math.max(4, S * 2.2) * u * u;
      const openingTop = f - DECK - sag;
      const spans = columns[tz * gridTiles + tx]!;
      // Insert the under-arch void below everything this column has.
      const lowest = spans.length > 0 ? spans[0]!.floor : f;
      if (lowest <= PIT_FLOOR) continue; // already open below
      if (openingTop >= lowest - 0.5) continue;
      columns[tz * gridTiles + tx] = [
        { floor: ABYSS, ceil: openingTop, owner: -1, ceilOwner: -1 },
        ...spans,
      ];
    }
  }
}
