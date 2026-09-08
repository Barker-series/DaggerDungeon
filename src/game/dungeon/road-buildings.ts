/** Road-front facilities are owned by bounded parcels, but their footprint
 * follows the existing street/plinth field. No whole-block/global flood fill.
 * The planner reads two tiles of context and writes only its 24-tile parcel.
 * Empty courts, streets, pillar footprints and unsuitable slivers stay intact.
 */
import { TileType, TILE_SIZE, SKY_CEIL, type ColumnSpan } from '../types';
import { regionAtCell } from './region-layer';
import { roadVeinsAt } from './road-field';
import { GAME_ROAD_PARAMS, roadPlinthHeight } from './roads-region';
import { cellSeed, mulberry32 } from './rng';
import { assemblePillar } from './pillar-layer';
import { planOwnedBridges, bridgeTiles } from './pillar-bridges';

export const ROAD_PARCEL_TILES = 24;
/** Published envelope for other coarse layers: derived from the foundation
 * field and this planner's storey rule, not whichever parcels are loaded. */
export const ROAD_STOREY_PITCH = 12;
const MAX_EXTRA_STOREYS = 2;
export const ROAD_MAX_FACILITY_ROOF =
  0.5 +
  (Math.ceil((roadPlinthHeight(1) + 8.5) / ROAD_STOREY_PITCH) + MAX_EXTRA_STOREYS) *
    ROAD_STOREY_PITCH;
const N = ROAD_PARCEL_TILES;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const RING = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [4, 2],
  [4, 3],
  [4, 4],
  [3, 4],
  [2, 4],
  [1, 4],
  [1, 3],
  [1, 2],
];

export interface RoadPlotSample {
  foundation: boolean;
  street: boolean;
  top: number;
  block: string;
}
export type RoadPlotProbe = (tx: number, tz: number) => RoadPlotSample;
export interface RoadBuildingPlan {
  id: string;
  /** Absolute tile origin. All index arrays below are local z*24+x. */
  tx0: number;
  tz0: number;
  body: number[];
  interior: number[];
  entry: number[];
  street: number;
  posts: number[];
  baseTop: number;
  storeys: number;
  roofY: number;
  core?: { x: number; z: number; rotation: number };
  /** Roof/wall junctions for surface pipework and overhead cable anchors. */
  anchors: { tx: number; tz: number; nx: number; nz: number }[];
}

export function roadPlotSample(
  seed: number,
  tx: number,
  tz: number,
  tile: TileType,
  pillar: boolean,
): RoadPlotSample {
  if (pillar || regionAtCell(seed, Math.floor(tx / 14), Math.floor(tz / 14)) !== 'roads')
    return { foundation: false, street: false, top: 0, block: '' };
  if (tile !== TileType.Wall) return { foundation: false, street: true, top: 0.5, block: '' };
  const s = roadVeinsAt(seed, (tx + 0.5) * TILE_SIZE, (tz + 0.5) * TILE_SIZE, GAME_ROAD_PARAMS);
  const top = roadPlinthHeight(s.blockHash);
  return { foundation: !s.road && top >= 3, street: false, top, block: s.blockId };
}
function adjacent(k: number): number[] {
  const x = k % N,
    z = Math.floor(k / N);
  return DIRS.flatMap(([dx, dz]) =>
    x + dx >= 0 && z + dz >= 0 && x + dx < N && z + dz < N ? [(z + dz) * N + x + dx] : [],
  );
}
function components(
  cells: Set<number>,
  same: (a: number, b: number) => boolean = () => true,
): number[][] {
  const left = new Set(cells),
    out: number[][] = [];
  for (const start of cells) {
    if (!left.delete(start)) continue;
    const queue = [start];
    for (let i = 0; i < queue.length; i++)
      for (const n of adjacent(queue[i]!)) {
        if (left.has(n) && same(queue[i]!, n)) {
          left.delete(n);
          queue.push(n);
        }
      }
    out.push(queue.sort((a, b) => a - b));
  }
  return out.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
}
function turn(x: number, z: number, k: number): [number, number] {
  for (let i = 0; i < k; i++) [x, z] = [5 - z, x];
  return [x, z];
}

