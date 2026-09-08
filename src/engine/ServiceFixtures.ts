/** Visible maintenance fittings follow building-owned service plans. Shelves
 * and approaches live in columns; these pipes/cables are overhead scenery.
 * Ladder rails/rungs represent the interactive links, never decide their paths. */
import type { WorldData } from '../game/types';
import {
  collectServiceLadders,
  frameServiceDecks,
  serviceWorldPoint,
} from '../game/dungeon/frame-services';
import { frameFloorY } from '../game/dungeon/frame-building';
import {
  buildUtilityRunBuffers,
  type UtilityRun,
  type UtilityPoint,
  type UtilityBounds,
  type UtilityBatches,
} from './StructureUtilities';

export function collectServiceFixtures(world: WorldData): UtilityRun[] {
  const out: UtilityRun[] = [];
  for (const p of world.pillars.values()) {
    if (!p.frame) continue;
    const f = p.frame;
    const at = (x: number, y: number, z: number): UtilityPoint => {
      const [wx, wz] = serviceWorldPoint(p.acx, p.acz, f.rotation, x, z);
      return [wx, y, wz];
    };
    for (const d of frameServiceDecks(f)) {
      const source = `service:${p.acx},${p.acz}:${d.level}`;
      const end = (d.endX + 0.5) * 3;
      const mounts: [UtilityPoint, UtilityPoint] = [
        at(94.5, d.top - 0.2, 66.1),
        at(end, d.top - 0.2, 66.1),
      ];
      const add = (
        id: string,
        kind: UtilityRun['kind'],
        radius: number,
        points: UtilityPoint[],
        anchors = mounts,
      ): void => {
        out.push({ id: `${source}:${id}`, source, kind, radius, points, anchors });
      };
      // One monumental trunk and a smaller parallel return above the shelf.
      // Ends terminate in capped collars; cantilever brackets carry the bank
      // from real piers, behind the walking strip and above standing headroom.
      for (const [i, radius, z, y] of [
        [0, 1.8, 72.3, d.top + 5.8],
        [1, 0.7, 68.2, d.top + 5.8],
      ]) {
        add(`trunk:${i}`, 'pipe', radius!, [at(81, y!, z!), at(end + 1.5, y!, z!)]);
        for (const x of [82, 94.5, 109.5, 121.5].filter((x) => x <= end)) {
          add(`collar:${i}:${x}`, 'collar', radius! + 0.09, [
            at(x - 0.14, y!, z!),
            at(x + 0.14, y!, z!),
          ]);
        }
      }
      for (const x of [94.5, 109.5, 121.5].filter((x) => x <= end)) {
        const anchor = at(x, d.top - 0.2, 66.1);
        add(
          `bracket:${x}`,
          'support',
          0.2,
          [anchor, at(x, d.top + 5.8, 66.1), at(x, d.top + 5.8, 73.9)],
          [anchor, anchor],
        );
      }
      // Unequal-height cable spans to real inner piers on the lower wing.
      // Kept away from the transfer crossing and from the ladder climb lane.
      for (let j = 0; j < 3 && d.level <= f.southLevels + 1; j++) {
        const y = Math.min(d.top - 2.7 - j * 0.4, frameFloorY(f.southLevels) - 2.5 - j * 0.4);
        const a = at(121.5 + j * 0.15, y, 65.98);
        const b = at(121.5 + j * 0.15, y - 0.7, 102.02);
        const points: UtilityPoint[] = Array.from({ length: 33 }, (_, k) => {
          const t = k / 32;
          return [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t - 4 * (1.5 + j * 0.45) * t * (1 - t),
            a[2] + (b[2] - a[2]) * t,
          ];
        });
        add(`gap:${j}`, j === 0 ? 'cable' : 'wire', j === 0 ? 0.065 : 0.03, points, [a, b]);
      }
    }
  }
  for (const l of collectServiceLadders(world)) {
    const at = (side: number, y: number, forward = -0.45): UtilityPoint => [
      l.x + l.nz * side + l.nx * forward,
      y,
      l.z - l.nx * side + l.nz * forward,
    ];
    const anchors: [UtilityPoint, UtilityPoint] = [
      [l.x, l.bottom - 0.1, l.z],
      [l.exitX, l.top - 0.1, l.exitZ],
    ];
    const add = (id: string, radius: number, points: UtilityPoint[]): void => {
      out.push({ id: `${l.id}:${id}`, source: l.id, kind: 'support', radius, points, anchors });
    };
    for (const [i, side] of [-0.46, 0.46].entries()) {
      add(`rail:${i}`, 0.055, [
        at(side, l.bottom - 0.1),
        at(side, l.top + 0.95),
        at(side, l.top + 1.08, -0.8),
        at(side, l.top + 0.9, -1.15),
        at(side, l.top - 0.1, -1.15),
      ]);
    }
    for (let i = 0; l.bottom + 0.28 + i * 0.3 < l.top; i++) {
      const y = l.bottom + 0.28 + i * 0.3;
      add(`rung:${i}`, 0.042, [at(-0.46, y), at(0.46, y)]);
    }
  }
  return out;
}

const cache = new WeakMap<WorldData, UtilityRun[]>();
export function buildServiceFixtureBuffers(
  world: WorldData,
  bounds: UtilityBounds,
): UtilityBatches {
  let runs = cache.get(world);
  if (!runs) {
    runs = collectServiceFixtures(world);
    cache.set(world, runs);
  }
  return buildUtilityRunBuffers(world, bounds, runs);
}
