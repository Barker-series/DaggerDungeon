/**
 * The chunked generation layers (milestone B). Each layer's create()
 * runs the SAME pass functions the legacy window pipeline uses, on a
 * small cell-aligned working window assembled from provider chunks,
 * and stores only its own 56×56-tile core (one pillar cell). Modified
 * copies of lower-layer data live in the modifying layer (rule 3) —
 * e.g. transit carves into ITS copy of the tiles, the column layer
 * mutates ITS copy of the floors (pillar marriage).
 *
 * DAG: TileBase → Transit(+pillars) → Height → Column. Padding per
 * dependency is the max effect distance of the consuming passes —
 * constants below, derivations in docs/streaming-milestoneB-design.md.
 */

import { TileType, type ColumnSpan, type DungeonData, type RoomData } from '../types';
import { ChunkedLayer, assembleGrid, type ChunkBounds } from './chunked';
import {
  getOrCreateCell, getCell, resetCells, setWindowOrigin,
  CELL_TILE_SIZE, type BiomeType,
} from '../dungeon/cells';
import { generateLayer0 } from '../dungeon/layer0-noise';
import { generateLayer1TileGrid } from '../dungeon/layer1-tilegrid';
import { assignBiomes } from '../dungeon/layer2-biome';
import { applyFineNoise } from '../dungeon/layer1-finenoise';
import { carveRoadsRegion, cutRoadBlockTops, flattenRoadStreets, suppressRoadPits } from '../dungeon/roads-region';
import { connectPermanentTransit, permanentTransitTiles, hallwayCells } from '../dungeon/layer4-connect';
import { placePillars } from '../dungeon/layer45-pillars';
import { computeHeightFields, computePitMask, carvePitArches, levelPitDecks } from '../dungeon/layer6-heights';
import { applyFoldStructures } from '../dungeon/fold-structure';
import { buildColumns } from '../dungeon/columns';
import { buildPillarField, PILLAR_CELL_TILES, PILLAR_FACTOR, type PillarSpec } from '../dungeon/pillar-layer';
import { pillarFootprint } from '../dungeon/pillar-geometry';
import { applyPillarSpans } from '../dungeon/pillar-marry';
import { planOwnedBridges, planOwnedArches, carveStructures, type BridgeSpec } from '../dungeon/pillar-bridges';

const CT = PILLAR_CELL_TILES; // chunk size in tiles (56)
const CELL = CELL_TILE_SIZE; // 14
const CPC = PILLAR_FACTOR; // dungeon cells per chunk side (4)

// ── Effect-distance padding constants (tiles). Rule 5: padding ≥ the
// max effect distance of every pass that reads through it. Working
// windows must stay CELL-aligned (the cell singleton indexes by cell),
// so pads round up to multiples of CELL. ──
/** TileBase working pad: fine-noise CA 3 iterations + 1 noise rim = 4,
 *  rounded to one cell. */
const PAD_TILEBASE = CELL;
/** Height working pad: pit-deck leveling reach 4 over span 12 = 16 is
 *  the largest (smoothing 2; mouth sweeps 4; border buffer 3+4),
 *  rounded to two cells. */
const PAD_HEIGHT = 2 * CELL;
/** Column working pad: arch span 12 + marry ring 1 + corner sampling,
 *  rounded to one cell. Bridge/arch planning uses the pure pillar
 *  field (radius 2 pillar cells), not chunk data. */
const PAD_COLUMN = CELL;

export interface TileBaseChunk {
  tiles: TileType[][]; // 56², pre-transit
  pillarWall: boolean[][]; // 56²
  /** layer1 rooms of this chunk's cells, ABSOLUTE tile coords */
  rooms: RoomData[];
  /** 4×4 row-major cell snapshots (post-roads mutation) */
  cellActive: boolean[];
  cellBiome: BiomeType[];
  cellNoise: number[];
}

export interface TransitChunk {
  tiles: TileType[][]; // 56², post-transit + decorative pillars
  /** Transit tile keys, CHUNK-LOCAL "tx,tz", in carve order (order is
   *  observable: nearestPermanentTransit tie-breaks on first-seen) */
  transitKeys: string[];
  /** Hallway cell keys, CHUNK-LOCAL "cx,cz" (0..3), in carve order */
  hallwayKeys: string[];
  /** Transit hallway rooms, ABSOLUTE tile coords */
  rooms: RoomData[];
}

export interface HeightChunk {
  floor: number[][]; // 56², pre-marriage
  ceiling: number[][];
}

export interface ColumnChunk {
  columns: ColumnSpan[][]; // flat 56*56, [z*56+x]
  floor: number[][]; // 56², post-marriage/post-roads-plinth
  pillarGround: boolean[][];
}

