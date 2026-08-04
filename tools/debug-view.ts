/**
 * Debug view — reproduce EXACTLY what the player saw from a DDSNAP
 * string (press P in-game to copy one).
 *
 *   npx tsx tools/debug-view.ts 'DDSNAP1{"seed":23677,...}' [out.png]
 *
 * Regenerates that world, builds the real renderer geometry headlessly,
 * and software-raycasts the player's exact camera view to an image:
 *   - surfaces shaded by orientation + distance
 *   - rays that hit NOTHING render MAGENTA — a magenta pixel is a hole
 * Also prints the column spans and slice classification around the
 * player's tile. One string from a playtest = a full local repro.
 */

/* eslint-disable no-console */
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

// three's TextureLoader needs a DOM — stub before the renderer loads
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }),
};
(globalThis as unknown as { self: unknown }).self = globalThis;

const THREE = await import('three');
const { generateWorld } = await import('../src/game/DungeonGenerator');
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const { tileBiome } = await import('../src/game/dungeon/cells');
const { TILE_SIZE, SKY_CEIL } = await import('../src/game/types');
const { sliceAt } = await import('../src/game/mapslice');
const { bridgeTiles } = await import('../src/game/dungeon/pillar-bridges');

// ── Parse ──

const arg = process.argv[2];
if (!arg || !arg.startsWith('DDSNAP1')) {
  console.error('usage: npx tsx tools/debug-view.ts \'DDSNAP1{"seed":...}\' [out.png]');
  process.exit(1);
}
const snap = JSON.parse(arg.slice('DDSNAP1'.length)) as {
  seed: number; stack: number; x: number; y: number; z: number; yaw: number; pitch: number;
  /** Window origin in pillar cells (endless world; absent = 0,0) */
  opx?: number; opz?: number;
  /** Click-marked world points — the exact geometry being reported */
  marks?: [number, number, number][];
};
const marks = snap.marks ?? [];
const outPath = process.argv[3] ?? '/tmp/debug-view.png';
console.log('snapshot:', snap);

// ── World + geometry ──

const world = generateWorld({ seed: snap.seed, stack: snap.stack, originPcx: snap.opx ?? 0, originPcz: snap.opz ?? 0 });
const L = world.levels[0]!;
const scene = new THREE.Scene();
new DungeonRenderer(scene).build(world);

// ── FACE DUMP: --faces lists every triangle near the first mark (or
// --faces=x,z for an explicit point) with its mesh, bounds, and
// authored normal — read the actual geometry instead of guessing. ──
const facesArg = process.argv.find((a) => a.startsWith('--faces'));
if (facesArg) {
  const coords = facesArg.includes('=')
    ? facesArg.split('=')[1]!.split(',').map(Number)
    : [marks[0]?.[0] ?? snap.x, marks[0]?.[2] ?? snap.z];
  const [fx, fz] = [coords[0]!, coords[1] ?? coords[0]!];
  const R = 2.0;
  console.log(`\nFACE DUMP around (${fx.toFixed(1)}, ${fz.toFixed(1)}) r=${R}:`);
  let meshIdx = 0;
  scene.traverse((o) => {
    const mesh = o as unknown as { isMesh?: boolean; geometry?: { getAttribute: (n: string) => { array: ArrayLike<number>; count: number } } };
    if (!mesh.isMesh || !mesh.geometry) { return; }
    const idx = meshIdx++;
    const g = mesh.geometry as unknown as {
      getAttribute: (n: string) => { array: ArrayLike<number>; count: number };
      index: { array: ArrayLike<number>; count: number } | null;
    };
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const count = g.index ? g.index.count : pos.count;
    const vAt = (k: number): number => (g.index ? (g.index.array[k]! as number) : k);
    for (let i = 0; i + 2 < count; i += 3) {
      const vs = [vAt(i), vAt(i + 1), vAt(i + 2)];
      const xs = vs.map((v) => pos.array[v * 3]! as number);
      const ys = vs.map((v) => pos.array[v * 3 + 1]! as number);
      const zs = vs.map((v) => pos.array[v * 3 + 2]! as number);
      if (Math.min(...xs) > fx + R || Math.max(...xs) < fx - R) continue;
      if (Math.min(...zs) > fz + R || Math.max(...zs) < fz - R) continue;
      const n = [nrm.array[vs[0]! * 3]!, nrm.array[vs[0]! * 3 + 1]!, nrm.array[vs[0]! * 3 + 2]!];
      console.log(
        `  m${idx} tri ${(i / 3) | 0}: `
        + xs.map((x, k) => `(${x.toFixed(2)},${ys[k]!.toFixed(2)},${zs[k]!.toFixed(2)})`).join(' ')
        + ` n(${(n as number[]).map((v) => v.toFixed(2)).join(',')})`,
      );
    }
  });
}

