import { useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { TileType } from '../game/types';

const MAP_SIZE = 140; // pixels
const TILE_PX = 3; // pixels per tile on minimap

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dungeon = useGameStore((s) => s.dungeon);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerYaw = useGameStore((s) => s.playerYaw);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dungeon) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;

    // Center the map on the player
    const offsetX = MAP_SIZE / 2 - playerPos.x * TILE_PX;
    const offsetY = MAP_SIZE / 2 - playerPos.y * TILE_PX;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw tiles
    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        const tile = dungeon.tiles[y]![x]!;
        if (tile === TileType.Wall) continue;

        const px = offsetX + x * TILE_PX;
        const py = offsetY + y * TILE_PX;

        // Skip tiles outside minimap
        if (px < -TILE_PX || px > MAP_SIZE || py < -TILE_PX || py > MAP_SIZE) continue;

        switch (tile) {
          case TileType.Floor:
            ctx.fillStyle = '#333';
            break;
          case TileType.Door:
            ctx.fillStyle = '#654';
            break;
          case TileType.StairsDown:
            ctx.fillStyle = '#3a3';
            break;
          default:
            ctx.fillStyle = '#333';
        }
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
      }
    }

    // Draw player as a triangle pointing in look direction
    const ppx = MAP_SIZE / 2;
    const ppy = MAP_SIZE / 2;

    // Camera yaw: 0 = looking toward -Z (south on screen = down)
    // Minimap: -Y = north (up). So angle on minimap = yaw + PI
    const angle = playerYaw + Math.PI;

    const size = 6;
    // Triangle: tip in front, two points behind
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
  }, [dungeon, playerPos, playerYaw]);

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      width={MAP_SIZE}
      height={MAP_SIZE}
    />
  );
}
