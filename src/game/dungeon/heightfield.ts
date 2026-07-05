/**
 * Height field utilities shared by the renderer and the game engine.
 *
 * Per-tile height values are averaged at tile corners, turning the field
 * into one continuous surface: single-tile noise becomes slopes and
 * cell-to-cell steps become short ramps. The renderer builds geometry from
 * corner heights; the engine bilinearly samples the same corners so the
 * player walks exactly the surface that is drawn.
 */

import { TileType, TILE_SIZE } from '../types';

/** Floor values at or below this are pit voids — they never blend with
 *  grade, and the UI maps render them as holes. Deep enough that real
 *  geometry (stairwell ramps descending a full LEVEL_HEIGHT) never
 *  crosses it. */
export const PIT_LEVEL = -900;

/**
 * Average the (up to 4) floor-tile values touching each grid corner.
 * Corners touching no floor tile keep the fallback — geometry and sampling
 * never reference them.
 *
 * Pit-depth values never average with grade values: a corner touching both
 * takes only the grade side. Rims therefore stay flat right up to the tile
 * edge, and the first pit tile plunges near-vertically — the rendered edge
 * IS the physical edge. (Only relevant for floor fields; ceilings never
 * carry pit values.)
 */
export function buildCornerField(
  tiles: TileType[][],
  values: number[][],
  width: number,
  height: number,
  fallback: number,
): number[][] {
  const corners: number[][] = Array.from({ length: height + 1 }, () =>
    Array.from({ length: width + 1 }, () => fallback),
  );

  for (let cy = 0; cy <= height; cy++) {
    for (let cx = 0; cx <= width; cx++) {
      let sum = 0;
      let count = 0;
      let pitMin = Infinity;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (tx! < 0 || ty! < 0 || tx! >= width || ty! >= height) continue;
        if (tiles[ty!]![tx!] === TileType.Wall) continue;
        const v = values[ty!]![tx!]!;
        if (v <= PIT_LEVEL) {
          pitMin = Math.min(pitMin, v);
          continue;
        }
        sum += v;
        count++;
      }
      if (count > 0) corners[cy]![cx] = sum / count;
      else if (pitMin < Infinity) corners[cy]![cx] = pitMin;
    }
  }

  return corners;
}

/**
 * Sample a corner field at a world position with smoothstep interpolation —
 * transitions curve into rounded shoulders instead of creasing at tile
 * lines. The surface still passes exactly through every corner value, so
 * coarse (1-quad) tiles and tessellated tiles stay seam-consistent.
 */
export function sampleCornerField(corners: number[][], wx: number, wz: number): number {
  const fx = wx / TILE_SIZE;
  const fz = wz / TILE_SIZE;
  const x0 = Math.max(0, Math.min(corners[0]!.length - 2, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(corners.length - 2, Math.floor(fz)));
  let u = Math.max(0, Math.min(1, fx - x0));
  let v = Math.max(0, Math.min(1, fz - z0));
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);

  const h00 = corners[z0]![x0]!;
  const h10 = corners[z0]![x0 + 1]!;
  const h01 = corners[z0 + 1]![x0]!;
  const h11 = corners[z0 + 1]![x0 + 1]!;

  const top = h00 * (1 - u) + h10 * u;
  const bot = h01 * (1 - u) + h11 * u;
  return top * (1 - v) + bot * v;
}
