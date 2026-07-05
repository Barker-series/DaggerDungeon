/**
 * Megastructure Generator
 *
 * The layer system IS the system. Nothing happens outside it.
 *
 * A "world" is a STACK of levels that physically coexist, organized
 * around a shared VERTICAL SKELETON (Layer 00) generated before any
 * level: stairwell galleries (walkable ramps between floors), atrium
 * wells (multi-level open shafts with balcony rims), and megacolumns
 * that exist identically on every level. The skeleton is what makes the
 * stack one building rather than stacked maps.
 *
 * Per level:
 *   Layer 0:  Noise — decides which cells are active
 *   Layer 1:  Tile grid + fine-noise sculpting of organic cells
 *   Layer 00: Skeleton imprint — exact tiles and locked heights
 *   Layer 2:  Biome — 3D noise sampled at this level's depth
 *   Layer 3:  Spawn/exit — top level spawns free; lower levels arrive at
 *             the stairwell landing above them; only the bottom level
 *             has real stairs out
 *   Layer 4:  Island connection (never through skeleton walls), pillars
 *   Layer 5:  Golden path entrance → stairwell door (never over voids)
 *   Layer 6:  Height fields with the 3D void mask; skeleton heights
 *             locked
 *
 * Then across the stack: decay holes carve downward through solid rock
 * until they find open space (never through the skeleton), and every
 * level learns where its ceiling opens to the space above.
 */

import { TileType, LEVEL_HEIGHT, WORLD_LEVELS, type DungeonData, type WorldData, type RoomData, type GridPos } from './types';
import { getOrCreateCell, getCell, getAllCells, resetCells, snapshotCellBiomes } from './dungeon/cells';
import { buildColumns, validateColumns } from './dungeon/columns';
import { buildSkeleton, imprintSkeleton, type WorldSkeleton } from './dungeon/layer00-skeleton';
import { generateLayer0 } from './dungeon/layer0-noise';
import { generateLayer1TileGrid } from './dungeon/layer1-tilegrid';
import { assignBiomes } from './dungeon/layer2-biome';
import { applyFineNoise } from './dungeon/layer1-finenoise';
import { generateLayer2SpawnExit } from './dungeon/layer2-spawnexit';
import { generateLayer3SpawnRooms } from './dungeon/layer3-spawnrooms';
import { connectIslands } from './dungeon/layer4-connect';
import { computeGoldenPath, goldenPath } from './dungeon/layer5-goldenpath';
import { computeHeightFields, computePitMask, PIT_FLOOR } from './dungeon/layer6-heights';
import { PIT_LEVEL } from './dungeon/heightfield';
import { placePillars } from './dungeon/layer45-pillars';

// ── Config ──

const CELL_GRID_SIZE = 8;
const CELL_TILE_SIZE = 14;
const GRID_TILES = CELL_GRID_SIZE * CELL_TILE_SIZE;

// ── Public API ──

interface GenerateOpts {
  seed: number;
  /** Which megastructure segment — bottom stairs regenerate stack+1 */
  stack: number;
}

