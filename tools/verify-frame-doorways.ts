import assert from 'node:assert/strict';
import { createFramePlan, createFrameSpec, frameFloorY } from '../src/game/dungeon/frame-building';
import { pillarAirSpans } from '../src/game/dungeon/pillar-geometry';
import { generateWorldChunked } from '../src/game/gen/assemble';

// Exact marked stair-core lintel from the user's DDSNAP.
const world = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: -1 });
const marked = world.columns[93 * world.levels[0]!.width + 87]!;
const opening = marked.find((s) => Math.abs(s.floor - 27.5) < 0.01);
assert.ok(
  opening && Math.abs(opening.ceil - opening.floor - 6) < 0.01,
  'the marked doorway must open six units above its unchanged floor',
);

const rotate = (x: number, z: number, k: number): [number, number] => {
  for (let i = 0; i < k; i++) [x, z] = [55 - z, x];
  return [x, z];
};
let cases = 0;
for (const industrial of [false, true])
  for (const roofClosed of [false, true])
    for (let rotation = 0; rotation < 4; rotation++) {
      const plan = createFramePlan(72, 18, rotation, industrial);
      const spec = createFrameSpec(plan, 0, 0);
      const columns = pillarAirSpans(
        spec,
        () => 0,
        () => 3,
        roofClosed,
      );
      const spans = (x: number, z: number) => columns.get(rotate(x, z, rotation).join(',')) ?? [];
      const door = (x: number, z: number, y: number) =>
        spans(x, z).find((s) => Math.abs(s.floor - y) < 0.01);
      for (const level of [-1, 2]) {
        const y = frameFloorY(level);
        for (const [x, z] of [
          [24, 18],
          [24, 19],
          [27, 18],
          [28, 18],
          [32, 37],
          [33, 37],
        ]) {
          const s = door(x!, z!, y);
          assert.ok(
            s && Math.abs(s.ceil - y - 6) < 0.01,
            `door ${x},${z} must be taller above and below grade`,
          );
        }
        for (const [x, z] of [
          [24, 17],
          [24, 20],
          [29, 18],
          [30, 18],
          [34, 37],
        ]) {
          assert.ok(
            !spans(x!, z!).some((s) => s.floor < y + 1 && s.ceil > y + 5.9),
            'adjacent jamb/crosswall must remain solid',
          );
        }
        const s = door(24, 18, y)!;
        assert.ok(
          frameFloorY(level + 1) - s.ceil >= 3 - 1e-6,
          'keep a substantial lintel/floor band above the core doorway',
        );
      }
      cases++;
    }
console.log(
  `frame doorways: exact marked opening and ${cases} style/roof/rotation cases passed; widths, floors and lintels preserved`,
);
