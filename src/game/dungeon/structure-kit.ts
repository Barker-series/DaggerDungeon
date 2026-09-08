/** Small local column recipes. Tile rectangles are inclusive; Y is world units.
 * Compilation belongs outside generation loops; sampling only appends solids.
 * No world selection, neighbor ownership, rotation or renderer dependencies. */
export interface StructureRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}
export interface StructureSlab {
  readonly kind: 'slab' | 'landing';
  readonly rect: StructureRect;
  readonly y: number;
  readonly thickness: number;
}
export interface StructureFlight {
  readonly kind: 'flight';
  readonly rect: StructureRect;
  readonly axis: 'x' | 'z';
  readonly direction: 1 | -1;
  readonly start: number;
  readonly maxSteps: number;
  readonly rise: number;
  readonly y: number;
  readonly thickness: number;
}
export interface StructureVolume {
  readonly kind: 'solid' | 'opening';
  readonly rect: StructureRect;
  readonly lo: number;
  readonly hi: number;
}
export interface StructureSocket {
  readonly name: string;
  readonly role: 'entry' | 'room' | 'door' | 'bridge' | 'utility' | 'vertical';
  readonly x: number;
  readonly z: number;
  readonly y: number;
}
export type StructurePiece = StructureSlab | StructureFlight | StructureVolume;
export interface StructurePlan {
  readonly name: string;
  readonly bounds: StructureRect;
  readonly pieces: readonly StructurePiece[];
  readonly sockets: readonly StructureSocket[];
}
export interface CompiledStructurePlan {
  readonly sockets: Readonly<Record<string, StructureSocket>>;
  appendSolids(x: number, z: number, baseY: number, out: [number, number][]): void;
  /** Inclusive integer levels; base Y is evaluated as level * pitch + floorOffset. */
  appendLevels(
    x: number,
    z: number,
    first: number,
    last: number,
    pitch: number,
    floorOffset: number,
    out: [number, number][],
  ): void;
}
export function compileStructurePlan(plan: StructurePlan): CompiledStructurePlan {
  // Validate once, before allocating the bounded tile index. Inputs are typed
  // authoring data, but numeric/domain mistakes still need useful diagnostics.
  const fail = (where: string, why: string): never => {
    throw new Error(`Structure ${plan.name || '<unnamed>'}: ${where}: ${why}`);
  };
  const finite = (n: number, where: string): void => {
    if (!Number.isFinite(n)) fail(where, 'must be finite');
  };
  const rect = (r: StructureRect, where: string): void => {
    if (![r.x0, r.x1, r.z0, r.z1].every(Number.isSafeInteger))
      fail(where, 'coordinates must be safe integers');
    if (r.x0 > r.x1 || r.z0 > r.z1) fail(where, 'bounds must be ordered and nonempty');
  };
  const within = (r: StructureRect): boolean =>
    r.x0 >= plan.bounds.x0 &&
    r.x1 <= plan.bounds.x1 &&
    r.z0 >= plan.bounds.z0 &&
    r.z1 <= plan.bounds.z1;
  if (!plan.name.trim()) fail('name', 'must be nonempty');
  rect(plan.bounds, 'bounds');
  const area = (plan.bounds.x1 - plan.bounds.x0 + 1) * (plan.bounds.z1 - plan.bounds.z0 + 1);
  if (!Number.isSafeInteger(area) || area > 65536)
    fail('bounds', 'local plans must fit in 65536 tiles');
  for (const [i, p] of plan.pieces.entries()) {
    const where = `piece ${i}`;
    rect(p.rect, where);
    if (!within(p.rect)) fail(where, 'rectangle exceeds plan bounds');
    if (p.kind === 'solid' || p.kind === 'opening') {
      finite(p.lo, where);
      finite(p.hi, where);
      if (p.lo >= p.hi) fail(where, 'interval must have lo < hi');
    } else if ('y' in p && (p.kind === 'slab' || p.kind === 'landing' || p.kind === 'flight')) {
      finite(p.y, where);
      finite(p.thickness, where);
      if (p.thickness <= 0) fail(where, 'thickness must be positive');
      if (p.kind === 'flight') {
        if (p.axis !== 'x' && p.axis !== 'z') fail(where, 'flight axis must be x or z');
        if (p.direction !== 1 && p.direction !== -1)
          fail(where, 'flight direction must be 1 or -1');
        if (!Number.isSafeInteger(p.start)) fail(where, 'flight start must be an integer');
        if (!Number.isSafeInteger(p.maxSteps) || p.maxSteps < 1)
          fail(where, 'flight maxSteps must be a positive integer');
        finite(p.rise, where);
        if (p.rise <= 0) fail(where, 'flight rise must be positive');
        const min = p.axis === 'x' ? p.rect.x0 : p.rect.z0;
        const max = p.axis === 'x' ? p.rect.x1 : p.rect.z1;
        if ((p.direction === 1 && p.start > min) || (p.direction === -1 && p.start < max))
          fail(where, 'flight start produces negative steps');
        finite(p.y + p.maxSteps * p.rise, where);
      }
      finite(p.y - p.thickness, where);
    } else fail(where, 'unknown piece kind');
  }
  const names = new Set<string>();
  for (const s of plan.sockets) {
    const where = `socket ${s.name}`;
    if (!s.name.trim()) fail(where, 'name must be nonempty');
    if (names.has(s.name)) fail(where, 'duplicate name');
    names.add(s.name);
    if (!['entry', 'room', 'door', 'bridge', 'utility', 'vertical'].includes(s.role))
      fail(where, 'unknown role');
    rect({ x0: s.x, x1: s.x, z0: s.z, z1: s.z }, where);
    if (!within({ x0: s.x, x1: s.x, z0: s.z, z1: s.z })) fail(where, 'outside plan bounds');
    finite(s.y, where);
  }
  const { x0, x1, z0, z1 } = plan.bounds;
  const width = x1 - x0 + 1;
  type Stamp = {
    one(baseY: number, out: [number, number][]): void;
    levels(
      first: number,
      last: number,
      pitch: number,
      floorOffset: number,
      out: [number, number][],
    ): void;
  };
  const columns: Stamp[][] = [];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const pieces = plan.pieces.filter(
        (p) => x >= p.rect.x0 && x <= p.rect.x1 && z >= p.rect.z0 && z <= p.rect.z1,
      );
      const openings = pieces
        .filter((p): p is StructureVolume => p.kind === 'opening')
        .map((p) => [p.lo, p.hi] as const)
        .sort((a, b) => a[0] - b[0]);
      const stamps: Stamp[] = [];
      for (const piece of pieces) {
        if (piece.kind === 'opening') continue;
        const emit: (base: number, lo: number, hi: number, out: [number, number][]) => void =
          openings.length
            ? (base, lo, hi, out) => {
                let cursor = lo;
                for (const [a, b] of openings) {
                  const start = base + a,
                    end = base + b;
                  if (end <= cursor) continue;
                  if (start >= hi) break;
                  if (start > cursor) out.push([cursor, start]);
                  cursor = Math.max(cursor, end);
                }
                if (cursor < hi) out.push([cursor, hi]);
              }
            : (_base, lo, hi, out) => {
                out.push([lo, hi]);
              };
        if ('lo' in piece) {
          // Solid/opening endpoints share the same base addition, so resolve
          // these cuts now rather than repeat subtraction on every storey.
          const intervals: [number, number][] = [];
          emit(0, piece.lo, piece.hi, intervals);
          for (const [lo, hi] of intervals)
            stamps.push({
              one(base, out) {
                out.push([base + lo, base + hi]);
              },
              levels(first, last, pitch, floorOffset, out) {
                for (let level = first; level <= last; level++) {
                  const base = level * pitch + floorOffset;
                  out.push([base + lo, base + hi]);
                }
              },
            });
        } else {
          const { y: offset, thickness } = piece;
          // Precompute only the tread delta, NEVER offset + delta: the base
          // addition must happen first to retain the authored float arithmetic.
          const steps =
            piece.kind === 'flight'
              ? Math.min(
                  piece.maxSteps,
                  piece.direction === 1
                    ? (piece.axis === 'x' ? x : z) - piece.start
                    : piece.start - (piece.axis === 'x' ? x : z),
                ) * piece.rise
              : undefined;
          stamps.push({
            one(base, out) {
              let y = base + offset;
              if (steps !== undefined) y += steps;
              if (openings.length) emit(base, y - thickness, y, out);
              else out.push([y - thickness, y]);
            },
            levels(first, last, pitch, floorOffset, out) {
              for (let level = first; level <= last; level++) {
                const base = level * pitch + floorOffset;
                let y = base + offset;
                if (steps !== undefined) y += steps;
                if (openings.length) emit(base, y - thickness, y, out);
                else out.push([y - thickness, y]);
              }
            },
          });
        }
      }
      columns.push(stamps);
    }
  return {
    sockets: Object.freeze(
      Object.fromEntries(plan.sockets.map((s) => [s.name, Object.freeze({ ...s })])),
    ),
    appendSolids(x, z, baseY, out) {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      for (const stamp of columns[(z - z0) * width + x - x0] ?? []) stamp.one(baseY, out);
    },
    appendLevels(x, z, first, last, pitch, floorOffset, out) {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      const stamps = columns[(z - z0) * width + x - x0];
      if (!stamps?.length) return;
      if (stamps.length === 1) stamps[0]!.levels(first, last, pitch, floorOffset, out);
      else
        for (let level = first; level <= last; level++) {
          for (const stamp of stamps) stamp.one(level * pitch + floorOffset, out);
        }
    },
  };
}
