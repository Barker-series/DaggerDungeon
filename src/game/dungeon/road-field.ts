/**
 * Roads region prototype — R0 sites + R1 street field.
 *
 * Streets are the borders of a jittered, per-district-rotated site lattice:
 * a point is ON a road when the distance difference between its two nearest
 * sites is under that street pair's width (the classic F2−F1 Voronoi-border
 * band). Junctions appear where three sites tie; city blocks are the Voronoi
 * cell interiors. One point set → streets, junctions, and blocks.
 *
 * INFINITE-WORLD DISCIPLINE: everything is a pure function of
 * (seed, x, z). Districts live on a fixed world-unit grid; each district
 * seeds its own grid angle, spacing, jitter, and warp personality. Site
 * lookup reads a bounded neighborhood (3×3 districts × 5×5 lattice cells).
 * Rotated lattices collide/gap at district borders — those become the
 * "crunchy" grid-collision seams of the reference image, and the F2−F1
 * band absorbs them gracefully.
 *
 * This file deliberately has no imports from the world pipeline other than
 * rng/noise: step 1 is a standalone experiment (see docs/roads-layer-design.md).
 */

import { cellSeed, mulberry32 } from './rng';
import { sampleNoise3D } from './noise';

const DISTRICT_SALT = 0x52443031; // 'RD01'
const SITE_SALT = 0x52443032;
const PAIR_SALT = 0x52443033;

/** Default world units per district tract. */
export const DISTRICT_WU = 768;

export type DistanceMetric = 'euclidean' | 'manhattan' | 'chebyshev';

export interface RoadFieldParams {
  /** Base lattice spacing in world units (block size + street). */
  spacing: number;
  /** Jitter as a fraction of spacing (0 = strict grid, 0.5 = organic). */
  jitter: number;
  /** Low-frequency domain warp amplitude in world units. */
  warpAmp: number;
  /** Warp feature size in world units. */
  warpScale: number;
  /** Half-width of an ordinary street's F2−F1 band, in world units. */
  streetWidth: number;
  /** World units per district tract (grid-personality patch size). */
  districtWu: number;
  /** Feature size of the prototype elevation field, in world units. */
  terrainScale: number;
  /** 0 = random district grid angles, 1 = grids fully align to contours. */
  terrainFollow: number;
  /** Distance metric for the Voronoi street borders — an AESTHETIC knob:
   *  euclidean = organic cells, manhattan = diamond/45-degree blocks,
   *  chebyshev = square axis-aligned blocks. */
  metric?: DistanceMetric;
}

export const DEFAULT_ROAD_PARAMS: RoadFieldParams = {
  spacing: 44,
  jitter: 0.22,
  warpAmp: 9,
  warpScale: 220,
  streetWidth: 3.2,
  districtWu: DISTRICT_WU,
  terrainScale: 1400,
  terrainFollow: 1,
};

export type StreetClass = 'alley' | 'street' | 'avenue';

interface District {
  dcx: number;
  dcz: number;
  /** Grid rotation of this district's lattice. */
  theta: number;
  /** Spacing multiplier (district personality). */
  spacingMul: number;
  /** Jitter multiplier. */
  jitterMul: number;
}

interface Site {
  x: number;
  z: number;
  /** Canonical identity: district + lattice cell (stable across windows). */
  id: string;
  hash: number;
}

/** District coords for a world point, with meandering borders. */
export function districtAt(seed: number, x: number, z: number, wu: number = DISTRICT_WU): { dcx: number; dcz: number } {
  const wx = (sampleNoise3D(x / wu, 0, z / wu, seed + 9101) - 0.5) * 2 * (wu * 0.18);
  const wz = (sampleNoise3D(x / wu, 0, z / wu, seed + 9178) - 0.5) * 2 * (wu * 0.18);
  return { dcx: Math.floor((x + wx) / wu), dcz: Math.floor((z + wz) / wu) };
}

