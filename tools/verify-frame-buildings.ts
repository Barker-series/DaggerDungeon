import assert from 'node:assert/strict';
import { assemblePillar } from '../src/game/dungeon/pillar-layer';
import { pillarAirSpans, pillarFootprint } from '../src/game/dungeon/pillar-geometry';

const city = assemblePillar(100001, -3, -1);
assert.ok(
  city && 'frame' in city,
  'city buildings must no longer default to the exterior-spiral kebab',
);
const { createFramePlan, createFrameSpec, frameFloorY, framePlatformAt } =
  await import('../src/game/dungeon/frame-building');

const rotate = (x: number, z: number, k: number): [number, number] => {
  for (let i = 0; i < k; i++) [x, z] = [55 - z, x];
  return [x, z];
};
let cases = 0;
for (const height of [24, 60, 90])
  for (const roofClosed of [false, true])
    for (const industrial of [false, true])
      for (const depth of [0, 18])
        for (let rotation = 0; rotation < 4; rotation++) {
          const plan = createFramePlan(height, depth, rotation, industrial);
          const spec = createFrameSpec(plan, -3, 2);
          const air = pillarAirSpans(
            spec,
            () => 0,
            () => 3,
            roofClosed,
          );
          assert.ok(
            spec.chunks.every((c) => c.def.id.startsWith('frame-')),
            'frame buildings cannot secretly use spiral chunks',
          );
          assert.ok(
            pillarFootprint(spec).every(([x, z]) => x >= 14 && x <= 41 && z >= 14 && z <= 41),
            'owned geometry must stay inside its pillar cell',
          );
          const at = (x: number, z: number) => air.get(rotate(x, z, rotation).join(',')) ?? [];
          const floor = (x: number, z: number, y: number) =>
            at(x, z).find((s) => Math.abs(s.floor - y) < 0.01);
          const first = frameFloorY(-plan.belowLevels);
          assert.ok(floor(22, 18, first), 'bottom internal landing exists');
          // A double-height ground lobby and a genuinely tall void, not stacked
          // small boxes hidden behind an exterior flight.
          assert.ok(floor(30, 19, 0.5)!.ceil >= 11, 'wing lobby must have double-height headroom');
          assert.ok(
            floor(29, 28, 0.5)!.ceil >= Math.min(30, spec.totalHeight),
            'atrium remains a tall continuous void',
          );
          // The new floor mass is three times the old half-unit plate, and its
          // supporting pier must connect uninterrupted to the foundation.
          const level2 = frameFloorY(2);
          const belowPlate = at(30, 19).find((s) => s.floor < level2 && s.ceil <= level2)!;
          assert.ok(
            level2 - belowPlate.ceil >= 1.5 - 1e-6,
            'occupied floors require substantial structural thickness',
          );
          assert.ok(
            !at(15, 15).some((s) => s.floor < level2 && s.ceil > 1),
            'corner buttress must support the floors from grade',
          );
          assert.ok(plan.southLevels < plan.aboveLevels, 'wings must have unequal heights');
          assert.ok(
            floor(30, 37, frameFloorY(plan.southLevels)),
            'lower wing ends in a reachable roof terrace',
          );
          assert.ok(
            !at(30, 37).some((s) => s.floor > frameFloorY(plan.southLevels) + 0.01),
            'lower wing must not continue as another full-height box',
          );

          const start = rotate(22, 18, rotation);
          const todo: [number, number, number][] = [[start[0], start[1], first]];
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
            ])
              for (const next of air.get(`${x + dx},${z + dz}`) ?? []) {
                if (
                  Math.abs(next.floor - y) <= 0.65 + 1e-6 &&
                  Math.min(next.ceil, current.ceil) - Math.max(next.floor, y) >= 1.8
                ) {
                  todo.push([x + dx, z + dz, next.floor]);
                }
              }
          }
          for (const socket of spec.roomSockets) {
            assert.ok(
              seen.has(`${socket.lx},${socket.lz},${socket.y.toFixed(3)}`),
              `unreachable room/core target ${JSON.stringify(socket)}`,
            );
          }
          assert.ok(
            seen.has(
              `${start[0]},${start[1]},${frameFloorY(plan.aboveLevels - (roofClosed ? 1 : 0)).toFixed(3)}`,
            ),
            'internal stairs must reach the roof or the last occupied landing under a closed roof',
          );
          if (roofClosed)
            assert.ok(
              !seen.has(`${start[0]},${start[1]},${spec.totalHeight.toFixed(3)}`),
              'a straddler must not grow a final flight into its sealed roof',
            );
          for (const socket of spec.sockets.filter((s) => s.kind === 'bridge')) {
            const tiles =
              socket.face === 'north'
                ? [
                    [27, 14],
                    [28, 14],
                    [29, 14],
                  ]
                : socket.face === 'south'
                  ? [
                      [27, 41],
                      [28, 41],
                      [29, 41],
                    ]
                  : socket.face === 'east'
                    ? [
                        [41, 27],
                        [41, 28],
                        [41, 29],
                      ]
                    : [
                        [14, 27],
                        [14, 28],
                        [14, 29],
                      ];
            for (const [x, z] of tiles)
              assert.ok(
                seen.has(`${x},${z},${socket.yAbs.toFixed(3)}`),
                'every published bridge portal must meet real circulation',
              );
          }
          assert.ok(framePlatformAt(plan, 30, 19, 2), 'north gallery is occupied');
          cases++;
        }
const { generateWorldChunked } = await import('../src/game/gen/assemble');
const world = generateWorldChunked({ seed: 4096, stack: 1 });
const level = world.levels[0]!;
for (const p of world.pillars.values()) {
  if (!p.frame) continue;
  for (const s of p.roomSockets.filter((s) => s.y === 0.5)) {
    const x = p.cx * 56 + s.lx,
      z = p.cz * 56 + s.lz;
    assert.ok(
      world.columns[z * level.width + x]!.some(
        (a) => Math.abs(a.floor - 0.5) < 0.01 && a.ceil - a.floor >= 1.8,
      ),
      'rolling terrain must not bury an authored ground-floor room',
    );
    assert.ok(
      level.pillarGround[z]![x],
      'the podium must bank the adjacent terrain into its fixed floor',
    );
  }
}
console.log(
  `frame buildings: ${cases} height/roof/style/depth/orientation cases and integrated podium grounding passed`,
);
