import assert from 'node:assert/strict';
import {
  bridgeTiles,
  carveStructures,
  GAP_TILES,
  CLEARANCE,
  type BridgeSpec,
} from '../src/game/dungeon/pillar-bridges';
import type { ColumnSpan } from '../src/game/types';
import { assemblePillar } from '../src/game/dungeon/pillar-layer';
import { planOwnedBridges } from '../src/game/dungeon/pillar-bridges';
import { regionAtCell } from '../src/game/dungeon/region-layer';

const W = 112;
const fresh = (floor = 0): ColumnSpan[][] =>
  Array.from({ length: W * W }, () => [{ floor, ceil: 100, owner: 0, ceilOwner: -1 }]);
const hasSolid = (spans: ColumnSpan[], lo: number, hi: number): boolean =>
  !spans.some((s) => s.floor < hi - 0.01 && s.ceil > lo + 0.01);
let cases = 0;
for (const housing of ['gatehouse', 'service'] as const) {
  for (const dir of ['east', 'south'] as const) {
    for (const dy of [0, 10, -10]) {
      const br: BridgeSpec & { housing: typeof housing } = {
        cx: 0,
        cz: 0,
        acx: -3,
        acz: -5,
        dir,
        yA: 25,
        yB: 25 + dy,
        pipe: false,
        housing,
      };
      const columns = fresh();
      const input = JSON.stringify(br);
      carveStructures(columns, W, [], [], [br]);
      assert.equal(JSON.stringify(br), input, 'carving must not mutate the pair plan');
      const at = (i: number, cross = 28): ColumnSpan[] => {
        const along = 42 + i;
        return columns[dir === 'east' ? cross * W + along : along * W + cross]!;
      };
      const height = (i: number): number => br.yA + (dy * (i + 0.5)) / GAP_TILES;
      const start = at(3).find((s) => Math.abs(s.floor - height(3)) < 0.01)!;
      assert.ok(
        start && Math.abs(start.ceil - height(3) - CLEARANCE) < 0.01,
        'sheltered approach must have a real roof at walk clearance',
      );
      const middle = at(15).find((s) => Math.abs(s.floor - height(15)) < 0.01)!;
      assert.equal(middle?.ceil, 100, 'the middle crossing must remain exposed');
      assert.ok(
        hasSolid(at(3, 26), height(3), height(3) + CLEARANCE),
        'housing must have an actual side wall',
      );
      assert.ok(
        hasSolid(at(3, 30), height(3), height(3) + CLEARANCE),
        'both side walls must enclose the approach',
      );
      if (housing === 'service') {
        assert.ok(
          at(6, 26).some((s) => s.floor <= height(6) + 1.01 && s.ceil >= height(6) + 2.99),
          'service approach must have real side openings, not painted windows',
        );
      }
      // Existing bridgeTiles remains the three-wide walking contract (renderer
      // chamfers and world verification also consume it in groups of three).
      assert.equal(bridgeTiles(br).length, GAP_TILES * 3);
      let previous: ColumnSpan | undefined;
      for (let i = 0; i < GAP_TILES; i++) {
        for (const cross of [27, 28, 29]) {
          const walk = at(i, cross).find((s) => Math.abs(s.floor - height(i)) < 0.01);
          assert.ok(
            walk && walk.ceil - walk.floor >= 2.6,
            'housing cannot narrow or block the existing deck',
          );
          if (cross === 28 && previous) {
            assert.ok(
              Math.abs(walk.floor - previous.floor) <= 0.65,
              'all deck steps stay walkable',
            );
            assert.ok(
              Math.min(walk.ceil, previous.ceil) - Math.max(walk.floor, previous.floor) >= 1.8,
              'adjacent roofed treads must share player clearance',
            );
          }
          if (cross === 28) previous = walk;
        }
      }
      for (const cross of [26, 30]) {
        assert.ok(
          at(3, cross).some((s) => s.floor === 0 && s.ceil >= 1.8),
          'new walls must preserve travel underneath',
        );
      }
      // Translation of window-local coordinates cannot alter structure output.
      const shifted = fresh();
      carveStructures(shifted, W, [], [], [{ ...br, cx: -2, cz: -3 }], 112, 168);
      assert.deepEqual(shifted, columns, 'negative window frames must emit identical columns');
      // Cropped generation must equal the same portion of a larger request.
      const smallW = 28;
      const cropX = dir === 'east' ? 40 : 24;
      const cropZ = dir === 'east' ? 24 : 40;
      const small = Array.from({ length: smallW * smallW }, () => [
        { floor: 0, ceil: 100, owner: 0, ceilOwner: -1 },
      ]);
      carveStructures(small, smallW, [], [], [br], -cropX, -cropZ);
      for (let z = 0; z < smallW; z++)
        for (let x = 0; x < smallW; x++) {
          assert.deepEqual(
            small[z * smallW + x],
            columns[(z + cropZ) * W + x + cropX],
            'cropped housing seam mismatch',
          );
        }
      cases++;
    }
  }
}

// A bridge crossing a hillside must not grow a housing wall across the
// pre-existing walking surface. Keep the ordinary bridge result in that case.
const nearTerrain: BridgeSpec & { housing: 'gatehouse' } = {
  cx: 0,
  cz: 0,
  acx: 0,
  acz: 0,
  dir: 'east',
  yA: 10,
  yB: 10,
  pipe: false,
  housing: 'gatehouse',
};
const housed = fresh(9.7);
const plain = fresh(9.7);
carveStructures(housed, W, [], [], [nearTerrain]);
carveStructures(plain, W, [], [], [{ ...nearTerrain, housing: undefined }]);
assert.deepEqual(housed, plain, 'housing must yield to a terrain-height crossing');
// Region identity weights the vocabulary, rather than hiding all service
// housings in city/machine terrain where a bridge is often already a tunnel.
let exposedService = false;
const cache = new Map<string, ReturnType<typeof assemblePillar>>();
const at = (x: number, z: number): ReturnType<typeof assemblePillar> => {
  const key = `${x},${z}`;
  if (!cache.has(key)) cache.set(key, assemblePillar(100001, x, z));
  return cache.get(key)!;
};
for (let z = -8; z <= 8; z++)
  for (let x = -8; x <= 8; x++) {
    const region = regionAtCell(100001, x * 4 + 2, z * 4 + 2);
    if (region === 'machine' || region === 'city') continue;
    if (planOwnedBridges(100001, x, z, at).some((b) => b.housing === 'service'))
      exposedService = true;
  }
assert.ok(exposedService, 'service housings must also occur in exposed-region vocabulary');
console.log(
  `bridge housings: ${cases} style/direction/slope cases, frame/crop identity, terrain protection, and regional variety passed`,
);
