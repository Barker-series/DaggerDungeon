/**
 * Seeded 2D value noise.
 * Simple but deterministic — same seed always produces the same field.
 * Uses the project's mulberry32 PRNG for per-point hashing.
 */

import { cellSeed, mulberry32 } from './rng';

/**
 * Sample noise at a cell position. Returns 0-1.
 * Uses smooth interpolation between grid points for organic feel.
 */
export function sampleNoise(cx: number, cz: number, worldSeed: number, scale: number = 1): number {
  // Scale coordinates for different noise frequencies
  const sx = cx / scale;
  const sz = cz / scale;

  // Integer grid corners
  const x0 = Math.floor(sx);
  const z0 = Math.floor(sz);
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  // Fractional position within grid cell
  const fx = sx - x0;
  const fz = sz - z0;

  // Smooth interpolation (smoothstep)
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  // Hash each corner to get a random value
  const v00 = hashPoint(x0, z0, worldSeed);
  const v10 = hashPoint(x1, z0, worldSeed);
  const v01 = hashPoint(x0, z1, worldSeed);
  const v11 = hashPoint(x1, z1, worldSeed);

  // Bilinear interpolation
  const top = v00 * (1 - ux) + v10 * ux;
  const bot = v01 * (1 - ux) + v11 * ux;
  return top * (1 - uz) + bot * uz;
}

/**
 * Multi-octave noise for more natural-looking fields.
 */
export function sampleNoiseOctaves(
  cx: number, cz: number, worldSeed: number,
  octaves: number = 3, lacunarity: number = 2, persistence: number = 0.5,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += sampleNoise(cx, cz, worldSeed + i * 31, 3 / frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

function hashPoint(x: number, z: number, seed: number): number {
  const s = cellSeed(x, z, seed, 777);
  const rng = mulberry32(s);
  return rng();
}

/**
 * Seeded 3D value noise — the megastructure's volumetric mask. The y axis
 * runs across stacked levels, so a single field decides where voids align
 * vertically (shafts, atria, bottomless pits) and where slabs stay solid.
 *
 * Coordinates are pre-scaled by the caller: one unit ≈ one noise feature.
 * Returns 0-1.
 */
export function sampleNoise3D(x: number, y: number, z: number, worldSeed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const h = (dx: number, dy: number, dz: number): number =>
    hashPoint(x0 + dx, z0 + dz, worldSeed + (y0 + dy) * 7919);

  const c00 = h(0, 0, 0) * (1 - ux) + h(1, 0, 0) * ux;
  const c10 = h(0, 0, 1) * (1 - ux) + h(1, 0, 1) * ux;
  const c01 = h(0, 1, 0) * (1 - ux) + h(1, 1, 0) * ux;
  const c11 = h(0, 1, 1) * (1 - ux) + h(1, 1, 1) * ux;

  const bottom = c00 * (1 - uz) + c10 * uz;
  const top = c01 * (1 - uz) + c11 * uz;
  return bottom * (1 - uy) + top * uy;
}
