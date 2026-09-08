import { ChunkedLayer } from './chunked';
import type { ColumnLayer, ColumnChunk } from './layers';
import type { ColumnSpan, WorldData } from '../types';
import { assemblePillar } from '../dungeon/pillar-layer';
import { pillarFootprint } from '../dungeon/pillar-geometry';
import { collectServiceLadders } from '../dungeon/frame-services';
import {
  INFRA_CELL_TILES,
  planInfrastructureCell,
  type InfrastructurePlan,
} from '../dungeon/infrastructure-network';
import { planInfrastructureAccess } from '../dungeon/infrastructure-access';
import { planInfrastructureCirculation } from '../dungeon/infrastructure-circulation';
import {
  infrastructureIntervalsAt,
  primitiveBounds,
  type InfrastructurePrimitive,
} from '../dungeon/infrastructure-solid';
import {
  carveInfrastructureAir,
  cutInfrastructureSolids,
  indexInfrastructure,
  infrastructureLadderPrimitives,
  mergeInfrastructureData,
  type InfrastructureData,
} from '../dungeon/infrastructure-columns';

const CT = 56;
const circulationCache = new WeakMap<
  InfrastructurePlan,
  ReturnType<typeof planInfrastructureCirculation>
>();
export class InfrastructurePlanLayer extends ChunkedLayer<InfrastructurePlan> {
  constructor(private seed: number) {
    super('infrastructure-plan', INFRA_CELL_TILES);
  }
  protected create(cx: number, cz: number): InfrastructurePlan {
    return planInfrastructureCell(this.seed, cx, cz);
  }
}
export interface InfrastructureChunk {
  columns: ColumnSpan[][];
  baseColumns: ColumnSpan[][];
  floor: number[][];
  pillarGround: boolean[][];
  data: InfrastructureData;
}

/** The same compiler runs in legacy and chunked paths. Local access reads a
 * COMPLETE owning base-column chunk, not an assembled window's clipped rim. */