function district(seed: number, dcx: number, dcz: number, p: RoadFieldParams): District {
  const rng = mulberry32(cellSeed(dcx, dcz, seed, DISTRICT_SALT));
  const randomTheta = rng() * Math.PI * 0.5;
  const spacingMul = 0.85 + rng() * 0.45;
  const jitterMul = 0.6 + rng() * 1.2;
  // Grid angle follows the terrain: main streets run along contours at the
  // district anchor, cross streets up the slope line. terrainFollow blends
  // toward the old random roll.
  const ax = (dcx + 0.5) * p.districtWu;
  const az = (dcz + 0.5) * p.districtWu;
  const { cx, cz } = contourDir(seed, ax, az, p);
  const contourTheta = Math.atan2(cz, cx);
  const theta = p.terrainFollow >= 1 ? contourTheta
    : p.terrainFollow <= 0 ? randomTheta
    : contourTheta * p.terrainFollow + randomTheta * (1 - p.terrainFollow);
  // Axis-aligned metrics want axis-aligned lattices: Manhattan/Chebyshev
  // distances are locked to world axes, so rotated grids staircase their
  // borders. Aligned districts get clean diamond/square blocks instead.
  if (p.metric && p.metric !== 'euclidean') {
    return { dcx, dcz, theta: 0, spacingMul, jitterMul };
  }
  return { dcx, dcz, theta, spacingMul, jitterMul };
}

/** Continuous low-frequency warp displacement, shared by all districts.
 *  The displacement is projected mostly onto the local contour direction, so
 *  street rows slide ALONG the terrain like brush strokes instead of being
 *  shoved across the slope (which made kinks nothing could drive). */
function warpVec(seed: number, x: number, z: number, p: RoadFieldParams): { wx: number; wz: number } {
  const n1 = (sampleNoise3D(x / p.warpScale, 0, z / p.warpScale, seed + 5501) - 0.5) * 2;
  const n2 = (sampleNoise3D(x / p.warpScale, 0, z / p.warpScale, seed + 5577) - 0.5) * 2;
  const { cx, cz } = contourDir(seed, x, z, p);
  // Full amplitude along the contour, a quarter across it.
  const along = n1 * p.warpAmp;
  const across = n2 * p.warpAmp * 0.25;
  return { wx: cx * along - cz * across, wz: cz * along + cx * across };
}

/**
 * Prototype elevation field — smooth, low-frequency, standalone. When this
 * graduates into the game, swap for pillar-layer's elevationField so roads,
 * biomes, and pillar heights all read ONE geography.
 */
export function roadElevation(seed: number, x: number, z: number, p: RoadFieldParams): number {
  const sc = p.terrainScale;
  return (
    sampleNoise3D(x / sc, 0, z / sc, seed + 8111) * 0.62 +
    sampleNoise3D((x * 2.1) / sc, 0, (z * 2.1) / sc, seed + 8177) * 0.26 +
    sampleNoise3D((x * 4.3) / sc, 0, (z * 4.3) / sc, seed + 8233) * 0.12
  );
}

/** Contour direction (perpendicular to the elevation gradient) at a point.
 *  Falls back to +x where the terrain is flat. */
function contourDir(seed: number, x: number, z: number, p: RoadFieldParams): { cx: number; cz: number; steep: number } {
  const h = p.terrainScale * 0.08;
  const gx = roadElevation(seed, x + h, z, p) - roadElevation(seed, x - h, z, p);
  const gz = roadElevation(seed, x, z + h, p) - roadElevation(seed, x, z - h, p);
  const len = Math.hypot(gx, gz);
  if (len < 1e-9) return { cx: 1, cz: 0, steep: 0 };
  // Rotate the gradient 90°: along-contour direction.
  return { cx: -gz / len, cz: gx / len, steep: len / (2 * h) };
}

/**
 * The site of lattice cell (i, j) in a district, or null when the site
 * lands outside its own district (border collision zone — by design).
 */
function siteFor(seed: number, d: District, i: number, j: number, p: RoadFieldParams): Site | null {
  const s = p.spacing * d.spacingMul;
  const rng = mulberry32(cellSeed(i, j, seed ^ cellSeed(d.dcx, d.dcz, seed, DISTRICT_SALT), SITE_SALT));
  const jit = p.jitter * d.jitterMul * s;
  const lx = (i + 0.5) * s + (rng() - 0.5) * 2 * jit;
  const lz = (j + 0.5) * s + (rng() - 0.5) * 2 * jit;
  const cos = Math.cos(d.theta);
  const sin = Math.sin(d.theta);
  const x0 = lx * cos - lz * sin;
  const z0 = lx * sin + lz * cos;
  const { wx, wz } = warpVec(seed, x0, z0, p);
  const x = x0 + wx;
  const z = z0 + wz;
  const home = districtAt(seed, x, z, p.districtWu);
  if (home.dcx !== d.dcx || home.dcz !== d.dcz) return null;
  return { x, z, id: `${d.dcx},${d.dcz}:${i},${j}`, hash: rng() };
}

