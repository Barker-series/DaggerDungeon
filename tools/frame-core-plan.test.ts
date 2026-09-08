import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createFramePlan,
  createFrameSpec,
  frameBuildingAir,
} from '../src/game/dungeon/frame-building';
import { FRAME_CORE } from '../src/game/dungeon/frame-core-plan';

// Captured from unmodified 72e0b45 frame-building.ts before the kit migration.
// Hash every tile (including exterior), both roof policies, and the FULL spec,
// preserving array order and IEEE float serialization. Not a shared-path oracle.
const fixture = new URL('./fixtures/frame-core-baseline.json', import.meta.url);
const actual: Record<string, string> = {};
for (const [height, depth] of [
  [0, 0],
  [37, 10],
  [144, 81],
]) {
  for (let rotation = 0; rotation < 4; rotation++) {
    for (const industrial of [false, true])
      for (const services of [false, true]) {
        const plan = createFramePlan(height!, depth!, rotation, industrial, services);
        const key = [height, depth, rotation, industrial, services].join('/');
        const hash = createHash('sha256');
        hash.update(JSON.stringify(createFrameSpec(plan, -3, 7)));
        for (const closed of [false, true])
          for (let wz = 0; wz < 56; wz++)
            for (let wx = 0; wx < 56; wx++) {
              let x = wx,
                z = wz;
              for (let i = 0; i < ((4 - rotation) & 3); i++) [x, z] = [55 - z, x];
              hash.update(JSON.stringify(frameBuildingAir(plan, x, z, closed)));
            }
        actual[key] = hash.digest('hex');
      }
  }
}
assert.deepEqual(actual, JSON.parse(readFileSync(fixture, 'utf8')));
console.log(
  `${Object.keys(actual).length} full-frame baseline fingerprints match (both roofs, all 56x56 tiles, full ordered specs)`,
);

// Direct recipe contract, independent of the full-frame digest.
const entry = FRAME_CORE.storey.sockets.entry!;
const door = FRAME_CORE.storey.sockets.door!;
assert.deepEqual([entry.x, entry.z, entry.y, entry.role], [22, 18, 0, 'entry']);
assert.deepEqual([door.x, door.z, door.y, door.role], [24, 18, 0, 'door']);
for (const base of [-80.5, 0.5, 18.5, 144.5]) {
  for (let z = 18; z <= 29; z++)
    for (let x = 18; x <= 23; x++) {
      const out: [number, number][] = [];
      FRAME_CORE.storey.appendSolids(x, z, base, out);
      const y =
        z <= 19
          ? base
          : z >= 28
            ? base + 4.2
            : x <= 19
              ? base + Math.min(7, z - 19) * 0.6
              : x >= 22
                ? base + 4.2 + (28 - z) * 0.6
                : undefined;
      assert.deepEqual(out, y === undefined ? [] : [[y - 1.5, y]]);
    }
  const out: [number, number][] = [];
  FRAME_CORE.wall.appendSolids(door.x, door.z, base, out);
  assert.deepEqual(out, [[base + 6, base + 9]]);
  const landing: [number, number][] = [];
  FRAME_CORE.arrival.appendSolids(entry.x, entry.z, base, landing);
  assert.deepEqual(landing, [[base - 1.5, base]]);
  const well: [number, number][] = [];
  FRAME_CORE.arrival.appendSolids(21, 24, base, well);
  assert.deepEqual(well, [], 'arrival must not close the well');
}
console.log('frame-core-plan: flights, entry, doorway and open arrival well pass');
