/**
 * Megastructure Generator
 *
 * The layer system IS the system. Nothing happens outside it.
 *
 * A "world" is ONE tall floor organized around the COARSE PILLAR LAYER:
 * massive climbable monuments (one per pillar cell = 4x4 dungeon cells)
 * with winding face-ramps, terrace plazas, and gallery interiors,
 * connected by bridges planned per neighbor pair. The dungeon layers
 * fill the ground between the pillars.
 *
 * Layers, in order:
 *   Pillar:   the coarse layer — pure function of (seed, pcx, pcz);
 *             footprints become walls the rest routes around
 *   Layer 0:  Noise — decides which cells are active
 *   Layer 1:  Tile grid + fine-noise sculpting of organic cells
 *   Layer 2:  Biome — noise per cell
 *   Layer 3:  Spawn/exit rooms; the exit stairs regenerate stack+1
 *   Layer 4:  Island connection (batch per pass)
 *   Layer 5:  Golden path entrance → exit, routed around unstable ground
 *   Layer 6:  Height fields with the void mask; terrain flows under
 *             pillar footprints
 *   Columns:  the column model, then pillar air spans, then bridges
 */

import { TileType, SKY_CEIL, type DungeonData, type WorldData, type RoomData, type GridPos } from './types';
import { getOrCreateCell, getCell, getAllCells, resetCells, snapshotCellBiomes, tileBiome } from './dungeon/cells';
import { buildColumns, validateColumns } from './dungeon/columns';
import { generateLayer0 } from './dungeon/layer0-noise';
import { generateLayer1TileGrid } from './dungeon/layer1-tilegrid';
import { assignBiomes } from './dungeon/layer2-biome';
import { applyFineNoise } from './dungeon/layer1-finenoise';
import { generateLayer2SpawnExit } from './dungeon/layer2-spawnexit';
import { generateLayer3SpawnRooms } from './dungeon/layer3-spawnrooms';
import { connectIslands } from './dungeon/layer4-connect';
import { computeGoldenPath, goldenPath } from './dungeon/layer5-goldenpath';
import { computeHeightFields, computePitMask, PIT_FLOOR } from './dungeon/layer6-heights';
import { placePillars } from './dungeon/layer45-pillars';
import { buildPillarField, PILLAR_CELL_TILES, type PillarSpec } from './dungeon/pillar-layer';
import { pillarFootprint, pillarAirSpans } from './dungeon/pillar-geometry';
import {
  planOwnedBridges, planOwnedSubways,
  bridgeTiles, carveBridgeIntoColumn,
  type BridgeSpec,
} from './dungeon/pillar-bridges';

// ── Config ──

const CELL_GRID_SIZE = 16;
const CELL_TILE_SIZE = 14;
const GRID_TILES = CELL_GRID_SIZE * CELL_TILE_SIZE;

// ── Public API ──

interface GenerateOpts {
  seed: number;
  /** Which megastructure segment — the exit stairs regenerate stack+1 */
  stack: number;
}