export function generateWorld(opts: GenerateOpts): WorldData {
  const { seed, stack } = opts;
  const stackSeed = seed + stack * 100000;

  // ── Layer 00: the stack's shared vertical skeleton ──
  const skel = buildSkeleton(stackSeed, WORLD_LEVELS, CELL_GRID_SIZE, CELL_TILE_SIZE, GRID_TILES);

  const levels: DungeonData[] = [];
  for (let level = 0; level < WORLD_LEVELS; level++) {
    levels.push(generateLevel(seed, stack, level, stackSeed, skel));
  }

  // ── Decay holes carve downward until they find open space ──
  // A hole with solid rock directly below punches through it — the shaft
  // continues, its sides stay sealed by the renderer. Skeleton tiles are
  // never carved (holes are banned above them anyway).
  for (let i = 0; i < levels.length - 1; i++) {
    const cur = levels[i]!;
    const below = levels[i + 1]!;
    for (let tz = 0; tz < GRID_TILES; tz++) {
      for (let tx = 0; tx < GRID_TILES; tx++) {
        if (cur.tiles[tz]![tx] === TileType.Wall) continue;
        if (cur.floorHeights[tz]![tx]! > PIT_LEVEL) continue;
        if (cur.skelVoid[tz]![tx] || cur.fascia[tz]![tx]) continue; // skeleton voids handle themselves
        if (below.tiles[tz]![tx] === TileType.Wall && !below.skelVoid[tz]![tx]) {
          below.tiles[tz]![tx] = TileType.Floor;
          below.floorHeights[tz]![tx] = PIT_FLOOR;
          below.ceilingHeights[tz]![tx] = 3.5;
        }
      }
    }
  }

  // ── Ceilings open wherever the level above has no floor ──
  for (let i = 1; i < levels.length; i++) {
    const above = levels[i - 1]!;
    const cur = levels[i]!;
    for (let tz = 0; tz < GRID_TILES; tz++) {
      for (let tx = 0; tx < GRID_TILES; tx++) {
        if (above.tiles[tz]![tx] === TileType.Wall) continue;
        if (above.skelVoid[tz]![tx]) continue; // ramp space above — its level draws it
        if (above.floorHeights[tz]![tx]! <= PIT_LEVEL) {
          cur.openUp[tz]![tx] = true;
        }
      }
    }
  }

  // ── The column model — built LAST; nothing mutates the world after ──
  const columns = buildColumns(levels);
  const errs = validateColumns(columns, GRID_TILES, GRID_TILES);
  if (errs.length > 0) {
    // A violation is a generation bug, never something to ship silently
    console.error(`[generateWorld] column model invariant violations (seed ${seed}, stack ${stack}):`, errs);
  }

  return { seed, stack, levels, links: skel.stairwells.map((s) => s.link), columns };
}

// ── Per-level pipeline ──