export function materializeInfrastructureChunk(
  seed: number,
  cx: number,
  cz: number,
  source: Pick<ColumnChunk, 'columns' | 'floor' | 'pillarGround'> &
    Partial<Pick<ColumnChunk, 'roadBuildingTiles'>>,
  plans: InfrastructurePlan[],
): InfrastructureChunk {
  const tx0 = cx * CT,
    tz0 = cz * CT;
  const overlaps = (p: InfrastructurePrimitive): boolean => {
    const b = primitiveBounds(p);
    return b.x1 >= tx0 * 3 && b.z1 >= tz0 * 3 && b.x0 <= (tx0 + CT) * 3 && b.z0 <= (tz0 + CT) * 3;
  };
  const primitives = plans.flatMap((p) => p.primitives).filter(overlaps);
  const circulation = plans.map((p) => {
    let c = circulationCache.get(p);
    if (!c) {
      c = planInfrastructureCirculation(seed, p);
      circulationCache.set(p, c);
    }
    return c;
  });
  primitives.push(...circulation.flatMap((c) => c.primitives).filter(overlaps));
  const access: InfrastructureData['access'] = [];
  const p = assemblePillar(seed, cx, cz);
  const reserved = new Set(p ? pillarFootprint(p).map(([x, z]) => `${tx0 + x},${tz0 + z}`) : []);
  if (cx % 2 === 0 && cz % 2 === 0) {
    const owner = plans.find((p) => p.id === `infra:${cx / 2},${cz / 2}`)!;
    const site = planInfrastructureAccess(
      owner,
      (ax, az) => {
        const x = ax - tx0,
          z = az - tz0;
        return x >= 0 && z >= 0 && x < CT && z < CT ? source.columns[z * CT + x] : undefined;
      },
      (ax, az) =>
        reserved.has(`${ax},${az}`) || Boolean(source.roadBuildingTiles?.[az - tz0]?.[ax - tx0]),
    );
    if (site) {
      access.push(site);
      primitives.push(...site.primitives);
    }
  }
  // Existing shelves keep their usable ladders, now represented by the SAME
  // physical primitives as the network, not a second noncolliding prop pass.
  const frameLadders = p
    ? collectServiceLadders({ pillars: new Map([['p', p]]) } as WorldData)
    : [];
  const ladders = [
    ...frameLadders,
    ...access.flatMap((a) => a.ladders),
    ...circulation
      .flatMap((c) => c.ladders)
      .filter(
        (l) => l.x >= tx0 * 3 && l.z >= tz0 * 3 && l.x < (tx0 + CT) * 3 && l.z < (tz0 + CT) * 3,
      ),
  ];
  primitives.push(...infrastructureLadderPrimitives(ladders));
  const unique = [...new Map(primitives.map((p) => [p.id, p])).values()];
  const primitiveIndex = indexInfrastructure(unique);
  // Pipe galleries are excavated upstream of the physical shell. In rock they
  // become enclosed maintenance passages; over void they remain exposed spans.
  const galleries = unique
    .filter(
      (p) =>
        (p.kind === 'pipe' && p.innerRadius !== undefined) ||
        (p.kind === 'deck' && p.a[1] === p.b[1]),
    )
    .map((p) => ({
      ...p,
      id: `${p.id}:gallery`,
      radius: p.radius + (p.radius >= 3 ? 6 : 3),
      innerRadius: undefined,
    }));
  const galleryIndex = indexInfrastructure(galleries);
  const floor = source.floor.map((r) => [...r]);
  const pillarGround = source.pillarGround.map((r) => [...r]);
  const baseColumns: ColumnSpan[][] = source.columns.map((c) => c.map((s) => ({ ...s })));
  for (let z = 0; z < CT; z++)
    for (let x = 0; x < CT; x++) {
      const key = `${tx0 + x},${tz0 + z}`;
      const nearby = galleryIndex.get(key);
      if (nearby)
        for (const [lo, hi] of infrastructureIntervalsAt(
          nearby,
          (tx0 + x + 0.5) * 3,
          (tz0 + z + 0.5) * 3,
        )) {
          baseColumns[z * CT + x] = carveInfrastructureAir(baseColumns[z * CT + x]!, lo, hi);
        }
    }
  for (const site of access) {
    // Foot carving first, then elevated platform slabs: the shaft must not
    // erase the actual shelf it leads to.
    for (const box of [...site.boxes].sort((a, b) => a.top - b.top)) {
      for (let az = box.z0; az < box.z1; az++)
        for (let ax = box.x0; ax < box.x1; ax++) {
          const x = ax - tx0,
            z = az - tz0;
          if (x < 0 || z < 0 || x >= CT || z >= CT)
            throw new Error('infrastructure access escaped its declared owner');
          let c = carveInfrastructureAir(baseColumns[z * CT + x]!, box.top, box.clearTop);
          c = cutInfrastructureSolids(c, [[box.bottom, box.top]], true);
          baseColumns[z * CT + x] = c;
          if (box.top === site.foot.y) {
            floor[z]![x] = box.top;
            pillarGround[z]![x] = true;
          }
        }
    }
  }
  const columns = baseColumns.map((spans, i) => {
    const x = i % CT,
      z = Math.floor(i / CT);
    const nearby = primitiveIndex.get(`${tx0 + x},${tz0 + z}`);
    return nearby
      ? cutInfrastructureSolids(
          spans,
          infrastructureIntervalsAt(nearby, (tx0 + x + 0.5) * 3, (tz0 + z + 0.5) * 3),
          true,
        )
      : spans;
  });
  return {
    columns,
    baseColumns,
    floor,
    pillarGround,
    data: { primitives: unique, ladders, plans, access },
  };
}

/** Legacy facade invokes the identical per-owner compiler, with no extra
 * window-dependent planning or writes into previously materialized chunks. */
