import type { WorldData } from '../src/game/types';
import { TileType } from '../src/game/types';
import { ROAD_PARCEL_TILES as N, roadBuildingAir } from '../src/game/dungeon/road-buildings';

/** Audit complete parcel interiors in a window. Partial parcels are checked
 * when their complete owning bounds are present, not falsely rejected at a
 * temporary window boundary. Low under-stair pockets are not standing targets. */
export function auditRoadBuildings(world: WorldData): {
  buildings: number;
  targets: number;
  errors: string[];
} {
  const L = world.levels[0]!,
    w = L.width;
  const errors: string[] = [];
  let buildings = 0,
    targets = 0;
  for (const lot of world.roadBuildings ?? []) {
    const ox = lot.tx0 - world.originPcx * 56,
      oz = lot.tz0 - world.originPcz * 56;
    if (ox < 0 || oz < 0 || ox + N > w || oz + N > L.height) continue;
    buildings++;
    const sx = ox + (lot.street % N),
      sz = oz + Math.floor(lot.street / N);
    if (L.tiles[sz]![sx] !== TileType.Floor) errors.push(`${lot.id}: entry street overwritten`);
    const queue: [number, number, number][] = [[sx, sz, 0.5]];
    const seen = new Set<string>();
    while (queue.length) {
      const [x, z, y] = queue.pop()!;
      const key = `${x},${z},${y.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = world.columns[z * w + x]?.find((s) => Math.abs(s.floor - y) < 0.01);
      if (!current) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx!,
          nz = z + dz!;
        if (nx < ox || nz < oz || nx >= ox + N || nz >= oz + N) continue;
        for (const s of world.columns[nz * w + nx] ?? []) {
          if (
            Math.abs(s.floor - y) <= 0.65 + 1e-6 &&
            Math.min(s.ceil, current.ceil) - Math.max(s.floor, y) >= 1.8
          )
            queue.push([nx, nz, s.floor]);
        }
      }
    }
    for (const k of lot.interior) {
      if (lot.posts.includes(k)) continue;
      const x = k % N,
        z = Math.floor(k / N);
      for (const [floor, ceil] of roadBuildingAir(lot, x, z) ?? []) {
        if (ceil - floor < 1.8 || floor > lot.roofY || (!lot.core && floor !== 0.5)) continue;
        targets++;
        if (!seen.has(`${ox + x},${oz + z},${floor.toFixed(3)}`))
          errors.push(`${lot.id}: unreachable interior (${x},${z},${floor})`);
      }
    }
    if (lot.core && ![...seen].some((k) => Math.abs(Number(k.split(',')[2]) - lot.roofY) < 0.01))
      errors.push(`${lot.id}: service stair does not reach roof`);
  }
  return { buildings, targets, errors };
}
