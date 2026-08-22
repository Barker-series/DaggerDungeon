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
 *   Layer 3:  Spawn marker (the endless world currently has no exit)
 *   Layer 4:  Permanent pillar-cell transit and local attachments
 *   Layer 6:  Height fields with the void mask; terrain flows under
 *             pillar footprints
 *   Columns:  the column model, then pillar air spans, then bridges
 */

import { TileType, type ColumnSpan, type DungeonData, type WorldData, type RoomData, type GridPos } from './types';
import { getOrCreateCell, getCell, getAllCells, resetCells, snapshotCellBiomes, setWindowOrigin } from './dungeon/cells';
import { buildColumns, validateColumns } from './dungeon/columns';
import { generateLayer0 } from './dungeon/layer0-noise';
import { generateLayer1TileGrid } from './dungeon/layer1-tilegrid';
import { assignBiomes } from './dungeon/layer2-biome';
import { applyFineNoise } from './dungeon/layer1-finenoise';
import { carveRoadsRegion, cutRoadBlockTops, flattenRoadStreets, suppressRoadPits } from './dungeon/roads-region';
import { regionAtCell } from './dungeon/region-layer';
import { connectPermanentTransit, permanentTransitTiles, hallwayCells } from './dungeon/layer4-connect';
import { computeHeightFields, computePitMask, carvePitArches, levelPitDecks, cellCrest } from './dungeon/layer6-heights';
import { applyFoldStructures } from './dungeon/fold-structure';
import { placePillars } from './dungeon/layer45-pillars';
import { buildPillarField, PILLAR_CELL_TILES, PILLAR_FACTOR, type PillarSpec } from './dungeon/pillar-layer';
import { applyPillarSpans } from './dungeon/pillar-marry';
import { pillarFootprint } from './dungeon/pillar-geometry';
import {
  planOwnedBridges, planOwnedArches,
  bridgeTiles, carveStructures,
  type BridgeSpec,
} from './dungeon/pillar-bridges';

// ── Config ──

const CELL_GRID_SIZE = 16;
const CELL_TILE_SIZE = 14;
const GRID_TILES = CELL_GRID_SIZE * CELL_TILE_SIZE;

/** GUARD PADDING (pillar cells per side): the pipeline generates a
 * padded window and only the core is returned. Every pass that
 * special-cases the grid rim (kernel fallbacks, BFS truncations,
 * boundary clamps) still does — but its damage lands entirely in the
 * discarded padding, so the core is rim-exact: any two windows agree
 * on every shared column. This is the docs' "input bounds always
 * exceed output bounds" rule applied to the window as a whole
 * (docs/layerprocgen/EffectDistance.md). One pillar cell (56 tiles)
 * exceeds the largest compound effect distance in the pipeline
 * (pit-deck leveling SPAN 12 + pit-mask opening ~4, mouth sweep 4 +
 * biome buffer 3 + relax 4, CA 3+1, smoothing 2) with 2x headroom. */
const PAD_PC = 1;

// ── Public API ──

interface GenerateOpts {
  seed: number;
  /** Megastructure segment seed offset (legacy save compatibility). */
  stack: number;
  /** WINDOW ORIGIN on the infinite plane, in PILLAR cells. The window
   *  generates the same slice of the same endless megastructure for
   *  any origin — overlapping windows agree on shared permanent
   *  construction. Default (0,0) = the classic map. */
  originPcx?: number;
  originPcz?: number;
}