/** Populate the generation-time cell singleton for a working window
 *  from TileBase snapshots. All passes keep reading getCell/windowOrigin
 *  exactly as they always have — the singleton just gets its data from
 *  chunks instead of a fresh layer0 run. */
export function setupCellsFromChunks(
  tileBase: TileBaseLayer,
  cellX0: number,
  cellZ0: number,
  cellsW: number,
  cellsH: number,
): void {
  resetCells();
  setWindowOrigin(cellX0, cellZ0);
  for (let cz = 0; cz < cellsH; cz++) {
    for (let cx = 0; cx < cellsW; cx++) {
      const acx = cellX0 + cx;
      const acz = cellZ0 + cz;
      const ccx = Math.floor(acx / CPC);
      const ccz = Math.floor(acz / CPC);
      const chunk = tileBase.get(ccx, ccz);
      const li = (acz - ccz * CPC) * CPC + (acx - ccx * CPC);
      const c = getOrCreateCell(cx, cz);
      c.active = chunk.cellActive[li]!;
      c.biome = chunk.cellBiome[li]!;
      c.noise = chunk.cellNoise[li]!;
      c.layer = 10; // fully generated — no pass may regenerate it
    }
  }
}

const crop2D = <T,>(g: T[][], off: number, size: number): T[][] =>
  g.slice(off, off + size).map((row) => row.slice(off, off + size));

export class TileBaseLayer extends ChunkedLayer<TileBaseChunk> {
  constructor(private stackSeed: number) {
    super('tile-base', CT);
    // No chunked providers — reads only pure absolute fields (noise,
    // biome, region, road veins, pillar specs).
  }

  protected create(ccx: number, ccz: number): TileBaseChunk {
    const padCells = PAD_TILEBASE / CELL;
    const cells = CPC + 2 * padCells;
    const cellX0 = ccx * CPC - padCells;
    const cellZ0 = ccz * CPC - padCells;
    const gridTiles = cells * CELL;
    resetCells();
    setWindowOrigin(cellX0, cellZ0);

    const tiles: TileType[][] = Array.from({ length: gridTiles }, () =>
      Array.from({ length: gridTiles }, () => TileType.Wall));
    const rooms: RoomData[] = [];
    for (let cz = 0; cz < cells; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        generateLayer0(getOrCreateCell(cx, cz), this.stackSeed);
      }
    }
    for (let cz = 0; cz < cells; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        generateLayer1TileGrid(getCell(cx, cz)!, tiles, rooms, CELL, gridTiles, 1);
      }
    }
    assignBiomes(CELL, this.stackSeed, 0);
    applyFineNoise(tiles, gridTiles, CELL, this.stackSeed);
    carveRoadsRegion(tiles, gridTiles, CELL, this.stackSeed);

    // Own pillar's footprint (footprints never leave their pillar cell)
    const pillarWall: boolean[][] = Array.from({ length: CT }, () =>
      Array.from({ length: CT }, () => false));
    const spec = buildPillarField(this.stackSeed, 0, 0, 1, 1, ccx, ccz).get('0,0');
    if (spec) {
      for (const [lx, lz] of pillarFootprint(spec)) {
        pillarWall[lz]![lx] = true;
        tiles[padCells * CELL + lz]![padCells * CELL + lx] = TileType.Wall;
      }
    }

    const off = padCells * CELL;
    const tX0 = cellX0 * CELL;
    const tZ0 = cellZ0 * CELL;
    const coreRooms = rooms
      .filter((r) => r.left >= off && r.left < off + CT && r.top >= off && r.top < off + CT)
      .map((r) => ({
        ...r,
        left: r.left + tX0,
        top: r.top + tZ0,
        center: { x: r.center.x + tX0, y: r.center.y + tZ0 },
        doors: r.doors.map((d) => ({ x: d.x + tX0, y: d.y + tZ0 })),
      }));
    const cellActive: boolean[] = [];
    const cellBiome: BiomeType[] = [];
    const cellNoise: number[] = [];
    for (let cz = 0; cz < CPC; cz++) {
      for (let cx = 0; cx < CPC; cx++) {
        const c = getCell(padCells + cx, padCells + cz)!;
        cellActive.push(c.active);
        cellBiome.push(c.biome);
        cellNoise.push(c.noise);
      }
    }
    return { tiles: crop2D(tiles, off, CT), pillarWall, rooms: coreRooms, cellActive, cellBiome, cellNoise };
  }
}

export class TransitLayer extends ChunkedLayer<TransitChunk> {
  constructor(private stackSeed: number, private tileBase: TileBaseLayer) {
    super('transit', CT);
    // Routes are clipped to the owning cell by construction — the one
    // provider read is this chunk's own tiles (padding 0).
    this.dependsOn(tileBase, 0);
  }

