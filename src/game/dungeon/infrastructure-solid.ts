/** Absolute-world analytic infrastructure. Radius is the octagon's axis extent
 * (apothem), NOT circumradius: vertices (q,r),(r,q), q=r*(sqrt(2)-1).
 * Immutable primitive records/arrays are cached.
 * Solid = (union(pipe/collar outer) - union(pipe/collar bore)) UNION fixtures.
 * Bores have the same axial extent, so terminal annuli are open, not sealed. */
export type InfrastructurePoint = [number, number, number];
export type InfrastructurePrimitive = {
  id: string;
  kind: 'pipe' | 'collar' | 'support' | 'deck' | 'cable';
  a: InfrastructurePoint;
  b: InfrastructurePoint;
  radius: number;
  innerRadius?: number;
};
export type InfrastructureBounds = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
};
type V = InfrastructurePoint;
export type InfrastructurePlane = { n: V; d: number };
export type InfrastructureFace = { vertices: V[]; normal: V; primitive: InfrastructurePrimitive };
type Prism = {
  planes: InfrastructurePlane[];
  faces: InfrastructureFace[];
  bounds: InfrastructureBounds;
};
const EPS = 1e-8;
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));
const cache = new WeakMap<InfrastructurePrimitive, { outer: Prism; inner?: Prism }>();
const isShell = (p: InfrastructurePrimitive): boolean => p.kind === 'pipe' || p.kind === 'collar';
function prism(p: InfrastructurePrimitive, r: number): Prism {
  const axis = unit(sub(p.b, p.a));
  const u = unit(cross(Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], axis));
  const v = cross(axis, u),
    q = r * (Math.SQRT2 - 1);
  const ring: [number, number][] = [
    [r, q],
    [q, r],
    [-q, r],
    [-r, q],
    [-r, -q],
    [-q, -r],
    [q, -r],
    [r, -q],
  ];
  const at = (a: V, s: number, t: number): V => [
    a[0] + u[0] * s + v[0] * t,
    a[1] + u[1] * s + v[1] * t,
    a[2] + u[2] * s + v[2] * t,
  ];
  const a = ring.map(([s, t]) => at(p.a, s, t)),
    b = ring.map(([s, t]) => at(p.b, s, t));
  const polygons = [
    a.slice().reverse(),
    b,
    ...a.map((pt, i) => [pt, a[(i + 1) % 8]!, b[(i + 1) % 8]!, b[i]!]),
  ];
  const faces = polygons.map((vertices) => ({
    vertices,
    normal: unit(cross(sub(vertices[1]!, vertices[0]!), sub(vertices[2]!, vertices[0]!))),
    primitive: p,
  }));
  const points = [...a, ...b];
  const bounds = {
    x0: Math.min(...points.map((t) => t[0])),
    y0: Math.min(...points.map((t) => t[1])),
    z0: Math.min(...points.map((t) => t[2])),
    x1: Math.max(...points.map((t) => t[0])),
    y1: Math.max(...points.map((t) => t[1])),
    z1: Math.max(...points.map((t) => t[2])),
  };
  return {
    faces,
    planes: faces.map((f) => ({ n: f.normal, d: dot(f.normal, f.vertices[0]!) })),
    bounds,
  };
}
function validatePrimitive(p: InfrastructurePrimitive): void {
  if (
    ![...p.a, ...p.b, p.radius].every(Number.isFinite) ||
    p.radius <= 0 ||
    Math.hypot(...sub(p.a, p.b)) < EPS ||
    (p.innerRadius !== undefined &&
      (!Number.isFinite(p.innerRadius) || p.innerRadius <= 0 || p.innerRadius >= p.radius))
  )
    throw new Error(`Invalid infrastructure primitive ${p.id}`);
}
function model(p: InfrastructurePrimitive): { outer: Prism; inner?: Prism } {
  let m = cache.get(p);
  if (m) return m;
  validatePrimitive(p);
  m = {
    outer: prism(p, p.radius),
    inner: !isShell(p) || p.innerRadius === undefined ? undefined : prism(p, p.innerRadius),
  };
  cache.set(p, m);
  return m;
}
export function primitiveBounds(p: InfrastructurePrimitive): InfrastructureBounds {
  return { ...boundsOf(p) };
}
const boundsCache = new WeakMap<InfrastructurePrimitive, InfrastructureBounds>();
/** Indexing must not construct every inner/outer face in a delivered window.
 * Use the identical ring arithmetic, but retain only the six extrema. */
