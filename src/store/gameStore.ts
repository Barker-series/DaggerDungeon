import { create } from 'zustand';
import { Direction, type GridPos, type DungeonData, type WorldData } from '../game/types';

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
