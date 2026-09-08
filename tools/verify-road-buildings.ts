import assert from 'node:assert/strict';
import { generateWorldChunked } from '../src/game/gen/assemble';
import { TileType } from '../src/game/types';
import { auditRoadBuildings } from './road-building-audit';

const seed = 1788647085001;
const world = generateWorldChunked({ seed, stack: 1, originPcx: -5, originPcz: 1 });
assert.ok(
  'roadBuildings' in world && Array.isArray(world.roadBuildings) && world.roadBuildings.length > 0,
  'the reported roads district must contain buildings grown from its foundations',
);
const lots = world.roadBuildings!;
const { ROAD_PARCEL_TILES, roadBuildingAir, roadPlotSample } =
  await import('../src/game/dungeon/road-buildings');
assert.ok(
  lots.some((l) => l.tx0 === -7 * ROAD_PARCEL_TILES && l.tz0 === 7 * ROAD_PARCEL_TILES),
  'the foreground foundation in the reported view should support a road facility',
);
let checked = 0;
for (const lot of lots) {
  const ox = lot.tx0 - world.originPcx * 56,
    oz = lot.tz0 - world.originPcz * 56;
  if (ox < 0 || oz < 0 || ox + ROAD_PARCEL_TILES > 224 || oz + ROAD_PARCEL_TILES > 224) continue;
  const streetX = ox + (lot.street % ROAD_PARCEL_TILES),
    streetZ = oz + Math.floor(lot.street / ROAD_PARCEL_TILES);
  assert.equal(
    world.levels[0]!.tiles[streetZ]![streetX],
    TileType.Floor,
    'street access must remain street, not building mass',
  );
  const queue: [number, number, number][] = [[streetX, streetZ, 0.5]];
  const seen = new Set<string>();
  while (queue.length) {
    const [x, z, y] = queue.pop()!;
    const key = `${x},${z},${y.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const current = world.columns[z * 224 + x]?.find((s) => Math.abs(s.floor - y) < 0.01);
    if (!current) continue;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx!,
        nz = z + dz!;
      if (nx < ox || nz < oz || nx >= ox + ROAD_PARCEL_TILES || nz >= oz + ROAD_PARCEL_TILES)
        continue;
      for (const s of world.columns[nz * 224 + nx] ?? []) {
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
    const x = k % ROAD_PARCEL_TILES,
      z = Math.floor(k / ROAD_PARCEL_TILES);
    const local = roadBuildingAir(lot, x, z);
    // Low pockets under the first stair flight are not standing-room targets.
    if (local?.some((s) => Math.abs(s[0] - 0.5) < 0.01 && s[1] - s[0] >= 1.8))
      assert.ok(
        seen.has(`${ox + x},${oz + z},0.500`),
        `ground room ${lot.id} local ${x},${z} ${JSON.stringify(local)} core=${JSON.stringify(lot.core)} must connect to street ${lot.street}`,
      );
    if (lot.core)
      for (const [floor, ceil] of local ?? []) {
        if (ceil - floor >= 1.8 && floor <= lot.roofY)
          assert.ok(
            seen.has(`${ox + x},${oz + z},${floor.toFixed(3)}`),
            `upper room/stair ${lot.id} ${x},${z},${floor} must connect to its entry`,
          );
      }
  }
  if (lot.core) {
    assert.ok(
      [...seen].some((k) => Math.abs(Number(k.split(',')[2]) - lot.roofY) < 0.01),
      'workshop roofs must be reachable by the internal stair',
    );
  }
  for (const k of lot.body) {
    const x = ox + (k % ROAD_PARCEL_TILES),
      z = oz + Math.floor(k / ROAD_PARCEL_TILES);
    assert.ok(
      world.levels[0]!.roadBuildingTiles?.[z]?.[x],
      'built volumes must carry the structural contour mask',
    );
    const original = roadPlotSample(
      seed + 100000,
      x + world.originPcx * 56,
      z + world.originPcz * 56,
      world.levels[0]!.tiles[z]![x]!,
      world.levels[0]!.pillarWall[z]![x]!,
    );
    assert.ok(
      original.foundation && original.top === lot.baseTop,
      'building footprint must follow the original flat foundation',
    );
  }
  checked++;
}
assert.ok(checked > 0, 'verify at least one complete building in the reported window');
const audit = auditRoadBuildings(world);
assert.equal(
  audit.buildings,
  checked,
  'canonical world gate must cover the same complete facilities',
);
assert.deepEqual(audit.errors, [], 'canonical world gate must accept the valid routes');
const complete = lots.find(
  (p) =>
    p.tx0 >= world.originPcx * 56 &&
    p.tz0 >= world.originPcz * 56 &&
    p.tx0 + 24 <= (world.originPcx + 4) * 56 &&
    p.tz0 + 24 <= (world.originPcz + 4) * 56,
)!;
const sx = complete.tx0 - world.originPcx * 56 + (complete.street % 24);
const sz = complete.tz0 - world.originPcz * 56 + Math.floor(complete.street / 24);
const broken = { ...world, columns: [...world.columns] };
broken.columns[sz * 224 + sx] = [];
assert.ok(
  auditRoadBuildings(broken).errors.length > 0,
  'canonical gate must detect a broken entry',
);
let edgeChecked = 0;
for (const lot of lots) {
  const ox = lot.tx0 - world.originPcx * 56,
    oz = lot.tz0 - world.originPcz * 56;
  if (ox >= 0 && oz >= 0 && ox + 24 <= 224 && oz + 24 <= 224) continue;
  const centered = generateWorldChunked({
    seed,
    stack: 1,
    originPcx: Math.floor(lot.tx0 / 56) - 1,
    originPcz: Math.floor(lot.tz0 / 56) - 1,
  });
  assert.deepEqual(
    centered.roadBuildings?.find((p) => p.id === lot.id),
    lot,
    'edge parcel plan must survive a centered request',
  );
  assert.deepEqual(
    auditRoadBuildings(centered).errors,
    [],
    'edge facilities must have valid complete routes too',
  );
  edgeChecked++;
}
console.log(
  `road buildings: ${lots.length} planned, ${checked + edgeChecked} complete routes checked (${edgeChecked} edge parcels recentered)`,
);