/** Pure-function memo caches — safe because every value is deterministic.
 *  Bounded FIFO eviction keeps long sessions from growing unboundedly. */
const siteCache = new Map<string, Site | null>();
const districtCache = new Map<string, District>();
const CACHE_MAX = 200_000;

/** Cached values depend on the params object, so it must be part of the
 *  key — the game uses one constant set, but tools build their own and
 *  would otherwise collide with it in the same process. */
const paramsIds = new WeakMap<RoadFieldParams, number>();
let nextParamsId = 1;
function paramsId(p: RoadFieldParams): number {
  let id = paramsIds.get(p);
  if (id === undefined) {
    id = nextParamsId++;
    paramsIds.set(p, id);
  }
  return id;
}

function cachedDistrict(seed: number, dcx: number, dcz: number, p: RoadFieldParams): District {
  const key = `${paramsId(p)}:${seed}:${dcx},${dcz}`;
  let d = districtCache.get(key);
  if (!d) {
    d = district(seed, dcx, dcz, p);
    if (districtCache.size > CACHE_MAX) districtCache.clear();
    districtCache.set(key, d);
  }
  return d;
}

function cachedSite(seed: number, d: District, i: number, j: number, p: RoadFieldParams): Site | null {
  const key = `${paramsId(p)}:${seed}:${d.dcx},${d.dcz}:${i},${j}`;
  let site = siteCache.get(key);
  if (site === undefined) {
    site = siteFor(seed, d, i, j, p);
    if (siteCache.size > CACHE_MAX) siteCache.clear();
    siteCache.set(key, site);
  }
  return site;
}

/** All candidate sites near a world point — bounded read, pure. */
function nearbySites(seed: number, x: number, z: number, p: RoadFieldParams): Site[] {
  const { dcx, dcz } = districtAt(seed, x, z, p.districtWu);
  const sites: Site[] = [];
  for (let ddz = -1; ddz <= 1; ddz++) {
    for (let ddx = -1; ddx <= 1; ddx++) {
      // Reject districts whose (meander-padded) tract can't reach the query
      // with a nearest-relevant site.
      const ncx = dcx + ddx;
      const ncz = dcz + ddz;
      const pad = p.districtWu * 0.18 + p.spacing * 2.5 + p.warpAmp;
      const gx = Math.max(0, Math.max(ncx * p.districtWu - x, x - (ncx + 1) * p.districtWu));
      const gz = Math.max(0, Math.max(ncz * p.districtWu - z, z - (ncz + 1) * p.districtWu));
      if (gx > pad || gz > pad) continue;
      const d = cachedDistrict(seed, ncx, ncz, p);
      const s = p.spacing * d.spacingMul;
      // Inverse-rotate the query into this district's lattice frame.
      const cos = Math.cos(d.theta);
      const sin = Math.sin(d.theta);
      const lx = x * cos + z * sin;
      const lz = -x * sin + z * cos;
      const i0 = Math.floor(lx / s);
      const j0 = Math.floor(lz / s);
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const site = cachedSite(seed, d, i0 + di, j0 + dj, p);
          if (site) sites.push(site);
        }
      }
    }
  }
  return sites;
}

/** Stable per-street-pair value in [0,1) — both sides agree. */
function pairHash(a: Site, b: Site): number {
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  let h = 2166136261 ^ PAIR_SALT;
  const s = `${lo}|${hi}`;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619) >>> 0;
  return h / 4294967296;
}

