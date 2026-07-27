/**
 * Layer 4 — Permanent pillar-cell transit
 *
 * The old implementation connected islands by flood-filling the complete
 * temporary window. Those corridors changed when the window moved. This layer
 * instead gives every absolute pillar cell a stable hub and four stable shared
 * sockets. Each cell routes and publishes only inside its own 56×56-tile
 * bounds, then attaches every local floor component to that permanent network.
 */

import { Path } from 'rot-js';
import { RoomType, TileType, type GridPos, type RoomData } from '../types';
import { cellSeed, mulberry32 } from './rng';
import { PILLAR_CELL_TILES } from './pillar-layer';

const TRANSIT_SALT = 0x4d335431;
const HALLWAY_HALF_WIDTH = 1;
const SOCKET_MARGIN = 6;

/** Dungeon-cell keys touched by transit, consumed by the debug map. */
export const hallwayCells = new Set<string>();
/** Tile keys owned by the permanent network; later layers must preserve them. */
export const permanentTransitTiles = new Set<string>();

type Axis = 'east' | 'south';

/** Stable offset for a pair owned by its west/north absolute pillar cell. */
export function transitSocketOffset(
  worldSeed: number,
  ownerPcx: number,
  ownerPcz: number,
  axis: Axis,
): number {
  const salt = TRANSIT_SALT + (axis === 'east' ? 0 : 1);
  const rng = mulberry32(cellSeed(ownerPcx, ownerPcz, worldSeed, salt));
  const span = PILLAR_CELL_TILES - SOCKET_MARGIN * 2;
  return SOCKET_MARGIN + Math.floor(rng() * span);
}

function nearestUnlocked(
  targetX: number,
  targetZ: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  locked?: boolean[][],
): GridPos | null {
  for (let radius = 0; radius < PILLAR_CELL_TILES; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = targetX + dx;
        const z = targetZ + dz;
        if (x < x0 || z < z0 || x >= x1 || z >= z1 || locked?.[z]?.[x]) continue;
        return { x, y: z };
      }
    }
  }
  return null;
}

function carveSpot(
  tiles: TileType[][],
  cx: number,
  cz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cellTileSize: number,
  locked?: boolean[][],
): void {
  for (let dz = -HALLWAY_HALF_WIDTH; dz <= HALLWAY_HALF_WIDTH; dz++) {
    for (let dx = -HALLWAY_HALF_WIDTH; dx <= HALLWAY_HALF_WIDTH; dx++) {
      if (dx * dx + dz * dz > HALLWAY_HALF_WIDTH * HALLWAY_HALF_WIDTH) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (x < x0 || z < z0 || x >= x1 || z >= z1 || locked?.[z]?.[x]) continue;
      tiles[z]![x] = TileType.Floor;
      permanentTransitTiles.add(`${x},${z}`);
      hallwayCells.add(`${Math.floor(x / cellTileSize)},${Math.floor(z / cellTileSize)}`);
    }
  }
}

function carveOwnedRoute(
  tiles: TileType[][],
  rooms: RoomData[],
  from: GridPos,
  to: GridPos,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  cellTileSize: number,
  locked?: boolean[][],
): boolean {
  const passable = (x: number, z: number): boolean =>
    x >= x0 && z >= z0 && x < x1 && z < z1 && !locked?.[z]?.[x];
  const astar = new Path.AStar(to.x, to.y, passable, { topology: 4 });
  const route: GridPos[] = [];
  astar.compute(from.x, from.y, (x, z) => route.push({ x, y: z }));
  if (route.length === 0) return false;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of route) {
    carveSpot(tiles, p.x, p.y, x0, z0, x1, z1, cellTileSize, locked);
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.y);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.y);
  }
  rooms.push({
    center: { x: Math.floor((minX + maxX) / 2), y: Math.floor((minZ + maxZ) / 2) },
    left: Math.max(x0, minX - HALLWAY_HALF_WIDTH),
    top: Math.max(z0, minZ - HALLWAY_HALF_WIDTH),
    width: Math.min(x1 - 1, maxX + HALLWAY_HALF_WIDTH) - Math.max(x0, minX - HALLWAY_HALF_WIDTH) + 1,
    height: Math.min(z1 - 1, maxZ + HALLWAY_HALF_WIDTH) - Math.max(z0, minZ - HALLWAY_HALF_WIDTH) + 1,
    ceilingHeight: 3,
    type: RoomType.Combat,
    doors: [],
  });
  return true;
}

