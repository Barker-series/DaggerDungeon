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
 *   - ROUTE: spawn → exit is navigable, never crossing an open pit
 *   - SEAMS: zero crack pairs (adjacent structural/terrain columns at
 *     near-equal height drawn by different systems)
 *   - COLUMNS: no invariant violations logged by the generator
 */

/* eslint-disable no-console */
import { generateWorld } from '../src/game/DungeonGenerator';
import { findWorldPathToExit } from '../src/game/pathfinding';
import { bridgeTiles } from '../src/game/dungeon/pillar-bridges';
import { PILLAR_CELL_TILES } from '../src/game/dungeon/pillar-layer';
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
// agree on nearly all shared columns (field-driven layers are exactly
// window-stable; per-window passes — rooms, hallways, golden path —
// account for the small remainder). Guards the endless-world plumbing.
{
  const seed = SEEDS[0]!;
  const A = generateWorld({ seed, stack: 1 });
  const B = generateWorld({ seed, stack: 1, originPcx: 1, originPcz: 0 });
  const W = A.levels[0]!.width;
  let same = 0, total = 0;
  for (let tz = 0; tz < W; tz++) {
    for (let tx = 56; tx < W; tx++) {
      total++;
      const ka = A.columns[tz * W + tx]!.map((s) => `${s.floor.toFixed(2)}..${s.ceil.toFixed(2)}`).join('|');
      const kb = B.columns[tz * W + (tx - 56)]!.map((s) => `${s.floor.toFixed(2)}..${s.ceil.toFixed(2)}`).join('|');
      if (ka === kb) same++;
    }
  }
  const pct = (100 * same) / total;
  console.log(`window seam: ${pct.toFixed(1)}% of overlap columns identical`);
  if (pct < 90) fail(`window seam agreement ${pct.toFixed(1)}% < 90%`);
}

for (const seed of SEEDS) {
  const t0 = Date.now();
  const before = logged.length;
  const world = generateWorld({ seed, stack: 1 });
  const ms = Date.now() - t0;
  const L = world.levels[0]!;
  const W = L.width;

  if (logged.slice(before).some((m) => m.includes('invariant'))) fail(`seed ${seed}: column invariant violations`);

  // ── Route ──
  const route = findWorldPathToExit(world, { level: 0, x: L.entrance.x, y: L.entrance.y });
  if (route.length === 0) fail(`seed ${seed}: no spawn→exit route`);
  const overPit = route.filter((p) =>
    L.tiles[p.y]![p.x] !== TileType.Wall && L.floorHeights[p.y]![p.x]! <= -999).length;
  if (overPit > 0) fail(`seed ${seed}: route crosses ${overPit} open pit tiles`);

  // ── Climbability ──
  let climbable = 0;
  let descendable = 0;
  let deepPillars = 0;
  for (const spec of world.pillars.values()) {
    const x0 = spec.cx * PILLAR_CELL_TILES;
    const z0 = spec.cz * PILLAR_CELL_TILES;
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

  console.log(`seed ${seed}: deep=${descendable}/${deepPillars} ${ms}ms pillars=${world.pillars.size} climbable=${climbable} bridges=${world.bridges.length} bridgeTiles=${total} route=${route.length} cracks=${cracks}`);
}

console.log(failures === 0 ? `ALL CHECKS PASSED (${SEEDS.length} seeds)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