export interface RoadSample {
  road: boolean;
  /** Street hierarchy of the nearest border (meaningful when road). */
  streetClass: StreetClass;
  /** F2−F1 in world units: 0 on the street centerline, grows into the block. */
  signal: number;
  /** True near a three-site tie — a junction area. */
  junction: boolean;
  /** Nearest site's canonical id — the block id. */
  blockId: string;
  /** Per-block stable random value (for debug tinting / later theming). */
  blockHash: number;
}

/** Street-class width multiplier from a stable hash value. */
function classify(h: number): { cls: StreetClass; mul: number } {
  if (h < 0.14) return { cls: 'avenue', mul: 2.1 };
  if (h < 0.4) return { cls: 'alley', mul: 0.55 };
  return { cls: 'street', mul: 1 };
}

/**
 * Street identity for the border between two sites. Same-district lattice
 * neighbors sharing an axis form one continuous street: the whole lattice
 * LINE gets one class, so avenues run block after block like real cities.
 * Everything else (diagonals, cross-district seams) classifies per pair.
 */
function streetHash(seed: number, a: Site, b: Site): number {
  // Parse "dcx,dcz:i,j"
  const pa = a.id.match(/^(-?\d+),(-?\d+):(-?\d+),(-?\d+)$/);
  const pb = b.id.match(/^(-?\d+),(-?\d+):(-?\d+),(-?\d+)$/);
  if (pa && pb && pa[1] === pb[1] && pa[2] === pb[2]) {
    const iA = Number(pa[3]), jA = Number(pa[4]);
    const iB = Number(pb[3]), jB = Number(pb[4]);
    if (jA === jB && Math.abs(iA - iB) === 1) {
      // Vertical lattice line between columns min(i)+1 — one class per line.
      const rng = mulberry32(cellSeed(Math.max(iA, iB), 0x7fff0 + Number(pa[1]) * 31 + Number(pa[2]) * 7, seed, PAIR_SALT));
      return rng();
    }
    if (iA === iB && Math.abs(jA - jB) === 1) {
      const rng = mulberry32(cellSeed(0x3fff0 + Number(pa[1]) * 31 + Number(pa[2]) * 7, Math.max(jA, jB), seed, PAIR_SALT + 1));
      return rng();
    }
  }
  return pairHash(a, b);
}

/**
 * FLOW MODE — streets ARE the terrain: main streets are level sets of the
 * elevation field at regular height intervals (streets literally follow
 * contours, so they are smooth drivable brush strokes by construction), and
 * cross streets are level sets of a second smooth potential, giving curved
 * ladders up the slope. Width is normalized by each field's gradient so
 * streets keep constant world-space width regardless of slope.
 */
export function roadFlowAt(seed: number, x: number, z: number, p: RoadFieldParams = DEFAULT_ROAD_PARAMS): RoadSample {
  // Main streets: contour interval in elevation units. spacing wu between
  // streets on a "typical" slope of the fbm field.
  const e = roadElevation(seed, x, z, p);
  const { steep } = contourDir(seed, x, z, p);
  const grad = Math.max(steep, 1e-5);
  const contourStep = p.spacing * 0.00062; // elevation units between streets
  const fe = Math.abs(((e / contourStep) % 1 + 1) % 1 - 0.5); // 0.5 at line... invert below
  const distContour = (0.5 - fe) * contourStep / grad; // wu — wrong sign handled by abs
  const dC = Math.abs(((e / contourStep + 0.5) % 1 + 1) % 1 - 0.5) * contourStep / grad;

  // Cross streets: second smooth potential, warped so it cuts across.
  const sc = p.terrainScale * 0.9;
  const f =
    sampleNoise3D((x + 4000) / sc, 0, z / sc, seed + 7333) * 0.7 +
    sampleNoise3D((x * 2.3 + 4000) / sc, 0, (z * 2.3) / sc, seed + 7391) * 0.3;
  const h = sc * 0.06;
  const fgx = (sampleNoise3D((x + h + 4000) / sc, 0, z / sc, seed + 7333) * 0.7 + sampleNoise3D(((x + h) * 2.3 + 4000) / sc, 0, (z * 2.3) / sc, seed + 7391) * 0.3 - f);
  const fgz = (sampleNoise3D((x + 4000) / sc, 0, (z + h) / sc, seed + 7333) * 0.7 + sampleNoise3D((x * 2.3 + 4000) / sc, 0, ((z + h) * 2.3) / sc, seed + 7391) * 0.3 - f);
  const fGrad = Math.max(Math.hypot(fgx, fgz) / h, 1e-5);
  const crossStep = contourStep * 1.4;
  const dX = Math.abs(((f / crossStep + 0.5) % 1 + 1) % 1 - 0.5) * crossStep / fGrad;

  void distContour;
  // Street class per line index — every ~5th contour is an avenue.
  const lineC = Math.round(e / contourStep);
  const lineX = Math.round(f / crossStep);
  const rngC = mulberry32(cellSeed(lineC, 11, seed, PAIR_SALT + 7))();
  const rngX = mulberry32(cellSeed(13, lineX, seed, PAIR_SALT + 8))();
  const cC = classify(rngC);
  const cX = classify(rngX);
  const wC = p.streetWidth * cC.mul;
  const wX = p.streetWidth * cX.mul * 0.8;

  const onC = dC < wC;
  const onX = dX < wX;
  const road = onC || onX;
  const cls: StreetClass = onC ? cC.cls : cX.cls;
  return {
    road,
    streetClass: cls,
    signal: Math.min(dC - wC, dX - wX),
    junction: onC && onX,
    blockId: `${lineC}/${lineX}`,
    blockHash: mulberry32(cellSeed(lineC, lineX, seed, PAIR_SALT + 9))(),
  };
}

