import assert from 'node:assert/strict';
import { CHUNK_BY_ID } from '../src/game/dungeon/pillar-chunks';
import { pillarAirSpans } from '../src/game/dungeon/pillar-geometry';
import { roomSocketsForChunks } from '../src/game/dungeon/pillar-rooms';
import type { PillarSpec, PlacedChunk } from '../src/game/dungeon/pillar-layer';

const def = CHUNK_BY_ID.get('service-gallery');
assert.ok(def, 'the room library must contain the service gallery');
const rotate = (x: number, z: number, k: number): [number, number] => {
  if (k & 4) x = 55 - x;
  for (let i = 0; i < (k & 3); i++) [x, z] = [55 - z, x];
  return [x, z];
};
let cases = 0;
for (const base of [6, -24])
  for (let k = 0; k < 8; k++) {
    const chunks: PlacedChunk[] = [
      {
        def: CHUNK_BY_ID.get('plain')!,
        baseY: base - 8,
        rotation: (k & 4) | ((k + (k & 4 ? 1 : 3)) & 3),
      },
      { def, baseY: base, rotation: k },
      {
        def: CHUNK_BY_ID.get('crown')!,
        baseY: base + 12,
        rotation: (k & 4) | ((k + (k & 4 ? 3 : 1)) & 3),
      },
    ];
    const spec: PillarSpec = {
      cx: 0,
      cz: 0,
      acx: -2,
      acz: 3,
      elevator: false,
      chunks,
      sockets: [],
      roomSockets: roomSocketsForChunks(chunks),
      baseDepth: base - 8,
      totalHeight: base + 16,
    };
    const air = pillarAirSpans(
      spec,
      () => 0,
      () => 3,
    );
    const spans = (x: number, z: number) => air.get(rotate(x, z, k).join(',')) ?? [];
    const has = (x: number, z: number, floor: number, ceil: number) =>
      spans(x, z).some(
        (s) => Math.abs(s.floor - base - floor) < 0.01 && s.ceil >= base + ceil - 0.01,
      );
    assert.ok(has(19, 19, 0.5, 3.5), 'low service entrance must be open');
    assert.ok(
      spans(19, 19).some((s) => Math.abs(s.ceil - base - 3.5) < 0.01),
      'entrance stays low',
    );
    assert.ok(has(22, 22, 0.5, 3.5), 'dogleg must continue around the front machine bay');
    assert.ok(!has(24, 19, 0.5, 3.5), 'entry must not degenerate into another straight hall');
    assert.ok(has(22, 28, 0.5, 11), 'dogleg must open into the taller service chamber');
    assert.ok(
      !spans(25, 26).some((s) => s.floor < base + 7.9 && s.ceil > base + 0.6),
      'first machine bay is real solid volume',
    );
    assert.ok(
      has(35, 28, 0.5, 7.5) && has(35, 28, 9, 11),
      'overhead trunk must be real solid with air beneath and above',
    );
    assert.ok(
      has(40, 30, 0.5, 11),
      'external service ledge must remain open through roofline culling',
    );
    assert.ok(
      has(38, 25, 0.5, 4.5) && has(38, 34, 0.5, 4.5),
      'both ledge doors must connect through the facade',
    );
    const entry = spec.roomSockets.find((s) => s.role === 'entry');
    assert.ok(
      entry && spec.roomSockets.length >= 7,
      'publish the approach, machine bays, both doors and outer ledge',
    );
    const todo: [number, number, number][] = [[entry.lx, entry.lz, entry.y]];
    const seen = new Set<string>();
    while (todo.length) {
      const [x, z, y] = todo.pop()!;
      const key = `${x},${z},${y.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = (air.get(`${x},${z}`) ?? []).find((s) => Math.abs(s.floor - y) < 0.01);
      if (!current) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        for (const next of air.get(`${x + dx},${z + dz}`) ?? []) {
          if (
            Math.abs(next.floor - y) <= 0.65 + 1e-6 &&
            Math.min(current.ceil, next.ceil) - Math.max(y, next.floor) >= 1.8
          ) {
            todo.push([x + dx, z + dz, next.floor]);
          }
        }
      }
    }
    for (const s of spec.roomSockets)
      assert.ok(
        seen.has(`${s.lx},${s.lz},${s.y.toFixed(3)}`),
        `unreachable service socket ${JSON.stringify(s)}`,
      );
    const end = rotate(41, 16, k);
    assert.ok(
      seen.has(`${end[0]},${end[1]},${(base + 12).toFixed(3)}`),
      'the exterior ascent must remain intact',
    );
    cases++;
  }
const { assemblePillar } = await import('../src/game/dungeon/pillar-layer');
const { regionAtCell } = await import('../src/game/dungeon/region-layer');
let transitional = 0;
for (let z = -8; z <= 8; z++)
  for (let x = -8; x <= 8; x++) {
    const region = regionAtCell(100001, x * 4 + 2, z * 4 + 2);
    if (region === 'machine' || region === 'city') continue;
    const p = assemblePillar(100001, x, z);
    if (p && !p.elevator && p.chunks.some((c) => c.def.id === 'service-gallery')) transitional++;
  }
assert.ok(
  transitional > 0,
  'service galleries must also occur outside the enclosed city/machine palette',
);
console.log(
  `service galleries: ${cases} above/below-grade rotated/mirrored route and geometry cases passed`,
);