export function generateWorld(opts: GenerateOpts): WorldData {
  const { seed, stack } = opts;
  const originPcx = opts.originPcx ?? 0;
  const originPcz = opts.originPcz ?? 0;
  const stackSeed = seed + stack * 100000;

  // ── Padded generation frame: everything below runs on a window one
  // pillar cell larger on every side, anchored one cell northwest.
  // The crop back to the core happens once, at the very end. ──
  const genPcx = originPcx - PAD_PC;
  const genPcz = originPcz - PAD_PC;
  const padCells = PAD_PC * PILLAR_FACTOR;
  const padTiles = padCells * CELL_TILE_SIZE;
  const genCellGrid = CELL_GRID_SIZE + padCells * 2;
  const genTiles = genCellGrid * CELL_TILE_SIZE;

  // Every noise/RNG/region sample in the level pipeline offsets by the
  // window origin (dungeon cells = 4 per pillar cell)
  setWindowOrigin(genPcx * PILLAR_FACTOR, genPcz * PILLAR_FACTOR);

  // ── Pillar kebabs — the coarse pillar layer's pure function over
  // this window (one pillar cell = 4x4 dungeon cells) ──
  const pillarGrid = Math.floor(genTiles / PILLAR_CELL_TILES);
  const pillars = buildPillarField(stackSeed, 0, 0, pillarGrid, pillarGrid, genPcx, genPcz);

  // Footprint tiles are WALL in the tile grid: connectivity, the golden
  // path, and pathfinding route around pillars by construction. Dungeon
  // cells a pillar touches are also barred from hosting spawn/exit rooms.
  const pillarWall: boolean[][] = Array.from({ length: genTiles }, () =>
    Array.from({ length: genTiles }, () => false),
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

  const level = generateLevel(
    seed, stack, stackSeed, pillarCells, pillarWall, genPcx, genPcz,
    genCellGrid, padCells,
  );
  const levels: DungeonData[] = [level];

  // ── The column model — built from the finished tile pipeline. The
  // passes below (pillar marry, road plinths, arches, bridges) still
  // mutate columns AND the level height fields, always in tandem so the
  // two never desync. After this function returns, nothing mutates. ──
  const columns = buildColumns(levels);

  // Pillar columns: footprint tiles are Wall (no spans); the pillar's
  // own air spans — ledges, platforms, gallery interiors, crown attic —
  // replace them. Faces, floors, and collision derive as usual.
  const topBiomes = level.cellBiomes;
  const topFloors = level.floorHeights;
  const topCeils = level.ceilingHeights;

  // Marry decisions read the ORIGINAL terrain field — married tiles
  // overwrite topFloors as they go, and neighbors must not see that
  const origFloors = topFloors.map((row) => [...row]);
  for (const spec of pillars.values()) {
    applyPillarSpans(spec, spec.cx * PILLAR_CELL_TILES, spec.cz * PILLAR_CELL_TILES, {
      gridTiles: genTiles,
      tiles: level.tiles,
      pillarWall,
      cellBiomes: topBiomes,
      floorHeights: topFloors,
      ceilingHeights: topCeils,
      origFloors,
      pillarGround: level.pillarGround,
      columns,
    });
  }
  // (The old marriage-PROPAGATION pass is gone: once marrying requires
  // the tile itself to sit in the terrain window — the grade anchor —
  // propagation could never marry a tile the per-tile test wouldn't,
  // so it was pure redundant machinery. One predicate, applied once.)

  // ── Roads districts: cut block mass down to per-block plinths under
  // open sky — the negative space between streets becomes usable form. ──
  cutRoadBlockTops(columns, level.tiles, genTiles, CELL_TILE_SIZE, stackSeed, pillarWall, level.floorHeights, level.pillarGround);

  // ── Pit arches: land strips spanning between pits become archways —
  // thin deck at the crown, legs thickening into the pit walls. ──
  carvePitArches(columns, level.tiles, level.floorHeights, genTiles, pillarWall);

  // ── Bridges: the neighbor-pair pass with the local degree guarantee.
  // Each cell owns its east and south pairs, so every pair is planned
  // exactly once — and identically from either side in a streamed world.
  //
  // Planning reads a PADDED pillar field (padding ≥ effect distance):
  // pair OWNERS need one ring beyond the window so rim pairs exist at
  // all, and the degree guarantee scans radius 1 around both endpoints
  // of a pair, so spec LOOKUPS need a second ring. Every window covering
  // a pair then derives it from the identical full neighborhood; tile
  // writes below stay clipped to this window and the neighbor window
  // deterministically emits the rest. ──
  const pillarsPadded = buildPillarField(
    stackSeed, -2, -2, pillarGrid + 2, pillarGrid + 2, genPcx, genPcz,
  );
  const specAt = (cx: number, cz: number): PillarSpec | null => pillarsPadded.get(`${cx},${cz}`) ?? null;
  const planningOwners = [...pillarsPadded.values()].filter(
    (s) => s.cx >= -1 && s.cx < pillarGrid && s.cz >= -1 && s.cz < pillarGrid,
  );
  const touchesWindow = (br: BridgeSpec): boolean =>
    bridgeTiles(br).some(({ tx, tz }) => tx >= 0 && tz >= 0 && tx < genTiles && tz < genTiles);
  const bridges: BridgeSpec[] = [];
  for (const spec of planningOwners) {
    bridges.push(...planOwnedBridges(stackSeed, spec.cx, spec.cz, specAt).filter(touchesWindow));
  }
  // ARCHES: skyline mass over canyon districts, on the pair machinery.
  // (Subway bores are GONE: they were unreachable visual scaffolding —
  // only wireframe mode and pit walls ever revealed them. Real rail is
  // the plan-8 routed system; until it exists the world carries no fake
  // infrastructure. planOwnedSubways stays in pillar-bridges, unwired.)
  const subways: BridgeSpec[] = [];
  const arches: BridgeSpec[] = [];
  for (const spec of planningOwners) {
    arches.push(...planOwnedArches(stackSeed, spec.cx, spec.cz, specAt).filter(touchesWindow));
  }
  // ── Fold structures: canyon districts grow kaleidoscopic-fold
  // megastructure mass (pits → tower roots, open sky → canopy), fully
  // columnized = fully playable. BEFORE bridges/subways so their
  // clearance bores cut through fold mass — walkways pierce towers. ──
  applyFoldStructures(
    columns, level.tiles, level.floorHeights, level.cellBiomes, genTiles,
    stackSeed, genPcx * PILLAR_CELL_TILES, genPcz * PILLAR_CELL_TILES,
    // Core only: pointwise pass, the guard ring is cropped anyway
    { x0: padTiles, z0: padTiles, x1: padTiles + GRID_TILES, z1: padTiles + GRID_TILES },
    level.pillarGround, permanentTransitTiles,
  );
  // Fold post-condition (the network guard is load-bearing): every
  // permanent transit tile keeps its walk clearance above its floor.
  {
    let broken = 0;
    for (const key of permanentTransitTiles) {
      const comma = key.indexOf(',');
      const tx = Number(key.slice(0, comma));
      const tz = Number(key.slice(comma + 1));
      if (tx < padTiles || tz < padTiles || tx >= padTiles + GRID_TILES || tz >= padTiles + GRID_TILES) continue;
      const f = level.floorHeights[tz]![tx]!;
      if (f <= -900 || level.tiles[tz]![tx] === TileType.Wall) continue;
      const ok = columns[tz * genTiles + tx]!.some((s) => s.floor <= f + 0.05 && s.ceil >= f + 3.0);
      if (!ok) broken++;
    }
    if (broken > 0) console.error(`[gen] column invariant: ${broken} transit tiles lost walk clearance under fold mass`);
  }

  carveStructures(columns, genTiles, arches, subways, bridges);

  const errs = validateColumns(columns, genTiles, genTiles);
  if (errs.length > 0) {
    // A violation is a generation bug, never something to ship silently
    console.error(`[generateWorld] column model invariant violations (seed ${seed}, stack ${stack}):`, errs);
  }

  // ── CROP: only the core window ships; the guard ring dies here.
  // Every structure shifts one pillar cell northwest into core-local
  // coordinates. Nothing after this point may touch padded indices. ──
  const crop2D = <T,>(g: T[][]): T[][] =>
    g.slice(padTiles, padTiles + GRID_TILES).map((row) => row.slice(padTiles, padTiles + GRID_TILES));
  const cropCells = <T,>(g: T[][]): T[][] =>
    g.slice(padCells, padCells + CELL_GRID_SIZE).map((row) => row.slice(padCells, padCells + CELL_GRID_SIZE));

  const coreColumns: ColumnSpan[][] = new Array(GRID_TILES * GRID_TILES);
  for (let tz = 0; tz < GRID_TILES; tz++) {
    for (let tx = 0; tx < GRID_TILES; tx++) {
      coreColumns[tz * GRID_TILES + tx] = columns[(tz + padTiles) * genTiles + (tx + padTiles)]!;
    }
  }

  const corePillarGrid = Math.floor(GRID_TILES / PILLAR_CELL_TILES);
  const corePillars = new Map<string, PillarSpec>();
  for (const spec of pillars.values()) {
    const cx = spec.cx - PAD_PC;
    const cz = spec.cz - PAD_PC;
    if (cx < 0 || cz < 0 || cx >= corePillarGrid || cz >= corePillarGrid) continue;
    spec.cx = cx;
    spec.cz = cz;
    corePillars.set(`${cx},${cz}`, spec);
  }

  const touchesCore = (br: BridgeSpec): boolean =>
    bridgeTiles(br).some(({ tx, tz }) => tx >= 0 && tz >= 0 && tx < GRID_TILES && tz < GRID_TILES);
  const shiftBridge = (br: BridgeSpec): BridgeSpec => ({ ...br, cx: br.cx - PAD_PC, cz: br.cz - PAD_PC });
  const coreBridges = bridges.map(shiftBridge).filter(touchesCore);
  const coreSubways = subways.map(shiftBridge).filter(touchesCore);

  const coreLevel: DungeonData = {
    ...level,
    width: GRID_TILES,
    height: GRID_TILES,
    tiles: crop2D(level.tiles),
    floorHeights: crop2D(level.floorHeights),
    ceilingHeights: crop2D(level.ceilingHeights),
    pillarWall: crop2D(level.pillarWall),
    pillarGround: crop2D(level.pillarGround),
    cellBiomes: cropCells(level.cellBiomes),
    cellCrests: cropCells(level.cellCrests),
    roadsCells: level.roadsCells ? cropCells(level.roadsCells) : undefined,
    cellDebug: level.cellDebug
      .map((c) => ({ ...c, cx: c.cx - padCells, cz: c.cz - padCells }))
      .filter((c) => c.cx >= 0 && c.cz >= 0 && c.cx < CELL_GRID_SIZE && c.cz < CELL_GRID_SIZE),
    transitCells: level.transitCells.flatMap((key) => {
      const comma = key.indexOf(',');
      const cx = Number(key.slice(0, comma)) - padCells;
      const cz = Number(key.slice(comma + 1)) - padCells;
      return cx >= 0 && cz >= 0 && cx < CELL_GRID_SIZE && cz < CELL_GRID_SIZE ? [`${cx},${cz}`] : [];
    }),
    entrance: { x: level.entrance.x - padTiles, y: level.entrance.y - padTiles },
    exit: { x: level.exit.x - padTiles, y: level.exit.y - padTiles },
    rooms: level.rooms
      .map((r) => ({
        ...r,
        left: r.left - padTiles,
        top: r.top - padTiles,
        center: { x: r.center.x - padTiles, y: r.center.y - padTiles },
        doors: r.doors.map((d) => ({ x: d.x - padTiles, y: d.y - padTiles })),
      }))
      .filter((r) => r.left + r.width > 0 && r.top + r.height > 0 && r.left < GRID_TILES && r.top < GRID_TILES),
  };

  return {
    seed,
    stack,
    originPcx,
    originPcz,
    levels: [coreLevel],
    columns: coreColumns,
    pillars: corePillars,
    bridges: coreBridges,
    subways: coreSubways,
  };
}

// ── The floor pipeline ──

function generateLevel(
  seed: number,
  stack: number,
  stackSeed: number,
  pillarCells: Set<string>,
  pillarWall: boolean[][],
  originPcx: number,
  originPcz: number,
  cellGrid: number,
  padCells: number,
): DungeonData {
  const levelSeed = stackSeed;
  const gridTiles = cellGrid * CELL_TILE_SIZE;
  const padTiles = padCells * CELL_TILE_SIZE;
  resetCells();

  // Shared tile grid — layers read and write this directly
  const tiles: TileType[][] = Array.from({ length: gridTiles }, () =>
    Array.from({ length: gridTiles }, () => TileType.Wall),
  );
  const rooms: RoomData[] = [];

  // ── Layer 0: Noise ──
  for (let cz = 0; cz < cellGrid; cz++) {
    for (let cx = 0; cx < cellGrid; cx++) {
      const cell = getOrCreateCell(cx, cz);
      generateLayer0(cell, levelSeed);
    }
  }

  // ── Layer 1: Tile grid ──
  for (let cz = 0; cz < cellGrid; cz++) {
    for (let cx = 0; cx < cellGrid; cx++) {
      const cell = getCell(cx, cz);
      if (!cell) continue;
      generateLayer1TileGrid(cell, tiles, rooms, CELL_TILE_SIZE, gridTiles, 1);
    }
  }

  // ── Layer 2: Biome assignment ──
  assignBiomes(CELL_TILE_SIZE, stackSeed, 0);

  // ── Layer 1.5: Fine noise — sculpt organic biome cells only ──
  applyFineNoise(tiles, gridTiles, CELL_TILE_SIZE, levelSeed);

  // ── Roads districts: rasterize the street-vein field (crude slice —
  // docs/roads-layer-design.md). Before transit, so layer 4 still
  // guarantees connectivity over whatever the veins leave behind. ──
  carveRoadsRegion(tiles, gridTiles, CELL_TILE_SIZE, stackSeed);

  // ── Pillar footprints: solid wall in the 2D grid. The column model
  // carves the pillar's real interior later; here they are obstacles
  // that everything routes around and never carves through. ──
  for (let tz = 0; tz < gridTiles; tz++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      if (pillarWall[tz]![tx]) tiles[tz]![tx] = TileType.Wall;
    }
  }

  // ── Layer 3: Spawn anchor — never in a pillar cell ──
  const center = Math.floor(cellGrid / 2);
  // The streaming window recenters around its middle 2x2 pillar cells.
  // Starting outside that region causes an immediate window rebuild while
  // the player is still at the old local coordinates, which can put the
  // first frame over a void. Keep the entrance inside the safe center —
  // measured from the CORE, not the padded frame.
  const centerMargin = PILLAR_FACTOR;
  const spawnCell = pickFarthestCell(
    center,
    center,
    pillarCells,
    padCells + centerMargin,
    cellGrid - padCells - centerMargin,
    cellGrid,
  );
  const spawnCx = spawnCell.cx;
  const spawnCz = spawnCell.cz;
  let entrance: GridPos = {
    x: spawnCx * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
    y: spawnCz * CELL_TILE_SIZE + Math.floor(CELL_TILE_SIZE / 2),
  };

  // ── Layer 4: Permanent pillar-cell transit. Absolute cell-pair sockets
  // and owned local routes replace the old whole-window island repair. ──
  connectPermanentTransit(
    tiles, rooms, stackSeed, originPcx, originPcz,
    gridTiles, CELL_TILE_SIZE, pillarWall,
  );
  // Spawn is a marker on the already-owned permanent graph. It never
  // carves rooms, clears pits, or changes decorative construction.
  entrance = nearestPermanentTransit(
    entrance,
    permanentTransitTiles,
    padTiles + PILLAR_CELL_TILES,
    gridTiles - padTiles - PILLAR_CELL_TILES,
  ) ?? entrance;

  // ── Layer 4.5: Decorative pillars in built biomes ──
  placePillars(
    tiles, gridTiles, CELL_TILE_SIZE,
    levelSeed, pillarWall, permanentTransitTiles,
  );

  // ── Layer 6: permanent transit reserves safe terrain. ──
  const pitMask = computePitMask(
    tiles, gridTiles, CELL_TILE_SIZE, stackSeed, permanentTransitTiles,
  );

  // ── Roads districts: arteries never break — no pits mid-street. ──
  suppressRoadPits(pitMask, tiles, gridTiles, CELL_TILE_SIZE, stackSeed);

  // ── Layer 6: Height fields (terrain flows under pillar footprints) ──
  const { floor: floorHeights, ceiling: ceilingHeights } = computeHeightFields(
    tiles, gridTiles, CELL_TILE_SIZE, levelSeed, pitMask, pillarWall,
  );

  // ── Roads districts: streets run at flat grade so quantized block
  // tops meet them with steppable or fully-walled edges only. ──
  flattenRoadStreets(floorHeights, tiles, gridTiles, CELL_TILE_SIZE, stackSeed);

  // ── Pit decks hold the level of their banks — no mid-span dips. ──
  levelPitDecks(floorHeights, tiles, gridTiles);

  // ── Output ──
  return {
    width: gridTiles,
    height: gridTiles,
    tiles,
    floorHeights,
    ceilingHeights,
    rooms,
    entrance,
    // Legacy field retained while save/debug data migrates. There is no
    // exit tile or gameplay attached to it.
    exit: entrance,
    seed,
    floor: stack,
    level: 0,
    baseY: 0,
    cellBiomes: snapshotCellBiomes(cellGrid),
    // The crest authority, snapshotted per cell: pure absolute function,
    // so the same cell crests identically in every window that sees it
    cellCrests: Array.from({ length: cellGrid }, (_, cz) =>
      Array.from({ length: cellGrid }, (_, cx) =>
        cellCrest(
          originPcx * PILLAR_FACTOR + cx,
          originPcz * PILLAR_FACTOR + cz,
          levelSeed,
        ))),
    cellDebug: getAllCells().map((c) => (
      { cx: c.cx, cz: c.cz, noise: c.noise, active: c.active, biome: c.biome })),
    transitCells: [...hallwayCells],
    // Per-cell roads mask — contour/collision must know these are
    // rectilinear plinth districts, not organic cave mass
    roadsCells: Array.from({ length: cellGrid }, (_, cz) =>
      Array.from({ length: cellGrid }, (_, cx) =>
        regionAtCell(
          stackSeed,
          originPcx * PILLAR_FACTOR + cx,
          originPcz * PILLAR_FACTOR + cz,
        ) === 'roads')),
    goldenPath: [],
    pillarWall,
    // Filled in by generateWorld once pillar spans are applied
    pillarGround: Array.from({ length: gridTiles }, () =>
      Array.from({ length: gridTiles }, () => false)),
  };
}

