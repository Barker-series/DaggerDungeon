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

import { TileType, SKY_CEIL, type DungeonData, type WorldData, type RoomData, type GridPos } from './types';
import { getOrCreateCell, getCell, getAllCells, resetCells, snapshotCellBiomes, setWindowOrigin, tileBiome } from './dungeon/cells';
import { buildColumns, validateColumns } from './dungeon/columns';
import { generateLayer0 } from './dungeon/layer0-noise';
import { generateLayer1TileGrid } from './dungeon/layer1-tilegrid';
import { assignBiomes } from './dungeon/layer2-biome';
import { applyFineNoise } from './dungeon/layer1-finenoise';
import { connectPermanentTransit, permanentTransitTiles } from './dungeon/layer4-connect';
import { computeHeightFields, computePitMask, PIT_FLOOR } from './dungeon/layer6-heights';
import { placePillars } from './dungeon/layer45-pillars';
import { buildPillarField, PILLAR_CELL_TILES, PILLAR_FACTOR, type PillarSpec } from './dungeon/pillar-layer';
import { pillarFootprint, pillarAirSpans } from './dungeon/pillar-geometry';
import {
  planOwnedBridges, planOwnedSubways, planOwnedArches,
  bridgeTiles, carveBridgeIntoColumn, carveArchIntoColumn, addBridgeEndSupport,
  type BridgeSpec,
} from './dungeon/pillar-bridges';

// ── Config ──