/**
 * VEINS — arterial hierarchy gated by an openness field.
 *
 * Streets are level sets of two smooth potentials (E along terrain contours,
 * F cutting across), but they exist in a HIERARCHY:
 *   level 0 (arteries):  every 8th line — exist EVERYWHERE, never break.
 *   level 1 (streets):   every 2nd line — exist where openness > ~0.35.
 *   level 2 (capillaries): all lines    — exist where openness > ~0.62.
 * Openness = noise + flatness: steep/tight zones squeeze the network down to
 * a lone artery (a single tunnel); open flats flood with side streets. The
 * push-and-pull repeats forever because openness is just another field.
 */
export function roadVeinsAt(seed: number, x: number, z: number, p: RoadFieldParams = DEFAULT_ROAD_PARAMS): RoadSample {
  const { steep } = contourDir(seed, x, z, p);
  const grad = Math.max(steep, 1e-5);
  const e = roadElevation(seed, x, z, p);

  // Openness: broad noise, minus steepness pressure.
  const osc = p.terrainScale * 1.3;
  const on =
    sampleNoise3D((x - 7000) / osc, 0, z / osc, seed + 6011) * 0.65 +
    sampleNoise3D((x * 2.7 - 7000) / osc, 0, (z * 2.7) / osc, seed + 6077) * 0.35;
  const steepNorm = Math.min(steep / 0.0009, 1);
  const raw = on * 0.72 + (1 - steepNorm) * 0.28;
  // Stretch contrast: raw hovers near 0.5, so remap [0.32, 0.62] -> [0, 1].
  const openness = Math.max(0, Math.min(1, (raw - 0.32) / 0.3));

  // Along-contour potential lines.
  const contourStep = p.spacing * 0.00062;
  const lineC = Math.round(e / contourStep);
  const dC = Math.abs(e - lineC * contourStep) / grad;

  // Cross potential lines.
  const sc = p.terrainScale * 0.9;
  const f =
    sampleNoise3D((x + 4000) / sc, 0, z / sc, seed + 7333) * 0.7 +
    sampleNoise3D((x * 2.3 + 4000) / sc, 0, (z * 2.3) / sc, seed + 7391) * 0.3;
  const h = sc * 0.06;
  const fx2 = sampleNoise3D((x + h + 4000) / sc, 0, z / sc, seed + 7333) * 0.7 + sampleNoise3D(((x + h) * 2.3 + 4000) / sc, 0, (z * 2.3) / sc, seed + 7391) * 0.3;
  const fz2 = sampleNoise3D((x + 4000) / sc, 0, (z + h) / sc, seed + 7333) * 0.7 + sampleNoise3D((x * 2.3 + 4000) / sc, 0, ((z + h) * 2.3) / sc, seed + 7391) * 0.3;
  const fGrad = Math.max(Math.hypot(fx2 - f, fz2 - f) / h, 1e-5);
  const crossStep = contourStep * 1.0;
  const lineX = Math.round(f / crossStep);
  const dX = Math.abs(f - lineX * crossStep) / fGrad;

  /** Hierarchy level of a line index: 0 = artery, 1 = street, 2 = capillary. */
  const levelOf = (idx: number): number => (idx % 8 === 0 ? 0 : idx % 2 === 0 ? 1 : 2);
  /** Does a line of this level exist here, and how wide is it? */
  const gate = (level: number): number => {
    if (level === 0) return p.streetWidth * (1.9 - openness * 0.8); // artery: wider when squeezed
    if (level === 1) return openness > 0.3 ? p.streetWidth : 0;
    return openness > 0.58 ? p.streetWidth * 0.55 : 0;
  };

  const wC = gate(levelOf(lineC));
  const wX = gate(levelOf(lineX)) * 0.85;
  const onC = wC > 0 && dC < wC;
  const onX = wX > 0 && dX < wX;
  const road = onC || onX;
  const lvl = onC ? levelOf(lineC) : levelOf(lineX);
  return {
    road,
    streetClass: lvl === 0 ? 'avenue' : lvl === 1 ? 'street' : 'alley',
    signal: Math.min(wC > 0 ? dC - wC : Infinity, wX > 0 ? dX - wX : Infinity),
    junction: onC && onX,
    blockId: `${lineC}/${lineX}`,
    blockHash: mulberry32(cellSeed(lineC, lineX, seed, PAIR_SALT + 9))(),
  };
}