function boundsOf(p: InfrastructurePrimitive): InfrastructureBounds {
  const ready = cache.get(p);
  if (ready) return ready.outer.bounds;
  const cached = boundsCache.get(p);
  if (cached) return cached;
  validatePrimitive(p);
  const axis = unit(sub(p.b, p.a));
  const u = unit(cross(Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], axis)),
    v = cross(axis, u);
  const r = p.radius,
    q = r * (Math.SQRT2 - 1);
  const b = {
    x0: Infinity,
    y0: Infinity,
    z0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
    z1: -Infinity,
  };
  for (const a of [p.a, p.b])
    for (const [s, t] of [
      [r, q],
      [q, r],
      [-q, r],
      [-r, q],
      [-r, -q],
      [-q, -r],
      [q, -r],
      [r, -q],
    ]) {
      const x = a[0] + u[0] * s! + v[0] * t!,
        y = a[1] + u[1] * s! + v[1] * t!,
        z = a[2] + u[2] * s! + v[2] * t!;
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.z0 = Math.min(b.z0, z);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
      b.z1 = Math.max(b.z1, z);
    }
  boundsCache.set(p, b);
  return b;
}
function interval(pr: Prism, x: number, z: number): [number, number] | null {
  let lo = -Infinity,
    hi = Infinity;
  for (const { n, d } of pr.planes) {
    const rhs = d - n[0] * x - n[2] * z;
    if (Math.abs(n[1]) < EPS) {
      if (rhs < -EPS) return null;
    } else if (n[1] > 0) hi = Math.min(hi, rhs / n[1]);
    else lo = Math.max(lo, rhs / n[1]);
  }
  return hi - lo > EPS ? [lo, hi] : null;
}
function merge(a: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of a.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && v[0] <= last[1] + EPS) last[1] = Math.max(last[1], v[1]);
    else out.push([...v]);
  }
  return out;
}
export function infrastructureIntervalsAt(
  primitives: readonly InfrastructurePrimitive[],
  x: number,
  z: number,
): [number, number][] {
  const outer: [number, number][] = [],
    fixtures: [number, number][] = [],
    inner: [number, number][] = [];
  for (const p of nearby(spatial(primitives), {
    x0: x,
    x1: x,
    z0: z,
    z1: z,
    y0: -Infinity,
    y1: Infinity,
  })) {
    const m = model(p),
      b = m.outer.bounds;
    if (x < b.x0 - EPS || x > b.x1 + EPS || z < b.z0 - EPS || z > b.z1 + EPS) continue;
    const o = interval(m.outer, x, z);
    if (o) (isShell(p) ? outer : fixtures).push(o);
    if (m.inner) {
      const i = interval(m.inner, x, z);
      if (i) inner.push(i);
    }
  }
  let out = merge(outer);
  for (const [lo, hi] of merge(inner)) {
    out = out.flatMap(([a, b]): [number, number][] =>
      hi <= a || lo >= b
        ? [[a, b]]
        : [
            ...(a < lo ? [[a, lo] as [number, number]] : []),
            ...(hi < b ? [[hi, b] as [number, number]] : []),
          ],
    );
  }
  return merge([...out, ...fixtures]).filter(([lo, hi]) => hi - lo > EPS);
}

/** Sutherland–Hodgman, preserving front winding; no synthetic clip caps. */
export function clipInfrastructurePolygon(poly: V[], plane: InfrastructurePlane): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!,
      da = dot(plane.n, a) - plane.d,
      db = dot(plane.n, b) - plane.d;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
function valid(poly: V[]): boolean {
  return (
    poly.length >= 3 &&
    poly.some(
      (p, i) => i > 1 && Math.hypot(...cross(sub(poly[i - 1]!, poly[0]!), sub(p, poly[0]!))) > EPS,
    )
  );
}
function intersect(poly: V[], planes: InfrastructurePlane[]): V[] {
  // Reject disjoint polygons BEFORE clipping against earlier planes. Otherwise
  // a remote fitting's end planes unnecessarily split a whole long pipe face.
  if (planes.some((p) => poly.every((v) => dot(p.n, v) - p.d > EPS))) return [];
  for (const p of planes) {
    poly = clipInfrastructurePolygon(poly, p);
    if (!valid(poly)) return [];
  }
  return poly;
}
function subtract(
  poly: V[],
  planes: InfrastructurePlane[],
  normal: V,
  keepCoincident: boolean,
): V[][] {
  if (!poly.length) return [];
  if (planes.some((p) => poly.every((v) => dot(p.n, v) - p.d > EPS))) return [poly];
  // A face touching a cutter is hidden only if its outward side enters it.
  for (const p of planes)
    if (poly.every((v) => Math.abs(dot(p.n, v) - p.d) < EPS)) {
      const alignment = dot(p.n, normal);
      if (alignment > 1 - EPS && keepCoincident) return [poly];
    }
  const out: V[][] = [];
  let rest = poly;
  for (const p of planes) {
    if (rest.every((v) => Math.abs(dot(p.n, v) - p.d) < EPS)) continue;
    const outside = clipInfrastructurePolygon(rest, { n: scale(p.n, -1), d: -p.d });
    if (valid(outside)) out.push(outside);
    rest = clipInfrastructurePolygon(rest, p);
    if (!valid(rest)) break;
  }
  return out;
}
const overlaps = (a: InfrastructureBounds, b: InfrastructureBounds): boolean =>
  a.x0 <= b.x1 + EPS &&
  a.x1 >= b.x0 - EPS &&
  a.y0 <= b.y1 + EPS &&
  a.y1 >= b.y0 - EPS &&
  a.z0 <= b.z1 + EPS &&
  a.z1 >= b.z0 - EPS;
