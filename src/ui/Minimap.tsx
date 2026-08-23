import { useRef, useEffect, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { TileType, TILE_SIZE } from '../game/types';
import { sliceAt } from '../game/mapslice';
import { buildOrganicContour } from '../game/dungeon/organiccontour';
import { drawSmoothWallOverlay } from './mapContour';

const MAP_SIZE = 140; // pixels
const TILE_PX = 3; // pixels per tile on minimap

/** Colors per slice kind; 'walk' shades by height offset from player */
const COLOR_BELOW = '#1a2a3e'; // open air — a drop
const COLOR_ABYSS = '#601525'; // bottomless
const COLOR_ABOVE = '#22331f'; // walkable overhead hint

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useGameStore((s) => s.world);
  const dungeon = useGameStore((s) => s.dungeon);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerY = useGameStore((s) => s.playerY);
  const playerYaw = useGameStore((s) => s.playerYaw);
  // The same marching-squares contour the walls render and collide with
  const storeContour = useGameStore((s) => s.worldContour);
  // Prefer the engine's contour (built off-thread with the world); the
  // local rebuild is only a fallback for views without one
  const contour = useMemo(
    () => storeContour ?? (dungeon ? buildOrganicContour(dungeon) : null),
    [storeContour, dungeon],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world || !dungeon) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;

    // Center the map on the player
    const offsetX = MAP_SIZE / 2 - playerPos.x * TILE_PX;
    const offsetY = MAP_SIZE / 2 - playerPos.y * TILE_PX;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const w = dungeon.width;
    const t0x = Math.max(0, Math.floor(playerPos.x - MAP_SIZE / 2 / TILE_PX) - 1);
    const t1x = Math.min(w - 1, Math.ceil(playerPos.x + MAP_SIZE / 2 / TILE_PX) + 1);
    const t0y = Math.max(0, Math.floor(playerPos.y - MAP_SIZE / 2 / TILE_PX) - 1);
    const t1y = Math.min(dungeon.height - 1, Math.ceil(playerPos.y + MAP_SIZE / 2 / TILE_PX) + 1);

    // ELEVATION SLICE: the map shows what exists at the player's height
    // — pillar plazas, ramp bands, bridges, whatever the column model
    // says is there. The tile grid alone can't see interiors.
    for (let y = t0y; y <= t1y; y++) {
      for (let x = t0x; x <= t1x; x++) {
        const cell = sliceAt(world.columns[y * w + x]!, playerY);
        if (cell.kind === 'solid') continue;

        const px = offsetX + x * TILE_PX;
        const py = offsetY + y * TILE_PX;
        if (px < -TILE_PX || px > MAP_SIZE || py < -TILE_PX || py > MAP_SIZE) continue;

        if (cell.kind === 'walk') {
          // Shade by height offset: brighter = higher than the player
          const dh = Math.max(-4, Math.min(4, cell.floor - playerY));
          const v = Math.round(70 + dh * 8);
          const tile = dungeon.tiles[y]![x]!;
          if (tile === TileType.Door) ctx.fillStyle = '#654';
          else if (tile === TileType.StairsDown) ctx.fillStyle = '#3a3';
          else ctx.fillStyle = `rgb(${v},${v},${v + 6})`;
        } else if (cell.kind === 'abyss') {
          ctx.fillStyle = COLOR_ABYSS;
        } else if (cell.kind === 'below') {
          ctx.fillStyle = COLOR_BELOW;
        } else {
          ctx.fillStyle = COLOR_ABOVE;
        }
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
      }
    }

    // ── Smooth walls: overlay the contour so map corners round exactly
    // like the rendered geometry (same segments, cannot drift) ──
    if (contour) {
      const worldToPx = (wx: number, wz: number): [number, number] =>
        [offsetX + (wx / TILE_SIZE) * TILE_PX, offsetY + (wz / TILE_SIZE) * TILE_PX];
      const floorColorAt = (tx: number, tz: number): string | null => {
        if (tx < 0 || tz < 0 || tx >= w || tz >= dungeon.height) return null;
        const cell = sliceAt(world.columns[tz * w + tx]!, playerY);
        if (cell.kind === 'walk') {
          const dh = Math.max(-4, Math.min(4, cell.floor - playerY));
          const v = Math.round(70 + dh * 8);
          const tile = dungeon.tiles[tz]![tx]!;
          if (tile === TileType.Door) return '#654';
          if (tile === TileType.StairsDown) return '#3a3';
          return `rgb(${v},${v},${v + 6})`;
        }
        if (cell.kind === 'abyss') return COLOR_ABYSS;
        if (cell.kind === 'below') return COLOR_BELOW;
        if (cell.kind === 'above') return COLOR_ABOVE;
        return null; // solid at this height — square is honest here
      };
      drawSmoothWallOverlay(ctx, contour, dungeon, worldToPx, floorColorAt, '#000', MAP_SIZE, MAP_SIZE);
    }

    // Draw player as a triangle pointing in look direction
    const ppx = MAP_SIZE / 2;
    const ppy = MAP_SIZE / 2;

    // Camera yaw: 0 = looking toward -Z (south on screen = down)
    // Minimap: -Y = north (up). So angle on minimap = yaw + PI
    const angle = playerYaw + Math.PI;

    const size = 6;
    const tipX = ppx + Math.sin(angle) * size;
    const tipY = ppy + Math.cos(angle) * size;
    const leftX = ppx + Math.sin(angle + 2.5) * size * 0.7;
    const leftY = ppy + Math.cos(angle + 2.5) * size * 0.7;
    const rightX = ppx + Math.sin(angle - 2.5) * size * 0.7;
    const rightY = ppy + Math.cos(angle - 2.5) * size * 0.7;

    ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }, [world, dungeon, contour, playerPos, playerY, playerYaw]);

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      width={MAP_SIZE}
      height={MAP_SIZE}
    />
  );
}
