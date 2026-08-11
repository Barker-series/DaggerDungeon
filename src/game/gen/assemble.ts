/**
 * Window assembler — the transitional facade over the chunked layers.
 * Produces the exact WorldData the legacy generateWorld produces (the
 * bit-identity harness in tools/verify-migration.ts is the proof), so
 * the engine/physics/renderer keep their window-local world unchanged
 * while generation underneath becomes per-chunk with a lifetime.
 *
 * The layer grids PERSIST across calls (module state — the worker is
 * the intended host): a recenter only generates chunks the previous
 * windows didn't already cover, then re-assembles. Gameplay anchors
 * (spawn entrance) are window-scoped by design — they are the top
 * dependency's focus, not world structure.
 */

import type { ColumnSpan, DungeonData, WorldData, RoomData, GridPos } from '../types';
import { getAllCells, snapshotCellBiomes, CELL_TILE_SIZE } from '../dungeon/cells';
import { cellCrest } from '../dungeon/layer6-heights';
import { validateColumns } from '../dungeon/columns';
import { regionAtCell } from '../dungeon/region-layer';
import { buildPillarField, PILLAR_CELL_TILES, PILLAR_FACTOR, type PillarSpec } from '../dungeon/pillar-layer';
import { pillarFootprint } from '../dungeon/pillar-geometry';
import { planOwnedBridges, bridgeTiles, type BridgeSpec } from '../dungeon/pillar-bridges';
import { pickFarthestCell, nearestPermanentTransit } from '../DungeonGenerator';
import { assembleGrid, type ChunkBounds } from './chunked';
import {
  TileBaseLayer, TransitLayer, HeightLayer, ColumnLayer, setupCellsFromChunks,
} from './layers';

const CT = PILLAR_CELL_TILES;
const CELL = CELL_TILE_SIZE;
const CPC = PILLAR_FACTOR;
const CELL_GRID_SIZE = 16;
const GRID_TILES = CELL_GRID_SIZE * CELL;
const CORE_PC = GRID_TILES / CT; // 4 pillar cells per window side
const PAD_PC = 1; // legacy guard ring, still used for the published bridge list
/** Chunks kept beyond the window on release — the next recenter's
 *  guard ring is usually already here. */
const KEEP_MARGIN_PC = 2;

interface GenState {
  key: string;
  tileBase: TileBaseLayer;
  transit: TransitLayer;
  height: HeightLayer;
  column: ColumnLayer;
}

let state: GenState | null = null;

/** E3: generation config changed. `from` names the shallowest dirty
 *  layer — it and everything downstream drop their chunks; layers
 *  above it stay cached (transit routing is the expensive pass, and a
 *  pit-size tweak has no business recomputing it). */
export type GenResetLevel = 'all' | 'tileBase' | 'transit' | 'height';

export function resetGenState(from: GenResetLevel = 'all'): void {
  if (!state || from === 'all' || from === 'tileBase') {
    state = null;
    return;
  }
  if (from === 'transit') {
    state.transit.clearAll();
    state.height.clearAll();
    state.column.clearAll();
    return;
  }
  // from === 'height'
  state.height.clearAll();
  state.column.clearAll();
}

function layersFor(seed: number, stack: number): GenState {
  const key = `${seed}:${stack}`;
  if (state && state.key === key) return state;
  const stackSeed = seed + stack * 100000;
  const tileBase = new TileBaseLayer(stackSeed);
  const transit = new TransitLayer(stackSeed, tileBase);
  const height = new HeightLayer(stackSeed, tileBase, transit);
  const column = new ColumnLayer(stackSeed, tileBase, transit, height);
  state = { key, tileBase, transit, height, column };
  return state;
}

export interface ChunkedGenOpts {
  seed: number;
  stack: number;
  originPcx?: number;
  originPcz?: number;
}

