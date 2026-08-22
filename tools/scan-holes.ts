/**
 * Hole sweep — hunt see-through geometry across whole worlds, without
 * needing anyone to stand in the right place.
 *
 *   npx tsx tools/scan-holes.ts [seed ...]
 *
 * Samples many player-eye positions per seed, fires a hemisphere of
 * rays from each, and reports any ray that leaves the world's air
 * WITHOUT exiting through open sky. Those are real holes: with
 * DoubleSide materials they show in game as a see-through slit or the
 * back of distant geometry.
 */

/* eslint-disable no-console */
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }),
};
(globalThis as unknown as { self: unknown }).self = globalThis;

const THREE = await import('three');
const { generateWorld } = await import('../src/game/DungeonGenerator');
// --tunables=key=val,key=val — apply live gen tunables before generating
{
  const tunArg = process.argv.find((a) => a.startsWith('--tunables='));
  if (tunArg) {
    const { applyTunables } = await import('../src/game/dungeon/tunables');
    const vals: Record<string, number> = {};
    for (const kv of tunArg.slice('--tunables='.length).split(',')) {
      const [k, v] = kv.split('=');
      if (k && v !== undefined) vals[k] = Number(v);
    }
    applyTunables(vals as never);
    console.log('tunables:', vals);
  }
}
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const { TileType, TILE_SIZE, SKY_CEIL } = await import('../src/game/types');

const seeds = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number).filter((n) => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : [1, 42, 889549, 1784949147155];

/** Ray directions: a hemisphere biased upward (where seams live) */
const DIRS: [number, number, number][] = [];
for (let i = 0; i < 12; i++) {
  const az = (i / 12) * Math.PI * 2;
  for (const el of [-0.35, 0, 0.3, 0.7, 1.1]) {
    DIRS.push([Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)]);
  }
}

let totalHoles = 0;

for (const seed of SEEDS) {
  const world = generateWorld({ seed, stack: 1 });
  const L = world.levels[0]!;
  const scene = new THREE.Scene();
  new DungeonRenderer(scene).build(world);

  type Tri = number[];
  const buckets = new Map<number, Tri[]>();
  const bkey = (tx: number, tz: number): number => tz * 4096 + tx;
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as InstanceType<typeof THREE.BufferGeometry>;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    if (!pos || !idx) return;
    for (let i = 0; i + 2 < idx.count; i += 3) {
      const t: number[] = [];
      for (let k = 0; k < 3; k++) {
        const j = idx.getX(i + k);
        t.push(pos.getX(j), pos.getY(j), pos.getZ(j));
      }
      const minTx = Math.floor(Math.min(t[0]!, t[3]!, t[6]!) / TILE_SIZE);
      const maxTx = Math.floor(Math.max(t[0]!, t[3]!, t[6]!) / TILE_SIZE);
      const minTz = Math.floor(Math.min(t[2]!, t[5]!, t[8]!) / TILE_SIZE);
      const maxTz = Math.floor(Math.max(t[2]!, t[5]!, t[8]!) / TILE_SIZE);
      for (let bz = minTz; bz <= maxTz; bz++) {
        for (let bx = minTx; bx <= maxTx; bx++) {
          const k = bkey(bx, bz);
          let arr = buckets.get(k);
          if (!arr) { arr = []; buckets.set(k, arr); }
          arr.push(t);
        }
      }
    }
  });

  function hitTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: Tri): number {
    const e1x = t[3]! - t[0]!, e1y = t[4]! - t[1]!, e1z = t[5]! - t[2]!;
    const e2x = t[6]! - t[0]!, e2y = t[7]! - t[1]!, e2z = t[8]! - t[2]!;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) return Infinity;
    const inv = 1 / det;
    const sx = ox - t[0]!, sy = oy - t[1]!, sz = oz - t[2]!;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return Infinity;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return Infinity;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 1e-4 ? tt : Infinity;
  }

  /** Does this ray hit geometry before leaving the air (or reaching sky)? */
  function escapes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): string | null {
    const MAXD = 220;
    const seen = new Set<number>();
    let best = Infinity;
    let prev = '';
    for (let d = 0; d <= MAXD; d += 0.5) {
      const x = ox + dx * d, y = oy + dy * d, z = oz + dz * d;
      const tx = Math.floor(x / TILE_SIZE);
      const tz = Math.floor(z / TILE_SIZE);
      if (tx < 0 || tz < 0 || tx >= L.width || tz >= L.height) return null; // left the map
      // geometry check for this bucket
      for (let bz = tz - 1; bz <= tz + 1; bz++) {
        for (let bx = tx - 1; bx <= tx + 1; bx++) {
          const k = bkey(bx, bz);
          if (seen.has(k)) continue;
          seen.add(k);
          const arr = buckets.get(k);
          if (!arr) continue;
          for (const t of arr) best = Math.min(best, hitTri(ox, oy, oz, dx, dy, dz, t));
        }
      }
      if (best < d + 0.75) return null; // blocked by geometry
      const spans = world.columns[tz * L.width + tx]!;
      const top = spans[spans.length - 1];
      if (top && top.ceil >= SKY_CEIL && y > top.floor - 0.2) return null; // open sky
      if (!spans.some((s) => y >= s.floor - 0.01 && y <= s.ceil + 0.01)) {
        return `${prev} -> ${tx},${tz} @y=${y.toFixed(1)}`;
      }
      prev = `${tx},${tz}`;
    }
    return null;
  }

  // Sample standable positions across the map
  const holes = new Map<string, number>();
  let origins = 0;
  let rays = 0;
  for (let tz = 3; tz < L.height - 3; tz += 5) {
    for (let tx = 3; tx < L.width - 3; tx += 5) {
      if (L.tiles[tz]![tx] === TileType.Wall) continue;
      const f = L.floorHeights[tz]![tx]!;
      if (f <= -900) continue;
      // The eye must be in AIR per the column model: a tile buried under
      // generated mass (fold structures) is not a standable origin — an
      // origin inside solid makes every ray "escape" (false positives)
      const col = world.columns[tz * L.width + tx]!;
      if (!col.some((s) => s.floor <= f + 0.05 && s.ceil >= f + 1.8)) continue;
      origins++;
      const ox = (tx + 0.5) * TILE_SIZE;
      const oz = (tz + 0.5) * TILE_SIZE;
      const oy = f + 1.6;
      for (const [dx, dy, dz] of DIRS) {
        rays++;
        const esc = escapes(ox, oy, oz, dx, dy, dz);
        if (esc) holes.set(esc, (holes.get(esc) ?? 0) + 1);
      }
    }
  }
  let count = 0;
  for (const n of holes.values()) count += n;
  totalHoles += count;
  console.log(`seed ${seed}: origins=${origins} rays=${rays} escapedRays=${count}`);
  for (const [k, n] of [...holes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${n}x  ${k}`);
  }
}

console.log(totalHoles === 0 ? 'NO HOLES FOUND' : `${totalHoles} escaping rays`);
process.exit(totalHoles === 0 ? 0 : 1);