export function applyInfrastructureToWorld(world: WorldData): WorldData {
  const level = world.levels[0]!,
    w = level.width,
    h = level.height;
  const planLayer = new InfrastructurePlanLayer(world.seed + world.stack * 100000);
  planLayer.ensure({
    tx0: world.originPcx * CT - INFRA_CELL_TILES,
    tz0: world.originPcz * CT - INFRA_CELL_TILES,
    tx1: world.originPcx * CT + w + INFRA_CELL_TILES,
    tz1: world.originPcz * CT + h + INFRA_CELL_TILES,
  });
  const columns: ColumnSpan[][] = new Array(w * h),
    baseColumns: ColumnSpan[][] = new Array(w * h);
  const floor = level.floorHeights.map((r) => [...r]),
    pillarGround = level.pillarGround.map((r) => [...r]);
  const data: InfrastructureData[] = [];
  for (let pz = 0; pz < h / CT; pz++)
    for (let px = 0; px < w / CT; px++) {
      const cx = world.originPcx + px,
        cz = world.originPcz + pz;
      const source = {
        columns: Array.from(
          { length: CT * CT },
          (_, i) => world.columns[(pz * CT + Math.floor(i / CT)) * w + px * CT + (i % CT)]!,
        ),
        floor: level.floorHeights
          .slice(pz * CT, (pz + 1) * CT)
          .map((r) => r.slice(px * CT, (px + 1) * CT)),
        pillarGround: level.pillarGround
          .slice(pz * CT, (pz + 1) * CT)
          .map((r) => r.slice(px * CT, (px + 1) * CT)),
        roadBuildingTiles: level.roadBuildingTiles
          ?.slice(pz * CT, (pz + 1) * CT)
          .map((r) => r.slice(px * CT, (px + 1) * CT)),
      };
      const plans: InfrastructurePlan[] = [];
      for (
        let z = Math.floor((cz * CT) / INFRA_CELL_TILES) - 1;
        z <= Math.floor(((cz + 1) * CT) / INFRA_CELL_TILES);
        z++
      )
        for (
          let x = Math.floor((cx * CT) / INFRA_CELL_TILES) - 1;
          x <= Math.floor(((cx + 1) * CT) / INFRA_CELL_TILES);
          x++
        )
          plans.push(planLayer.get(x, z));
      const c = materializeInfrastructureChunk(
        world.seed + world.stack * 100000,
        cx,
        cz,
        source,
        plans,
      );
      data.push(c.data);
      for (let z = 0; z < CT; z++)
        for (let x = 0; x < CT; x++) {
          const i = (pz * CT + z) * w + px * CT + x;
          columns[i] = c.columns[z * CT + x]!;
          baseColumns[i] = c.baseColumns[z * CT + x]!;
          floor[pz * CT + z]![px * CT + x] = c.floor[z]![x]!;
          pillarGround[pz * CT + z]![px * CT + x] = c.pillarGround[z]![x]!;
        }
    }
  return {
    ...world,
    columns,
    infrastructureBaseColumns: baseColumns,
    infrastructure: mergeInfrastructureData(data),
    levels: [{ ...level, floorHeights: floor, pillarGround }, ...world.levels.slice(1)],
  };
}

export class InfrastructureLayer extends ChunkedLayer<InfrastructureChunk> {
  constructor(
    private seed: number,
    private column: ColumnLayer,
    private plans: InfrastructurePlanLayer,
  ) {
    super('infrastructure', CT);
    this.dependsOn(column, 0);
    // A west/north owner reaches an entire coarse cell beyond its own node.
    this.dependsOn(plans, INFRA_CELL_TILES);
  }
  protected create(cx: number, cz: number): InfrastructureChunk {
    const plans: InfrastructurePlan[] = [];
    for (
      let z = Math.floor((cz * CT) / INFRA_CELL_TILES) - 1;
      z <= Math.floor(((cz + 1) * CT) / INFRA_CELL_TILES);
      z++
    ) {
      for (
        let x = Math.floor((cx * CT) / INFRA_CELL_TILES) - 1;
        x <= Math.floor(((cx + 1) * CT) / INFRA_CELL_TILES);
        x++
      )
        plans.push(this.plans.get(x, z));
    }
    return materializeInfrastructureChunk(this.seed, cx, cz, this.column.get(cx, cz), plans);
  }
}