export function generateWorld(opts: GenerateOpts): WorldData {
  const { seed, stack } = opts;
  const stackSeed = seed + stack * 100000;

  // ── Pillar kebabs — the coarse pillar layer's pure function over
  // this window (one pillar cell = 4x4 dungeon cells) ──
  const pillarGrid = Math.floor(GRID_TILES / PILLAR_CELL_TILES);
  const pillars = buildPillarField(stackSeed, 0, 0, pillarGrid, pillarGrid);

  // Footprint tiles are WALL in the tile grid: connectivity, the golden
  // path, and pathfinding route around pillars by construction. Dungeon
  // cells a pillar touches are also barred from hosting spawn/exit rooms.
  const pillarWall: boolean[][] = Array.from({ length: GRID_TILES }, () =>
    Array.from({ length: GRID_TILES }, () => false),
  );
  const pillarCells = new Set<string>();
  for (const spec of pillars.values()) {
    for (const [lx, lz] of pillarFootprint(spec)) {
      const tx = spec.cx * PILLAR_CELL_TILES + lx;
      const tz = spec.cz * PILLAR_CELL_TILES + lz;
      pillarWall[tz]![tx] = true;
      pillarCells.add(`${Math.floor(tx / CELL_TILE_SIZE)},${Math.floor(tz / CELL_TILE_SIZE)}`);
    }
  }

  const level = generateLevel(seed, stack, stackSeed, pillarCells, pillarWall);
  const levels: DungeonData[] = [level];

  // ── The column model — built LAST; nothing mutates the world after ──
  const columns = buildColumns(levels);

  // Pillar columns: footprint tiles are Wall (no spans); the pillar's
  // own air spans — ledges, platforms, gallery interiors, crown attic —
  // replace them. Faces, floors, and collision derive as usual.
  const topBiomes = level.cellBiomes;
  const topFloors = level.floorHeights;
  const topCeils = level.ceilingHeights;

  // ── LOCAL ROOFLINE FIELD: each interior room's ceiling, propagated
  // into pillar footprints by nearest-room BFS (lowest roof wins on
  // contested tiles). Interior pillar tiles cull generic air above this
  // cap, so a pillar passes through whatever roof it actually pierces
  // as one solid mass — no open chimneys above the ceiling. ──
  const capField = new Float64Array(GRID_TILES * GRID_TILES).fill(-1);
  {
    let frontier: number[] = [];
    for (let tz = 0; tz < GRID_TILES; tz++) {
      for (let tx = 0; tx < GRID_TILES; tx++) {
        if (pillarWall[tz]![tx] || level.tiles[tz]![tx] === TileType.Wall) continue;
        if (tileBiome(topBiomes, tx, tz) === 'outside') continue;
        capField[tz * GRID_TILES + tx] = topCeils[tz]![tx]!;
        frontier.push(tz * GRID_TILES + tx);
      }
    }
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const k of frontier) {
        const tx = k % GRID_TILES;
        const tz = Math.floor(k / GRID_TILES);
        const v = capField[k]!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx!;
          const nz = tz + dz!;
          if (nx < 0 || nz < 0 || nx >= GRID_TILES || nz >= GRID_TILES) continue;
          if (!pillarWall[nz]![nx]) continue;
          const nk = nz * GRID_TILES + nx;
          if (capField[nk]! >= 0) {
            // Contested: the LOWEST adjacent roof wins — sealing below a
            // tall vault just draws the pillar lower; an opening above a
            // low roof is a visible chimney
            capField[nk] = Math.min(capField[nk]!, v);
            continue;
          }
          capField[nk] = v;
          next.push(nk);
        }
      }
      frontier = next;
    }
  }
  // Marry decisions read the ORIGINAL terrain field — married tiles
  // overwrite topFloors as they go, and neighbors must not see that
  const origFloors = topFloors.map((row) => [...row]);
  for (const spec of pillars.values()) {
    const groundAt = (lx: number, lz: number): number =>
      topFloors[spec.cz * PILLAR_CELL_TILES + lz]?.[spec.cx * PILLAR_CELL_TILES + lx] ?? 0;
    const capAt = (lx: number, lz: number): number | null => {
      const gx = spec.cx * PILLAR_CELL_TILES + lx;
      const gz = spec.cz * PILLAR_CELL_TILES + lz;
      if (tileBiome(topBiomes, gx, gz) === 'outside') return null;
      const cap = capField[gz * GRID_TILES + gx]!;
      return cap >= 0 ? cap + 0.5 : 8;
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
      if (tileBiome(topBiomes, spec.cx * PILLAR_CELL_TILES + lx!, spec.cz * PILLAR_CELL_TILES + lz!) === 'outside') outsideTiles++;
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
      const gx = spec.cx * PILLAR_CELL_TILES + lx!;
      const gz = spec.cz * PILLAR_CELL_TILES + lz!;
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
      if (spans.length > 0) {
        const f0 = spans[0]!.floor;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++) {
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const t = origFloors[gz + dz]?.[gx + dx];
            if (t !== undefined && t > PIT_FLOOR && Math.abs(f0 - Math.max(0, t)) < 1.0) near = true;
          }
        }
        if (near) {
          spans[0]!.owner = 0;
          topFloors[gz]![gx] = f0;
          level.pillarGround[gz]![gx] = true;
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
      columns[gz * GRID_TILES + gx] = spans;
    }
  }

  // ── MARRIAGE PROPAGATES ACROSS THE FOOTPRINT. A pillar ground tile
  // drawn FLAT (structural, owner -1) beside one drawn CORNER-BLENDED
  // (married, owner 0) at the same height is the crack condition: the
  // blended surface climbs away from the flat one and no wall face
  // exists between them (both columns are air there), opening a
  // wedge-shaped hole. The per-tile marry test compares against
  // terrain, so neighbours can land on opposite sides of its threshold.
  // Pull any unmarried ground surface in when it sits within a step of
  // an already-married neighbour. ──
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const spec of pillars.values()) {
      for (let lz = 0; lz < PILLAR_CELL_TILES; lz++) {
        for (let lx = 0; lx < PILLAR_CELL_TILES; lx++) {
          const gx = spec.cx * PILLAR_CELL_TILES + lx;
          const gz = spec.cz * PILLAR_CELL_TILES + lz;
          if (gx < 0 || gz < 0 || gx >= GRID_TILES || gz >= GRID_TILES) continue;
          if (!pillarWall[gz]![gx] || level.pillarGround[gz]![gx]) continue;
          const spans = columns[gz * GRID_TILES + gx]!;
          const s0 = spans[0];
          if (!s0 || s0.owner === 0 || s0.floor < -100 || s0.floor > 30) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = gx + dx!;
            const nz = gz + dz!;
            if (nx < 0 || nz < 0 || nx >= GRID_TILES || nz >= GRID_TILES) continue;
            if (!level.pillarGround[nz]![nx]) continue;
            if (Math.abs(topFloors[nz]![nx]! - s0.floor) > 0.6) continue;
            s0.owner = 0;
            topFloors[gz]![gx] = s0.floor;
            level.pillarGround[gz]![gx] = true;
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }

  // ── Bridges: the neighbor-pair pass with the local degree guarantee.
  // Each cell owns its east and south pairs, so every pair is planned
  // exactly once — and identically from either side in a streamed world. ──
  const specAt = (cx: number, cz: number): PillarSpec | null => pillars.get(`${cx},${cz}`) ?? null;
  const bridges: BridgeSpec[] = [];
  for (const spec of pillars.values()) {
    bridges.push(...planOwnedBridges(stackSeed, spec.cx, spec.cz, specAt));
  }
  // Subways: deep bores between below-grade pillars, riding the same
  // pair machinery. (Canyon ARCHES are planned in pillar-bridges but
  // NOT yet applied: carving them breaks spiral climbability on some
  // seeds — unresolved; see planOwnedArches.)
  const subways: BridgeSpec[] = [];
  for (const spec of pillars.values()) {
    subways.push(...planOwnedSubways(stackSeed, spec.cx, spec.cz, specAt));
  }
  for (const sw of subways) {
    for (const { tx, tz, h } of bridgeTiles(sw)) {
      if (tx < 0 || tz < 0 || tx >= GRID_TILES || tz >= GRID_TILES) continue;
      columns[tz * GRID_TILES + tx] = carveBridgeIntoColumn(columns[tz * GRID_TILES + tx]!, h, true);
    }
  }
  for (const br of bridges) {
    for (const { tx, tz, h } of bridgeTiles(br)) {
      if (tx < 0 || tz < 0 || tx >= GRID_TILES || tz >= GRID_TILES) continue;
      columns[tz * GRID_TILES + tx] = carveBridgeIntoColumn(columns[tz * GRID_TILES + tx]!, h, br.pipe);
    }
  }

  const errs = validateColumns(columns, GRID_TILES, GRID_TILES);
  if (errs.length > 0) {
    // A violation is a generation bug, never something to ship silently
    console.error(`[generateWorld] column model invariant violations (seed ${seed}, stack ${stack}):`, errs);
  }

  return { seed, stack, levels, columns, pillars, bridges };
}

// ── The floor pipeline ──

function generateLevel(
  seed: number,
  stack: number,
  stackSeed: number,
  pillarCells: Set<string>,
  pillarWall: boolean[][],
): DungeonData {
  const levelSeed = stackSeed;
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

  // ── Layer 2: Biome assignment ──
  assignBiomes(CELL_TILE_SIZE, stackSeed, 0);

  // ── Layer 1.5: Fine noise — sculpt organic biome cells only ──
  applyFineNoise(tiles, GRID_TILES, CELL_TILE_SIZE, levelSeed);

  // ── Pillar footprints: solid wall in the 2D grid. The column model
  // carves the pillar's real interior later; here they are obstacles
  // that everything routes around and never carves through. ──
  for (let tz = 0; tz < GRID_TILES; tz++) {
    for (let tx = 0; tx < GRID_TILES; tx++) {
      if (pillarWall[tz]![tx]) tiles[tz]![tx] = TileType.Wall;
    }
  }

  // ── Layer 3: Spawn & exit — far-apart rooms, never in pillar cells ──
  const center = Math.floor(CELL_GRID_SIZE / 2);
  const spawnCell = pickFarthestCell(center, center, pillarCells);
  const spawnCx = spawnCell.cx;
  const spawnCz = spawnCell.cz;
  let entrance: GridPos = {
    x: spawnCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    y: spawnCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
  };
  const exitCell = pickFarthestCell(spawnCx, spawnCz, pillarCells);
  const exitCx = exitCell.cx;
  const exitCz = exitCell.cz;
  let exit: GridPos = {
    x: exitCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    y: exitCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
  };

  for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
    for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      const result = generateLayer2SpawnExit(
        cell, tiles, rooms,
        spawnCx, spawnCz, exitCx, exitCz,
        CELL_TILE_SIZE, GRID_TILES, 2, true,
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
        CELL_TILE_SIZE, GRID_TILES, 3, true, pillarWall,
      );
    }
  }

  // ── Layer 4: Connect disconnected islands into one network ──
  connectIslands(tiles, rooms, entrance, GRID_TILES, CELL_TILE_SIZE, pillarWall);

  // ── Layer 4.5: Decorative pillars in built biomes ──
  placePillars(tiles, entrance, exit, GRID_TILES, CELL_TILE_SIZE, levelSeed, pillarWall);

  // ── Layer 5: Golden path — routed AROUND unstable ground: the same
  // void mask the heights will use makes hole tiles expensive, so the
  // route prefers solid floor and bridges a void only where it must ──
  const pitMask = computePitMask(tiles, GRID_TILES, CELL_TILE_SIZE, entrance, exit, stackSeed);
  computeGoldenPath(tiles, entrance, exit, GRID_TILES, (x, z) => pitMask[z]![x]!);

  // ── Layer 6: Height fields (terrain flows under pillar footprints) ──
  const { floor: floorHeights, ceiling: ceilingHeights } = computeHeightFields(
    tiles, GRID_TILES, CELL_TILE_SIZE, levelSeed, pitMask, pillarWall,
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
    level: 0,
    baseY: 0,
    cellBiomes: snapshotCellBiomes(CELL_GRID_SIZE),
    goldenPath: [...goldenPath],
    pillarWall,
    // Filled in by generateWorld once pillar spans are applied
    pillarGround: Array.from({ length: GRID_TILES }, () =>
      Array.from({ length: GRID_TILES }, () => false)),
  };
}

/** Farthest active cell from a fixed anchor (distance × noise score),
 *  never an excluded (pillar) cell. */
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
    // No usable active cell — take the farthest NON-EXCLUDED cell on the
    // whole grid; layer 3 carves a room there and connects it. (Never
    // fall back into an excluded cell: a room punched inside a pillar
    // footprint is sealed off forever.)
    let fallbackScore = -1;
    for (let cz = 0; cz < CELL_GRID_SIZE; cz++) {
      for (let cx = 0; cx < CELL_GRID_SIZE; cx++) {
        if (exclude.has(`${cx},${cz}`)) continue;
        if (cx === fromCx && cz === fromCz) continue;
        const score = Math.abs(cx - fromCx) + Math.abs(cz - fromCz);
        if (score > fallbackScore) {
          fallbackScore = score;
          best = { cx, cz };
        }
      }
    }
    best ??= { cx: 1, cz: 1 };
  }
  return best;
}
