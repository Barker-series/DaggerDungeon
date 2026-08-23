import { useRef, useEffect, useState, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { tileBiome } from '../game/dungeon/cells';
import { PIT_LEVEL } from '../game/dungeon/heightfield';
import { sliceAt } from '../game/mapslice';
import { TILE_SIZE } from '../game/types';
import { buildOrganicContour } from '../game/dungeon/organiccontour';
import { drawSmoothWallOverlay } from './mapContour';
import { PILLAR_FACTOR } from '../game/dungeon/pillar-layer';
import { regionAtCell, type RegionType } from '../game/dungeon/region-layer';

const PIT_COLOR = '#601525';
const ELEVATOR_COLOR = '#ff4fd8';

const CELL_PX = 40; // pixels per cell in the debug view

const BIOME_COLORS = {
  dungeon: '#2a5a8a',
  cave: '#8a5a2a',
  crypt: '#5a7a9a',
  ember: '#9a3a1a',
  outside: '#3a7a3a',
} as const;

const REGION_COLORS: Record<RegionType, string> = {
  city: '#6f7389',
  machine: '#8b653c',
  canyon: '#78453b',
  frontier: '#486a55',
  roads: '#3d5a8a',
  fold: '#7a5fa8',
};

type ViewMode = 'slice' | 'tiles' | 'biome' | 'region' | 'noise' | 'content' | 'pillars';
const VIEW_MODES: ViewMode[] = ['slice', 'tiles', 'biome', 'region', 'noise', 'content', 'pillars'];

function drawElevatorMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  radius: number,
): void {
  ctx.fillStyle = ELEVATOR_COLOR;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, z - radius);
  ctx.lineTo(x + radius, z);
  ctx.lineTo(x, z + radius);
  ctx.lineTo(x - radius, z);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#160915';
  ctx.font = `bold ${Math.max(8, radius)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('E', x, z + 0.5);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

export function DebugMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<ViewMode>('slice');
  const dungeon = useGameStore((s) => s.dungeon);
  // Marching-squares contour — the same lines the walls render/collide with
  const storeContour = useGameStore((s) => s.worldContour);
  // Prefer the engine's contour (built off-thread with the world); the
  // local rebuild is only a fallback for views without one
  const contour = useMemo(
    () => storeContour ?? (dungeon ? buildOrganicContour(dungeon) : null),
    [storeContour, dungeon],
  );
  const world = useGameStore((s) => s.world);
  const spawnAbs = useGameStore((s) => s.spawnAbs);
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

    // Snapshots carried on the level — the generation-time singletons
    // live in the worker's module instance, not this thread's
    const cells = dungeon?.cellDebug ?? [];
    const transitCells = new Set(dungeon?.transitCells ?? []);
    if (cells.length === 0) return;

    // The run's ONE spawn point (absolute tiles), converted to this
    // window's local frame. Each window recomputes a local `entrance`,
    // but R always returns to this spot — draw only this, and only
    // when the window contains it.
    const spawnLocal = spawnAbs && world && dungeon
      ? { x: spawnAbs.x - world.originPcx * 56, y: spawnAbs.y - world.originPcz * 56 }
      : null;
    const spawnVisible = spawnLocal !== null && dungeon !== null
      && spawnLocal.x >= 0 && spawnLocal.y >= 0
      && spawnLocal.x < dungeon.width && spawnLocal.y < dungeon.height;

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
    const cellMap = new Map<string, (typeof cells)[number]>();
    for (const cell of cells) {
      cellMap.set(`${cell.cx},${cell.cz}`, cell);
    }

    // ── Elevation slice: what exists at the PLAYER'S height, from the
    // column model — pillar interiors, ramps, plazas, bridges included.
    // The vertical buffer keeps ramps/steps readable however tangled
    // the vertical layout gets. ──
    if (mode === 'slice' && dungeon && world) {
      const mapSize = 560;
      const tilePx = Math.max(2, Math.floor(mapSize / dungeon.width));
      canvas.width = dungeon.width * tilePx + 200;
      canvas.height = dungeon.height * tilePx + 40;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const w = dungeon.width;
      for (let tz = 0; tz < dungeon.height; tz++) {
        for (let tx = 0; tx < w; tx++) {
          const cell = sliceAt(world.columns[tz * w + tx]!, playerY);
          let color: string | null = null;
          if (cell.kind === 'walk') {
            const dh = Math.max(-4, Math.min(4, cell.floor - playerY));
            const v = Math.round(96 + dh * 12);
            color = `rgb(${v},${v},${v + 10})`;
          } else if (cell.kind === 'abyss') color = PIT_COLOR;
          else if (cell.kind === 'below') color = '#1a2a3e';
          else if (cell.kind === 'above') color = '#2a3a24';
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(tx * tilePx, tz * tilePx, tilePx, tilePx);
          }
        }
      }

      // ── Smooth walls: contour overlay (same segments the world uses) ──
      if (contour) {
        const worldToPx = (wx: number, wz: number): [number, number] =>
          [(wx / TILE_SIZE) * tilePx, (wz / TILE_SIZE) * tilePx];
        const floorColorAt = (ftx: number, ftz: number): string | null => {
          const col = world.columns[ftz * w + ftx];
          if (!col) return null;
          const cell = sliceAt(col, playerY);
          if (cell.kind === 'walk') {
            const dh = Math.max(-4, Math.min(4, cell.floor - playerY));
            const v = Math.round(96 + dh * 12);
            return `rgb(${v},${v},${v + 10})`;
          }
          if (cell.kind === 'abyss') return PIT_COLOR;
          if (cell.kind === 'below') return '#1a2a3e';
          if (cell.kind === 'above') return '#2a3a24';
          return null;
        };
        drawSmoothWallOverlay(
          ctx, contour, dungeon, worldToPx, floorColorAt, '#111',
          dungeon.width * tilePx, dungeon.height * tilePx,
        );
      }

      for (const spec of world.pillars.values()) {
        if (!spec.elevator) continue;
        drawElevatorMarker(
          ctx,
          (spec.cx * 56 + 28) * tilePx,
          (spec.cz * 56 + 28) * tilePx,
          Math.max(5, tilePx * 3),
        );
      }

      // Player marker
      if (playerPos) {
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(playerPos.x * tilePx + tilePx / 2, playerPos.y * tilePx + tilePx / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Legend
      const legendX = dungeon.width * tilePx + 10;
      ctx.fillStyle = '#ccc'; ctx.font = '12px monospace';
      ctx.fillText(`Slice @ y=${playerY.toFixed(1)}`, legendX, 20);
      ctx.fillText(`Mode: ${mode}`, legendX, 38);
      ctx.fillText('` toggle map', legendX, 56);
      ctx.fillText('Tab cycle mode', legendX, 71);
      let ly = 94;
      const items = [
        ['#606066', 'Walkable (here)'],
        ['#b0b0ba', 'Walkable (higher)'],
        ['#2a3a24', 'Landing above'],
        ['#1a2a3e', 'Open air below'],
        [PIT_COLOR, 'Abyss'],
        ['#111', 'Solid'],
        [ELEVATOR_COLOR, 'Elevator shaft'],
        ['#ff0', 'You'],
      ] as const;
      for (const [c, text] of items) {
        ctx.fillStyle = c; ctx.fillRect(legendX, ly - 8, 12, 12);
        ctx.fillStyle = '#ccc'; ctx.fillText(text, legendX + 18, ly + 2);
        ly += 18;
      }
      return;
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

      // ── Smooth walls: contour overlay so map corners match the world ──
      if (contour) {
        const worldToPx = (wx: number, wz: number): [number, number] =>
          [(wx / TILE_SIZE) * tilePx, (wz / TILE_SIZE) * tilePx];
        const floorColorAt = (ftx: number, ftz: number): string | null => {
          if (dungeon.floorHeights[ftz]?.[ftx] === undefined) return null;
          if (dungeon.floorHeights[ftz]![ftx]! <= PIT_LEVEL) return PIT_COLOR;
          if (mode === 'biome') {
            const biome = tileBiome(dungeon.cellBiomes, ftx, ftz) ?? 'dungeon';
            return BIOME_COLORS[biome] ?? '#2a5a8a';
          }
          return '#3a5a3a';
        };
        const wallColor = mode === 'biome' ? '#0a0a0a' : '#1a1a1a';
        drawSmoothWallOverlay(
          ctx, contour, dungeon, worldToPx, floorColorAt, wallColor,
          dungeon.width * tilePx, dungeon.height * tilePx,
        );
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

      // Spawn marker — the run's fixed respawn point, if in this window
      if (spawnVisible && spawnLocal) {
        const spx = spawnLocal.x * tilePx + tilePx / 2;
        const spz = spawnLocal.y * tilePx + tilePx / 2;
        ctx.fillStyle = '#0f0';
        ctx.beginPath(); ctx.arc(spx, spz, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.font = 'bold 8px monospace';
        ctx.fillText('S', spx - 3, spz + 3);
      }

      if (world) {
        for (const spec of world.pillars.values()) {
          if (!spec.elevator) continue;
          drawElevatorMarker(
            ctx,
            (spec.cx * 56 + 28) * tilePx,
            (spec.cz * 56 + 28) * tilePx,
            Math.max(5, tilePx * 3),
          );
        }
      }

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
      ctx.fillText(`Stack ${currentLevel + 1}`, legendX, 20);
      ctx.fillText(`Mode: ${mode}`, legendX, 38);
      ctx.fillText('` toggle map', legendX, 56);
      ctx.fillText('Tab cycle mode', legendX, 71);
      let ly = 94;
      const legendItems = mode === 'biome'
        ? [['#1a1a1a', 'Wall'], [BIOME_COLORS.dungeon, 'Dungeon'], [BIOME_COLORS.cave, 'Cave'], [BIOME_COLORS.crypt, 'Crypt'], [BIOME_COLORS.ember, 'Ember'], [BIOME_COLORS.outside, 'Outside'], [PIT_COLOR, 'Hole'], [ELEVATOR_COLOR, 'Elevator shaft'], ['#0f0', 'Spawn'], ['#fff', 'Player']] as const
        : [['#1a1a1a', 'Wall'], ['#3a5a3a', 'Floor'], ['#5a4a2a', 'Door'], [PIT_COLOR, 'Hole'], [ELEVATOR_COLOR, 'Elevator shaft'], ['#0f0', 'Spawn'], ['#fff', 'Player']] as const;
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
            const isTransit = transitCells.has(`${cell.cx},${cell.cz}`);
            if (isTransit) {
              color = '#4a3a1a';
              label = 'TRANSIT';
            } else if (cell.active) {
              color = '#2a3a2a';
              label = `${cell.noise.toFixed(2)}`;
            } else {
              color = '#1a1a1a';
              label = 'void';
            }
            break;
          }
          case 'pillars': {
            // Pillars live on their own coarse grid — drawn after the
            // cell loop as 4x4-cell blocks
            color = '#14101c';
            label = '';
            break;
          }
          case 'region': {
            if (world) {
              const absoluteCx = world.originPcx * PILLAR_FACTOR + cell.cx;
              const absoluteCz = world.originPcz * PILLAR_FACTOR + cell.cz;
              const region = regionAtCell(
                world.seed + world.stack * 100000,
                absoluteCx,
                absoluteCz,
              );
              color = REGION_COLORS[region];
              label = region.toUpperCase();
            }
            break;
          }
        }

        ctx.fillStyle = color;
        ctx.fillRect(px, pz, CELL_PX - 1, CELL_PX - 1);

        // Label
        ctx.fillStyle = '#ccc';
        ctx.font = '9px monospace';
        ctx.fillText(label, px + 2, pz + CELL_PX - 4);

      }
    }

    // Pillar blocks — the coarse layer, one block per 4x4 dungeon cells
    if (mode === 'pillars' && world) {
      const P = CELL_PX * 4;
      for (const spec of world.pillars.values()) {
        const px = spec.cx * P;
        const pz = spec.cz * P;
        // Brightness tracks kebab height — tall monuments glow
        const t = Math.min(1, spec.totalHeight / 80);
        ctx.fillStyle = spec.elevator
          ? '#8b246f'
          : `rgb(${Math.floor(40 + t * 60)}, ${Math.floor(30 + t * 120)}, ${Math.floor(70 + t * 150)})`;
        const inset = Math.floor(P * 0.23); // footprint ≈ central 54%
        ctx.fillRect(px + inset, pz + inset, P - 2 * inset, P - 2 * inset);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.strokeRect(px + inset, pz + inset, P - 2 * inset, P - 2 * inset);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px monospace';
        if (spec.elevator) {
          drawElevatorMarker(ctx, px + P / 2, pz + P / 2, 14);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('SHAFT', px + P / 2, pz + P / 2 + 27);
          ctx.textAlign = 'start';
        } else {
          ctx.fillText(`${spec.chunks.length}·${Math.round(spec.totalHeight)}`, px + P / 2 - 12, pz + P / 2 + 3);
        }
        // Bridge sockets — ticks on the face they open from, positioned
        // along the edge by height (low → corner, high → far)
        ctx.fillStyle = '#ffd24a';
        for (const s of spec.sockets) {
          if (s.kind !== 'bridge') continue;
          const frac = Math.min(1, s.yAbs / spec.totalHeight);
          const o = 4 + frac * (P - 12);
          if (s.face === 'north') ctx.fillRect(px + o, pz + inset - 4, 5, 3);
          else if (s.face === 'south') ctx.fillRect(px + o, pz + P - inset + 1, 5, 3);
          else if (s.face === 'west') ctx.fillRect(px + inset - 4, pz + o, 3, 5);
          else if (s.face === 'east') ctx.fillRect(px + P - inset + 1, pz + o, 3, 5);
        }
      }
    }

    // Bridges — teal lines between pillar cell centers, brighter = higher
    if (mode === 'pillars' && world) {
      const P = CELL_PX * 4;
      for (const br of world.bridges) {
        const x0 = br.cx * P + P / 2;
        const z0 = br.cz * P + P / 2;
        const x1 = x0 + (br.dir === 'east' ? P : 0);
        const z1 = z0 + (br.dir === 'south' ? P : 0);
        const t = Math.min(1, ((br.yA + br.yB) / 2) / 80);
        ctx.strokeStyle = `rgba(${Math.floor(60 + t * 195)}, 230, 200, 0.9)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, z0);
        ctx.lineTo(x1, z1);
        ctx.stroke();
      }
    }

    // Elevator identity remains visible on every cell-level diagnostic view,
    // not only the pillar layer.
    if (mode !== 'pillars' && world) {
      for (const spec of world.pillars.values()) {
        if (!spec.elevator) continue;
        drawElevatorMarker(
          ctx,
          (spec.cx * PILLAR_FACTOR + PILLAR_FACTOR / 2) * CELL_PX,
          (spec.cz * PILLAR_FACTOR + PILLAR_FACTOR / 2) * CELL_PX,
          10,
        );
      }
    }

    // Draw spawn marker — the run's fixed respawn point, if in this window
    if (spawnVisible && spawnLocal) {
      const cellTileSize = 14; // must match CELL_TILE_SIZE in DungeonGenerator

      // Spawn — green circle with S
      const spawnCx = Math.floor(spawnLocal.x / cellTileSize);
      const spawnCz = Math.floor(spawnLocal.y / cellTileSize);
      ctx.fillStyle = '#0f0';
      ctx.beginPath();
      ctx.arc(spawnCx * CELL_PX + CELL_PX / 2, spawnCz * CELL_PX + CELL_PX / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('S', spawnCx * CELL_PX + CELL_PX / 2 - 4, spawnCz * CELL_PX + CELL_PX / 2 + 4);
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
      ? [['#2a3a2a', 'Active'], ['#4a3a1a', 'Permanent transit'], [ELEVATOR_COLOR, 'Elevator shaft'], ['#1a1a1a', 'Inactive'], ['#0f0', 'Spawn'], ['#fff', 'Player']]
      : mode === 'pillars'
        ? [[ELEVATOR_COLOR, 'Elevator shaft'], ['#8ac6dc', 'Tall pillar'], ['#38326a', 'Short pillar'], ['#14101c', 'Void (no pillar)'], ['#ffd24a', 'Bridge socket'], ['#3ce6c8', 'Bridge'], ['#fff', 'Player']]
      : mode === 'region'
          ? [[REGION_COLORS.city, 'City'], [REGION_COLORS.machine, 'Machine'], [REGION_COLORS.canyon, 'Canyon'], [REGION_COLORS.frontier, 'Frontier'], [REGION_COLORS.roads, 'Roads'], [ELEVATOR_COLOR, 'Elevator shaft'], ['#0f0', 'Spawn'], ['#fff', 'Player']]
          : [['#0f0', 'High noise'], ['#300', 'Low noise'], [ELEVATOR_COLOR, 'Elevator shaft'], ['#fff', 'Player']];

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
    const pillarSpecs = world ? [...world.pillars.values()] : [];
    const stats = {
      total: cells.length,
      active: cells.filter((c) => c.active).length,
      transitCells: transitCells.size,
      pillars: pillarSpecs.length,
      elevators: pillarSpecs.filter((p) => p.elevator).length,
      avgHeight: pillarSpecs.length
        ? (pillarSpecs.reduce((s, p) => s + p.totalHeight, 0) / pillarSpecs.length).toFixed(1)
        : '0',
    };
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    for (const [key, val] of Object.entries(stats)) {
      ctx.fillText(`${key}: ${val}`, legendX, ly);
      ly += 16;
    }
  }, [visible, mode, dungeon, world, contour, spawnAbs, playerPos, playerY, currentLevel]);

  if (!visible) return null;

  return (
    <div className="debug-map-overlay">
      <canvas ref={canvasRef} className="debug-map-canvas" />
    </div>
  );
}
