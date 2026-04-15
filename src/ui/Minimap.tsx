import { useRef, useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { TileType } from '../game/types';

const MAP_SIZE = 140; // pixels
const TILE_PX = 3; // pixels per tile on minimap

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dungeon = useGameStore((s) => s.dungeon);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerFacing = useGameStore((s) => s.playerFacing);

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

    // Draw player
    const ppx = MAP_SIZE / 2;
    const ppy = MAP_SIZE / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ppx, ppy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw facing direction
    const angles = [
      -Math.PI / 2, // North (up)
      0, // East (right)
      Math.PI / 2, // South (down)
      Math.PI, // West (left)
    ];
    const angle = angles[playerFacing] ?? 0;
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ppx, ppy);
    ctx.lineTo(ppx + Math.cos(angle) * 8, ppy + Math.sin(angle) * 8);
    ctx.stroke();
  }, [dungeon, playerPos, playerFacing]);

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      width={MAP_SIZE}
      height={MAP_SIZE}
    />
  );
}
