import { create } from 'zustand';
import { Direction, type GridPos, type DungeonData } from '../game/types';

export interface GameState {
  // ── Screen ──
  screen: 'menu' | 'playing';

  // ── Player ──
  playerPos: GridPos;
  playerFacing: Direction;
  playerYaw: number; // camera yaw in radians for minimap

  // ── Dungeon ──
  seed: number;
  dungeon: DungeonData | null;
  currentFloor: number;

  // ── Auto-play ──
  autoPlay: boolean;

  // ── Actions ──
  setScreen: (s: GameState['screen']) => void;
  setSeed: (seed: number) => void;
  setPlayerPos: (pos: GridPos) => void;
  setPlayerFacing: (dir: Direction) => void;
  setPlayerYaw: (yaw: number) => void;
  setDungeon: (d: DungeonData) => void;
  setCurrentFloor: (f: number) => void;
  toggleAutoPlay: () => void;
  startRun: () => void;
  resetRun: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  screen: 'menu',
  playerPos: { x: 0, y: 0 },
  playerFacing: Direction.North,
  playerYaw: 0,
  seed: Date.now(),
  dungeon: null,
  currentFloor: 1,
  autoPlay: false,

  setScreen: (screen) => set({ screen }),
  setSeed: (seed) => set({ seed }),
  setPlayerPos: (playerPos) => set({ playerPos }),
  setPlayerFacing: (playerFacing) => set({ playerFacing }),
  setPlayerYaw: (playerYaw) => set({ playerYaw }),
  setDungeon: (dungeon) => set({ dungeon }),
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
      dungeon: null,
    }),
}));