/** 9 position floats + 3 authored-normal floats (the renderer sets
 *  explicit normals and uses DoubleSide, so WINDING is meaningless —
 *  the authored normal is the only truth about which way a face looks) */
type Tri = number[];
const buckets = new Map<number, Tri[]>();
const bkey = (tx: number, tz: number) => tz * 4096 + tx;
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
    const nrm = g.getAttribute('normal');
    const j0 = idx.getX(i);
    t.push(nrm ? nrm.getX(j0) : 0, nrm ? nrm.getY(j0) : 0, nrm ? nrm.getZ(j0) : 0);
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

function cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { d: number; n: [number, number, number]; back: boolean } {
  const MAXD = 500; // long sightlines exist (colonnade arcades run through multiple pillar cells)
  const seen = new Set<number>();
  let best = Infinity;
  let bestTri: Tri | null = null;
  for (let d = 0; d <= MAXD; d += TILE_SIZE * 0.9) {
    const x = ox + dx * d, z = oz + dz * d;
    for (let bz = Math.floor(z / TILE_SIZE) - 1; bz <= Math.floor(z / TILE_SIZE) + 1; bz++) {
      for (let bx = Math.floor(x / TILE_SIZE) - 1; bx <= Math.floor(x / TILE_SIZE) + 1; bx++) {
        const k = bkey(bx, bz);
        if (seen.has(k)) continue;
        seen.add(k);
        const arr = buckets.get(k);
        if (!arr) continue;
        for (const t of arr) {
          const tt = hitTri(ox, oy, oz, dx, dy, dz, t);
          if (tt < best) { best = tt; bestTri = t; }
        }
      }
    }
    if (best < d + TILE_SIZE) break;
  }
  if (!bestTri) return { d: Infinity, n: [0, 0, 0], back: false };
  // The AUTHORED normal (winding is meaningless in this renderer)
  const n: [number, number, number] = [bestTri[9]!, bestTri[10]!, bestTri[11]!];
  const len = Math.hypot(...n) || 1;
  const nn: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
  // WRONG-SIDE hit: the surface's own normal points AWAY from the eye,
  // so we are looking at its back. DoubleSide renders it anyway, which
  // is exactly why missing/flipped walls never show up as holes.
  const back = nn[0] * dx + nn[1] * dy + nn[2] * dz > 0.05;
  return { d: best, n: nn, back };
}

// ── Render the exact camera view ──

const W = 480, H = 360;
const FOV = 75 * Math.PI / 180;
const tanY = Math.tan(FOV / 2);
const tanX = tanY * (W / H);
const eye = { x: snap.x, y: snap.y + 1.6, z: snap.z };
const cy = Math.cos(snap.yaw), sy = Math.sin(snap.yaw);
const cp = Math.cos(snap.pitch), sp = Math.sin(snap.pitch);
const fwd = [-sy * cp, sp, -cy * cp];
const right = [cy, 0, -sy];
const up = [
  right[1]! * fwd[2]! - right[2]! * fwd[1]!,
  right[2]! * fwd[0]! - right[0]! * fwd[2]!,
  right[0]! * fwd[1]! - right[1]! * fwd[0]!,
];