  protected create(ccx: number, ccz: number): TransitChunk {
    const base = this.tileBase.get(ccx, ccz);
    const tiles = base.tiles.map((row) => [...row]);
    const rooms: RoomData[] = [];
    // connectPermanentTransit samples wander/sockets from its origin
    // params (absolute), not the window singleton.
    connectPermanentTransit(tiles, rooms, this.stackSeed, ccx, ccz, CT, CELL, base.pillarWall);
    const transitKeys = [...permanentTransitTiles];
    const hallwayKeys = [...hallwayCells];

    // Decorative pillars (layer 4.5) read the cell singleton — chunk
    // frame, own cells only (placement + its 3×3 checks never leave
    // the cell interior).
    setupCellsFromChunks(this.tileBase, ccx * CPC, ccz * CPC, CPC, CPC);
    placePillars(tiles, CT, CELL, this.stackSeed, base.pillarWall, permanentTransitTiles);

    const tX0 = ccx * CT;
    const tZ0 = ccz * CT;
    return {
      tiles,
      transitKeys,
      hallwayKeys,
      rooms: rooms.map((r) => ({
        ...r,
        left: r.left + tX0,
        top: r.top + tZ0,
        center: { x: r.center.x + tX0, y: r.center.y + tZ0 },
        doors: r.doors.map((d) => ({ x: d.x + tX0, y: d.y + tZ0 })),
      })),
    };
  }
}

/** Working-local transit-tile key set for a working window. */
export function transitSetFor(transit: TransitLayer, b: ChunkBounds): Set<string> {
  const out = new Set<string>();
  const c0x = Math.floor(b.tx0 / CT);
  const c0z = Math.floor(b.tz0 / CT);
  const c1x = Math.ceil(b.tx1 / CT);
  const c1z = Math.ceil(b.tz1 / CT);
  for (let cz = c0z; cz < c1z; cz++) {
    for (let cx = c0x; cx < c1x; cx++) {
      for (const key of transit.get(cx, cz).transitKeys) {
        const comma = key.indexOf(',');
        const tx = cx * CT + Number(key.slice(0, comma)) - b.tx0;
        const tz = cz * CT + Number(key.slice(comma + 1)) - b.tz0;
        if (tx >= 0 && tz >= 0 && tx < b.tx1 - b.tx0 && tz < b.tz1 - b.tz0) {
          out.add(`${tx},${tz}`);
        }
      }
    }
  }
  return out;
}

export class HeightLayer extends ChunkedLayer<HeightChunk> {
  constructor(
    private stackSeed: number,
    private tileBase: TileBaseLayer,
    private transit: TransitLayer,
  ) {
    super('height', CT);
    this.dependsOn(transit, PAD_HEIGHT);
    this.dependsOn(tileBase, PAD_HEIGHT);
  }

  protected create(ccx: number, ccz: number): HeightChunk {
    const b: ChunkBounds = {
      tx0: ccx * CT - PAD_HEIGHT, tz0: ccz * CT - PAD_HEIGHT,
      tx1: (ccx + 1) * CT + PAD_HEIGHT, tz1: (ccz + 1) * CT + PAD_HEIGHT,
    };
    const gridTiles = b.tx1 - b.tx0;
    const tiles = assembleGrid(this.transit, (c) => c.tiles, b);
    const pillarWall = assembleGrid(this.tileBase, (c) => c.pillarWall, b);
    setupCellsFromChunks(this.tileBase, b.tx0 / CELL, b.tz0 / CELL, gridTiles / CELL, gridTiles / CELL);
    const protectedTiles = transitSetFor(this.transit, b);
    const pitMask = computePitMask(tiles, gridTiles, CELL, this.stackSeed, protectedTiles);
    suppressRoadPits(pitMask, tiles, gridTiles, CELL, this.stackSeed);
    const { floor, ceiling } = computeHeightFields(
      tiles, gridTiles, CELL, this.stackSeed, pitMask, pillarWall,
    );
    flattenRoadStreets(floor, tiles, gridTiles, CELL, this.stackSeed);
    levelPitDecks(floor, tiles, gridTiles);
    return { floor: crop2D(floor, PAD_HEIGHT, CT), ceiling: crop2D(ceiling, PAD_HEIGHT, CT) };
  }
}

export class ColumnLayer extends ChunkedLayer<ColumnChunk> {
  constructor(
    private stackSeed: number,
    private tileBase: TileBaseLayer,
    private transit: TransitLayer,
    private height: HeightLayer,
  ) {
    super('column', CT);
    this.dependsOn(transit, PAD_COLUMN);
    this.dependsOn(tileBase, PAD_COLUMN);
    this.dependsOn(height, PAD_COLUMN);
  }

