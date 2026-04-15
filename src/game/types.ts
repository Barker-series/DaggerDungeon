// ── Dungeon Grid ──

export enum TileType {
  Wall = 0,
  Floor = 1,
  Door = 2,
  StairsDown = 3,
  StairsUp = 4,
}

export enum Direction {
  North = 0, // -Z in world space
  East = 1, // +X
  South = 2, // +Z
  West = 3, // -X
}

export interface GridPos {
  x: number;
  y: number;
}

export enum RoomType {
  Entrance = 'entrance',
  Combat = 'combat',
  Treasure = 'treasure',
  Trap = 'trap',
  Boss = 'boss',
}

export interface RoomData {
  center: GridPos;
  left: number;
  top: number;
  width: number;
  height: number;
  ceilingHeight: number; // world units, varies per room
  type: RoomType;
  doors: GridPos[];
}

export interface DungeonData {
  width: number;
  height: number;
  tiles: TileType[][];
  rooms: RoomData[];
  entrance: GridPos;
  exit: GridPos;
  seed: number;
  floor: number;
}

// ── Entities ──

export enum EnemyType {
  Rat = 'rat',
  Skeleton = 'skeleton',
  Bat = 'bat',
  Imp = 'imp',
  Orc = 'orc',
}

export type EnemyArchetype = 'melee_rusher' | 'melee_tactical' | 'hit_and_run' | 'ranged' | 'heavy';
export type AlertLevel = 'idle' | 'suspicious' | 'alert' | 'combat';
export type AttackPhase = 'none' | 'windUp' | 'active' | 'recovery';
export type CombatStyle = 'approach' | 'circleLeft' | 'circleRight' | 'backstep' | 'hold' | 'flee';
export type AmbientBehavior = 'idle' | 'wander' | 'patrol' | 'chat';

export interface AttackDef {
  name: string;
  windUpMs: number;
  activeMs: number;
  recoveryMs: number;
  damage: [number, number];
  range: number;       // world units
  isRanged: boolean;
  projectileSpeed?: number;
  projectileGravity?: number;
}

export interface EnemyDef {
  type: EnemyType;
  archetype: EnemyArchetype;
  name: string;
  hp: number;
  speed: number;           // world units per second
  agility: number;
  color: number;
  sprite: string;            // path to sprite texture e.g. '/sprites/enemy-rat.png'
  xpValue: number;
  viewDistance: number;     // world units
  viewAngle: number;       // radians (full FOV)
  hearingRadius: number;   // world units
  attackRange: number;     // preferred engagement distance
  attacks: AttackDef[];
  combatWeights: Record<CombatStyle, number>; // base utility weights
}

export interface EnemyInstance {
  id: string;
  def: EnemyDef;
  hp: number;

  // World-space (continuous)
  worldX: number;
  worldZ: number;
  // Grid derived from world pos (for pathfinding, store compat)
  position: GridPos;

  // Perception
  alertLevel: AlertLevel;
  suspicion: number;
  lastKnownPlayerX: number;
  lastKnownPlayerZ: number;
  lastSeenTime: number;

  // Attack
  attackPhase: AttackPhase;
  attackTimer: number;       // time remaining in current phase (seconds)
  currentAttack: AttackDef | null;
  attackCooldown: number;    // time until can attack again

  // Combat movement
  combatStyle: CombatStyle;
  combatStyleTimer: number;
  preferredStrafeDir: 1 | -1;

  // Ambient
  ambientBehavior: AmbientBehavior;
  ambientTimer: number;
  wanderTargetX: number;
  wanderTargetZ: number;
  homeX: number;
  homeZ: number;
  chatPartnerId: string | null;

  // General
  state: 'alive' | 'dead';
  facing: Direction;
}

// ── Items ──

export enum MaterialTier {
  Iron = 'iron',
  Steel = 'steel',
  Silver = 'silver',
  Elven = 'elven',
  Dwarven = 'dwarven',
  Mithril = 'mithril',
  Ebony = 'ebony',
  Daedric = 'daedric',
}

export enum WeaponType {
  Dagger = 'dagger',
  Shortsword = 'shortsword',
  Longsword = 'longsword',
  Mace = 'mace',
  Staff = 'staff',
}

export interface WeaponItem {
  kind: 'weapon';
  id: string;
  type: WeaponType;
  material: MaterialTier;
  damage: [number, number];
  cooldown: number;
  name: string;
}

export interface ConsumableItem {
  kind: 'consumable';
  id: string;
  type: 'health_potion' | 'mana_potion' | 'scroll_fireball';
  name: string;
  effect: number;
}

export type GameItem = WeaponItem | ConsumableItem;

export interface ItemDrop {
  item: GameItem;
  position: GridPos;
  id: string;
}

// ── Player ──

export interface PlayerStats {
  str: number;
  agi: number;
  int: number;
  end: number;
  spd: number;
  lck: number;
}

export enum ClassName {
  Warrior = 'warrior',
  Rogue = 'rogue',
  Mage = 'mage',
  Knight = 'knight',
  Ranger = 'ranger',
  Battlemage = 'battlemage',
}

export interface ClassDef {
  name: ClassName;
  displayName: string;
  description: string;
  stats: PlayerStats;
  startingWeapon: WeaponItem;
  startingItems: ConsumableItem[];
  passive: string;
  passiveDesc: string;
  unlocked: boolean;
}

// ── Game Input ──

export interface GameInput {
  moveForward(): void;
  moveBackward(): void;
  strafeLeft(): void;
  strafeRight(): void;
  turnLeft(): void;
  turnRight(): void;
  attack(): void;
  useItem(slot: number): void;
  interact(): void;
}

// ── Constants ──

export const TILE_SIZE = 3;
export const WALL_HEIGHT = 3;
export const EYE_HEIGHT = 1.6;
export const MOVE_DURATION = 0.18; // seconds
export const TURN_DURATION = 0.12; // seconds

/** Direction offsets: [dx, dy] for N/E/S/W */
export const DIR_OFFSETS: Record<Direction, GridPos> = {
  [Direction.North]: { x: 0, y: -1 },
  [Direction.East]: { x: 1, y: 0 },
  [Direction.South]: { x: 0, y: 1 },
  [Direction.West]: { x: -1, y: 0 },
};

/** Direction to Y-axis rotation in radians */
export const DIR_ANGLES: Record<Direction, number> = {
  [Direction.North]: 0,
  [Direction.East]: -Math.PI / 2,
  [Direction.South]: Math.PI,
  [Direction.West]: Math.PI / 2,
};
