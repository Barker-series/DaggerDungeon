/** Metric UV charts for the actual planar faces of an octagonal prism.
 * Charts belong to complete absolute primitives, never clipped render jobs. */
import type {
  InfrastructurePoint,
  InfrastructurePrimitive,
} from '../game/dungeon/infrastructure-solid';
import { TILE_SIZE } from '../game/types';

type V = InfrastructurePoint;
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: V): V => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const q = Math.SQRT2 - 1;
const ring: [number, number][] = [
  [1, q],
  [q, 1],
  [-q, 1],
  [-1, q],
  [-1, -q],
  [-q, -1],
  [q, -1],
  [1, -q],
];
interface PrismFrame {
  axis: V;
  u: V;
  v: V;
  sides: { normal: V; tangent: V }[];
}
const frames = new WeakMap<InfrastructurePrimitive, PrismFrame>();
function frame(p: InfrastructurePrimitive): PrismFrame {
  const cached = frames.get(p);
  if (cached) return cached;
  const axis = unit([p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]]);
  const u = unit(cross(Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], axis)),
    v = cross(axis, u);
  const combine = (x: number, y: number): V => [
    u[0] * x + v[0] * y,
    u[1] * x + v[1] * y,
    u[2] * x + v[2] * y,
  ];
  const sides = ring.map((a, i) => {
    const b = ring[(i + 1) % 8]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      l = Math.hypot(dx, dy);
    return { normal: combine(dy / l, -dx / l), tangent: combine(dx / l, dy / l) };
  });
  const result = { axis, u, v, sides };
  frames.set(p, result);
  return result;
}
export interface SurfaceUVChart {
  origin: V;
  u: V;
  v: V;
  uOffset: number;
}
export function infrastructureUVChart(
  p: InfrastructurePrimitive,
  normal: V,
  point: V,
): SurfaceUVChart {
  const f = frame(p);
  if (Math.abs(dot(normal, f.axis)) > 0.99) return { origin: p.a, u: f.u, v: f.v, uOffset: 0 };
  const delta: V = [point[0] - p.a[0], point[1] - p.a[1], point[2] - p.a[2]];
  const inside = dot(delta, normal) < 0;
  const sign = inside ? -1 : 1;
  let selected = 0,
    best = -Infinity;
  for (let i = 0; i < f.sides.length; i++) {
    const d = dot(normal, f.sides[i]!.normal) * sign;
    if (d > best) {
      best = d;
      selected = i;
    }
  }
  const radius = inside ? (p.innerRadius ?? p.radius) : p.radius;
  // Accumulated facet arc length gives a continuous wrap across the eight
  // side faces, with only the deliberate longitudinal unwrap seam remaining.
  return {
    origin: p.a,
    u: f.sides[selected]!.tangent,
    v: f.axis,
    uOffset: (selected + 0.5) * 2 * q * radius,
  };
}
export function surfaceUV(chart: SurfaceUVChart, p: V): [number, number] {
  const d: V = [p[0] - chart.origin[0], p[1] - chart.origin[1], p[2] - chart.origin[2]];
  return [(dot(d, chart.u) + chart.uOffset) / TILE_SIZE, dot(d, chart.v) / TILE_SIZE];
}
