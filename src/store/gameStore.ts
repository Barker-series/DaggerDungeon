import { create } from 'zustand';
import {
  Direction,
  type GridPos,
  type DungeonData,
  type EnemyInstance,
  type GameItem,
  type ItemDrop,
  type PlayerStats,
  type ClassName,
} from '../game/types';

export interface DamagePopup {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  time: number;
}

export interface GameState {
  // ── Screen ──
  screen: 'menu' | 'classSelect' | 'playing' | 'dead' | 'shrine';

  // ── Player ──
  playerPos: GridPos;
  playerFacing: Direction;
  playerYaw: number; // camera yaw in radians for minimap
  playerHp: number;
  playerMaxHp: number;
  playerMana: number;
  playerMaxMana: number;
  playerStats: PlayerStats;
  playerClass: ClassName | null;

  // ── Inventory ──
  weapon: GameItem | null;
  hotbar: (GameItem | null)[];
  gold: number;

  // ── Dungeon ──
  seed: number;
  dungeon: DungeonData | null;
  currentFloor: number;

  // ── Entities ──
  enemies: EnemyInstance[];
  itemDrops: ItemDrop[];

  // ── Combat feedback ──
  attackSwing: number; // timestamp of last swing (0 = none)
  damageTaken: number; // timestamp of last hit taken
  damagePopups: DamagePopup[];

  // ── Run stats ──
  killCount: number;
  soulShardsEarned: number;

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
  takeDamage: (amount: number) => void;
  heal: (amount: number) => void;
  setEnemies: (enemies: EnemyInstance[]) => void;
  updateEnemy: (id: string, update: Partial<EnemyInstance>) => void;
  removeEnemy: (id: string) => void;
  addItemDrop: (drop: ItemDrop) => void;
  removeItemDrop: (id: string) => void;
  equipWeapon: (weapon: GameItem) => void;
  addToHotbar: (item: GameItem) => void;
  removeFromHotbar: (slot: number) => void;
  addGold: (amount: number) => void;
  addKill: () => void;
  addSoulShards: (amount: number) => void;
  toggleAutoPlay: () => void;
  triggerSwing: () => void;
  addDamagePopup: (popup: Omit<DamagePopup, 'id' | 'time'>) => void;
  cleanPopups: () => void;
  startRun: (className: ClassName, stats: PlayerStats, hp: number, mana: number, weapon: GameItem, items: GameItem[]) => void;
  resetRun: () => void;
}

let popupId = 0;

export const useGameStore = create<GameState>((set) => ({
  screen: 'menu',
  playerPos: { x: 0, y: 0 },
  playerFacing: Direction.North,
  playerYaw: 0,
  playerHp: 100,
  playerMaxHp: 100,
  playerMana: 0,
  playerMaxMana: 0,
  playerStats: { str: 10, agi: 10, int: 10, end: 10, spd: 10, lck: 10 },
  playerClass: null,
  weapon: null,
  hotbar: [null, null, null],
  gold: 0,
  seed: Date.now(),
  dungeon: null,
  currentFloor: 1,
  enemies: [],
  itemDrops: [],
  attackSwing: 0,
  damageTaken: 0,
  damagePopups: [],
  killCount: 0,
  soulShardsEarned: 0,
  autoPlay: false,

  setScreen: (screen) => set({ screen }),
  setSeed: (seed) => set({ seed }),
  setPlayerPos: (playerPos) => set({ playerPos }),
  setPlayerFacing: (playerFacing) => set({ playerFacing }),
  setPlayerYaw: (playerYaw) => set({ playerYaw }),
  setDungeon: (dungeon) => set({ dungeon }),
  setCurrentFloor: (currentFloor) => set({ currentFloor }),
  takeDamage: (amount) =>
    set((s) => ({ playerHp: Math.max(0, s.playerHp - amount), damageTaken: Date.now() })),
  heal: (amount) =>
    set((s) => ({ playerHp: Math.min(s.playerMaxHp, s.playerHp + amount) })),
  setEnemies: (enemies) => set({ enemies }),
  updateEnemy: (id, update) =>
    set((s) => ({
      enemies: s.enemies.map((e) => (e.id === id ? { ...e, ...update } : e)),
    })),
  removeEnemy: (id) =>
    set((s) => ({ enemies: s.enemies.filter((e) => e.id !== id) })),
  addItemDrop: (drop) =>
    set((s) => ({ itemDrops: [...s.itemDrops, drop] })),
  removeItemDrop: (id) =>
    set((s) => ({ itemDrops: s.itemDrops.filter((d) => d.id !== id) })),
  equipWeapon: (weapon) => set({ weapon }),
  addToHotbar: (item) =>
    set((s) => {
      const idx = s.hotbar.indexOf(null);
      if (idx === -1) return s;
      const newBar = [...s.hotbar];
      newBar[idx] = item;
      return { hotbar: newBar };
    }),
  removeFromHotbar: (slot) =>
    set((s) => {
      const newBar = [...s.hotbar];
      newBar[slot] = null;
      return { hotbar: newBar };
    }),
  addGold: (amount) => set((s) => ({ gold: s.gold + amount })),
  addKill: () => set((s) => ({ killCount: s.killCount + 1 })),
  addSoulShards: (amount) =>
    set((s) => ({ soulShardsEarned: s.soulShardsEarned + amount })),
  toggleAutoPlay: () => set((s) => ({ autoPlay: !s.autoPlay })),
  triggerSwing: () => set({ attackSwing: Date.now() }),
  addDamagePopup: (popup) =>
    set((s) => ({
      damagePopups: [...s.damagePopups, { ...popup, id: popupId++, time: Date.now() }],
    })),
  cleanPopups: () =>
    set((s) => ({
      damagePopups: s.damagePopups.filter((p) => Date.now() - p.time < 1200),
    })),

  startRun: (className, stats, hp, mana, weapon, items) =>
    set({
      screen: 'playing',
      playerClass: className,
      playerStats: stats,
      playerHp: hp,
      playerMaxHp: hp,
      playerMana: mana,
      playerMaxMana: mana,
      weapon,
      hotbar: [items[0] ?? null, items[1] ?? null, items[2] ?? null],
      gold: 0,
      currentFloor: 1,
      enemies: [],
      itemDrops: [],
      attackSwing: 0,
      damageTaken: 0,
      damagePopups: [],
      killCount: 0,
      soulShardsEarned: 0,
    }),

  resetRun: () =>
    set({
      screen: 'menu',
      dungeon: null,
      enemies: [],
      itemDrops: [],
      damagePopups: [],
      playerHp: 100,
      playerMaxHp: 100,
    }),
}));