/** Existing pair-owned crossings reserve their corridors before facilities
 * are fitted. These are pure coarse-field reads (including the bridge degree
 * guarantee's radius), not a scan of whichever bridges a window has loaded. */
function roadBridgeReservations(seed: number, lotX: number, lotZ: number): Set<string> {
  const tx0 = lotX * N,
    tz0 = lotZ * N,
    out = new Set<string>();
  const specs = new Map<string, ReturnType<typeof assemblePillar>>();
  const at = (x: number, z: number): ReturnType<typeof assemblePillar> => {
    const key = `${x},${z}`;
    if (!specs.has(key)) specs.set(key, assemblePillar(seed, x, z));
    return specs.get(key)!;
  };
  for (let z = Math.floor((tz0 - 2) / 56) - 1; z <= Math.floor((tz0 + N + 1) / 56); z++) {
    for (let x = Math.floor((tx0 - 2) / 56) - 1; x <= Math.floor((tx0 + N + 1) / 56); x++) {
      for (const br of planOwnedBridges(seed, x, z, at))
        for (const t of bridgeTiles(br)) {
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const lx = t.tx + dx - tx0,
                lz = t.tz + dz - tz0;
              if (lx >= -2 && lz >= -2 && lx < N + 2 && lz < N + 2) out.add(`${lx},${lz}`);
            }
        }
    }
  }
  return out;
}

