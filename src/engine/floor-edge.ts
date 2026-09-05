/** A vertical face between two DRAWN floor-edge profiles. The profiles may
 *  meet, reverse order, or cross; raw tile heights cannot decide the face. */
export interface FloorEdgeSegment {
  start: number;
  end: number;
  lo0: number;
  lo1: number;
  hi0: number;
  hi1: number;
  towardA: boolean;
}

export function floorEdgeSegments(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): FloorEdgeSegment[] {
  const d0 = b0 - a0;
  const d1 = b1 - a1;
  const cuts = [0, 1];
  if (d0 * d1 < 0) cuts.splice(1, 0, d0 / (d0 - d1));
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const out: FloorEdgeSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const as = lerp(a0, a1, start),
      ae = lerp(a0, a1, end);
    const bs = lerp(b0, b1, start),
      be = lerp(b0, b1, end);
    if (Math.max(Math.abs(bs - as), Math.abs(be - ae)) < 1e-6) continue;
    out.push({
      start,
      end,
      lo0: Math.min(as, bs),
      lo1: Math.min(ae, be),
      hi0: Math.max(as, bs),
      hi1: Math.max(ae, be),
      towardA: lerp(d0, d1, (start + end) / 2) > 0,
    });
  }
  return out;
}