const CELL_GRID_SIZE = 16;
const CELL_TILE_SIZE = 14;
const GRID_TILES = CELL_GRID_SIZE * CELL_TILE_SIZE;

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
  // Every noise/RNG/region sample in the level pipeline offsets by the
  // window origin (dungeon cells = 4 per pillar cell)
  setWindowOrigin(originPcx * PILLAR_FACTOR, originPcz * PILLAR_FACTOR);

  // ── Pillar kebabs — the coarse pillar layer's pure function over
  // this window (one pillar cell = 4x4 dungeon cells) ──
  const pillarGrid = Math.floor(GRID_TILES / PILLAR_CELL_TILES);
  const pillars = buildPillarField(stackSeed, 0, 0, pillarGrid, pillarGrid, originPcx, originPcz);

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

  const level = generateLevel(
    seed, stack, stackSeed, pillarCells, pillarWall, originPcx, originPcz,
  );
  const levels: DungeonData[] = [level];

  // ── The column model — built LAST; nothing mutates the world after ──
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
  const pillarFootprints = new Map<PillarSpec, Set<string>>();
  for (const spec of pillars.values()) {
    // ── BOUNDED ROOFLINE DEPENDENCY ──
    // A pillar may only read room ceilings immediately bordering its own
    // footprint. Those boundary samples propagate through this footprint,
    // never through the whole moving window. This is the LayerProcGen
    // effect-distance contract for roof culling: the pillar is the owned
    // output bounds; its one-tile perimeter is the complete dependency
    // padding. Equal-distance contests choose the lower roof.
    const footprint = new Set(pillarFootprint(spec).map(([lx, lz]) => `${lx},${lz}`));
    pillarFootprints.set(spec, footprint);
    const capDistance = new Map<string, number>();
    const localCaps = new Map<string, number>();
    let capFrontier: [number, number][] = [];
    for (const key of footprint) {
      const [lx, lz] = key.split(',').map(Number);
      const gx = spec.cx * PILLAR_CELL_TILES + lx!;
      const gz = spec.cz * PILLAR_CELL_TILES + lz!;
      let boundaryCap = Infinity;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= GRID_TILES || nz >= GRID_TILES) continue;
        if (pillarWall[nz]![nx] || level.tiles[nz]![nx] === TileType.Wall) continue;
        if (tileBiome(topBiomes, nx, nz) === 'outside') continue;
        boundaryCap = Math.min(boundaryCap, topCeils[nz]![nx]!);
      }
      if (Number.isFinite(boundaryCap)) {
        capDistance.set(key, 0);
        localCaps.set(key, boundaryCap);
        capFrontier.push([lx!, lz!]);
      }
    }
    for (let head = 0; head < capFrontier.length; head++) {
      const [lx, lz] = capFrontier[head]!;
      const key = `${lx},${lz}`;
      const distance = capDistance.get(key)!;
      const cap = localCaps.get(key)!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = lx + dx;
        const nz = lz + dz;
        const nextKey = `${nx},${nz}`;
        if (!footprint.has(nextKey)) continue;
        const nextDistance = distance + 1;
        const knownDistance = capDistance.get(nextKey);
        const knownCap = localCaps.get(nextKey);
        if (knownDistance !== undefined
          && (knownDistance < nextDistance
            || (knownDistance === nextDistance && knownCap! <= cap))) continue;
        capDistance.set(nextKey, nextDistance);
        localCaps.set(nextKey, cap);
        capFrontier.push([nx, nz]);
      }
    }

    const groundAt = (lx: number, lz: number): number =>
      topFloors[spec.cz * PILLAR_CELL_TILES + lz]?.[spec.cx * PILLAR_CELL_TILES + lx] ?? 0;
    const capAt = (lx: number, lz: number): number | null => {
      const gx = spec.cx * PILLAR_CELL_TILES + lx;
      const gz = spec.cz * PILLAR_CELL_TILES + lz;
      if (tileBiome(topBiomes, gx, gz) === 'outside') return null;
      const cap = localCaps.get(`${lx},${lz}`);
      return cap !== undefined ? cap + 0.5 : 8;
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

  // ── MARRIAGE PROPAGATES ONLY ACROSS ITS OWNED FOOTPRINT. A pillar ground tile
  // drawn FLAT (structural, owner -1) beside one drawn CORNER-BLENDED
  // (married, owner 0) at the same height is the crack condition: the
  // blended surface climbs away from the flat one and no wall face
  // exists between them (both columns are air there), opening a
  // wedge-shaped hole. The per-tile marry test compares against
  // terrain, so neighbours can land on opposite sides of its threshold.
  // Pull any unmarried ground surface in when it sits within a step of
  // an already-married neighbour. A per-footprint queue reaches the exact
  // fixpoint without reading another pillar or depending on window scan order. ──
  for (const spec of pillars.values()) {
    const footprint = pillarFootprints.get(spec)!;
    const frontier: [number, number][] = [];
    for (const key of footprint) {
      const [lx, lz] = key.split(',').map(Number);
      const gx = spec.cx * PILLAR_CELL_TILES + lx!;
      const gz = spec.cz * PILLAR_CELL_TILES + lz!;
      if (level.pillarGround[gz]?.[gx]) frontier.push([lx!, lz!]);
    }
    for (let head = 0; head < frontier.length; head++) {
      const [lx, lz] = frontier[head]!;
      const gx = spec.cx * PILLAR_CELL_TILES + lx;
      const gz = spec.cz * PILLAR_CELL_TILES + lz;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = lx + dx;
        const nz = lz + dz;
        if (!footprint.has(`${nx},${nz}`)) continue;
        const ngx = spec.cx * PILLAR_CELL_TILES + nx;
        const ngz = spec.cz * PILLAR_CELL_TILES + nz;
        if (level.pillarGround[ngz]?.[ngx]) continue;
        const s0 = columns[ngz * GRID_TILES + ngx]?.[0];
        if (!s0 || s0.owner === 0 || s0.floor < -100 || s0.floor > 30) continue;
        if (Math.abs(topFloors[gz]![gx]! - s0.floor) > 0.6) continue;
        s0.owner = 0;
        topFloors[ngz]![ngx] = s0.floor;
        level.pillarGround[ngz]![ngx] = true;
        frontier.push([nx, nz]);
      }
    }
  }

  // ── Bridges: the neighbor-pair pass with the local degree guarantee.
  // Each cell owns its east and south pairs, so every pair is planned
  // exactly once — and identically from either side in a streamed world. ──
  const specAt = (cx: number, cz: number): PillarSpec | null => pillars.get(`${cx},${cz}`) ?? null;
  const bridges: BridgeSpec[] = [];
  for (const spec of pillars.values()) {
    bridges.push(...planOwnedBridges(stackSeed, spec.cx, spec.cz, specAt));
  }
  // Subways: deep bores between below-grade pillars; ARCHES: skyline
  // mass over canyon districts. Both ride the same pair machinery.
  const subways: BridgeSpec[] = [];
  const arches: BridgeSpec[] = [];
  for (const spec of pillars.values()) {
    subways.push(...planOwnedSubways(stackSeed, spec.cx, spec.cz, specAt));
    arches.push(...planOwnedArches(stackSeed, spec.cx, spec.cz, specAt));
  }
  for (const ar of arches) {
    for (const { tx, tz, h } of bridgeTiles(ar)) {
      if (tx < 0 || tz < 0 || tx >= GRID_TILES || tz >= GRID_TILES) continue;
      columns[tz * GRID_TILES + tx] = carveArchIntoColumn(columns[tz * GRID_TILES + tx]!, h);
    }
  }
  for (const sw of subways) {
    for (const { tx, tz, h } of bridgeTiles(sw)) {
      if (tx < 0 || tz < 0 || tx >= GRID_TILES || tz >= GRID_TILES) continue;
      columns[tz * GRID_TILES + tx] = carveBridgeIntoColumn(columns[tz * GRID_TILES + tx]!, h, true);
    }
  }
  for (const br of bridges) {
    for (const { tx, tz, h, support } of bridgeTiles(br)) {
      if (tx < 0 || tz < 0 || tx >= GRID_TILES || tz >= GRID_TILES) continue;
      columns[tz * GRID_TILES + tx] = carveBridgeIntoColumn(columns[tz * GRID_TILES + tx]!, h, br.pipe);
      if (support) {
        columns[tz * GRID_TILES + tx] = addBridgeEndSupport(columns[tz * GRID_TILES + tx]!, h);
      }
    }
  }

  const errs = validateColumns(columns, GRID_TILES, GRID_TILES);
  if (errs.length > 0) {
    // A violation is a generation bug, never something to ship silently
    console.error(`[generateWorld] column model invariant violations (seed ${seed}, stack ${stack}):`, errs);
  }

  return { seed, stack, originPcx, originPcz, levels, columns, pillars, bridges, subways };
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

  // ── Layer 3: Spawn anchor — never in a pillar cell ──
  const center = Math.floor(CELL_GRID_SIZE / 2);
  // The streaming window recenters around its middle 2x2 pillar cells.
  // Starting outside that region causes an immediate window rebuild while
  // the player is still at the old local coordinates, which can put the
  // first frame over a void. Keep the entrance inside the safe center;
  const centerMargin = PILLAR_FACTOR;
  const spawnCell = pickFarthestCell(
    center,
    center,
    pillarCells,
    centerMargin,
    CELL_GRID_SIZE - centerMargin,
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
    GRID_TILES, CELL_TILE_SIZE, pillarWall,
  );
  // Spawn is a marker on the already-owned permanent graph. It never
  // carves rooms, clears pits, or changes decorative construction.
  entrance = nearestPermanentTransit(
    entrance,
    permanentTransitTiles,
    PILLAR_CELL_TILES,
    GRID_TILES - PILLAR_CELL_TILES,
  ) ?? entrance;

  // ── Layer 4.5: Decorative pillars in built biomes ──
  placePillars(
    tiles, GRID_TILES, CELL_TILE_SIZE,
    levelSeed, pillarWall, permanentTransitTiles,
  );

  // ── Layer 6: permanent transit reserves safe terrain. ──
  const pitMask = computePitMask(
    tiles, GRID_TILES, CELL_TILE_SIZE, stackSeed, permanentTransitTiles,
  );

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
    // Legacy field retained while save/debug data migrates. There is no
    // exit tile or gameplay attached to it.
    exit: entrance,
    seed,
    floor: stack,
    level: 0,
    baseY: 0,
    cellBiomes: snapshotCellBiomes(CELL_GRID_SIZE),
    goldenPath: [],
    pillarWall,
    // Filled in by generateWorld once pillar spans are applied
    pillarGround: Array.from({ length: GRID_TILES }, () =>
      Array.from({ length: GRID_TILES }, () => false)),
  };
}

function nearestPermanentTransit(
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
function pickFarthestCell(
  fromCx: number,
  fromCz: number,
  exclude: Set<string>,
  minCell = 0,
  maxCell = CELL_GRID_SIZE,
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
    if (!best && (minCell !== 0 || maxCell !== CELL_GRID_SIZE)) {
      return pickFarthestCell(fromCx, fromCz, exclude);
    }
    best ??= { cx: 1, cz: 1 };
  }
  return best;
}
