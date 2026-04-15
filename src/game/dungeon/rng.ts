/**
 * Deterministic seeded RNG — copied from runGame Blame procgen.ts
 *
 * cellSeed: FNV-1a hash producing a unique seed per cell per layer (via salt)
 * mulberry32: Fast 32-bit PRNG seeded from cellSeed output
 */

export function cellSeed(cx: number, cz: number, worldSeed: number, salt: number): number {
  let h = (2166136261 ^ salt ^ worldSeed) >>> 0;
  h = Math.imul(h ^ cx, 16777619) >>> 0;
  h = Math.imul(h ^ cz, 16777619) >>> 0;
  h = Math.imul(h ^ (cx * 31 + cz * 17), 16777619) >>> 0;
  return h;
}

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
