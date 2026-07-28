/**
 * World verification suite — the generation invariants that must hold
 * on every seed. Run after any change to generation or geometry:
 *
 *   npx tsx tools/verify-world.ts [seed ...]
 *
 * Checks, per seed:
 *   - CLIMBABLE: every pillar's highest walkable surface is reachable
 *     from grade by a walker stepping ≤0.7 between column spans
 *   - BRIDGES: every bridge tile has a walkable span at its height
 *   - NETWORK: every terrain tile belongs to the permanent reachable network
 *   - SEAMS: zero crack pairs (adjacent structural/terrain columns at
 *     near-equal height drawn by different systems)
 *   - COLUMNS: no invariant violations logged by the generator
 */

/* eslint-disable no-console */
import { generateWorld } from '../src/game/DungeonGenerator';
import { bridgeTiles } from '../src/game/dungeon/pillar-bridges';
import { PILLAR_CELL_TILES, PILLAR_FACTOR, pillarOccupied } from '../src/game/dungeon/pillar-layer';
import { pillarFootprint } from '../src/game/dungeon/pillar-geometry';
import { transitSocketOffset } from '../src/game/dungeon/layer4-connect';
import { regionAtCell, type RegionType } from '../src/game/dungeon/region-layer';
import type { BiomeType } from '../src/game/dungeon/cells';
import { findForwardExplorationPath } from '../src/game/pathfinding';
import { TileType } from '../src/game/types';

const DEFAULT_SEEDS = [1, 7, 42, 99, 137, 500, 999, 1234, 4096, 7777, 12345, 31337, 55555, 90210, 2024, 13];
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : DEFAULT_SEEDS;

/** Engine STEP_UP (0.65) plus slack */
const STEP = 0.7;

let failures = 0;
const fail = (msg: string): void => { failures++; console.error(`  FAIL: ${msg}`); };

const logged: string[] = [];
const origError = console.error;
console.error = (...args: unknown[]) => { logged.push(args.join(' ')); origError(...args); };

