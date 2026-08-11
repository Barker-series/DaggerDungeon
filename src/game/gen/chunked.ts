/**
 * Minimal LayerProcGen runtime — layer/chunk pairs with declared
 * dependencies (docs/layerprocgen/PRINCIPLES.md rules 1-6).
 *
 * - Each layer is a grid of chunks keyed by ABSOLUTE chunk coords
 *   (chunk size = one pillar cell, 56 tiles, for every tile-scale
 *   layer here; coarser planning stays pure functions with no store).
 * - A layer declares its providers ONCE with world-space (tile)
 *   padding. ensure() generates provider chunks recursively BEFORE a
 *   chunk's create() runs; a read that finds a missing provider chunk
 *   is a loud error, never a silent fallback.
 * - Chunks live while something keeps them (release() recycles all
 *   chunks outside kept bounds). The worker holds layers across
 *   requests, so a moving window regenerates only what it lacks.
 */

export interface ChunkBounds {
  /** Absolute tile bounds, inclusive x0/z0, exclusive x1/z1 */
  tx0: number; tz0: number; tx1: number; tz1: number;
}

export abstract class ChunkedLayer<T> {
  readonly name: string;
  /** Chunk size in tiles (square). */
  readonly chunkTiles: number;
  private readonly chunks = new Map<string, T>();
  private readonly deps: { layer: ChunkedLayer<unknown>; padTiles: number }[] = [];

  constructor(name: string, chunkTiles: number) {
    this.name = name;
    this.chunkTiles = chunkTiles;
  }

  /** Declare a provider layer with world-space padding (rule 4/5):
   *  padTiles must be ≥ the max effect distance of any pass in this
   *  layer that reads the provider. */
  protected dependsOn(layer: ChunkedLayer<unknown>, padTiles: number): void {
    this.deps.push({ layer, padTiles });
  }

  /** Generate every chunk overlapping the given absolute tile bounds
   *  (providers first, recursively). */
  ensure(b: ChunkBounds): void {
    const c0x = Math.floor(b.tx0 / this.chunkTiles);
    const c0z = Math.floor(b.tz0 / this.chunkTiles);
    const c1x = Math.ceil(b.tx1 / this.chunkTiles);
    const c1z = Math.ceil(b.tz1 / this.chunkTiles);
    for (let cz = c0z; cz < c1z; cz++) {
      for (let cx = c0x; cx < c1x; cx++) {
        const key = `${cx},${cz}`;
        if (this.chunks.has(key)) continue;
        const tx0 = cx * this.chunkTiles;
        const tz0 = cz * this.chunkTiles;
        for (const d of this.deps) {
          d.layer.ensure({
            tx0: tx0 - d.padTiles,
            tz0: tz0 - d.padTiles,
            tx1: tx0 + this.chunkTiles + d.padTiles,
            tz1: tz0 + this.chunkTiles + d.padTiles,
          });
        }
        this.chunks.set(key, this.create(cx, cz));
      }
    }
  }

  /** Chunk by absolute chunk coords. Loud when missing — a missing
   *  provider means a padding bug, never something to paper over. */
  get(cx: number, cz: number): T {
    const c = this.chunks.get(`${cx},${cz}`);
    if (c === undefined) {
      throw new Error(
        `[gen] ${this.name}: missing chunk (${cx},${cz}) — `
        + 'a dependency padding is smaller than an effect distance');
    }
    return c;
  }

  /** Drop every chunk fully outside the kept bounds. */
  release(keep: ChunkBounds): void {
    for (const key of this.chunks.keys()) {
      const comma = key.indexOf(',');
      const cx = Number(key.slice(0, comma));
      const cz = Number(key.slice(comma + 1));
      const tx0 = cx * this.chunkTiles;
      const tz0 = cz * this.chunkTiles;
      if (tx0 + this.chunkTiles <= keep.tx0 || tx0 >= keep.tx1
        || tz0 + this.chunkTiles <= keep.tz0 || tz0 >= keep.tz1) {
        this.chunks.delete(key);
      }
    }
  }

  chunkCount(): number {
    return this.chunks.size;
  }

  /** Drop every chunk (generation config changed for this layer). */
  clearAll(): void {
    this.chunks.clear();
  }

  protected abstract create(cx: number, cz: number): T;
}

/** Copy a rectangular region assembled from per-chunk 2D grids into
 *  one working array. `field` extracts a chunk's core grid (chunk-local
 *  [z][x], chunkTiles²); `fill` is used outside any... never: bounds
 *  must be covered by ensured chunks — missing chunks throw via get(). */
export function assembleGrid<T, C>(
  layer: ChunkedLayer<C>,
  field: (chunk: C) => T[][],
  b: ChunkBounds,
): T[][] {
  const w = b.tx1 - b.tx0;
  const h = b.tz1 - b.tz0;
  const out: T[][] = new Array(h);
  for (let z = 0; z < h; z++) out[z] = new Array(w) as T[];
  const ct = layer.chunkTiles;
  const c0x = Math.floor(b.tx0 / ct);
  const c0z = Math.floor(b.tz0 / ct);
  const c1x = Math.ceil(b.tx1 / ct);
  const c1z = Math.ceil(b.tz1 / ct);
  for (let cz = c0z; cz < c1z; cz++) {
    for (let cx = c0x; cx < c1x; cx++) {
      const grid = field(layer.get(cx, cz));
      const gx0 = Math.max(b.tx0, cx * ct);
      const gz0 = Math.max(b.tz0, cz * ct);
      const gx1 = Math.min(b.tx1, (cx + 1) * ct);
      const gz1 = Math.min(b.tz1, (cz + 1) * ct);
      for (let tz = gz0; tz < gz1; tz++) {
        const src = grid[tz - cz * ct]!;
        const dst = out[tz - b.tz0]!;
        for (let tx = gx0; tx < gx1; tx++) {
          dst[tx - b.tx0] = src[tx - cx * ct]!;
        }
      }
    }
  }
  return out;
}
