import { create } from 'zustand';
import { Direction, type GridPos, type DungeonData, type WorldData } from '../game/types';
import type { Tunables } from '../game/dungeon/tunables';

export interface GameState {
  // ── Screen ──
  screen: 'menu' | 'playing';

  // ── Player ──
  playerPos: GridPos;
  /** World-space feet height — resolves which level owns a mid-ramp position */
  playerY: number;
  playerFacing: Direction;
  playerYaw: number; // camera yaw in radians for minimap

  // ── World ──
  seed: number;
  /** The whole stack of physically coexisting levels */
  world: WorldData | null;
  /** The level the player is currently on — what all the 2D UI shows */
  dungeon: DungeonData | null;
  /** Index of `dungeon` within the stack (0 = top) */
  currentLevel: number;
  /** Stack index — how many megastructure segments deep the run is */
  currentFloor: number;

  // ── Auto-play ──
  autoPlay: boolean;

  // ── Telemetry ──
  /** Smoothed frames-per-second, published by the engine ~2x/second */
  fps: number;

  /** The run's ONE spawn/respawn point in ABSOLUTE tiles (window (0,0)'s
   *  entrance). Windows recompute a local `entrance` as they stream; this
   *  is the fixed spot R returns to — what maps should mark. */
  spawnAbs: GridPos | null;

  // ── DaggerKit editor mode (E1) ──
  /** Dev-only inspection mode: noclip fly camera, editor HUD */
  editorActive: boolean;
  /** Fly speed in units/second (engine-published for the HUD) */
  editorSpeed: number;
  /** A DDSNAP string the HUD asks the engine to teleport to; the
   *  engine consumes it (sets back to null) on the next frame */
  editorTeleport: string | null;
  /** E2 provenance selection: the full copyable report and the short
   *  lines the HUD displays. Null = nothing selected. */
  editorSelection: { report: string; summary: string[] } | null;
  /** E3: pending tunables change the engine consumes next frame */
  editorTunables: Partial<Tunables> | null;
  /** E3: true while the window is regenerating after a tunables change */
  editorRegenerating: boolean;

  // ── Actions ──
  setScreen: (s: GameState['screen']) => void;
  setSeed: (seed: number) => void;
  setPlayerPos: (pos: GridPos) => void;
  setPlayerY: (y: number) => void;
  setPlayerFacing: (dir: Direction) => void;
  setPlayerYaw: (yaw: number) => void;
  setWorld: (w: WorldData) => void;
  setCurrentLevel: (level: number) => void;
  setCurrentFloor: (f: number) => void;
  toggleAutoPlay: () => void;
  setFps: (fps: number) => void;
  setSpawnAbs: (pos: GridPos) => void;
  setEditorActive: (on: boolean) => void;
  setEditorSpeed: (speed: number) => void;
  requestEditorTeleport: (snap: string | null) => void;
  setEditorSelection: (sel: { report: string; summary: string[] } | null) => void;
  requestEditorTunables: (values: Partial<Tunables> | null) => void;
  setEditorRegenerating: (on: boolean) => void;
  startRun: () => void;
  resetRun: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  screen: 'menu',
  playerPos: { x: 0, y: 0 },
  playerY: 0,
  playerFacing: Direction.North,
  playerYaw: 0,
  seed: Date.now(),
  world: null,
  dungeon: null,
  currentLevel: 0,
  currentFloor: 1,
  autoPlay: false,
  fps: 0,
  spawnAbs: null,
  editorActive: false,
  editorSpeed: 24,
  editorTeleport: null,
  editorSelection: null,
  editorTunables: null,
  editorRegenerating: false,

  setScreen: (screen) => set({ screen }),
  setSeed: (seed) => set({ seed }),
  setPlayerPos: (playerPos) => set({ playerPos }),
  setPlayerY: (playerY) => set({ playerY }),
  setPlayerFacing: (playerFacing) => set({ playerFacing }),
  setPlayerYaw: (playerYaw) => set({ playerYaw }),
  setWorld: (world) =>
    set({ world, currentLevel: 0, dungeon: world.levels[0] ?? null }),
  setCurrentLevel: (currentLevel) =>
    set((s) => ({ currentLevel, dungeon: s.world?.levels[currentLevel] ?? null })),
  setCurrentFloor: (currentFloor) => set({ currentFloor }),
  toggleAutoPlay: () => set((s) => ({ autoPlay: !s.autoPlay })),
  setFps: (fps) => set({ fps }),
  setSpawnAbs: (spawnAbs) => set({ spawnAbs }),
  setEditorActive: (editorActive) => set({ editorActive }),
  setEditorSpeed: (editorSpeed) => set({ editorSpeed }),
  requestEditorTeleport: (editorTeleport) => set({ editorTeleport }),
  setEditorSelection: (editorSelection) => set({ editorSelection }),
  requestEditorTunables: (editorTunables) => set({ editorTunables }),
  setEditorRegenerating: (editorRegenerating) => set({ editorRegenerating }),

  startRun: () =>
    set({
      screen: 'playing',
      currentFloor: 1,
    }),

  resetRun: () =>
    set({
      screen: 'menu',
      world: null,
      dungeon: null,
    }),
}));