// ── Window seam agreement: two windows offset by one pillar cell must
// agree on nearly all shared columns. Field-driven and permanent-transit
// layers are window-stable; the diagnostic buckets below identify any
// remaining window-relative work instead of accepting it as mysterious drift.
{
  const seed = SEEDS[0]!;
  const A = generateWorld({ seed, stack: 1 });
  const B = generateWorld({ seed, stack: 1, originPcx: 1, originPcz: 0 });
  const W = A.levels[0]!.width;
  let same = 0, total = 0;
  let tileDiff = 0;
  let heightDiff = 0;
  let pillarDiff = 0;
  let columnOnlyDiff = 0;
  let coreSame = 0, coreTotal = 0;
  const mismatchByAbsCell = new Map<string, number>();
  for (let tz = 0; tz < W; tz++) {
    for (let tx = 56; tx < W; tx++) {
      total++;
      const bx = tx - 56;
      const ka = A.columns[tz * W + tx]!.map((s) => `${s.floor.toFixed(2)}..${s.ceil.toFixed(2)}`).join('|');
      const kb = B.columns[tz * W + bx]!.map((s) => `${s.floor.toFixed(2)}..${s.ceil.toFixed(2)}`).join('|');
      const inSharedCore = tx >= PILLAR_CELL_TILES * 2
        && tx < W - PILLAR_CELL_TILES;
      if (inSharedCore) {
        coreTotal++;
        if (ka === kb) coreSame++;
      }
      if (ka === kb) {
        same++;
        continue;
      }
      const absCell = `${Math.floor(tx / PILLAR_CELL_TILES)},${Math.floor(tz / PILLAR_CELL_TILES)}`;
      mismatchByAbsCell.set(absCell, (mismatchByAbsCell.get(absCell) ?? 0) + 1);
      const tilesDiffer = A.levels.some((level, li) =>
        level.tiles[tz]![tx] !== B.levels[li]!.tiles[tz]![bx]);
      const heightsDiffer = A.levels.some((level, li) =>
        Math.abs(level.floorHeights[tz]![tx]! - B.levels[li]!.floorHeights[tz]![bx]!) > 0.005
        || Math.abs(level.ceilingHeights[tz]![tx]! - B.levels[li]!.ceilingHeights[tz]![bx]!) > 0.005);
      const pillarsDiffer = A.levels.some((level, li) =>
        level.pillarWall[tz]![tx] !== B.levels[li]!.pillarWall[tz]![bx]
        || level.pillarGround[tz]![tx] !== B.levels[li]!.pillarGround[tz]![bx]);
      if (tilesDiffer) tileDiff++;
      if (heightsDiffer) heightDiff++;
      if (pillarsDiffer) pillarDiff++;
      if (!tilesDiffer && !heightsDiffer && !pillarsDiffer) columnOnlyDiff++;
    }
  }
  const pct = (100 * same) / total;
  const corePct = (100 * coreSame) / coreTotal;
  console.log(`window seam: ${pct.toFixed(1)}% of overlap columns identical`);
  console.log(`  retained core: ${corePct.toFixed(1)}% identical (${coreSame}/${coreTotal})`);
  if (same !== total) {
    const hottestCells = [...mismatchByAbsCell.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([cell, count]) => `${cell}:${count}`)
      .join(' ');
    console.log(
      `  seam diffs: tiles=${tileDiff} heights=${heightDiff} `
      + `pillars=${pillarDiff} columns-only=${columnOnlyDiff}; cells ${hottestCells}`,
    );
  }
  if (pct < 90) fail(`window seam agreement ${pct.toFixed(1)}% < 90%`);
  if (corePct < 100) fail(`retained window core agreement ${corePct.toFixed(1)}% < 100%`);

  // A grounded player crossing the east recenter line must have compatible
  // support in the shifted window, either at the same column or within the
  // engine's bounded 16-tile recovery neighborhood. This specifically guards
  // the legacy case where a window-scoped tunnel disappears at handoff.
  const crossingTxA = PILLAR_CELL_TILES * 3;
  const crossingTxB = crossingTxA - PILLAR_CELL_TILES;
  let unsupportedCrossings = 0;
  for (let tz = 0; tz < W; tz++) {
    const oldSpans = A.columns[tz * W + crossingTxA]!;
    for (const oldSpan of oldSpans) {
      if (oldSpan.ceil - oldSpan.floor < 1.8 || oldSpan.floor < -900) continue;
      let recovered = false;
      for (let radius = 0; radius <= 16 && !recovered; radius++) {
        for (let dz = -radius; dz <= radius && !recovered; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const tx = crossingTxB + dx;
            const nz = tz + dz;
            if (tx < 0 || nz < 0 || tx >= W || nz >= W) continue;
            recovered = B.columns[nz * W + tx]!.some((s) =>
              s.floor > -900
              && s.ceil - s.floor >= 1.8
              && Math.abs(s.floor - oldSpan.floor) <= 2);
            if (recovered) break;
          }
        }
      }
      if (!recovered) unsupportedCrossings++;
    }
  }
  if (unsupportedCrossings > 0) {
    fail(`${unsupportedCrossings} east-window crossing spans lack bounded recovery support`);
  }
}

