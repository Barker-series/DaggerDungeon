/** Software preview using the SAME exported taps as the GLSL reference tests.
 * Run: npx tsx tools/preview-texture-repetition.ts. No browser or network needed.
 * Bilinear, linear-light RGB + linear alpha; prefiltered 128px source level.
 * This is an albedo/height comparison, NOT an in-engine lighting/FPS claim.
 */
import { sourceSampleTaps } from '../src/engine/SourceSampling';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = 'docs/previews/texture-repetition';
mkdirSync(out, { recursive: true });
const roles = ['concrete-wall', 'concrete-floor', 'painted-metal', 'rusted-metal'];
const W = 768,
  H = 256,
  N = 128,
  stride = W * 2;
const image = Buffer.alloc(stride * H * roles.length * 3),
  relief = Buffer.alloc(image.length);
const run = (args: string[], input?: Buffer) => {
  const r = spawnSync('magick', args, { input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw Error(r.stderr.toString());
  return r.stdout;
};
const srgb = (v: number) =>
  Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
const metrics: any[] = [];
for (const [row, role] of roles.entries()) {
  const path = `public/textures/source/${role}-packed.webp`;
  const rgb = run([
    path,
    '-alpha',
    'off',
    '-colorspace',
    'RGB',
    '-resize',
    `${N}x${N}!`,
    '-depth',
    '16',
    '-endian',
    'LSB',
    'rgb:-',
  ]);
  const height = run([
    path,
    '-alpha',
    'extract',
    '-resize',
    `${N}x${N}!`,
    '-depth',
    '16',
    '-endian',
    'LSB',
    'gray:-',
  ]);
  const read = (x: number, y: number, c: number) => {
    const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
    return (c === 3 ? height.readUInt16LE(i * 2) : rgb.readUInt16LE((i * 3 + c) * 2)) / 65535;
  };
  const sample = (u: number, v: number, c: number) => {
    const x = u * N - 0.5,
      y = v * N - 0.5,
      ix = Math.floor(x),
      iy = Math.floor(y),
      f = x - ix,
      g = y - iy;
    return (
      (read(ix, iy, c) * (1 - f) + read(ix + 1, iy, c) * f) * (1 - g) +
      (read(ix, iy + 1, c) * (1 - f) + read(ix + 1, iy + 1, c) * f) * g
    );
  };
  const stochastic = (u: number, v: number, c: number) =>
    sourceSampleTaps(u, v).reduce(
      (s, t) => s + t.weight * sample(u + t.offset[0], v + t.offset[1], c),
      0,
    );
  const a: number[] = [],
    b: number[] = [],
    shifted: number[] = [],
    oldShifted: number[] = [];
  let oldSeam = 0,
    newSeam = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / 64 - 3.7,
        v = y / 64 - 1.3;
      for (let c = 0; c < 4; c++) {
        const before = sample(u, v, c),
          after = stochastic(u, v, c);
        const i = ((row * H + y) * stride + x) * 3;
        if (c < 3) {
          image[i + c] = srgb(before);
          image[i + W * 3 + c] = srgb(after);
        } else
          for (let k = 0; k < 3; k++) {
            relief[i + k] = Math.round(before * 255);
            relief[i + W * 3 + k] = Math.round(after * 255);
          }
        if (c === 1 && x % 4 === 0 && y % 4 === 0) {
          a.push(before);
          b.push(after);
          shifted.push(stochastic(u + 1, v, c));
          oldShifted.push(sample(u + 1, v, c));
        }
      }
    }
  for (let i = 0; i < 100; i++) {
    const v = i * 0.047;
    oldSeam += Math.abs(sample(0.75 - 1e-7, v, 1) - sample(1e-7, v, 1));
    newSeam += Math.abs(stochastic(0.75 - 1e-7, v, 1) - stochastic(0.75 + 1e-7, v, 1));
  }
  const mean = (a: number[]) => a.reduce((a, b) => a + b, 0) / a.length;
  const variance = (a: number[]) => {
    const m = mean(a);
    return mean(a.map((v) => (v - m) ** 2));
  };
  const corr = (a: number[], b: number[]) => {
    const ma = mean(a),
      mb = mean(b);
    return mean(a.map((v, i) => (v - ma) * (b[i]! - mb))) / Math.sqrt(variance(a) * variance(b));
  };
  const m = {
    role,
    oldOneTileCorrelation: corr(a, oldShifted),
    newOneTileCorrelation: corr(b, shifted),
    meanBefore: mean(a),
    meanAfter: mean(b),
    standardDeviationRatio: Math.sqrt(variance(b) / variance(a)),
    oldWallResetSeamMean: oldSeam / 100,
    newContinuousSeamMean: newSeam / 100,
  };
  assert.ok(m.newOneTileCorrelation < 0.8);
  assert.ok(m.newContinuousSeamMean < 1e-4);
  assert.ok(Math.abs(m.meanAfter / m.meanBefore - 1) < 0.1);
  assert.ok(m.standardDeviationRatio > 0.65);
  metrics.push(m);
  if (role === 'concrete-wall') {
    const pixels = Buffer.alloc(stride * H * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (let c = 0; c < 3; c++) {
          const i = (y * stride + x) * 3 + c;
          pixels[i] = srgb(sample(((x / 128) % 1) * 0.75, (y / 128) * 0.75, c));
          pixels[i + W * 3] = srgb(stochastic((x / 128) * 0.75, (y / 128) * 0.75, c));
        }
    run(
      [
        '-size',
        `${stride}x${H}`,
        '-depth',
        '8',
        'rgb:-',
        '-fill',
        'white',
        '-undercolor',
        '#000000b0',
        '-font',
        'DejaVu-Sans',
        '-pointsize',
        '18',
        '-annotate',
        '+12+24',
        'BEFORE: per-quad reset, repeat 0.75',
        '-annotate',
        `+${W + 12}+24`,
        'AFTER: absolute projected UV, same texel scale',
        `${out}/concrete-quad-seams.png`,
      ],
      pixels,
    );
  }
}
for (const [name, pixels] of [
  ['albedo', image],
  ['height', relief],
] as const) {
  const args = [
    '-size',
    `${stride}x${H * roles.length}`,
    '-depth',
    '8',
    'rgb:-',
    '-fill',
    'white',
    '-undercolor',
    '#000000b0',
    '-font',
    'DejaVu-Sans',
    '-pointsize',
    '18',
  ];
  for (const [row, role] of roles.entries())
    for (const [col, label] of ['BEFORE: periodic', 'AFTER: 3 translated taps'].entries())
      args.push('-annotate', `+${col * W + 12}+${row * H + 24}`, `${role} — ${label}`);
  args.push(`${out}/${name}.png`);
  run(args, pixels);
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify(metrics, null, 2));