  protected create(ccx: number, ccz: number): ColumnChunk {
    const b: ChunkBounds = {
      tx0: ccx * CT - PAD_COLUMN, tz0: ccz * CT - PAD_COLUMN,
      tx1: (ccx + 1) * CT + PAD_COLUMN, tz1: (ccz + 1) * CT + PAD_COLUMN,
    };
    const gridTiles = b.tx1 - b.tx0;
    const tiles = assembleGrid(this.transit, (c) => c.tiles, b);
    const pillarWall = assembleGrid(this.tileBase, (c) => c.pillarWall, b);
    const floors = assembleGrid(this.height, (c) => c.floor, b);
    const ceilings = assembleGrid(this.height, (c) => c.ceiling, b);
    setupCellsFromChunks(this.tileBase, b.tx0 / CELL, b.tz0 / CELL, gridTiles / CELL, gridTiles / CELL);
    // Working cell-biome grid in the working cell frame
    const cellsW = gridTiles / CELL;
    const cellBiomes: (BiomeType | null)[][] = Array.from({ length: cellsW }, (_, cz) =>
      Array.from({ length: cellsW }, (_, cx) => {
        const c = getCell(cx, cz)!;
        return c.active ? c.biome : null;
      }));
    const pillarGround: boolean[][] = Array.from({ length: gridTiles }, () =>
      Array.from({ length: gridTiles }, () => false));

    const pseudo = {
      width: gridTiles, height: gridTiles, tiles,
      floorHeights: floors, ceilingHeights: ceilings,
      cellBiomes, baseY: 0,
    } as unknown as DungeonData;
    const columns = buildColumns([pseudo]);

    // Marry decisions read the ORIGINAL terrain field
    const origFloors = floors.map((row) => [...row]);
    const spec = buildPillarField(this.stackSeed, 0, 0, 1, 1, ccx, ccz).get('0,0');
    if (spec) {
      applyPillarSpans(spec, PAD_COLUMN, PAD_COLUMN, {
        gridTiles, tiles, pillarWall, cellBiomes,
        floorHeights: floors, ceilingHeights: ceilings,
        origFloors, pillarGround, columns,
      });
    }
    cutRoadBlockTops(columns, tiles, gridTiles, CELL, this.stackSeed, pillarWall, floors, pillarGround);
    carvePitArches(columns, tiles, floors, gridTiles, pillarWall);

    // Bridges/arches: owned pairs from the pure pillar field. Owners
    // within radius 1 cover every structure that can touch this chunk;
    // their spec lookups need radius 2 (the degree guarantee) — the
    // local field spans radius 2.
    const FR = 2;
    const field = buildPillarField(this.stackSeed, 0, 0, 2 * FR + 1, 2 * FR + 1, ccx - FR, ccz - FR);
    const specAt = (cx: number, cz: number): PillarSpec | null =>
      field.get(`${cx},${cz}`) ?? null;
    const bridges: BridgeSpec[] = [];
    const arches: BridgeSpec[] = [];
    for (let cz = FR - 1; cz <= FR + 1; cz++) {
      for (let cx = FR - 1; cx <= FR + 1; cx++) {
        bridges.push(...planOwnedBridges(this.stackSeed, cx, cz, specAt));
        arches.push(...planOwnedArches(this.stackSeed, cx, cz, specAt));
      }
    }
    // Fold structures BEFORE bridges: clearance bores cut through fold
    // mass (same ordering as the legacy path)
    applyFoldStructures(
      columns, tiles, floors, cellBiomes, gridTiles,
      this.stackSeed, ccx * CT - PAD_COLUMN, ccz * CT - PAD_COLUMN,
      // Core only: pointwise pass, padding is discarded anyway (2.25×)
      { x0: PAD_COLUMN, z0: PAD_COLUMN, x1: PAD_COLUMN + CT, z1: PAD_COLUMN + CT },
      pillarGround, transitSetFor(this.transit, b), pillarWall,
    );

    // Field tile frame → working frame: field origin is FR chunks
    // northwest of this chunk; working origin is PAD_COLUMN inside.
    const off = -FR * CT + PAD_COLUMN;
    carveStructures(columns, gridTiles, arches, [], bridges, off, off);

    // Crop cores
    const coreColumns: ColumnSpan[][] = new Array(CT * CT);
    for (let tz = 0; tz < CT; tz++) {
      for (let tx = 0; tx < CT; tx++) {
        coreColumns[tz * CT + tx] =
          columns[(tz + PAD_COLUMN) * gridTiles + (tx + PAD_COLUMN)]!;
      }
    }
    return {
      columns: coreColumns,
      floor: crop2D(floors, PAD_COLUMN, CT),
      pillarGround: crop2D(pillarGround, PAD_COLUMN, CT),
    };
  }
}