function generateLevel(
  seed: number,
  stack: number,
  level: number,
  stackSeed: number,
  skel: WorldSkeleton,
): DungeonData {
  const levelSeed = stackSeed + level * 1000;
  const isBottom = level === WORLD_LEVELS - 1;
  const stairUp = level > 0 ? skel.stairwells[level - 1] : undefined; // arrival from above
  const stairDown = !isBottom ? skel.stairwells[level] : undefined; // the way down
  resetCells();

  // Shared tile grid — layers read and write this directly
  const tiles: TileType[][] = Array.from({ length: GRID_TILES }, () =>
    Array.from({ length: GRID_TILES }, () => TileType.Wall),
  );
  const rooms: RoomData[] = [];

  // ── Layer 0: Noise ──
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getOrCreateCell(cx, cz);
      generateLayer0(cell, levelSeed);
    }
  }

  // ── Layer 1: Tile grid ──
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      generateLayer1TileGrid(cell, tiles, rooms, CELL_TILE_SIZE, GRID_TILES, 1);
    }
  }

  // ── Layer 2: Biome assignment (3D — sampled at this level's depth) ──
  assignBiomes(CELL_TILE_SIZE, stackSeed, level);

  // ── Layer 1.5: Fine noise — sculpt organic biome cells only ──
  applyFineNoise(tiles, GRID_TILES, CELL_TILE_SIZE, levelSeed);

  // ── Layer 00 imprint: the skeleton overrides everything under it ──
  const imprint = imprintSkeleton(skel, level, tiles, rooms, GRID_TILES, CELL_TILE_SIZE);

  // Skeleton tiles that carving may neither modify nor route through:
  // structure (walls) and open voids. Locked FLOORS (door landings,
  // balcony rims, ramps) are walkable and fine to route across.
  const carveBlocked: boolean[][] = Array.from({ length: GRID_TILES }, (_, tz) =>
    Array.from({ length: GRID_TILES }, (_, tx) =>
      imprint.locked[tz]![tx]! && (
        tiles[tz]![tx] === TileType.Wall ||
        (imprint.presetFloor[tz]![tx] ?? 0) <= PIT_FLOOR + 1
      ),
    ),
  );

  // ── Layer 3: Spawn & exit ──
  // Entrance: top level spawns in a far-off cell; lower levels arrive at
  // the landing under the stairwell from above (already carved).
  // Exit: upper levels target their stairwell-down door; the bottom level
  // gets a real stairs room via the classic machinery.
  let spawnCx = -99, spawnCz = -99, exitCx = -99, exitCz = -99;
  let entrance: GridPos;
  let exit: GridPos;

  if (level === 0) {
    const anchor = { cx: stairDown!.cx, cz: stairDown!.cz };
    const spawnCell = pickFarthestCell(anchor.cx, anchor.cz, skel.usedCells);
    spawnCx = spawnCell.cx;
    spawnCz = spawnCell.cz;
    entrance = {
      x: spawnCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
      y: spawnCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    };
  } else {
    entrance = stairUp!.entrancePos;
  }

  if (isBottom) {
    const entranceCell = { cx: Math.floor(entrance.x / CELL_TILE_SIZE), cz: Math.floor(entrance.y / CELL_TILE_SIZE) };
    const exitCell = pickFarthestCell(entranceCell.cx, entranceCell.cz, skel.usedCells);
    exitCx = exitCell.cx;
    exitCz = exitCell.cz;
    exit = {
      x: exitCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
      y: exitCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    };
  } else {
    exit = stairDown!.exitPos;
  }

  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      const result = generateLayer2SpawnExit(
        cell, tiles, rooms,
        spawnCx, spawnCz, exitCx, exitCz,
        CELL_TILE_SIZE, GRID_TILES, 2, isBottom,
      );
      if (result.entrance) entrance = result.entrance;
      if (result.exit) exit = result.exit;
    }
  }
  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      generateLayer3SpawnRooms(
        cell, tiles, rooms,
        spawnCx, spawnCz, exitCx, exitCz,
        CELL_TILE_SIZE, GRID_TILES, 3, isBottom, carveBlocked,
      );
    }
  }

  // ── Layer 4: Connect disconnected islands (stairwell doors, balconies,
  // and every room end up in one network; skeleton walls stay sealed) ──
  connectIslands(tiles, rooms, entrance, GRID_TILES, CELL_TILE_SIZE, carveBlocked);

  // ── Layer 4.5: Pillars in built biomes ──
  placePillars(tiles, entrance, exit, GRID_TILES, CELL_TILE_SIZE, levelSeed, imprint.locked);

  // ── Layer 5: Golden path — never over skeleton voids, and routed
  // AROUND unstable ground: the same void mask the heights will use
  // makes hole tiles expensive, so the route prefers solid floor and
  // bridges a void only where it must ──
  const pitMask = computePitMask(
    tiles, GRID_TILES, CELL_TILE_SIZE, entrance, exit, level, stackSeed,
    skel.pitBan, imprint.locked,
  );
  const overVoid = (x: number, z: number): boolean =>
    imprint.locked[z]![x]! && (imprint.presetFloor[z]![x] ?? 0) <= PIT_FLOOR + 1;
  computeGoldenPath(tiles, entrance, exit, GRID_TILES, overVoid, (x, z) => pitMask[z]![x]!);

  // ── Layer 6: Height fields (same void mask, skeleton heights locked) ──
  const { floor: floorHeights, ceiling: ceilingHeights } = computeHeightFields(
    tiles, GRID_TILES, CELL_TILE_SIZE, levelSeed, imprint, pitMask,
  );

  // ── Output ──
  return {
    width: GRID_TILES,
    height: GRID_TILES,
    tiles,
    floorHeights,
    ceilingHeights,
    rooms,
    entrance,
    exit,
    seed,
    floor: stack,
    level,
    baseY: -level * LEVEL_HEIGHT,
    cellBiomes: snapshotCellBiomes(CELL_GRID_SIZE),
    goldenPath: [...goldenPath],
    openUp: imprint.openUp,
    skelVoid: imprint.skelVoid,
    fascia: imprint.fascia,
  };
}

/** Farthest active cell from a fixed anchor (distance × noise score),
 *  never one the skeleton occupies. */
function pickFarthestCell(fromCx: number, fromCz: number, exclude: Set<string>): { cx: number; cz: number } {
  const active = getAllCells().filter((c) => c.active && !exclude.has(`${c.cx},${c.cz}`));
  let best: { cx: number; cz: number } | null = null;
  let bestScore = -1;
  for (const c of active) {
    if (c.cx === fromCx && c.cz === fromCz) continue;
    const score = (Math.abs(c.cx - fromCx) + Math.abs(c.cz - fromCz)) * (0.5 + c.noise);
    if (score > bestScore) {
      bestScore = score;
      best = { cx: c.cx, cz: c.cz };
    }
  }
  if (!best) {
    // No usable active cell — take the opposite corner; layer 3 carves a
    // room there and connects it
    best = { cx: CELL_GRID_SIZE - 1 - fromCx, cz: CELL_GRID_SIZE - 1 - fromCz };
    if (exclude.has(`${best.cx},${best.cz}`)) best = { cx: 1, cz: 1 };
  }
  return best;
}
