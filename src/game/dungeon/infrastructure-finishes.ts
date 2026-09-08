/** Construction finishes follow the existing network owner, service role and
 * coarse region. They are appearance data, not new fluid/network simulation.
 * Never seed a finish from a render chunk, camera or individual tessellated face. */
import type { InfrastructurePrimitive, InfrastructurePoint } from './infrastructure-solid';
import { regionAtCell, type RegionType } from './region-layer';
import { cellSeed, mulberry32 } from './rng';
import { PIPE_COLORS } from '../material-presets';

export type PipeService = 'trunk' | 'return' | 'service';
export interface PipeFinish {
  readonly service: PipeService;
  readonly district: RegionType;
  readonly hex: number;
  readonly color: readonly [number, number, number];
}
export const TRUNK_FINISHES = PIPE_COLORS.trunk;
const linear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function finish(seed: number, x: number, z: number, service: PipeService): PipeFinish {
  const district = regionAtCell(seed, x * 8, z * 8);
  const palette =
    service === 'trunk'
      ? TRUNK_FINISHES[district]
      : service === 'return'
        ? district === 'machine'
          ? PIPE_COLORS.return.machine
          : PIPE_COLORS.return.other
        : PIPE_COLORS.service;
  const salt = service === 'trunk' ? 0x5041494e : service === 'return' ? 0x52455455 : 0x53455256;
  const hex = palette[Math.floor(mulberry32(cellSeed(x, z, seed, salt))() * palette.length)]!;
  const color = Object.freeze([
    linear(((hex >> 16) & 255) / 255),
    linear(((hex >> 8) & 255) / 255),
    linear((hex & 255) / 255),
  ]) as readonly [number, number, number];
  return Object.freeze({ service, district, hex, color });
}
const cache = new WeakMap<InfrastructurePrimitive, Map<number, PipeFinish>>();
export function pipeFinish(seed: number, p: InfrastructurePrimitive): PipeFinish {
  let values = cache.get(p);
  if (!values) {
    values = new Map();
    cache.set(p, values);
  }
  const cached = values.get(seed);
  if (cached) return cached;
  const owner = /^infra:(-?\d+),(-?\d+)(?=:|$)/.exec(p.id);
  const x = owner ? Number(owner[1]) : Math.floor(p.a[0] / 336),
    z = owner ? Number(owner[2]) : Math.floor(p.a[2] / 336);
  const service: PipeService = p.id.includes(':return')
    ? 'return'
    : p.id.includes(':access:') || p.id.includes(':maintenance:') || p.radius < 3
      ? 'service'
      : 'trunk';
  const result = finish(seed, x, z, service);
  values.set(seed, result);
  return result;
}
export function mountedPipeFinish(
  seed: number,
  source: string,
  radius: number,
  anchor: InfrastructurePoint,
): PipeFinish {
  const frame = /^frame:(-?\d+),(-?\d+)(?=:|$)/.exec(source),
    road = /^road:(-?\d+),(-?\d+)(?=:|$)/.exec(source);
  const x = frame
    ? Math.floor(Number(frame[1]) / 2)
    : road
      ? Math.floor((Number(road[1]) * 24) / 112)
      : Math.floor(anchor[0] / 336);
  const z = frame
    ? Math.floor(Number(frame[2]) / 2)
    : road
      ? Math.floor((Number(road[2]) * 24) / 112)
      : Math.floor(anchor[2] / 336);
  return finish(seed, x, z, radius >= 0.5 ? 'service' : 'return');
}
