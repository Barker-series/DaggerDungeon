import { EnemyType, type EnemyDef } from './types';

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  [EnemyType.Rat]: {
    type: EnemyType.Rat,
    archetype: 'melee_rusher',
    name: 'Rat',
    hp: 15,
    speed: 5.5,
    agility: 8,
    color: 0x8b6914,
    sprite: '/sprites/enemy-rat.png',
    xpValue: 5,
    viewDistance: 12,
    viewAngle: Math.PI * 0.8,
    hearingRadius: 8,
    attackRange: 1.8,
    attacks: [
      { name: 'bite', windUpMs: 250, activeMs: 80, recoveryMs: 300, damage: [3, 5], range: 1.8, isRanged: false },
    ],
    combatWeights: { approach: 0.8, circleLeft: 0.1, circleRight: 0.1, backstep: 0.0, hold: 0.0, flee: 0.0 },
  },

  [EnemyType.Skeleton]: {
    type: EnemyType.Skeleton,
    archetype: 'melee_tactical',
    name: 'Skeleton Warrior',
    hp: 35,
    speed: 3.0,
    agility: 10,
    color: 0xd4c8a0,
    sprite: '/sprites/enemy-skeleton.png',
    xpValue: 15,
    viewDistance: 16,
    viewAngle: Math.PI * 0.7,
    hearingRadius: 12,
    attackRange: 2.5,
    attacks: [
      { name: 'slash', windUpMs: 500, activeMs: 100, recoveryMs: 600, damage: [6, 10], range: 2.5, isRanged: false },
      { name: 'thrust', windUpMs: 300, activeMs: 100, recoveryMs: 400, damage: [4, 8], range: 3.0, isRanged: false },
    ],
    combatWeights: { approach: 0.3, circleLeft: 0.3, circleRight: 0.3, backstep: 0.1, hold: 0.2, flee: 0.0 },
  },

  [EnemyType.Bat]: {
    type: EnemyType.Bat,
    archetype: 'hit_and_run',
    name: 'Giant Bat',
    hp: 25,
    speed: 6.0,
    agility: 18,
    color: 0x4a2a5a,
    sprite: '/sprites/enemy-bat.png',
    xpValue: 12,
    viewDistance: 14,
    viewAngle: Math.PI * 1.2, // wide vision
    hearingRadius: 10,
    attackRange: 2.0,
    attacks: [
      { name: 'swoop', windUpMs: 200, activeMs: 80, recoveryMs: 250, damage: [5, 10], range: 2.0, isRanged: false },
    ],
    combatWeights: { approach: 0.5, circleLeft: 0.1, circleRight: 0.1, backstep: 0.5, hold: 0.0, flee: 0.1 },
  },

  [EnemyType.Imp]: {
    type: EnemyType.Imp,
    archetype: 'ranged',
    name: 'Imp',
    hp: 30,
    speed: 3.5,
    agility: 14,
    color: 0xaa3322,
    sprite: '/sprites/enemy-imp.png',
    xpValue: 20,
    viewDistance: 20,
    viewAngle: Math.PI * 0.6,
    hearingRadius: 14,
    attackRange: 10,
    attacks: [
      { name: 'fireball', windUpMs: 500, activeMs: 100, recoveryMs: 500, damage: [8, 15], range: 12, isRanged: true, projectileSpeed: 8, projectileGravity: -4 },
    ],
    combatWeights: { approach: 0.0, circleLeft: 0.2, circleRight: 0.2, backstep: 0.6, hold: 0.3, flee: 0.2 },
  },

  [EnemyType.Orc]: {
    type: EnemyType.Orc,
    archetype: 'heavy',
    name: 'Orc Brute',
    hp: 50,
    speed: 2.5,
    agility: 10,
    color: 0x3a6a2a,
    sprite: '/sprites/enemy-orc.png',
    xpValue: 25,
    viewDistance: 14,
    viewAngle: Math.PI * 0.5,
    hearingRadius: 10,
    attackRange: 2.8,
    attacks: [
      { name: 'overhead_slam', windUpMs: 700, activeMs: 100, recoveryMs: 800, damage: [12, 18], range: 2.8, isRanged: false },
      { name: 'heavy_swing', windUpMs: 450, activeMs: 120, recoveryMs: 550, damage: [8, 14], range: 3.0, isRanged: false },
    ],
    combatWeights: { approach: 0.5, circleLeft: 0.2, circleRight: 0.2, backstep: 0.05, hold: 0.3, flee: 0.0 },
  },
};

export function getEnemyTypesForFloor(floor: number): EnemyType[] {
  const types: EnemyType[] = [];
  if (floor >= 1) types.push(EnemyType.Rat);
  if (floor >= 2) types.push(EnemyType.Skeleton);
  if (floor >= 3) types.push(EnemyType.Bat);
  if (floor >= 4) types.push(EnemyType.Imp, EnemyType.Orc);
  return types;
}

export function enemiesPerRoom(floor: number): [number, number] {
  if (floor <= 2) return [1, 2];
  if (floor <= 4) return [2, 3];
  return [2, 4];
}
