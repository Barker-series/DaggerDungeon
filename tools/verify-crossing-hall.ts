import assert from 'node:assert/strict';
import { CHUNK_BY_ID } from '../src/game/dungeon/pillar-chunks';
import { pillarAirSpans } from '../src/game/dungeon/pillar-geometry';
import { roomSocketsForChunks } from '../src/game/dungeon/pillar-rooms';
import type { PillarSpec, PlacedChunk } from '../src/game/dungeon/pillar-layer';

const def = CHUNK_BY_ID.get('crossing-hall');
assert.ok(def, 'the shipping library must include the crossing hall');

function rotate(x: number, z: number, rotation: number): [number, number] {
  if (rotation & 4) x = 55 - x;
  for (let k = 0; k < (rotation & 3); k++) [x, z] = [55 - z, x];
  return [x, z];
}

let cases = 0;
for (const base of [6, -24]) {
  for (let rotation = 0; rotation < 8; rotation++) {
    const chunks: PlacedChunk[] = [
      {
        def: CHUNK_BY_ID.get('plain')!,
        baseY: base - 8,
        rotation: (rotation & 4) | ((rotation + (rotation & 4 ? 1 : 3)) & 3),
      },
      { def, baseY: base, rotation },
      {
        def: CHUNK_BY_ID.get('crown')!,
        baseY: base + def.height,
        rotation: (rotation & 4) | ((rotation + (rotation & 4 ? 3 : 1)) & 3),
      },
    ];
    const spec: PillarSpec = {
      cx: 0,
      cz: 0,
      acx: -3,
      acz: -2,
      elevator: false,
      baseDepth: base - 8,
      totalHeight: base + def.height + 4,
      chunks,
      sockets: [],
      roomSockets: roomSocketsForChunks(chunks),
    };
    // A low terrain roof must not cull authored rooms higher up the building.
    const air = pillarAirSpans(
      spec,
      () => 0,
      () => 3,
    );
    const spansAt = (x: number, z: number) => air.get(rotate(x, z, rotation).join(',')) ?? [];
    const has = (x: number, z: number, floor: number, ceil: number) =>
      spansAt(x, z).some(
        (s) => Math.abs(s.floor - base - floor) < 0.01 && s.ceil >= base + ceil - 0.01,
      );
    assert.ok(has(25, 20, 4.8, 7.8), 'low entry passage must survive the roofline/foundation');
    assert.ok(
      spansAt(25, 20).some((s) => Math.abs(s.ceil - base - 7.8) < 0.01),
      'entry must remain compressed',
    );
    assert.ok(has(28, 28, 0.5, 11), 'chamber must open to full height with a lower floor');
    assert.ok(has(31, 28, 0.5, 4.3), 'catwalk must have explorable space underneath');
    assert.ok(has(31, 28, 4.8, 11), 'catwalk must be a real raised walking surface');
    assert.ok(has(30, 38, 4.8, 11), 'far facade must open onto the observation edge');
    assert.ok(has(25, 16, 4.8, 8.3), 'entrance must meet a flat exterior stair landing');

    const entry = spec.roomSockets.find((s) => s.role === 'entry');
    const targets = spec.roomSockets.filter((s) => s.role === 'room');
    assert.ok(
      entry && targets.length >= 4,
      'hall must publish entry, crossing, balcony, and lower-floor targets',
    );
    const queue: [number, number, number][] = [[entry.lx, entry.lz, entry.y]];
    const visited = new Set<string>();
    while (queue.length) {
      const [x, z, y] = queue.pop()!;
      const key = `${x},${z},${y.toFixed(3)}`;
      if (visited.has(key)) continue;
      visited.add(key);
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
            queue.push([x + dx, z + dz, next.floor]);
          }
        }
      }
    }
    for (const target of targets) {
      assert.ok(
        visited.has(`${target.lx},${target.lz},${target.y.toFixed(3)}`),
        `unreachable ${target.group} target at ${target.lx},${target.lz},${target.y}`,
      );
    }
    // The authored mid-flight landing must not break the exterior ascent.
    const end = rotate(41, 16, rotation);
    assert.ok(
      visited.has(`${end[0]},${end[1]},${(base + def.height).toFixed(3)}`),
      'exterior stair must still reach the next chunk',
    );
    cases++;
  }
}
console.log(`crossing hall: ${cases} above/below-grade, rotated/mirrored circulation cases passed`);