type SpatialModel = {
  sorted: InfrastructurePrimitive[];
  bins: Map<string, InfrastructurePrimitive[]>;
  faces: Map<InfrastructurePrimitive, InfrastructureFace[]>;
};
const spatialCache = new WeakMap<readonly InfrastructurePrimitive[], SpatialModel>();
const BIN = 64;
function spatial(primitives: readonly InfrastructurePrimitive[]): SpatialModel {
  const data = spatialCache.get(primitives);
  if (data) return data;
  const work = spatialWork(primitives);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
function* spatialWork(
  primitives: readonly InfrastructurePrimitive[],
): Generator<undefined, SpatialModel> {
  const cached = spatialCache.get(primitives);
  if (cached) return cached;
  const data: SpatialModel = {
    sorted: [...primitives].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    bins: new Map(),
    faces: new Map(),
  };
  let count = 0;
  for (const p of data.sorted) {
    const b = boundsOf(p);
    for (let z = Math.floor(b.z0 / BIN); z <= Math.floor(b.z1 / BIN); z++)
      for (let x = Math.floor(b.x0 / BIN); x <= Math.floor(b.x1 / BIN); x++) {
        const key = `${x},${z}`,
          bucket = data.bins.get(key);
        if (bucket) bucket.push(p);
        else data.bins.set(key, [p]);
      }
    if (++count % 32 === 0) yield undefined;
  }
  spatialCache.set(primitives, data);
  return data;
}
function nearby(data: SpatialModel, b: InfrastructureBounds): InfrastructurePrimitive[] {
  const found = new Set<InfrastructurePrimitive>();
  for (let z = Math.floor(b.z0 / BIN); z <= Math.floor(b.z1 / BIN); z++)
    for (let x = Math.floor(b.x0 / BIN); x <= Math.floor(b.x1 / BIN); x++)
      for (const p of data.bins.get(`${x},${z}`) ?? []) if (overlaps(b, boundsOf(p))) found.add(p);
  return [...found].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** CSG boundary, deterministic ID ownership of coincident surfaces. Only nearby
 * prisms participate. Input must include the planner's neighbor/effect halo. */
export function infrastructureBoundaryFaces(
  primitives: readonly InfrastructurePrimitive[],
  bounds?: InfrastructureBounds,
): InfrastructureFace[] {
  const result: InfrastructureFace[] = [];
  for (const batch of infrastructureBoundaryFaceBatches(primitives, bounds))
    if (batch) result.push(...batch);
  return result;
}

/** Cooperative rendering work. Only complete primitive boundaries enter the
 * shared cache; cancellation cannot expose a half-built physical surface. */
export function* infrastructureBoundaryFaceBatches(
  primitives: readonly InfrastructurePrimitive[],
  bounds?: InfrastructureBounds,
): Generator<InfrastructureFace[] | undefined> {
  const data = yield* spatialWork(primitives);
  const selected = bounds ? nearby(data, bounds) : data.sorted;
  let workCount = 0;
  for (const p of selected) {
    const cached = data.faces.get(p);
    if (cached) {
      yield cached;
      continue;
    }
    const out: InfrastructureFace[] = [];
    const m = model(p),
      near = nearby(data, m.outer.bounds);
    for (const f of m.outer.faces) {
      let parts = [f.vertices];
      for (const q of near) {
        if (++workCount % 8 === 0) yield undefined;
        if (q === p) continue;
        if (!isShell(p) && isShell(q)) continue;
        parts = parts.flatMap((poly) =>
          subtract(poly, model(q).outer.planes, f.normal, p.id < q.id),
        );
      }
      for (const q of isShell(p) ? near : []) {
        if (++workCount % 8 === 0) yield undefined;
        const bore = model(q).inner;
        if (bore) parts = parts.flatMap((poly) => subtract(poly, bore.planes, f.normal, false));
      }
      if (!isShell(p)) {
        // Remove shell material, not entire pipe outers: every network bore
        // restores fixture surfaces inside a hollow junction.
        for (const q of near.filter(isShell)) {
          yield undefined;
          const outer = model(q).outer;
          parts = parts.flatMap((poly) => {
            const outside = subtract(poly, outer.planes, f.normal, p.id < q.id);
            const inside = intersect(poly, outer.planes);
            const restored: V[][] = [];
            const used: Prism[] = [];
            for (const r of near) {
              const bore = model(r).inner;
              if (
                !bore ||
                bore.planes.some(
                  (pl) =>
                    dot(pl.n, f.normal) > 1 - EPS &&
                    poly.every((v) => Math.abs(dot(pl.n, v) - pl.d) < EPS),
                )
              )
                continue;
              let piece = [intersect(inside, bore.planes)].filter(valid);
              for (const prev of used)
                piece = piece.flatMap((v) => subtract(v, prev.planes, f.normal, false));
              restored.push(...piece);
              used.push(bore);
            }
            return [...outside, ...restored];
          });
        }
      }
      for (const vertices of parts) if (valid(vertices)) out.push({ ...f, vertices });
      yield undefined;
    }
    if (m.inner)
      for (const f of m.inner.faces) {
        let parts: V[][] = [];
        // Union intersections, assigning overlaps to the first positive prism.
        const used: Prism[] = [];
        for (const q of near) {
          if (++workCount % 8 === 0) yield undefined;
          if (!isShell(q)) continue;
          const outer = model(q).outer;
          if (
            outer.planes.some(
              (pl) =>
                dot(pl.n, f.normal) > 1 - EPS &&
                f.vertices.every((v) => Math.abs(dot(pl.n, v) - pl.d) < EPS),
            )
          )
            continue;
          let piece = [intersect(f.vertices, outer.planes)].filter(valid);
          for (const prev of used)
            piece = piece.flatMap((poly) => subtract(poly, prev.planes, f.normal, false));
          parts.push(...piece);
          used.push(outer);
        }
        for (const q of near) {
          if (!isShell(q)) {
            if (++workCount % 8 === 0) yield undefined;
            parts = parts.flatMap((poly) =>
              subtract(poly, model(q).outer.planes, scale(f.normal, -1), false),
            );
            continue;
          }
          if (q === p) continue;
          const bore = model(q).inner;
          if (++workCount % 8 === 0) yield undefined;
          if (bore)
            parts = parts.flatMap((poly) => subtract(poly, bore.planes, f.normal, p.id < q.id));
        }
        for (const vertices of parts)
          if (valid(vertices))
            out.push({
              primitive: p,
              normal: scale(f.normal, -1),
              vertices: vertices.slice().reverse(),
            });
        yield undefined;
      }
    data.faces.set(p, out);
    yield out;
  }
}
/** Conservative cylinder/capsule test: intersect its enclosing axis-aligned
 * body box with exact CSG boundary. No point sampling, so even thin wires hit.
 * At diagonal corners this can stop up to (sqrt(2)-1)*radius early; ordinary
 * centerline bores and flat floors keep their exact clearance. Feet is the
 * bottom of the body, height its full extent (not the capsule axis length). */
export function infrastructureBodyIntersects(
  primitives: readonly InfrastructurePrimitive[],
  feet: { x: number; y: number; z: number },
  height: number,
  radius: number,
): boolean {
  const { x, y, z } = feet;
  if (height <= 0 || radius < 0) return false;
  const b = {
    // Exceed polygon clipping tolerance so mere floor contact is not a hit.
    x0: x - radius + 2 * EPS,
    y0: y + 2 * EPS,
    z0: z - radius + 2 * EPS,
    x1: x + radius - 2 * EPS,
    y1: y + height - 2 * EPS,
    z1: z + radius - 2 * EPS,
  };
  const near = nearby(spatial(primitives), b);
  if (!near.length) return false;
  if (
    infrastructureIntervalsAt(primitives, x, z).some(
      ([lo, hi]) => y + height / 2 > lo && y + height / 2 < hi,
    )
  )
    return true;
  const planes: InfrastructurePlane[] = [
    { n: [1, 0, 0], d: b.x1 },
    { n: [-1, 0, 0], d: -b.x0 },
    { n: [0, 1, 0], d: b.y1 },
    { n: [0, -1, 0], d: -b.y0 },
    { n: [0, 0, 1], d: b.z1 },
    { n: [0, 0, -1], d: -b.z0 },
  ];
  // Include all overlapping bores, not just the primitive whose shell is hit.
  // Cache the complete boundary so repeated motion never repeats CSG work.
  return infrastructureBoundaryFaces(primitives, b).some((f) =>
    valid(intersect(f.vertices, planes)),
  );
}
