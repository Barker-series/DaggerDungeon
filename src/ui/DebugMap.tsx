import { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { getAllCells, tileBiome, type DungeonCell } from '../game/dungeon/cells';
import { hallwayCells } from '../game/dungeon/layer4-connect';
import { PIT_LEVEL } from '../game/dungeon/heightfield';
import { findWorldPathToExit, startLevelFor } from '../game/pathfinding';
import { WORLD_LEVELS } from '../game/types';

const PIT_COLOR = '#601525';

const CELL_PX = 40; // pixels per cell in the debug view

const BIOME_COLORS = {
  dungeon: '#2a5a8a',
  cave: '#8a5a2a',
  crypt: '#5a7a9a',
  ember: '#9a3a1a',
  outside: '#3a7a3a',
} as const;

type ViewMode = 'tiles' | 'biome' | 'noise' | 'content';
const VIEW_MODES: ViewMode[] = ['tiles', 'biome', 'noise', 'content'];

export function DebugMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ViewMode>('tiles');
  const dungeon = useGameStore((s) => s.dungeon);
  const world = useGameStore((s) => s.world);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerY = useGameStore((s) => s.playerY);
  const currentLevel = useGameStore((s) => s.currentLevel);

  // Toggle with backtick key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') {
        e.preventDefault();
        setVisible((v) => !v);
      }
      if (e.code === 'Tab' && visible) {
        e.preventDefault();
        setMode((m) => VIEW_MODES[(VIEW_MODES.indexOf(m) + 1) % VIEW_MODES.length]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cells = getAllCells();
    if (cells.length === 0) return;

    // Find grid bounds
    let maxCx = 0, maxCz = 0;
    for (const cell of cells) {
      maxCx = Math.max(maxCx, cell.cx);
      maxCz = Math.max(maxCz, cell.cz);
    }
    const gridW = maxCx + 1;
    const gridH = maxCz + 1;

    canvas.width = gridW * CELL_PX + 200; // extra space for legend
    canvas.height = gridH * CELL_PX + 40;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellTileSize = 14;

    // Build cell lookup (used by both tile and cell views)
    const cellMap = new Map<string, DungeonCell>();
    for (const cell of cells) {
      cellMap.set(`${cell.cx},${cell.cz}`, cell);
    }

    // ── Tile-level view: draw actual tiles from dungeon.tiles ──
    if ((mode === 'tiles' || mode === 'biome') && dungeon) {
      const mapSize = 560; // fixed map size in pixels
      const tilePx = Math.max(2, Math.floor(mapSize / dungeon.width));
      canvas.width = dungeon.width * tilePx + 200;
      canvas.height = dungeon.height * tilePx + 40;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let tz = 0; tz < dungeon.height; tz++) {
        for (let tx = 0; tx < dungeon.width; tx++) {
          const tile = dungeon.tiles[tz]![tx]!;
          const px = tx * tilePx;
          const pz = tz * tilePx;

          const isPit = tile !== 0 && dungeon.floorHeights[tz]![tx]! <= PIT_LEVEL;
          if (mode === 'biome') {
            if (tile === 0) {
              ctx.fillStyle = '#0a0a0a';
            } else if (isPit) {
              ctx.fillStyle = PIT_COLOR;
            } else if (tile === 3) {
              ctx.fillStyle = '#2a8a2a';
            } else {
              const biome = tileBiome(dungeon.cellBiomes, tx, tz) ?? 'dungeon';
              ctx.fillStyle = BIOME_COLORS[biome] ?? '#2a5a8a';
            }
          } else if (isPit) {
            ctx.fillStyle = PIT_COLOR;
          } else {
            switch (tile) {
              case 0: ctx.fillStyle = '#1a1a1a'; break;
              case 1: ctx.fillStyle = '#3a5a3a'; break;
              case 2: ctx.fillStyle = '#5a4a2a'; break;
              case 3: ctx.fillStyle = '#2a8a2a'; break;
              default: ctx.fillStyle = '#333'; break;
            }
          }
          ctx.fillRect(px, pz, tilePx, tilePx);
        }
      }

      // Draw cell grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      for (let cx = 0; cx <= gridW; cx++) {
        const x = cx * cellTileSize * tilePx;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, dungeon.height * tilePx); ctx.stroke();
      }
      for (let cz = 0; cz <= gridH; cz++) {
        const z = cz * cellTileSize * tilePx;
        ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(dungeon.width * tilePx, z); ctx.stroke();
      }

      // Golden path — yellow line from spawn to exit (this level's own)
      const golden = dungeon.goldenPath;
      if (golden.length > 1) {
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(golden[0]!.x * tilePx + tilePx / 2, golden[0]!.y * tilePx + tilePx / 2);
        for (let i = 1; i < golden.length; i++) {
          ctx.lineTo(golden[i]!.x * tilePx + tilePx / 2, golden[i]!.y * tilePx + tilePx / 2);
        }
        ctx.stroke();
      }

      // Live route — green line from the player toward the stack exit
      // (what the compass follows); only this level's segment is drawn
      if (playerPos && world) {
        const li = startLevelFor(world, playerPos, playerY) ?? currentLevel;
        const route = findWorldPathToExit(world, { level: li, x: playerPos.x, y: playerPos.y });
        if (route.length > 0) {
          ctx.strokeStyle = '#3dd68c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playerPos.x * tilePx + tilePx / 2, playerPos.y * tilePx + tilePx / 2);
          for (const p of route) {
            if (p.level !== currentLevel) break; // continues on the next level
            ctx.lineTo(p.x * tilePx + tilePx / 2, p.y * tilePx + tilePx / 2);
          }
          ctx.stroke();
        }
      }

      // Stairwell doorways on this level — blue diamonds
      if (world) {
        ctx.fillStyle = '#5599ff';
        for (const link of world.links) {
          for (const end of [link.a, link.b]) {
            if (end.level !== currentLevel) continue;
            const px = end.x * tilePx + tilePx / 2;
            const pz = end.y * tilePx + tilePx / 2;
            ctx.beginPath();
            ctx.moveTo(px, pz - 5);
            ctx.lineTo(px + 5, pz);
            ctx.lineTo(px, pz + 5);
            ctx.lineTo(px - 5, pz);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // Spawn marker
      const spx = dungeon.entrance.x * tilePx + tilePx / 2;
      const spz = dungeon.entrance.y * tilePx + tilePx / 2;
      ctx.fillStyle = '#0f0';
      ctx.beginPath(); ctx.arc(spx, spz, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = 'bold 8px monospace';
      ctx.fillText('S', spx - 3, spz + 3);

      // Exit marker
      const epx = dungeon.exit.x * tilePx + tilePx / 2;
      const epz = dungeon.exit.y * tilePx + tilePx / 2;
      ctx.fillStyle = '#f00';
      ctx.beginPath(); ctx.arc(epx, epz, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 8px monospace';
      ctx.fillText('X', epx - 3, epz + 3);

      // Player
      if (playerPos) {
        const ppx = playerPos.x * tilePx + tilePx / 2;
        const ppz = playerPos.y * tilePx + tilePx / 2;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ppx, ppz, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Legend
      const legendX = dungeon.width * tilePx + 10;
      ctx.fillStyle = '#ccc'; ctx.font = '12px monospace';
      ctx.fillText(`Level ${currentLevel + 1}/${WORLD_LEVELS}`, legendX, 20);
      ctx.fillText(`Mode: ${mode}`, legendX, 38);
      ctx.fillText('` toggle map', legendX, 56);
      ctx.fillText('Tab cycle mode', legendX, 71);
      let ly = 94;
      const legendItems = mode === 'biome'
        ? [['#1a1a1a', 'Wall'], [BIOME_COLORS.dungeon, 'Dungeon'], [BIOME_COLORS.cave, 'Cave'], [BIOME_COLORS.crypt, 'Crypt'], [BIOME_COLORS.ember, 'Ember'], [BIOME_COLORS.outside, 'Outside'], [PIT_COLOR, 'Hole'], ['#2a8a2a', 'Stairs'], ['#5599ff', 'Stairwell'], ['#ff0', 'Golden Path'], ['#3dd68c', 'Live Route'], ['#0f0', 'Spawn'], ['#f00', 'Exit']] as const
        : [['#1a1a1a', 'Wall'], ['#3a5a3a', 'Floor'], [PIT_COLOR, 'Hole'], ['#2a8a2a', 'Stairs'], ['#5599ff', 'Stairwell'], ['#ff0', 'Golden Path'], ['#3dd68c', 'Live Route'], ['#0f0', 'Spawn'], ['#f00', 'Exit']] as const;
      for (const [c, text] of legendItems) {
        ctx.fillStyle = c; ctx.fillRect(legendX, ly - 8, 12, 12);
        ctx.fillStyle = '#ccc'; ctx.fillText(text, legendX + 18, ly + 2);
        ly += 18;
      }
      return; // skip cell-level drawing
    }


    // Draw cells
    for (let cz = 0; cz < gridH; cz++) {
      for (let cx = 0; cx < gridW; cx++) {
        const cell = cellMap.get(`${cx},${cz}`);
        const px = cx * CELL_PX;
        const pz = cz * CELL_PX;

        if (!cell) {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(px, pz, CELL_PX - 1, CELL_PX - 1);
          continue;
        }

        // Background color based on mode
        let color = '#222';
        let label = '';

        switch (mode) {
          case 'noise': {
            const v = Math.floor(cell.noise * 255);
            color = cell.active ? `rgb(${v * 0.3}, ${v * 0.7}, ${v * 0.3})` : `rgb(${v * 0.3}, ${v * 0.15}, ${v * 0.15})`;
            label = cell.noise.toFixed(2);
            break;
          }
          case 'content': {
            const isHallway = hallwayCells.has(`${cell.cx},${cell.cz}`);
            if (isHallway) {
              color = '#4a3a1a';
              label = 'HALL';
            } else if (cell.active) {
              color = '#2a3a2a';
              label = `${cell.noise.toFixed(2)}`;
            } else {
              color = '#1a1a1a';
              label = 'void';
            }
            break;
          }
        }

        ctx.fillStyle = color;
        ctx.fillRect(px, pz, CELL_PX - 1, CELL_PX - 1);

        // Waypoint marker — diamond shape
        if (cell.isWaypoint) {
          const wcx = px + CELL_PX / 2;
          const wcz = pz + CELL_PX / 2;
          const ws = 6;
          ctx.fillStyle = cell.waypointRole === 'spawn' ? '#0f0'
            : cell.waypointRole === 'exit' ? '#f00'
            : cell.waypointRole === 'major' ? '#ff0'
            : '#fa0';
          ctx.beginPath();
          ctx.moveTo(wcx, wcz - ws);
          ctx.lineTo(wcx + ws, wcz);
          ctx.lineTo(wcx, wcz + ws);
          ctx.lineTo(wcx - ws, wcz);
          ctx.closePath();
          ctx.fill();

          // Waypoint order number
          ctx.fillStyle = '#000';
          ctx.font = 'bold 8px monospace';
          ctx.fillText(`${cell.waypointOrder}`, wcx - 3, wcz + 3);
        }

        // Label
        ctx.fillStyle = '#ccc';
        ctx.font = '9px monospace';
        ctx.fillText(label, px + 2, pz + CELL_PX - 4);

      }
    }

    // Draw spawn and exit markers
    if (dungeon) {
      const cellTileSize = 14; // must match CELL_TILE_SIZE in DungeonGenerator

      // Spawn — green circle with S
      const spawnCx = Math.floor(dungeon.entrance.x / cellTileSize);
      const spawnCz = Math.floor(dungeon.entrance.y / cellTileSize);
      ctx.fillStyle = '#0f0';
      ctx.beginPath();
      ctx.arc(spawnCx * CELL_PX + CELL_PX / 2, spawnCz * CELL_PX + CELL_PX / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('S', spawnCx * CELL_PX + CELL_PX / 2 - 4, spawnCz * CELL_PX + CELL_PX / 2 + 4);

      // Exit — red circle with X
      const exitCx = Math.floor(dungeon.exit.x / cellTileSize);
      const exitCz = Math.floor(dungeon.exit.y / cellTileSize);
      ctx.fillStyle = '#f00';
      ctx.beginPath();
      ctx.arc(exitCx * CELL_PX + CELL_PX / 2, exitCz * CELL_PX + CELL_PX / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('X', exitCx * CELL_PX + CELL_PX / 2 - 4, exitCz * CELL_PX + CELL_PX / 2 + 4);
    }

    // Draw player position
    if (dungeon && playerPos) {
      const cellTileSize = 14;
      const pcx = Math.floor(playerPos.x / cellTileSize);
      const pcz = Math.floor(playerPos.y / cellTileSize);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(pcx * CELL_PX + CELL_PX / 2, pcz * CELL_PX + CELL_PX / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff0';
      ctx.font = '10px monospace';
      ctx.fillText('YOU', pcx * CELL_PX + CELL_PX / 2 - 10, pcz * CELL_PX - 3);
    }

    // Legend
    const legendX = gridW * CELL_PX + 10;
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.fillText(`Mode: ${mode}`, legendX, 20);
    ctx.fillText('` toggle map', legendX, 40);
    ctx.fillText('Tab cycle mode', legendX, 55);
    ctx.fillText('', legendX, 75);

    const legendItems: Array<[string, string]> = mode === 'content'
      ? [['#2a3a2a', 'Active'], ['#4a3a1a', 'Hallway'], ['#1a1a1a', 'Void'], ['#0f0', 'Spawn (S)'], ['#f00', 'Exit (X)'], ['#fff', 'Player']]
      : [['#0f0', 'High noise'], ['#300', 'Low noise'], ['#fff', 'Player']];

    let ly = 80;
    for (const [c, text] of legendItems) {
      ctx.fillStyle = c;
      ctx.fillRect(legendX, ly - 8, 12, 12);
      ctx.fillStyle = '#ccc';
      ctx.fillText(text, legendX + 18, ly + 2);
      ly += 18;
    }

    // Stats
    ly += 10;
    const stats = {
      total: cells.length,
      active: cells.filter((c) => c.active).length,
      waypoints: cells.filter((c) => c.isWaypoint).length,
      hallways: hallwayCells.size,
    };
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    for (const [key, val] of Object.entries(stats)) {
      ctx.fillText(`${key}: ${val}`, legendX, ly);
      ly += 16;
    }
  }, [visible, mode, dungeon, world, playerPos, playerY, currentLevel]);

  if (!visible) return null;

  return (
    <div className="debug-map-overlay">
      <canvas ref={canvasRef} className="debug-map-canvas" />
    </div>
  );
}
