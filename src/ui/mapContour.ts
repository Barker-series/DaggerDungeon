/**
 * Smooth-wall overlay for the 2D maps. The maps draw per-tile squares,
 * but the world renders (and collides with) the marching-squares
 * contour — so square maps show jagged corners the game doesn't have.
 * This paints, for every contour segment that ACTUALLY renders smooth
 * (all wall tiles in its group soft), the inner group square split
 * along the segment: air side in the floor color, wall side in the
 * wall color. Map wall lines then follow the exact contour geometry —
 * derived from the same segments, so the map can never drift from the
 * world.
 */

import { TileType, TILE_SIZE, type DungeonData } from '../game/types';
import type { OrganicContour } from '../game/dungeon/organiccontour';

export function drawSmoothWallOverlay(
  ctx: CanvasRenderingContext2D,
  contour: OrganicContour,
  dungeon: DungeonData,
  /** World coords → canvas pixels */
  worldToPx: (wx: number, wz: number) => [number, number],
  /** Color the map used for this FLOOR tile; null = skip this segment
   *  (e.g. the minimap slice shows something else at this height) */
  floorColorAt: (tx: number, tz: number) => string | null,
  /** Color the map uses for wall/solid */
  wallColor: string,
  /** Canvas bounds for culling (canvas pixels) */
  cullW: number,
  cullH: number,
): void {
  const w = dungeon.width;
  const h = dungeon.height;
  for (const seg of contour.segments) {
    const mx = (seg.x0 + seg.x1) / 2;
    const mz = (seg.z0 + seg.z1) / 2;
    const [cpx, cpz] = worldToPx(mx, mz);
    const margin = 2 * TILE_SIZE;
    if (cpx < -margin || cpz < -margin || cpx > cullW + margin || cpz > cullH + margin) continue;

    // Only where the smooth wall actually renders: every wall tile in
    // the 2x2 group must be soft (mirrors the renderer's group verdict;
    // hard/declined groups keep square faces and square map corners).
    let anyWall = false;
    let allSoft = true;
    for (const [tx, tz] of [
      [seg.gx, seg.gz], [seg.gx + 1, seg.gz],
      [seg.gx, seg.gz + 1], [seg.gx + 1, seg.gz + 1],
    ] as const) {
      if (tx < 0 || tz < 0 || tx >= w || tz >= h) continue;
      if (dungeon.tiles[tz]![tx] === TileType.Wall) {
        anyWall = true;
        if (!contour.softWalls.has(tz * w + tx)) allSoft = false;
      }
    }
    if (!anyWall || !allSoft) continue;

    // Normal toward the AIR side (sample the tile past the midpoint)
    let nx = -(seg.z1 - seg.z0);
    let nz = seg.x1 - seg.x0;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const probe = (sign: number): boolean => {
      const tx = Math.floor((mx + sign * nx * TILE_SIZE * 0.6) / TILE_SIZE);
      const tz = Math.floor((mz + sign * nz * TILE_SIZE * 0.6) / TILE_SIZE);
      return dungeon.tiles[tz]?.[tx] !== undefined && dungeon.tiles[tz]![tx] !== TileType.Wall;
    };
    if (!probe(1)) {
      if (!probe(-1)) continue;
      nx = -nx;
      nz = -nz;
    }
    const airTx = Math.floor((mx + nx * TILE_SIZE * 0.6) / TILE_SIZE);
    const airTz = Math.floor((mz + nz * TILE_SIZE * 0.6) / TILE_SIZE);
    const floorColor = floorColorAt(airTx, airTz);
    if (floorColor === null) continue;

    // The group's INNER square (spanned by the 4 tile centers — where
    // marching-squares segments live), split along the segment.
    const q: [number, number][] = [
      [(seg.gx + 0.5) * TILE_SIZE, (seg.gz + 0.5) * TILE_SIZE],
      [(seg.gx + 1.5) * TILE_SIZE, (seg.gz + 0.5) * TILE_SIZE],
      [(seg.gx + 1.5) * TILE_SIZE, (seg.gz + 1.5) * TILE_SIZE],
      [(seg.gx + 0.5) * TILE_SIZE, (seg.gz + 1.5) * TILE_SIZE],
    ];
    const clip = (side: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i < q.length; i++) {
        const a = q[i]!;
        const b = q[(i + 1) % q.length]!;
        const da = ((a[0] - mx) * nx + (a[1] - mz) * nz) * side;
        const db = ((b[0] - mx) * nx + (b[1] - mz) * nz) * side;
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      return out;
    };
    const paint = (poly: [number, number][], color: string): void => {
      if (poly.length < 3) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      const [px, pz] = worldToPx(poly[0]![0], poly[0]![1]);
      ctx.moveTo(px, pz);
      for (let i = 1; i < poly.length; i++) {
        const [qx, qz] = worldToPx(poly[i]![0], poly[i]![1]);
        ctx.lineTo(qx, qz);
      }
      ctx.closePath();
      ctx.fill();
    };
    paint(clip(1), floorColor); // air side
    paint(clip(-1), wallColor); // wall side
  }
}
