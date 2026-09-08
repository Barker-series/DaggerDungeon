import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { buildInfrastructureBuffers } from '../src/engine/InfrastructureRenderer';
import { buildUtilityRunBuffers, type UtilityBatches } from '../src/engine/StructureUtilities';
import type { InfrastructurePrimitive } from '../src/game/dungeon/infrastructure-solid';
import type { WorldData } from '../src/game/types';
function check(batches: UtilityBatches, label: string, metric = true) {
  let triangles = 0;
  for (const b of Object.values(batches))
    for (let i = 0; i < b.idxs.length; i += 3) {
      const ids = b.idxs.slice(i, i + 3);
      const p = ids.map(
        (j) => new Vector3(...(b.verts.slice(j * 3, j * 3 + 3) as [number, number, number])),
      );
      const area = p[1]!.clone().sub(p[0]!).cross(p[2]!.clone().sub(p[0]!)).length();
      if (area < 1e-8) continue;
      const uv = ids.map((j) => b.uvs.slice(j * 2, j * 2 + 2));
      const uvArea = Math.abs(
        (uv[1]![0]! - uv[0]![0]!) * (uv[2]![1]! - uv[0]![1]!) -
          (uv[1]![1]! - uv[0]![1]!) * (uv[2]![0]! - uv[0]![0]!),
      );
      assert.ok(uvArea > 1e-9, `${label}: nonzero surface must not collapse to a UV line`);
      if (metric) {
        assert.ok(
          Math.abs(uvArea / area - 1 / 9) < 1e-5,
          `${label}: texel density must stay one repeat per three world units`,
        );
        for (const [a, c] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ])
          assert.ok(
            Math.abs(
              p[a!]!.distanceTo(p[c!]!) -
                3 * Math.hypot(uv[a!]![0]! - uv[c!]![0]!, uv[a!]![1]! - uv[c!]![1]!),
            ) < 1e-5,
            `${label}: UVs must preserve both edge lengths, not just area`,
          );
      }
      triangles++;
    }
  assert.ok(triangles > 0);
  return triangles;
}
let count = 0;
for (const end of [
  [30, 0, 0],
  [0, 30, 0],
  [0, 0, 30],
  [30, 12, 24],
] as [number, number, number][]) {
  const p: InfrastructurePrimitive = {
    id: 'test',
    kind: 'pipe',
    a: [-10, 4, -10],
    b: [end[0] - 10, end[1] + 4, end[2] - 10],
    radius: 3,
    innerRadius: 2.1,
  };
  count += check(
    buildInfrastructureBuffers([p], { x0: -20, z0: -20, x1: 40, z1: 40 }),
    'infrastructure',
  );
  const full = buildInfrastructureBuffers([p], { x0: -20, z0: -20, x1: 40, z1: 40 });
  const rebased = buildInfrastructureBuffers([p], { x0: -20, z0: -20, x1: 40, z1: 40 }, 168, -168);
  for (const key of Object.keys(full) as (keyof UtilityBatches)[])
    assert.deepEqual(
      full[key].uvs,
      rebased[key].uvs,
      'floating render origin cannot change UV phase',
    );
  count += check(
    buildInfrastructureBuffers([p], { x0: -11, z0: -11, x1: 14, z1: 14 }),
    'clipped infrastructure',
  );
}
const world = { originPcx: 0, originPcz: 0 } as WorldData;
count += check(
  buildUtilityRunBuffers(world, { x0: -10, z0: -10, x1: 30, z1: 30 }, [
    {
      id: 'mounted',
      source: 'test',
      kind: 'pipe',
      radius: 0.5,
      points: [
        [0, 0, 0],
        [0, 12, 0],
      ],
      anchors: [
        [0, 0, 0],
        [0, 12, 0],
      ],
    },
  ]),
  'mounted utilities',
);
const bent = buildUtilityRunBuffers(world, { x0: -10, z0: -10, x1: 30, z1: 30 }, [
  {
    id: 'bent',
    source: 'test',
    kind: 'pipe',
    radius: 0.3,
    points: [
      [0, 0, 0],
      [0, 5, 0],
      [1, 6, 0],
      [5, 6, 0],
    ],
    anchors: [
      [0, 0, 0],
      [5, 6, 0],
    ],
  },
]);
count += check(bent, 'bent utility', false);
// Every actual meridian follows its own physical bend length. Cap vertices
// occupy the final two groups of 1+2*8 vertices in the existing tube emitter.
const b = bent.pipe;
for (let i = 0; i < b.verts.length / 3 - 34; i += 4)
  for (const [a, c] of [
    [i, i + 3],
    [i + 1, i + 2],
  ]) {
    const p = new Vector3(...(b.verts.slice(a! * 3, a! * 3 + 3) as [number, number, number]));
    const q = new Vector3(...(b.verts.slice(c! * 3, c! * 3 + 3) as [number, number, number]));
    assert.ok(
      Math.abs(p.distanceTo(q) - 3 * (b.uvs[c! * 2 + 1]! - b.uvs[a! * 2 + 1]!)) < 1e-6,
      'bent pipe texture uses actual meridian arc length',
    );
  }
console.log(
  `pipe UVs: ${count} UV-valid triangles; metric straight/clipped faces, stable origins and bent meridian distances passed`,
);