function localComponents(
  tiles: TileType[][],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): GridPos[][] {
  const seen = new Set<number>();
  const components: GridPos[][] = [];
  const width = x1 - x0;
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const startKey = (z - z0) * width + x - x0;
      if (seen.has(startKey) || tiles[z]![x] === TileType.Wall) continue;
      const component: GridPos[] = [];
      const queue: GridPos[] = [{ x, y: z }];
      seen.add(startKey);
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head]!;
        component.push(p);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = p.x + dx;
          const nz = p.y + dz;
          if (nx < x0 || nz < z0 || nx >= x1 || nz >= z1 || tiles[nz]![nx] === TileType.Wall) continue;
          const key = (nz - z0) * width + nx - x0;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ x: nx, y: nz });
        }
      }
      components.push(component);
    }
  }
  return components;
}

/**
 * Materialize the permanent coarse graph for the current window. Every route
 * is owned and clipped by one pillar cell, so shifted windows regenerate the
 * same transit tiles for every overlapping absolute cell.
 */
export function connectPermanentTransit(
  tiles: TileType[][],
  rooms: RoomData[],
  worldSeed: number,
  originPcx: number,
  originPcz: number,
  gridTiles: number,
  cellTileSize: number,
  locked?: boolean[][],
): void {
  hallwayCells.clear();
  permanentTransitTiles.clear();
  const pillarGrid = Math.ceil(gridTiles / PILLAR_CELL_TILES);

  for (let pcz = 0; pcz < pillarGrid; pcz++) {
    for (let pcx = 0; pcx < pillarGrid; pcx++) {
      const x0 = pcx * PILLAR_CELL_TILES;
      const z0 = pcz * PILLAR_CELL_TILES;
      const x1 = Math.min(gridTiles, x0 + PILLAR_CELL_TILES);
      const z1 = Math.min(gridTiles, z0 + PILLAR_CELL_TILES);
      const apx = originPcx + pcx;
      const apz = originPcz + pcz;

      // The corner choice is cell-local and permanent; keeping the hub away
      // from the central kebab leaves four broad routing channels.
      const hubRng = mulberry32(cellSeed(apx, apz, worldSeed, TRANSIT_SALT + 9));
      const corner = Math.floor(hubRng() * 4);
      const inset = 8;
      const hubTargetX = corner === 0 || corner === 3 ? x0 + inset : x1 - 1 - inset;
      const hubTargetZ = corner < 2 ? z0 + inset : z1 - 1 - inset;
      const hub = nearestUnlocked(hubTargetX, hubTargetZ, x0, z0, x1, z1, locked);
      if (!hub) continue;

      const westOffset = transitSocketOffset(worldSeed, apx - 1, apz, 'east');
      const eastOffset = transitSocketOffset(worldSeed, apx, apz, 'east');
      const northOffset = transitSocketOffset(worldSeed, apx, apz - 1, 'south');
      const southOffset = transitSocketOffset(worldSeed, apx, apz, 'south');
      const socketTargets: GridPos[] = [
        { x: x0, y: z0 + westOffset },
        { x: x1 - 1, y: z0 + eastOffset },
        { x: x0 + northOffset, y: z0 },
        { x: x0 + southOffset, y: z1 - 1 },
      ];
      for (const target of socketTargets) {
        const socket = nearestUnlocked(target.x, target.y, x0, z0, x1, z1, locked);
        if (socket) carveOwnedRoute(tiles, rooms, hub, socket, x0, z0, x1, z1, cellTileSize, locked);
      }

      // Attach each remaining local component. Re-evaluate after the backbone
      // carve; one representative per component is sufficient because all
      // routes terminate on the hub component.
      const components = localComponents(tiles, x0, z0, x1, z1);
      for (const component of components) {
        if (component.some((p) => p.x === hub.x && p.y === hub.y)) continue;
        let nearest = component[0]!;
        let nearestDistance = Infinity;
        for (const p of component) {
          const distance = Math.abs(p.x - hub.x) + Math.abs(p.y - hub.y);
          if (distance < nearestDistance) {
            nearest = p;
            nearestDistance = distance;
          }
        }
        carveOwnedRoute(tiles, rooms, hub, nearest, x0, z0, x1, z1, cellTileSize, locked);
      }
    }
  }
}