export function planRoadParcel(
  seed: number,
  lotX: number,
  lotZ: number,
  probe: RoadPlotProbe,
  reserved?: ReadonlySet<string>,
): RoadBuildingPlan | null {
  const tx0 = lotX * N,
    tz0 = lotZ * N;
  let blocked = reserved;
  const samples = new Map<string, RoadPlotSample>();
  const at = (x: number, z: number): RoadPlotSample => {
    const key = `${x},${z}`;
    if (!samples.has(key)) {
      const s = probe(tx0 + x, tz0 + z);
      if (s.foundation && !blocked) blocked = roadBridgeReservations(seed, lotX, lotZ);
      samples.set(key, blocked?.has(key) ? { ...s, foundation: false } : s);
    }
    return samples.get(key)!;
  };
  const candidates = new Set<number>();
  for (let z = 1; z < N - 1; z++)
    for (let x = 1; x < N - 1; x++) {
      const s = at(x, z);
      if (!s.foundation) continue;
      let fits = true;
      for (let dz = -2; dz <= 2 && fits; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const n = at(x + dx, z + dz);
          if (!n.foundation || n.top !== s.top) {
            fits = false;
            break;
          }
        }
      if (fits) candidates.add(z * N + x);
    }
  // Follow the visible contiguous foundation, not hidden potential-line IDs:
  // adjacent IDs can legitimately describe one flat plinth at the same height.
  const same = (a: number, b: number) =>
    at(a % N, Math.floor(a / N)).top === at(b % N, Math.floor(b / N)).top;
  for (const component of components(candidates, same)) {
    if (component.length < 30) continue;
    const componentSet = new Set(component);
    const inners = new Set(component.filter((k) => adjacent(k).every((n) => componentSet.has(n))));
    const interiorArray = components(inners)[0];
    if (!interiorArray || interiorArray.length < 12) continue;
    const interior = new Set(interiorArray),
      body = new Set<number>();
    for (const k of interior) {
      const x = k % N,
        z = Math.floor(k / N);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = (z + dz) * N + x + dx;
          if (componentSet.has(n)) body.add(n);
        }
    }
    const entrances: { path: number[]; street: number; inner: number }[] = [];
    for (const k of interior)
      for (const [dx, dz] of DIRS) {
        const x = k % N,
          z = Math.floor(k / N),
          sx = -dz,
          sz = dx;
        if (!interior.has((z + sz) * N + x + sx)) continue;
        if (!body.has((z + dz) * N + x + dx) || interior.has((z + dz) * N + x + dx)) continue;
        const path: number[] = [];
        for (let d = 1; d <= 4; d++) {
          const pair = [
            [x + dx * d, z + dz * d],
            [x + sx + dx * d, z + sz + dz * d],
          ];
          if (pair.some(([px, pz]) => px! < 0 || pz! < 0 || px! >= N || pz! >= N)) break;
          const values = pair.map(([px, pz]) => at(px!, pz!));
          if (values.every((s) => s.street)) {
            entrances.push({ path, street: pair[0]![1]! * N + pair[0]![0]!, inner: k });
            break;
          }
          if (values.some((s) => !s.street && (!s.foundation || s.top !== at(x, z).top))) break;
          pair.forEach(([px, pz], i) => {
            if (!values[i]!.street) path.push(pz! * N + px!);
          });
        }
      }
    if (!entrances.length) continue;
    entrances.sort(
      (a, b) => a.path.length - b.path.length || a.inner - b.inner || a.street - b.street,
    );
    const rng = mulberry32(cellSeed(lotX, lotZ, seed, 12021));
    const entrance = entrances[Math.floor(rng() * Math.min(4, entrances.length))]!;
    const entry = new Set(entrance.path);
    let core: RoadBuildingPlan['core'];
    for (let z = 1; z < N - 6 && !core; z++)
      for (let x = 1; x < N - 6 && !core; x++) {
        const square: number[] = [];
        for (let dz = 0; dz < 6; dz++)
          for (let dx = 0; dx < 6; dx++) square.push((z + dz) * N + x + dx);
        if (!square.every((k) => body.has(k) && !entry.has(k))) continue;
        const free = new Set([...interior].filter((k) => !square.includes(k)));
        if (!free.has(entrance.inner) || components(free).length !== 1) continue;
        for (let rotation = 0; rotation < 4; rotation++) {
          const doors = [turn(1, -1, rotation), turn(2, -1, rotation)];
          if (doors.every(([dx, dz]) => free.has((z + dz) * N + x + dx))) {
            core = { x, z, rotation };
            break;
          }
        }
      }
    const coreCells = new Set<number>();
    if (core)
      for (let z = 0; z < 6; z++)
        for (let x = 0; x < 6; x++) coreCells.add((core.z + z) * N + core.x + x);
    const posts = interiorArray.filter((k) => {
      if (coreCells.has(k) || entry.has(k)) return false;
      const x = k % N,
        z = Math.floor(k / N);
      if ((((tx0 + x) % 5) + 5) % 5 !== 2 || (((tz0 + z) % 5) + 5) % 5 !== 2) return false;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = (z + dz) * N + x + dx;
          if (!interior.has(n) || coreCells.has(n)) return false;
        }
      return true;
    });
    const baseTop = at(component[0]! % N, Math.floor(component[0]! / N)).top;
    const minimum = Math.max(1, Math.ceil((baseTop + 8.5) / ROAD_STOREY_PITCH));
    const storeys = minimum + Math.floor(rng() * (core ? MAX_EXTRA_STOREYS + 1 : 2));
    const edges = [...body].filter((k) => !interior.has(k) && !entry.has(k));
    const picks = new Set<number>();
    for (const axis of [0, 1])
      for (const sign of [-1, 1]) {
        const sorted = [...edges].sort(
          (a, b) =>
            sign *
              ((axis === 0 ? a % N : Math.floor(a / N)) -
                (axis === 0 ? b % N : Math.floor(b / N))) || a - b,
        );
        if (sorted.length) picks.add(sorted[0]!);
      }
    const anchors = [...picks].map((k) => {
      const x = k % N,
        z = Math.floor(k / N);
      const [nx, nz] = DIRS.find(([dx, dz]) => !body.has((z + dz) * N + x + dx)) ?? DIRS[0]!;
      return { tx: tx0 + x, tz: tz0 + z, nx, nz };
    });
    return {
      id: `road:${lotX},${lotZ}:${at(component[0]! % N, Math.floor(component[0]! / N)).block}`,
      tx0,
      tz0,
      body: [...body].sort((a, b) => a - b),
      interior: interiorArray,
      entry: [...entry].sort((a, b) => a - b),
      street: entrance.street,
      posts,
      baseTop,
      storeys,
      roofY: 0.5 + storeys * ROAD_STOREY_PITCH,
      core,
      anchors,
    };
  }
  return null;
}

const prepared = new WeakMap<
  RoadBuildingPlan,
  { body: Set<number>; interior: Set<number>; entry: Set<number>; posts: Set<number> }
