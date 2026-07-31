/**
 * Roads region step-1 experiment — render the road field as a top-down mask.
 *
 *   npx tsx tools/road-mask.ts [seed] [out.png] [--extent 900] [--size 1100]
 *                              [--spacing 44] [--jitter 0.22] [--warp 9]
 *                              [--warpScale 220] [--width 3.2] [--blocks]
 *
 * Blue lines on black, like the reference image. --blocks additionally
 * tints each Voronoi block by district + block hash so grid-collision
 * seams and block structure are readable.
 *
 * Zero game-code integration: reads only src/game/dungeon/road-field.ts.
 */

/* eslint-disable no-console */
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { roadAt, roadFlowAt, roadHybridAt, roadVeinsAt, districtAt, roadElevation, DEFAULT_ROAD_PARAMS, type RoadFieldParams } from '../src/game/dungeon/road-field';
import { cellSeed, mulberry32 } from '../src/game/dungeon/rng';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const seed = Number(positional[0] ?? 1337);
const outPath = positional[1] ?? '/tmp/road-mask.png';
const extent = flag('extent', 900); // world units rendered edge to edge
const size = flag('size', 1100); // output pixels
const showBlocks = args.includes('--blocks');
const flowMode = args.includes('--flow');
const hybridMode = args.includes('--hybrid');
const veinsMode = args.includes('--veins');

const params: RoadFieldParams = {
  spacing: flag('spacing', DEFAULT_ROAD_PARAMS.spacing),
  jitter: flag('jitter', DEFAULT_ROAD_PARAMS.jitter),
  warpAmp: flag('warp', DEFAULT_ROAD_PARAMS.warpAmp),
  warpScale: flag('warpScale', DEFAULT_ROAD_PARAMS.warpScale),
  streetWidth: flag('width', DEFAULT_ROAD_PARAMS.streetWidth),
  districtWu: flag('district', DEFAULT_ROAD_PARAMS.districtWu),
  terrainScale: flag('terrain', DEFAULT_ROAD_PARAMS.terrainScale),
  terrainFollow: flag('follow', DEFAULT_ROAD_PARAMS.terrainFollow),
  metric: (args.includes('--manhattan') ? 'manhattan' : args.includes('--chebyshev') ? 'chebyshev' : 'euclidean') as import('../src/game/dungeon/road-field').DistanceMetric,
};

console.log(`road-mask seed=${seed} extent=${extent}wu size=${size}px`, params);

const img = new Uint8Array(size * size * 3);
const wuPerPx = extent / size;
let roadPx = 0;

for (let py = 0; py < size; py++) {
  for (let px = 0; px < size; px++) {
    const x = (px - size / 2) * wuPerPx;
    const z = (py - size / 2) * wuPerPx;
    const s = veinsMode ? roadVeinsAt(seed, x, z, params) : hybridMode ? roadHybridAt(seed, x, z, params) : flowMode ? roadFlowAt(seed, x, z, params) : roadAt(seed, x, z, params);
    const i = (py * size + px) * 3;
    if (s.road) {
      roadPx++;
      // Reference-image blue; avenues brighter, alleys dimmer.
      const v = s.streetClass === 'avenue' ? 1 : s.streetClass === 'alley' ? 0.5 : 0.78;
      img[i] = 30 * v;
      img[i + 1] = 40 * v;
      img[i + 2] = 235 * v;
      // junction highlighting off — it made the mask read as blobs
    } else if (showBlocks) {
      // Terrain relief shading so contour-following is visible.
      const e = roadElevation(seed, x, z, params);
      const t = 10 + e * 70;
      const { dcx, dcz } = districtAt(seed, x, z, params.districtWu);
      const dRng = mulberry32(cellSeed(dcx, dcz, seed, 4242));
      const dTint = dRng() * 12;
      img[i] = t + dTint;
      img[i + 1] = t + dTint;
      img[i + 2] = t * 1.15 + dTint;
    }
  }
}

const ppm = outPath.replace(/\.png$/, '.ppm');
writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), Buffer.from(img)]));
try {
  execSync(`magick ${ppm} ${outPath} 2>/dev/null || convert ${ppm} ${outPath}`);
  console.log(`mask rendered: ${outPath} (${((100 * roadPx) / (size * size)).toFixed(1)}% road)`);
} catch {
  console.log(`mask rendered: ${ppm} (PPM; install ImageMagick for PNG)`);
}