for (const seed of SEEDS) {
  const t0 = Date.now();
  const before = logged.length;
  const world = generateWorld({ seed, stack: 1 });
  const ms = Date.now() - t0;
  const L = world.levels[0]!;
  const W = L.width;
  const occupancySeed = seed + world.stack * 100000;

  // ── Large-area composition ──
  // A play window may intentionally be an empty court or dense block, so
  // measure the authored rhythm across a larger 64x64 pillar-cell tract.
  let occupied = 0;
  const sampleSide = 64;
  for (let pcz = -sampleSide / 2; pcz < sampleSide / 2; pcz++) {
    for (let pcx = -sampleSide / 2; pcx < sampleSide / 2; pcx++) {
      if (pillarOccupied(occupancySeed, pcx, pcz)) occupied++;
    }
  }
  const occupancyPercent = occupied / (sampleSide * sampleSide) * 100;
  if (occupancyPercent < 25 || occupancyPercent > 60) {
    fail(`seed ${seed}: large-area pillar occupancy ${occupancyPercent.toFixed(1)}% outside 25–60%`);
  }

  // ── Region vocabulary ──
  const allowedBiomes: Record<RegionType, ReadonlySet<BiomeType>> = {
    city: new Set(['dungeon', 'crypt']),
    machine: new Set(['cave', 'ember']),
    canyon: new Set(['cave', 'outside']),
    frontier: new Set(['dungeon', 'crypt', 'cave', 'ember', 'outside']),
  };
  let wrongRegionBiomes = 0;
  for (let cz = 0; cz < L.cellBiomes.length; cz++) {
    for (let cx = 0; cx < L.cellBiomes[cz]!.length; cx++) {
      const biome = L.cellBiomes[cz]![cx];
      if (!biome) continue;
      const region = regionAtCell(
        occupancySeed,
        world.originPcx * PILLAR_FACTOR + cx,
        world.originPcz * PILLAR_FACTOR + cz,
      );
      if (!allowedBiomes[region].has(biome)) wrongRegionBiomes++;
    }
  }
  if (wrongRegionBiomes > 0) {
    fail(`seed ${seed}: ${wrongRegionBiomes} cells violate their region vocabulary`);
  }

  if (logged.slice(before).some((m) => m.includes('invariant'))) fail(`seed ${seed}: column invariant violations`);

  // ── Spawn streaming safety ──
  // A spawn outside the center 2x2 pillar cells triggers an immediate
  // recenter, leaving its window-local coordinates over regenerated ground.
  const spawnPcx = Math.floor(L.entrance.x / PILLAR_CELL_TILES);
  const spawnPcz = Math.floor(L.entrance.y / PILLAR_CELL_TILES);
  if (spawnPcx < 1 || spawnPcx > 2 || spawnPcz < 1 || spawnPcz > 2) {
    fail(`seed ${seed}: spawn outside streaming-safe center (${spawnPcx},${spawnPcz})`);
  }

  // ── AUTO exploration ──
  const northPath = findForwardExplorationPath(
    world,
    { level: 0, x: L.entrance.x, y: L.entrance.y },
    0,
  );
  const northTarget = northPath[northPath.length - 1];
  if (!northTarget || northTarget.y >= L.entrance.y) {
    fail(`seed ${seed}: AUTO cannot find reachable terrain north of spawn`);
  }
  const southeastPath = findForwardExplorationPath(
    world,
    { level: 0, x: L.entrance.x, y: L.entrance.y },
    -Math.PI * 0.75,
  );
  const southeastTarget = southeastPath[southeastPath.length - 1];
  if (!southeastTarget ||
      southeastTarget.x <= L.entrance.x ||
      southeastTarget.y <= L.entrance.y) {
    fail(`seed ${seed}: AUTO quantized or lost a southeast heading`);
  }

  // ── Permanent transit sockets: both sides of every owned pair are open ──
  let brokenTransitSockets = 0;
  const pillarGrid = Math.floor(W / PILLAR_CELL_TILES);
  const transitSeed = seed + world.stack * 100000;
  const walkableTile = (tx: number, tz: number): boolean =>
    L.tiles[tz]?.[tx] !== TileType.Wall
    && world.columns[tz * W + tx]!.some((s) => s.floor > -900 && s.ceil - s.floor >= 1.8);
  for (let pcz = 0; pcz < pillarGrid; pcz++) {
    for (let pcx = 0; pcx < pillarGrid; pcx++) {
      const apx = world.originPcx + pcx;
      const apz = world.originPcz + pcz;
      if (pcx + 1 < pillarGrid) {
        const z = pcz * PILLAR_CELL_TILES
          + transitSocketOffset(transitSeed, apx, apz, 'east');
        const x = (pcx + 1) * PILLAR_CELL_TILES;
        if (!walkableTile(x - 1, z) || !walkableTile(x, z)) brokenTransitSockets++;
      }
      if (pcz + 1 < pillarGrid) {
        const x = pcx * PILLAR_CELL_TILES
          + transitSocketOffset(transitSeed, apx, apz, 'south');
        const z = (pcz + 1) * PILLAR_CELL_TILES;
        if (!walkableTile(x, z - 1) || !walkableTile(x, z)) brokenTransitSockets++;
      }
    }
  }
  if (brokenTransitSockets > 0) {
    fail(`seed ${seed}: ${brokenTransitSockets} permanent transit socket pairs are broken`);
  }

  // Every ordinary terrain floor belongs to one connected network. Pillar
  // interiors are column-owned and verified separately by climbability.
  const connected = new Uint8Array(W * W);
  const terrainQueue: number[] = [L.entrance.y * W + L.entrance.x];
  connected[terrainQueue[0]!] = 1;
  for (let head = 0; head < terrainQueue.length; head++) {
    const key = terrainQueue[head]!;
    const tx = key % W;
    const tz = Math.floor(key / W);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = tx + dx;
      const nz = tz + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
      const nk = nz * W + nx;
      if (connected[nk] || L.tiles[nz]![nx] === TileType.Wall) continue;
      connected[nk] = 1;
      terrainQueue.push(nk);
    }
  }
  let unreachableTerrain = 0;
  for (let tz = 0; tz < W; tz++) {
    for (let tx = 0; tx < W; tx++) {
      if (L.tiles[tz]![tx] !== TileType.Wall && !connected[tz * W + tx]) unreachableTerrain++;
    }
  }
  if (unreachableTerrain > 0) {
    fail(`seed ${seed}: ${unreachableTerrain} terrain tiles are outside the permanent transit network`);
  }

  // ── Climbability ──
  let climbable = 0;
  let descendable = 0;
  let deepPillars = 0;
  let elevatorShafts = 0;
  for (const spec of world.pillars.values()) {
    const x0 = spec.cx * PILLAR_CELL_TILES;
    const z0 = spec.cz * PILLAR_CELL_TILES;
    if (spec.elevator) {
      elevatorShafts++;
      const shaft = world.columns[(z0 + 27) * W + x0 + 27]!;
      const bottom = spec.baseDepth + 0.5;
      const shaftAir = shaft.some((s) =>
        s.floor <= bottom + 0.01
        && s.ceil >= spec.totalHeight + 3.9);
      const lobby = world.columns[(z0 + 27) * W + x0 + 17]!
        .some((s) => Math.abs(s.floor - 0.5) < 0.01 && s.ceil - s.floor >= 4);
      const orderedStops = bottom < 0.5 && spec.totalHeight > 0.5;
      if (!shaftAir || !lobby || !orderedStops) {
        fail(
          `seed ${seed}: elevator(${spec.cx},${spec.cz}) invalid `
          + `shaft=${shaftAir} lobby=${lobby} stops=${orderedStops}`,
        );
      } else {
        // The runtime car is the moving floor connecting these authored stops.
        climbable++;
        if (spec.baseDepth < -4) descendable++;
      }
      if (spec.baseDepth < -4) deepPillars++;
      continue;
    }
    const seen = new Set<string>();
    const queue: [number, number, number][] = [];
    let targetY = -Infinity;
    for (let dz = 0; dz < PILLAR_CELL_TILES; dz++) {
      for (let dx = 0; dx < PILLAR_CELL_TILES; dx++) {
        const tx = x0 + dx;
        const tz = z0 + dz;
        if (tx >= W || tz >= W) continue;
        // Climb target: highest habitable floor ON the structure (ring
        // 14..41). Gap columns hold arches — skyline mass, never walked
        // (an arch's end tile sits at 42/13, just outside the ring).
        const onRing = dx >= 14 && dx <= 41 && dz >= 14 && dz <= 41;
        for (const s of world.columns[tz * W + tx]!) {
          if (onRing && s.ceil - s.floor >= 1.5 && s.floor > targetY && s.floor < 1e8) targetY = s.floor;
          if (s.floor > -2 && s.floor < 2 && s.ceil - s.floor >= 1.5) {
            const k = `${tx},${tz},${s.floor.toFixed(2)}`;
            if (!seen.has(k)) { seen.add(k); queue.push([tx, tz, s.floor]); }
          }
        }
      }
    }
    let reached = false;
    let lowest = Infinity;
    while (queue.length > 0) {
      const [tx, tz, fy] = queue.pop()!;
      if (Math.abs(fy - targetY) < 0.01) reached = true;
      if (fy < lowest) lowest = fy;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx!;
        const nz = tz + dz!;
        if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        for (const s of world.columns[nz * W + nx]!) {
          if (s.ceil - s.floor < 1.5 || Math.abs(s.floor - fy) > STEP) continue;
          const k = `${nx},${nz},${s.floor.toFixed(2)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          queue.push([nx, nz, s.floor]);
        }
      }
    }
    if (reached) climbable++;
    // Below-grade kebabs must be DESCENDABLE: the same walk from grade
    // has to reach the bottom landing of the down spiral
    if (spec.baseDepth < -4) {
      if (lowest <= spec.baseDepth + 1.5) descendable++;
      else fail(`seed ${seed}: pillar(${spec.cx},${spec.cz}) depth ${spec.baseDepth} unreachable (lowest walked ${lowest.toFixed(1)})`);
      deepPillars++;
    }
  }
  if (climbable !== world.pillars.size) {
    fail(`seed ${seed}: only ${climbable}/${world.pillars.size} pillars climbable`);
  }

  // ── Bridges ──
  let walkable = 0;
  let total = 0;
  for (const br of world.bridges) {
    for (const { tx, tz, h } of bridgeTiles(br)) {
      if (tx < 0 || tz < 0 || tx >= W || tz >= W) continue;
      total++;
      if (world.columns[tz * W + tx]!.some((s) => Math.abs(s.floor - h) < 0.7 && s.ceil - s.floor >= 1.5)) walkable++;
    }
  }
  if (walkable !== total) fail(`seed ${seed}: ${total - walkable}/${total} bridge tiles unwalkable`);

  // ── Seams: structural surfaces must not sit at terrain height ──
  let cracks = 0;
  for (let tz = 1; tz < L.height - 1; tz++) {
    for (let tx = 1; tx < W - 1; tx++) {
      if (!L.pillarWall[tz]![tx]) continue;
      const spans = world.columns[tz * W + tx]!;
      const s0 = spans[0];
      if (!s0 || s0.owner === 0 || s0.floor < -100 || s0.floor > 30) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx!;
        const nz = tz + dz!;
        if (L.pillarWall[nz]![nx] || L.tiles[nz]![nx] === TileType.Wall) continue;
        const nf = L.floorHeights[nz]![nx]!;
        if (nf > -900 && Math.abs(nf - s0.floor) < 0.8) cracks++;
      }
    }
  }
  if (cracks > 0) fail(`seed ${seed}: ${cracks} crack pairs`);

  // ── Pillar marriage reached its bounded per-footprint fixpoint ──
  let unsettledMarriage = 0;
  for (const spec of world.pillars.values()) {
    const footprint = new Set(pillarFootprint(spec).map(([x, z]) => `${x},${z}`));
    for (const key of footprint) {
      const [lx, lz] = key.split(',').map(Number);
      const tx = spec.cx * PILLAR_CELL_TILES + lx!;
      const tz = spec.cz * PILLAR_CELL_TILES + lz!;
      if (L.pillarGround[tz]?.[tx]) continue;
      const s0 = world.columns[tz * W + tx]?.[0];
      if (!s0 || s0.owner === 0 || s0.floor < -100 || s0.floor > 30) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nlx = lx! + dx;
        const nlz = lz! + dz;
        if (!footprint.has(`${nlx},${nlz}`)) continue;
        const nx = spec.cx * PILLAR_CELL_TILES + nlx;
        const nz = spec.cz * PILLAR_CELL_TILES + nlz;
        if (!L.pillarGround[nz]?.[nx]) continue;
        if (Math.abs(L.floorHeights[nz]![nx]! - s0.floor) <= 0.6) {
          unsettledMarriage++;
          break;
        }
      }
    }
  }
  if (unsettledMarriage > 0) {
    fail(`seed ${seed}: ${unsettledMarriage} pillar-ground tiles remain before marriage fixpoint`);
  }

  console.log(`seed ${seed}: density=${occupancyPercent.toFixed(1)}% deep=${descendable}/${deepPillars} ${ms}ms pillars=${world.pillars.size} elevators=${elevatorShafts} climbable=${climbable} bridges=${world.bridges.length} bridgeTiles=${total} sockets=${brokenTransitSockets} unreachable=${unreachableTerrain} cracks=${cracks} unsettled=${unsettledMarriage}`);
}

console.log(failures === 0 ? `ALL CHECKS PASSED (${SEEDS.length} seeds)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
