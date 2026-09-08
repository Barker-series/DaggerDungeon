import assert from 'node:assert/strict';
import { generateWorldChunked, resetGenState } from '../src/game/gen/assemble';
import { infrastructureColumnAt } from '../src/game/dungeon/infrastructure-columns';
import {
  primitiveBounds,
  type InfrastructurePrimitive,
} from '../src/game/dungeon/infrastructure-solid';
let columns = 0,
  points = 0,
  primitives = 0,
  ladders = 0;
for (const seed of [1234, 1788647085001]) {
  resetGenState();
  const a = generateWorldChunked({ seed, stack: 1, originPcx: -1, originPcz: -1 });
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    resetGenState();
    const b = generateWorldChunked({ seed, stack: 1, originPcx: -1 + dx!, originPcz: -1 + dz! });
    for (let z = dz! * 56; z < 224; z++)
      for (let x = dx! * 56; x < 224; x++) {
        assert.deepEqual(
          a.columns[z * 224 + x],
          b.columns[(z - dz! * 56) * 224 + x - dx! * 56],
          'projected network seam',
        );
        assert.deepEqual(
          a.infrastructureBaseColumns![z * 224 + x],
          b.infrastructureBaseColumns![(z - dz! * 56) * 224 + x - dx! * 56],
          'excavated base seam',
        );
        columns++;
        if (x % 11 === 0 && z % 11 === 0) {
          assert.deepEqual(
            infrastructureColumnAt(a, (x + 0.25) * 3, (z + 0.75) * 3),
            infrastructureColumnAt(b, (x - dx! * 56 + 0.25) * 3, (z - dz! * 56 + 0.75) * 3),
            'continuous pointwise field seam',
          );
          points++;
        }
      }
    const x0 = b.originPcx * 168,
      z0 = b.originPcz * 168,
      x1 = (a.originPcx + 4) * 168,
      z1 = (a.originPcz + 4) * 168;
    const inOverlap = (p: InfrastructurePrimitive) => {
      const q = primitiveBounds(p);
      return q.x0 < x1 - 1e-5 && q.z0 < z1 - 1e-5 && q.x1 > x0 + 1e-5 && q.z1 > z0 + 1e-5;
    };
    const ap = a.infrastructure!.primitives.filter(inOverlap),
      bp = b.infrastructure!.primitives.filter(inOverlap);
    assert.deepEqual(
      ap,
      bp,
      'every physical primitive touching the shared region is present, not just intersected IDs',
    );
    primitives += ap.length;
    const al = a.infrastructure!.ladders.filter(
        (l) => l.x > x0 && l.x < x1 && l.z > z0 && l.z < z1,
      ),
      bl = b.infrastructure!.ladders.filter((l) => l.x > x0 && l.x < x1 && l.z > z0 && l.z < z1);
    assert.deepEqual(al, bl, 'all shared interactive links survive cold recenter');
    ladders += al.length;
  }
  generateWorldChunked({ seed, stack: 1, originPcx: 25, originPcz: 31 });
  const revisited = generateWorldChunked({ seed, stack: 1, originPcx: -1, originPcz: -1 });
  assert.deepEqual(revisited.columns, a.columns, 'eviction/revisit columns');
  assert.deepEqual(revisited.infrastructure, a.infrastructure, 'eviction/revisit exact model');
  const clone = structuredClone(a);
  assert.deepEqual(
    clone.infrastructure,
    a.infrastructure,
    'worker structured-clone preserves plain-data physical model',
  );
}
console.log(
  `infrastructure seams: ${columns} columns, ${points} exact sub-tile queries, ${primitives} physical records, ${ladders} links; X/Z/diagonal, eviction and worker clone passed`,
);