export function nearestPermanentTransit(
  target: GridPos,
  transit: ReadonlySet<string>,
  minCoordinate = 0,
  maxCoordinate = Infinity,
): GridPos | null {
  let best: GridPos | null = null;
  let bestDistance = Infinity;
  for (const key of transit) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    if (x < minCoordinate || y < minCoordinate || x >= maxCoordinate || y >= maxCoordinate) continue;
    const distance = Math.abs(x - target.x) + Math.abs(y - target.y);
    if (distance < bestDistance || (
      distance === bestDistance &&
      (best === null || y < best.y || (y === best.y && x < best.x))
    )) {
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best;
}

/** Farthest active cell from a fixed anchor (distance × noise score),
 *  never an excluded (pillar) cell. */
export function pickFarthestCell(
  fromCx: number,
  fromCz: number,
  exclude: Set<string>,
  minCell: number,
  maxCell: number,
  wholeGrid: number,
): { cx: number; cz: number } {
  const inBounds = (cx: number, cz: number): boolean =>
    cx >= minCell && cz >= minCell && cx < maxCell && cz < maxCell;
  const active = getAllCells().filter((c) =>
    c.active &&
    inBounds(c.cx, c.cz) &&
    !exclude.has(`${c.cx},${c.cz}`),
  );
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
    for (let cz = minCell; cz < maxCell; cz++) {
      for (let cx = minCell; cx < maxCell; cx++) {
        if (exclude.has(`${cx},${cz}`)) continue;
        if (cx === fromCx && cz === fromCz) continue;
        const score = Math.abs(cx - fromCx) + Math.abs(cz - fromCz);
        if (score > fallbackScore) {
          fallbackScore = score;
          best = { cx, cz };
        }
      }
    }
    // A bounded region could theoretically be entirely occupied by pillar
    // footprints. Preserve the old whole-window fallback in that case.
    if (!best && (minCell !== 0 || maxCell !== wholeGrid)) {
      return pickFarthestCell(fromCx, fromCz, exclude, 0, wholeGrid, wholeGrid);
    }
    best ??= { cx: 1, cz: 1 };
  }
  return best;
}
