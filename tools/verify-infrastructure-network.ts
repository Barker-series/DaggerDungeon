import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ROAD_MAX_FACILITY_ROOF } from '../src/game/dungeon/road-buildings';
import { regionAtCell } from '../src/game/dungeon/region-layer';
assert.ok(
  existsSync(new URL('../src/game/dungeon/infrastructure-network.ts', import.meta.url)),
  'infrastructure must have its own world planner, independent of building recipes',
);
const { infrastructureNode, planInfrastructureCell, collectInfrastructurePlans, INFRA_CELL_TILES } =
  await import('../src/game/dungeon/infrastructure-network');
const ids = new Set<string>();
let runs = 0;
for (const seed of [1, 1234, 1788647085001])
  for (let z = -3; z <= 3; z++)
    for (let x = -3; x <= 3; x++) {
      const p = planInfrastructureCell(seed, x, z);
      assert.deepEqual(p, planInfrastructureCell(seed, x, z));
      const a = infrastructureNode(seed, x, z);
      if (
        Array.from({ length: 64 }, (_, i) =>
          regionAtCell(seed, x * 8 + (i % 8), z * 8 + Math.floor(i / 8)),
        ).includes('roads')
      ) {
        assert.ok(
          a.point[1] >= ROAD_MAX_FACILITY_ROOF + 18,
          'shared node clears the upstream facility envelope even at mixed-region boundaries',
        );
      }
      assert.ok(
        p.primitives.some((v) => v.id === `${p.id}:junction`),
        'shared node has a physical junction housing, not hanging open tube ends',
      );
      for (const [dx, dz, axis] of [
        [1, 0, 'east'],
        [0, 1, 'south'],
      ] as const) {
        const b = infrastructureNode(seed, x + dx, z + dz);
        const route = p.routes.find((r) => r.axis === axis)!;
        assert.ok(route, 'every coarse cell participates in the endless connected trunk network');
        assert.deepEqual(route.points[0], a.point);
        assert.deepEqual(
          route.points.at(-1),
          b.point,
          'owned pair terminates at the same node the next owner starts from',
        );
        assert.ok(
          Math.hypot(b.point[0] - a.point[0], b.point[2] - a.point[2]) > 250,
          'trunks cross multiple building cells, not a local prop bank',
        );
        assert.ok(route.radius >= 3, 'trunks have monumental diameter');
        assert.ok(
          route.radius <= a.radius && route.radius <= b.radius,
          'node housing owns every incident trunk diameter',
        );
        for (let i = 1; i < route.points.length; i++)
          assert.equal(
            route.points[i]!.filter((v, k) => Math.abs(v - route.points[i - 1]![k]!) > 1e-6).length,
            1,
            'axis aligned fabrication segments',
          );
        const key = `${seed}:${route.id}`;
        assert.ok(!ids.has(key));
        ids.add(key);
        runs++;
      }
    }
const bounds = {
  tx0: -INFRA_CELL_TILES,
  tz0: -INFRA_CELL_TILES,
  tx1: INFRA_CELL_TILES,
  tz1: INFRA_CELL_TILES,
};
const a = collectInfrastructurePlans(1234, bounds);
const b = collectInfrastructurePlans(1234, {
  ...bounds,
  tx0: bounds.tx0 + 56,
  tx1: bounds.tx1 + 56,
});
for (const p of a) {
  const q = b.find((v) => v.id === p.id);
  if (q) assert.deepEqual(p, q, 'overlapping windows receive identical complete plans');
}
assert.ok(a.length > 0);
console.log(
  `infrastructure network: ${runs} long owned routes across seeds and negative coordinates; connected endpoint and window identity passed`,
);

const { generateWorldChunked } = await import('../src/game/gen/assemble');
const w = generateWorldChunked({ seed: 1234, stack: 1 });
assert.ok(
  w.infrastructure?.primitives.length,
  'shipping chunk pipeline must materialize the infrastructure network',
);
assert.ok(
  w.infrastructureBaseColumns,
  'exact refinements retain the excavated structural column base',
);
assert.ok(
  w.columns.some((s, i) => JSON.stringify(s) !== JSON.stringify(w.infrastructureBaseColumns![i])),
  'physical network changes the authoritative column projection, not just a mesh',
);
console.log('infrastructure network: shipping columns and published exact geometry passed');