const img = new Uint8Array(W * H * 3);
let missPixels = 0;
let backPixels = 0;
const backSpots = new Map<string, number>();
// HOLE-ENTRY clustering: for each bad ray (miss or wrong-side), march
// the COLUMN MODEL to where the ray first crosses from data-air into
// data-solid — that boundary is where the missing face belongs. Hit
// points name where rays LAND; entry points name where they LEAK.
const entrySpots = new Map<string, number>();
const dataAir = (x: number, y: number, z: number): boolean => {
  const tx = Math.floor(x / TILE_SIZE);
  const tz = Math.floor(z / TILE_SIZE);
  if (tx < 0 || tz < 0 || tx >= L.width || tz >= L.height) return true;
  return world.columns[tz * L.width + tx]!.some((s) => s.floor < y && y < s.ceil);
};
const recordEntry = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number): void => {
  let wasAir = dataAir(ox, oy, oz);
  for (let t = 0.5; t < Math.min(maxD, 160); t += 0.5) {
    const inAir = dataAir(ox + dx * t, oy + dy * t, oz + dz * t);
    if (wasAir && !inAir) {
      const tx = Math.floor((ox + dx * t) / TILE_SIZE);
      const tz = Math.floor((oz + dz * t) / TILE_SIZE);
      const k = `${tx},${tz}`;
      entrySpots.set(k, (entrySpots.get(k) ?? 0) + 1);
      return;
    }
    wasAir = inAir;
  }
};
const BACKFACE_VIS = process.argv.includes('--backfaces');
// --ray=px,py: print EVERY triangle intersection along that pixel's ray
// (front/back, position, normal) — the single-ray microscope for
// junction leaks where face dumps and clustering aren't enough.
const rayArg = process.argv.find((a) => a.startsWith('--ray='));
if (rayArg) {
  const [rpx, rpy] = rayArg.slice(6).split(',').map(Number);
  const u = ((rpx ?? 0) / W) * 2 - 1;
  const v = 1 - ((rpy ?? 0) / H) * 2;
  let dx = fwd[0]! + u * tanX * right[0]! + v * tanY * up[0]!;
  let dy = fwd[1]! + u * tanX * right[1]! + v * tanY * up[1]!;
  let dz = fwd[2]! + u * tanX * right[2]! + v * tanY * up[2]!;
  const dl = Math.hypot(dx, dy, dz);
  dx /= dl; dy /= dl; dz /= dl;
  console.log(`RAY pixel(${rpx},${rpy}) origin(${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}) dir(${dx.toFixed(3)},${dy.toFixed(3)},${dz.toFixed(3)})`);
  const hits: { t: number; tri: Tri }[] = [];
  const seenB = new Set<number>();
  for (let d = 0; d <= 200; d += TILE_SIZE * 0.9) {
    const x = eye.x + dx * d, z = eye.z + dz * d;
    for (let bz = Math.floor(z / TILE_SIZE) - 1; bz <= Math.floor(z / TILE_SIZE) + 1; bz++) {
      for (let bx = Math.floor(x / TILE_SIZE) - 1; bx <= Math.floor(x / TILE_SIZE) + 1; bx++) {
        const k = bkey(bx, bz);
        if (seenB.has(k)) continue;
        seenB.add(k);
        for (const t of buckets.get(k) ?? []) {
          const tt = hitTri(eye.x, eye.y, eye.z, dx, dy, dz, t);
          if (Number.isFinite(tt)) hits.push({ t: tt, tri: t });
        }
      }
    }
  }
  hits.sort((a, b) => a.t - b.t);
  for (const { t, tri } of hits.slice(0, 20)) {
    const hx = eye.x + dx * t, hy = eye.y + dy * t, hz = eye.z + dz * t;
    const n = [tri[9]!, tri[10]!, tri[11]!];
    const nl2 = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const back = (n[0]! * dx + n[1]! * dy + n[2]! * dz) / nl2 > 0.05;
    console.log(`  t=${t.toFixed(2)} at(${hx.toFixed(2)},${hy.toFixed(2)},${hz.toFixed(2)}) n(${(n[0]! / nl2).toFixed(2)},${(n[1]! / nl2).toFixed(2)},${(n[2]! / nl2).toFixed(2)}) ${back ? 'BACK' : 'front'}`);
  }
}
for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const u = (px / W) * 2 - 1;
    const v = 1 - (py / H) * 2;
    let dx = fwd[0]! + u * tanX * right[0]! + v * tanY * up[0]!;
    let dy = fwd[1]! + u * tanX * right[1]! + v * tanY * up[1]!;
    let dz = fwd[2]! + u * tanX * right[2]! + v * tanY * up[2]!;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;
    const { d, n, back } = cast(eye.x, eye.y, eye.z, dx, dy, dz);
    const i = (py * W + px) * 3;
    if (!Number.isFinite(d)) {
      missPixels++;
      recordEntry(eye.x, eye.y, eye.z, dx, dy, dz, 160);
      img[i] = 255; img[i + 1] = 0; img[i + 2] = 255; // MAGENTA = hole/sky
      continue;
    }
    // Marked geometry TINTS red (small radius, shading preserved so
    // the marked shape stays readable — a solid blob hid it)
    const hx = eye.x + dx * d, hy = eye.y + dy * d, hz = eye.z + dz * d;
    let marked = false;
    for (const m of marks) {
      const md = (hx - m[0]) ** 2 + (hy - m[1]) ** 2 + (hz - m[2]) ** 2;
      if (md < 0.45 * 0.45) { marked = true; break; }
    }
    if (back) {
      backPixels++;
      const btx = Math.floor((eye.x + dx * d) / TILE_SIZE);
      const btz = Math.floor((eye.z + dz * d) / TILE_SIZE);
      const bk = `${btx},${btz}`;
      backSpots.set(bk, (backSpots.get(bk) ?? 0) + 1);
      recordEntry(eye.x, eye.y, eye.z, dx, dy, dz, d);
    }
    const light = 0.45 + 0.55 * Math.abs(n[0]! * 0.35 + n[1]! * 0.85 + n[2]! * 0.4);
    const fog = Math.max(0.25, 1 - d / 160);
    const base = 215 * light * fog;
    // tint: floors warm, ceilings cool, walls neutral. NOTE: the
    // renderer's horizontal quads wind clockwise-from-above, so their
    // GEOMETRIC normal points down for floors — invert accordingly.
    const upness = n[1]!;
    const r = upness > 0.5 ? base : upness < -0.5 ? base * 0.8 : base * 0.95;
    const g = base * 0.92;
    const b = upness < -0.5 ? base : base * 0.85;
    if (BACKFACE_VIS && back) {
      // Backfaces render CYAN: you are seeing the inside of a surface,
      // i.e. a missing/flipped wall (DoubleSide hides this in-game)
      img[i] = 0; img[i + 1] = Math.min(255, 120 + base * 0.5); img[i + 2] = Math.min(255, 160 + base * 0.4);
    } else if (marked) {
      img[i] = Math.min(255, r * 0.45 + 150);
      img[i + 1] = g * 0.35;
      img[i + 2] = b * 0.35;
    } else {
      img[i] = r; img[i + 1] = g; img[i + 2] = b;
    }
  }
}
const ppm = outPath.replace(/\.png$/, '.ppm');
writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(img)]));
try {
  execSync(`magick ${ppm} ${outPath} 2>/dev/null || convert ${ppm} ${outPath}`);
  console.log(`view rendered: ${outPath} (missPixels=${missPixels} magenta=nothing hit; backfacePixels=${backPixels}${BACKFACE_VIS ? ' shown CYAN' : ' — rerun with --backfaces to see them'})`);
  if (entrySpots.size > 0) {
    const top = [...entrySpots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log('LEAK ENTRY tiles (where bad rays first crossed data-air → data-solid — the missing face lives here):');
    for (const [k, count] of top) {
      const [tx, tz] = k.split(',').map(Number);
      console.log(`  tile(${tx},${tz}) ${count} rays  world(${(tx! * TILE_SIZE + 1.5).toFixed(1)}, ${(tz! * TILE_SIZE + 1.5).toFixed(1)})`);
    }
  }
} catch {
  console.log(`view rendered: ${ppm} (PPM; install ImageMagick for PNG) missPixels=${missPixels}`);
}

// ── HOLE AUTO-LOCATE: march each missed ray and report where it left
// the air (the boundary it slipped through). No mark needed. ──

if (missPixels > 0) {
  const holeAt = new Map<string, number>();
  let skyExits = 0;
  for (let py = 0; py < H; py += 2) {
    for (let px = 0; px < W; px += 2) {
      const u = (px / W) * 2 - 1;
      const v = 1 - (py / H) * 2;
      let dx = fwd[0]! + u * tanX * right[0]! + v * tanY * up[0]!;
      let dy = fwd[1]! + u * tanX * right[1]! + v * tanY * up[1]!;
      let dz = fwd[2]! + u * tanX * right[2]! + v * tanY * up[2]!;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      if (Number.isFinite(cast(eye.x, eye.y, eye.z, dx, dy, dz).d)) continue;
      let prev = '';
      for (let d = 0.5; d < 300; d += 0.25) {
        const wx = eye.x + dx * d, wy = eye.y + dy * d, wz = eye.z + dz * d;
        const tx = Math.floor(wx / TILE_SIZE);
        const tz = Math.floor(wz / TILE_SIZE);
        if (tx < 0 || tz < 0 || tx >= L.width || tz >= L.height) { skyExits++; break; }
        const spans = world.columns[tz * L.width + tx]!;
        const top = spans[spans.length - 1];
        if (top && top.ceil >= SKY_CEIL && wy > top.floor - 0.2) { skyExits++; break; }
        const inAir = spans.some((s2) => wy >= s2.floor - 0.01 && wy <= s2.ceil + 0.01);
        const key = `${tx},${tz}`;
        if (!inAir) {
          if (prev) holeAt.set(`${prev} -> ${key} @y=${wy.toFixed(1)}`, (holeAt.get(`${prev} -> ${key} @y=${wy.toFixed(1)}`) ?? 0) + 1);
          break;
        }
        prev = key;
      }
    }
  }
  const top = [...holeAt.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 6);
  if (top.length > 0) {
    console.log(`\nHOLES (rays leaving air; ${skyExits} legit sky exits):`);
    for (const [k, n] of top) console.log(`  ${n}x  ${k}`);
  }
}

// ── Wrong-side hotspots: seeing the BACK of a surface means a
// missing or flipped face there (DoubleSide renders it regardless) ──

if (backPixels > 0) {
  const top = [...backSpots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`\nWRONG-SIDE hotspots (${backPixels} px):`);
  for (const [k, n] of top) {
    const [btx, btz] = k.split(',').map(Number);
    console.log(`  tile(${k}) ${n}px tile=${L.tiles[btz!]?.[btx!]}${L.pillarWall[btz!]?.[btx!] ? 'P' : ''}` +
      ` biome=${tileBiome(L.cellBiomes, btx!, btz!) ?? 'tunnel'}` +
      ` ceil=${L.ceilingHeights[btz!]?.[btx!]?.toFixed(1)}`);
  }
}

// ── Data under each mark ──

for (let mi = 0; mi < marks.length; mi++) {
  const [mx, my, mz] = marks[mi]!;
  const mtx = Math.floor(mx / TILE_SIZE);
  const mtz = Math.floor(mz / TILE_SIZE);
  const spans = world.columns[mtz * L.width + mtx] ?? [];
  console.log(`\nMARK ${mi + 1} @ (${mx},${my},${mz}) tile(${mtx},${mtz})` +
    ` tile=${L.tiles[mtz]?.[mtx]}${L.pillarWall[mtz]?.[mtx] ? 'P' : ''}` +
    ` biome=${tileBiome(L.cellBiomes, mtx, mtz) ?? 'tunnel'}` +
    ` ceil=${L.ceilingHeights[mtz]?.[mtx]?.toFixed(1)} floor=${L.floorHeights[mtz]?.[mtx]?.toFixed(1)}`);
  console.log(`  spans: ${spans.map((s) =>
    `${s.floor <= -1e8 ? 'ABYSS' : s.floor.toFixed(1)}..${s.ceil >= SKY_CEIL ? 'SKY' : s.ceil.toFixed(1)}(${s.owner},${s.ceilOwner})`).join(' ') || '(solid)'}`);
  console.log(`  slice@markY: ${JSON.stringify(sliceAt(spans, my))}`);
  for (const br of world.bridges.filter((candidate) =>
    bridgeTiles(candidate).some((t) => t.tx === mtx && t.tz === mtz))) {
    const receivingCx = br.dir === 'east' ? br.cx + 1 : br.cx;
    const receivingCz = br.dir === 'south' ? br.cz + 1 : br.cz;
    const receiving = world.pillars.get(`${receivingCx},${receivingCz}`);
    console.log(
      `  bridge: owner(${br.cx},${br.cz}) ${br.dir} `
      + `${br.yA.toFixed(1)}..${br.yB.toFixed(1)} pipe=${br.pipe} `
      + `receiving=${receiving ? `${receiving.cx},${receiving.cz}` : 'missing'}`,
    );
  }
  // ── GAP AUDIT at the mark: for each of the 4 tile-boundary planes
  // through this point, list the vertical coverage of the geometry on
  // it vs the range that MUST be sealed (one side air, other solid).
  // A mark on a slit lands straight on the missing interval. ──
  let sealedCount = 0;
  // Scan the 3x3 neighborhood: a mark on a shared corner belongs to
  // several tiles at once, and the slit may be on any of their planes
  for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const)
  for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
    const mtx2 = mtx + ox;
    const mtz2 = mtz + oz;
    const nx = mtx2 + dx;
    const nz = mtz2 + dz;
    if (mtx2 < 0 || mtz2 < 0 || mtx2 >= L.width || mtz2 >= L.height) continue;
    if (nx < 0 || nz < 0 || nx >= L.width || nz >= L.height) continue;
    const A = world.columns[mtz2 * L.width + mtx2] ?? [];
    const B = world.columns[nz * L.width + nx] ?? [];
    const mtxL = mtx2, mtzL = mtz2;
    const clip = (y: number): number => (y >= SKY_CEIL ? 92 : y <= -1e8 ? -24 : y);
    const inAir = (sp: typeof A, y: number): boolean =>
      sp.some((s) => clip(s.floor) <= y && y <= clip(s.ceil));
    // required: ranges where exactly one side is air
    const marks2: number[] = [];
    for (const sp of [A, B]) for (const s of sp) { marks2.push(clip(s.floor), clip(s.ceil)); }
    marks2.push(0, 92);
    marks2.sort((p2, q2) => p2 - q2);
    const need: [number, number][] = [];
    for (let i2 = 0; i2 + 1 < marks2.length; i2++) {
      const lo = marks2[i2]!, hi = marks2[i2 + 1]!;
      if (hi - lo < 0.05) continue;
      const mid2 = (lo + hi) / 2;
      if (inAir(A, mid2) !== inAir(B, mid2)) {
        const prev = need[need.length - 1];
        if (prev && Math.abs(prev[1] - lo) < 0.05) prev[1] = hi;
        else need.push([lo, hi]);
      }
    }
    if (need.length === 0) continue;
    // 2D coverage on that plane: a slit can be half a tile WIDE at
    // full height, so Y-only merging misses it. Sample the (along, y)
    // rectangle and point-test the plane's triangles.
    const planeX = dx !== 0 ? (mtxL + 1) * TILE_SIZE : null;
    const planeZ = dz !== 0 ? (mtzL + 1) * TILE_SIZE : null;
    const lo2 = (planeX !== null ? mtzL : mtxL) * TILE_SIZE;
    const hi2 = lo2 + TILE_SIZE;
    const planeTris: number[][] = [];
    for (const arr of buckets.values()) {
      for (const t of arr) {
        const onPlane = planeX !== null
          ? [0, 3, 6].every((o) => Math.abs(t[o]! - planeX) < 0.02)
          : [2, 5, 8].every((o) => Math.abs(t[o]! - planeZ!) < 0.02);
        if (!onPlane) continue;
        const along = planeX !== null ? [t[2]!, t[5]!, t[8]!] : [t[0]!, t[3]!, t[6]!];
        if (Math.max(...along) <= lo2 - 0.05 || Math.min(...along) >= hi2 + 0.05) continue;
        planeTris.push([along[0]!, t[1]!, along[1]!, t[4]!, along[2]!, t[7]!]);
      }
    }
    const covers = (a: number, y: number): boolean => {
      for (const t of planeTris) {
        const d1 = (a - t[2]!) * (t[1]! - t[3]!) - (t[0]! - t[2]!) * (y - t[3]!);
        const d2 = (a - t[4]!) * (t[3]! - t[5]!) - (t[2]! - t[4]!) * (y - t[5]!);
        const d3 = (a - t[0]!) * (t[5]! - t[1]!) - (t[4]! - t[0]!) * (y - t[1]!);
        const hasNeg = d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6;
        const hasPos = d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6;
        if (!(hasNeg && hasPos)) return true;
      }
      return false;
    };
    const gaps: string[] = [];
    for (const [nlo, nhi] of need) {
      let aMin = Infinity, aMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      let miss = 0, tot = 0;
      for (let a = lo2 + 0.15; a < hi2; a += 0.3) {
        for (let y = nlo + 0.15; y < nhi; y += 0.5) {
          tot++;
          if (covers(a, y)) continue;
          miss++;
          aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
          yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
        }
      }
      if (miss === 0) continue;
      // A plane gap is only a REAL hole if you can see through it: a
      // chamfered corner legitimately sets its surface back onto a
      // diagonal inside the wall tile. Probe perpendicular rays through
      // the uncovered area and keep only those that pass clean through.
      let seeThrough = 0;
      const aM = (aMin + aMax) / 2;
      for (let y = yMin; y <= yMax; y += Math.max(0.5, (yMax - yMin) / 8)) {
        // Start on whichever side is actually AIR at this height and
        // cast toward the solid side. (Starting inside the rock reports
        // phantom holes: a chamfer diagonal sits set back INSIDE the
        // wall tile, so a ray launched past it hits nothing.)
        const aOpen = inAir(A, y);
        const sign = aOpen ? 1 : -1; // A is the -x/-z side of the plane
        const px2 = planeX !== null ? planeX - sign * 0.6 : aM;
        const pz2 = planeZ !== null ? planeZ - sign * 0.6 : aM;
        const r2 = cast(px2, y, pz2,
          planeX !== null ? sign : 0, 0, planeZ !== null ? sign : 0);
        if (!Number.isFinite(r2.d) || r2.d > 4) seeThrough++;
      }
      if (seeThrough > 0) {
        gaps.push(`${Math.round(100 * miss / tot)}% of ${nlo.toFixed(1)}..${nhi.toFixed(1)}` +
          ` at along[${aMin.toFixed(1)}..${aMax.toFixed(1)}] y[${yMin.toFixed(1)}..${yMax.toFixed(1)}]` +
          ` SEE-THROUGH(${seeThrough})`);
      }
    }
    if (gaps.length === 0) { sealedCount++; continue; }
    const dir = planeX !== null ? `x=${planeX}` : `z=${planeZ}`;
    console.log(`  *** UNSEALED ${dir} tile(${mtxL},${mtzL})|(${nx},${nz}): ${gaps.join(' ; ')}` +
      ` (need ${need.map((n2) => `${n2[0].toFixed(1)}..${n2[1].toFixed(1)}`).join(' ')})`);
  }
  console.log(`  boundary planes checked near mark: ${sealedCount} sealed`);
  {
    // Probe from the eye toward the mark: what do we actually see there?
    let ddx = mx - eye.x, ddy = my - eye.y, ddz = mz - eye.z;
    const dl = Math.hypot(ddx, ddy, ddz) || 1;
    ddx /= dl; ddy /= dl; ddz /= dl;
    const r = cast(eye.x, eye.y, eye.z, ddx, ddy, ddz);
    console.log(`  seen-from-eye: ${Number.isFinite(r.d) ? `d=${r.d.toFixed(1)} n=(${r.n.map((v) => v.toFixed(2)).join(',')}) ${r.back ? 'WRONG-SIDE (seeing this surface\'s back — missing or flipped face)' : 'front'}` : 'NOTHING HIT'}`);
  }
  if (L.pillarWall[mtz]?.[mtx]) {
    const pcx = Math.floor(mtx / 56);
    const pcz = Math.floor(mtz / 56);
    const spec = world.pillars.get(`${pcx},${pcz}`);
    if (spec) {
      console.log(`  pillar (${pcx},${pcz}) h=${spec.totalHeight} local(${mtx - pcx * 56},${mtz - pcz * 56}) chunks: ${spec.chunks.map((c) => `${c.def.id}@${c.baseY}r${c.rotation}`).join(' ')}`);
    }
  }
}

// ── Local world data at the player ──

const tx = Math.floor(snap.x / TILE_SIZE);
const tz = Math.floor(snap.z / TILE_SIZE);
console.log(`\nplayer tile (${tx},${tz}) biome=${tileBiome(L.cellBiomes, tx, tz) ?? 'tunnel'} feetY=${snap.y}`);
for (let dz = -1; dz <= 1; dz++) {
  let row = '';
  for (let dx = -1; dx <= 1; dx++) {
    const nx = tx + dx, nz = tz + dz;
    if (nx < 0 || nz < 0 || nx >= L.width || nz >= L.height) { row += ' [oob]'; continue; }
    const spans = world.columns[nz * L.width + nx]!;
    const slice = sliceAt(spans, snap.y);
    row += ` [${nx},${nz} ${L.tiles[nz]![nx]}${L.pillarWall[nz]![nx] ? 'P' : ''} ${slice.kind} | ${spans.map((s) =>
      `${s.floor <= -1e8 ? 'ABYSS' : s.floor.toFixed(1)}..${s.ceil >= SKY_CEIL ? 'SKY' : s.ceil.toFixed(1)}(${s.owner},${s.ceilOwner})`).join(' ')}]`;
  }
  console.log(row);
}