>();
export function roadBuildingAir(
  p: RoadBuildingPlan,
  x: number,
  z: number,
): [number, number][] | undefined {
  let sets = prepared.get(p);
  if (!sets) {
    sets = {
      body: new Set(p.body),
      interior: new Set(p.interior),
      entry: new Set(p.entry),
      posts: new Set(p.posts),
    };
    prepared.set(p, sets);
  }
  const k = z * N + x;
  if (!sets.body.has(k) && !sets.entry.has(k)) return undefined;
  if (!sets.body.has(k))
    return [
      [0.5, 6.5],
      [Math.max(p.baseTop, 8), SKY_CEIL],
    ];
  if (p.core && x >= p.core.x && x < p.core.x + 6 && z >= p.core.z && z < p.core.z + 6) {
    const [u, v] = turn(x - p.core.x, z - p.core.z, (4 - p.core.rotation) % 4);
    if (u === 0 || u === 5 || v === 0 || v === 5) {
      const a: [number, number][] = [];
      if (v === 0 && (u === 1 || u === 2))
        for (let j = 0; j < p.storeys; j++) a.push([0.5 + j * 12, 6.5 + j * 12]);
      a.push([p.roofY, SKY_CEIL]);
      return a;
    }
    const i = RING.findIndex(([a, b]) => a === u && b === v);
    if (i < 0) return [[0.5, SKY_CEIL]]; // open service well
    const surfaces = [0.5];
    for (let j = 0; j < p.storeys * 2; j++) surfaces.push(0.5 + j * 6 + Math.max(0, i - 1) * 0.6);
    if (i <= 1) surfaces.push(p.roofY);
    const unique = [...new Set(surfaces)].sort((a, b) => a - b);
    return unique
      .map(
        (f, j) => [f, j + 1 < unique.length ? unique[j + 1]! - 1.5 : SKY_CEIL] as [number, number],
      )
      .filter(([f, c]) => c - f >= 1.5);
  }
  if (sets.posts.has(k)) return [[p.roofY, SKY_CEIL]];
  if (!sets.interior.has(k)) {
    const a: [number, number][] = [];
    if (sets.entry.has(k)) a.push([0.5, 6.5]);
    const outward = DIRS.filter(([dx, dz]) => !sets.body.has((z + dz) * N + x + dx));
    const along = outward[0]?.[0] !== 0 ? z : x;
    if (outward.length === 1 && (along % 5 === 2 || along % 5 === 3)) {
      for (let j = 0; j < (p.core ? p.storeys : 1); j++)
        if (j > 0 || !sets.entry.has(k)) a.push([2 + j * 12, 6.5 + j * 12]);
    }
    a.push([p.roofY, SKY_CEIL]);
    return a;
  }
  const floors = p.core ? Array.from({ length: p.storeys }, (_, j) => 0.5 + j * 12) : [0.5];
  floors.push(p.roofY);
  return floors.map(
    (f, j) => [f, j + 1 < floors.length ? floors[j + 1]! - 1.5 : SKY_CEIL] as [number, number],
  );
}

/** Compile only the requested output bounds; plans themselves are complete
 * and window-independent. Existing streets are never written. */
export function applyRoadBuildings(
  columns: ColumnSpan[][],
  floorHeights: number[][],
  pillarGround: boolean[][],
  plans: readonly RoadBuildingPlan[],
  width: number,
  absTx0: number,
  absTz0: number,
  bounds: { x0: number; z0: number; x1: number; z1: number },
): boolean[][] {
  const mask = Array.from({ length: width }, () => Array(width).fill(false) as boolean[]);
  for (const p of plans)
    for (const k of new Set([...p.body, ...p.entry])) {
      const lx = k % N,
        lz = Math.floor(k / N),
        x = p.tx0 + lx - absTx0,
        z = p.tz0 + lz - absTz0;
      if (x < bounds.x0 || z < bounds.z0 || x >= bounds.x1 || z >= bounds.z1) continue;
      const air = roadBuildingAir(p, lx, lz)!;
      columns[z * width + x] = air.map(([floor, ceil]) => ({
        floor,
        ceil,
        owner: floor === 0.5 ? 0 : -1,
        ceilOwner: -1,
      }));
      if (air.some(([f]) => f === 0.5)) {
        floorHeights[z]![x] = 0.5;
        pillarGround[z]![x] = true;
      }
      mask[z]![x] = true;
    }
  return mask;
}