/**
 * HYBRID — the real model: grid districts fill the flats, contour streets
 * take the slopes (how actual cities work). Sharp-ish transition with a
 * union band so the two networks stitch where they meet.
 */
export function roadHybridAt(seed: number, x: number, z: number, p: RoadFieldParams = DEFAULT_ROAD_PARAMS): RoadSample {
  const { steep } = contourDir(seed, x, z, p);
  // Steepness thresholds in elevation-units-per-wu of the fbm field.
  const flat = 0.0005;
  const hilly = 0.00068;
  if (steep < flat) return roadAt(seed, x, z, p);
  if (steep > hilly) return roadFlowAt(seed, x, z, p);
  // Transition band: union of both networks so they connect.
  const a = roadAt(seed, x, z, p);
  const b = roadFlowAt(seed, x, z, p);
  return a.road ? a : b;
}

/**
 * THE field: sample the street network at a world position.
 * Pure function of (seed, x, z, params); bounded neighbor reads only.
 */
export function roadAt(seed: number, x: number, z: number, p: RoadFieldParams = DEFAULT_ROAD_PARAMS): RoadSample {
  const sites = nearbySites(seed, x, z, p);
  // Find the three nearest sites (n1 = my block, n2 = across the street).
  let n1: Site | null = null;
  let n2: Site | null = null;
  let n3: Site | null = null;
  let d1 = Infinity;
  let d2 = Infinity;
  let d3 = Infinity;
  const metric = p.metric ?? 'euclidean';
  for (const site of sites) {
    const dx = Math.abs(site.x - x);
    const dz = Math.abs(site.z - z);
    const d = metric === 'manhattan' ? dx + dz
      : metric === 'chebyshev' ? Math.max(dx, dz)
      : Math.sqrt(dx * dx + dz * dz);
    if (d < d1) {
      d3 = d2; n3 = n2; d2 = d1; n2 = n1; d1 = d; n1 = site;
    } else if (d < d2) {
      d3 = d2; n3 = n2; d2 = d; n2 = site;
    } else if (d < d3) {
      d3 = d; n3 = site;
    }
  }
  if (!n1 || !n2) {
    return { road: false, streetClass: 'street', signal: Infinity, junction: false, blockId: n1?.id ?? '?', blockHash: n1?.hash ?? 0 };
  }
  const signal = d2 - d1;
  const { cls, mul } = classify(streetHash(seed, n1, n2));
  const width = p.streetWidth * mul;
  const road = signal < width;
  const junction = n3 !== null && d3 - d1 < width * 1.6;
  return { road, streetClass: cls, signal, junction, blockId: n1.id, blockHash: n1.hash };
}