export function generateWorldChunked(opts: ChunkedGenOpts): WorldData {
  const { seed, stack } = opts;
  const originPcx = opts.originPcx ?? 0;
  const originPcz = opts.originPcz ?? 0;
  const stackSeed = seed + stack * 100000;
  const S = layersFor(seed, stack);

  const b: ChunkBounds = {
    tx0: originPcx * CT, tz0: originPcz * CT,
    tx1: (originPcx + CORE_PC) * CT, tz1: (originPcz + CORE_PC) * CT,
  };
  S.column.ensure(b);
  // Transit one ring wider: nothing structural needs it, but keeping
  // the ring warm means the next recenter's providers are cached.
  S.transit.ensure({
    tx0: b.tx0 - CT, tz0: b.tz0 - CT, tx1: b.tx1 + CT, tz1: b.tz1 + CT,
  });

  // ── Assemble the core arrays ──
  const tiles = assembleGrid(S.transit, (c) => c.tiles, b);
  const pillarWall = assembleGrid(S.tileBase, (c) => c.pillarWall, b);
  const ceilingHeights = assembleGrid(S.height, (c) => c.ceiling, b);
  const floorHeights = assembleGrid(S.column, (c) => c.floor, b);
  const pillarGround = assembleGrid(S.column, (c) => c.pillarGround, b);
  const columns: ColumnSpan[][] = new Array(GRID_TILES * GRID_TILES);
  for (let pcz = 0; pcz < CORE_PC; pcz++) {
    for (let pcx = 0; pcx < CORE_PC; pcx++) {
      const chunk = S.column.get(originPcx + pcx, originPcz + pcz);
      for (let tz = 0; tz < CT; tz++) {
        for (let tx = 0; tx < CT; tx++) {
          columns[(pcz * CT + tz) * GRID_TILES + (pcx * CT + tx)] =
            chunk.columns[tz * CT + tx]!;
        }
      }
    }
  }

  // ── Window-level cell state (snapshots + spawn search read it) ──
  setupCellsFromChunks(S.tileBase, originPcx * CPC, originPcz * CPC, CELL_GRID_SIZE, CELL_GRID_SIZE);
  const cellBiomes = snapshotCellBiomes(CELL_GRID_SIZE);
  const cellDebug = getAllCells().map((c) => (
    { cx: c.cx, cz: c.cz, noise: c.noise, active: c.active, biome: c.biome }));

  // ── Rooms, in the legacy order: layer1 rooms by (cellZ, cellX), then
  // transit rooms by pillar cell row-major ──
  const toLocal = (r: RoomData): RoomData => ({
    ...r,
    left: r.left - b.tx0,
    top: r.top - b.tz0,
    center: { x: r.center.x - b.tx0, y: r.center.y - b.tz0 },
    doors: r.doors.map((d) => ({ x: d.x - b.tx0, y: d.y - b.tz0 })),
  });
  const layer1Rooms: RoomData[] = [];
  const transitRooms: RoomData[] = [];
  for (let pcz = 0; pcz < CORE_PC; pcz++) {
    for (let pcx = 0; pcx < CORE_PC; pcx++) {
      layer1Rooms.push(...S.tileBase.get(originPcx + pcx, originPcz + pcz).rooms.map(toLocal));
      transitRooms.push(...S.transit.get(originPcx + pcx, originPcz + pcz).rooms.map(toLocal));
    }
  }
  layer1Rooms.sort((p, q) => (p.top - q.top) || (p.left - q.left));
  const rooms = [...layer1Rooms, ...transitRooms];

  // ── Transit set + hallway cells, insertion order preserved (the
  // entrance tie-break and the published transitCells order are both
  // observable) ──
  const transitSet = new Set<string>();
  const transitCells: string[] = [];
  for (let pcz = 0; pcz < CORE_PC; pcz++) {
    for (let pcx = 0; pcx < CORE_PC; pcx++) {
      const chunk = S.transit.get(originPcx + pcx, originPcz + pcz);
      for (const key of chunk.transitKeys) {
        const comma = key.indexOf(',');
        const tx = pcx * CT + Number(key.slice(0, comma));
        const tz = pcz * CT + Number(key.slice(comma + 1));
        transitSet.add(`${tx},${tz}`);
      }
      for (const key of chunk.hallwayKeys) {
        const comma = key.indexOf(',');
        const cx = pcx * CPC + Number(key.slice(0, comma));
        const cz = pcz * CPC + Number(key.slice(comma + 1));
        transitCells.push(`${cx},${cz}`);
      }
    }
  }

  // ── Spawn anchor (window-scoped top-dependency overlay) ──
  const pillars = buildPillarField(stackSeed, 0, 0, CORE_PC, CORE_PC, originPcx, originPcz);
  const pillarCells = new Set<string>();
  for (const spec of pillars.values()) {
    for (const [lx, lz] of pillarFootprint(spec)) {
      const tx = spec.cx * CT + lx;
      const tz = spec.cz * CT + lz;
      pillarCells.add(`${Math.floor(tx / CELL)},${Math.floor(tz / CELL)}`);
    }
  }
  const center = Math.floor((CELL_GRID_SIZE + 2 * PAD_PC * CPC) / 2) - PAD_PC * CPC;
  const centerMargin = CPC;
  const spawnCell = pickFarthestCell(
    center, center, pillarCells,
    centerMargin, CELL_GRID_SIZE - centerMargin, CELL_GRID_SIZE,
  );
  let entrance: GridPos = {
    x: spawnCell.cx * CELL + Math.floor(CELL / 2),
    y: spawnCell.cz * CELL + Math.floor(CELL / 2),
  };
  entrance = nearestPermanentTransit(
    entrance, transitSet, CT, GRID_TILES - CT,
  ) ?? entrance;

  // ── Published structure lists: legacy planning frames, verbatim ──
  const genPcx = originPcx - PAD_PC;
  const genPcz = originPcz - PAD_PC;
  const pillarGrid = CORE_PC + 2 * PAD_PC;
  const genTiles = (CELL_GRID_SIZE + 2 * PAD_PC * CPC) * CELL;
  const pillarsPadded = buildPillarField(
    stackSeed, -2, -2, pillarGrid + 2, pillarGrid + 2, genPcx, genPcz,
  );
  const specAt = (cx: number, cz: number): PillarSpec | null => pillarsPadded.get(`${cx},${cz}`) ?? null;
  const planningOwners = [...pillarsPadded.values()].filter(
    (s) => s.cx >= -1 && s.cx < pillarGrid && s.cz >= -1 && s.cz < pillarGrid,
  );
  const touchesWindow = (br: BridgeSpec): boolean =>
    bridgeTiles(br).some(({ tx, tz }) => tx >= 0 && tz >= 0 && tx < genTiles && tz < genTiles);
  const bridgesPadded: BridgeSpec[] = [];
  for (const spec of planningOwners) {
    bridgesPadded.push(...planOwnedBridges(stackSeed, spec.cx, spec.cz, specAt).filter(touchesWindow));
  }
  const touchesCore = (br: BridgeSpec): boolean =>
    bridgeTiles(br).some(({ tx, tz }) => tx >= 0 && tz >= 0 && tx < GRID_TILES && tz < GRID_TILES);
  const shiftBridge = (br: BridgeSpec): BridgeSpec => ({ ...br, cx: br.cx - PAD_PC, cz: br.cz - PAD_PC });
  const bridges = bridgesPadded.map(shiftBridge).filter(touchesCore);

  const level: DungeonData = {
    width: GRID_TILES,
    height: GRID_TILES,
    tiles,
    floorHeights,
    ceilingHeights,
    rooms,
    entrance,
    exit: entrance,
    seed,
    floor: stack,
    level: 0,
    baseY: 0,
    cellBiomes,
    cellCrests: Array.from({ length: CELL_GRID_SIZE }, (_, cz) =>
      Array.from({ length: CELL_GRID_SIZE }, (_, cx) =>
        cellCrest(originPcx * CPC + cx, originPcz * CPC + cz, stackSeed))),
    cellDebug,
    transitCells,
    roadsCells: Array.from({ length: CELL_GRID_SIZE }, (_, cz) =>
      Array.from({ length: CELL_GRID_SIZE }, (_, cx) =>
        regionAtCell(stackSeed, originPcx * CPC + cx, originPcz * CPC + cz) === 'roads')),
    goldenPath: [],
    pillarWall,
    pillarGround,
  };

  const errs = validateColumns(columns, GRID_TILES, GRID_TILES);
  if (errs.length > 0) {
    console.error(`[generateWorldChunked] column invariant violations (seed ${seed}, stack ${stack}):`, errs);
  }

  // ── Chunk lifetime: keep a margin ring, release the rest ──
  const keep: ChunkBounds = {
    tx0: b.tx0 - KEEP_MARGIN_PC * CT, tz0: b.tz0 - KEEP_MARGIN_PC * CT,
    tx1: b.tx1 + KEEP_MARGIN_PC * CT, tz1: b.tz1 + KEEP_MARGIN_PC * CT,
  };
  for (const layer of [S.tileBase, S.transit, S.height, S.column]) layer.release(keep);

  return {
    seed,
    stack,
    originPcx,
    originPcz,
    levels: [level],
    columns,
    pillars,
    bridges,
    subways: [],
  };
}

/** Number of live chunks across all layers (perf probes). */
export function chunkedStateSize(): number {
  if (!state) return 0;
  return [state.tileBase, state.transit, state.height, state.column]
    .reduce((n, l) => n + l.chunkCount(), 0);
}
