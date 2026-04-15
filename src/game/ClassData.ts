import { ClassName, WeaponType, MaterialTier, type ClassDef } from './types';
import { createWeapon, createHealthPotion, createManaPotion } from './LootTable';

export const CLASS_DEFS: Record<ClassName, ClassDef> = {
  [ClassName.Warrior]: {
    name: ClassName.Warrior,
    displayName: 'Warrior',
    description: 'High health, high damage, no magic.',
    stats: { str: 18, agi: 12, int: 5, end: 18, spd: 12, lck: 15 },
    startingWeapon: createWeapon(WeaponType.Longsword, MaterialTier.Iron),
    startingItems: [createHealthPotion(1), createHealthPotion(1)],
    passive: 'Shield Wall',
    passiveDesc: 'Blocking reduces damage by 40%',
    unlocked: true,
  },
  [ClassName.Rogue]: {
    name: ClassName.Rogue,
    displayName: 'Rogue',
    description: 'Fast and evasive. Glass cannon.',
    stats: { str: 12, agi: 20, int: 8, end: 10, spd: 18, lck: 12 },
    startingWeapon: createWeapon(WeaponType.Dagger, MaterialTier.Iron),
    startingItems: [createHealthPotion(1)],
    passive: 'Lucky Dodge',
    passiveDesc: '+10% dodge chance',
    unlocked: true,
  },
  [ClassName.Mage]: {
    name: ClassName.Mage,
    displayName: 'Sorcerer',
    description: 'Devastating spells but fragile.',
    stats: { str: 6, agi: 12, int: 22, end: 8, spd: 14, lck: 18 },
    startingWeapon: createWeapon(WeaponType.Staff, MaterialTier.Iron),
    startingItems: [createManaPotion(1), createManaPotion(1)],
    passive: 'Mana Shield',
    passiveDesc: 'Spend mana to absorb damage',
    unlocked: true,
  },
  [ClassName.Knight]: {
    name: ClassName.Knight,
    displayName: 'Knight',
    description: 'Tanky paladin with healing magic.',
    stats: { str: 16, agi: 8, int: 14, end: 20, spd: 8, lck: 14 },
    startingWeapon: createWeapon(WeaponType.Longsword, MaterialTier.Iron),
    startingItems: [createHealthPotion(1)],
    passive: 'Holy Armor',
    passiveDesc: '+15% damage reduction',
    unlocked: false,
  },
  [ClassName.Ranger]: {
    name: ClassName.Ranger,
    displayName: 'Ranger',
    description: 'Ranged specialist with utility.',
    stats: { str: 10, agi: 16, int: 14, end: 12, spd: 16, lck: 12 },
    startingWeapon: createWeapon(WeaponType.Shortsword, MaterialTier.Iron),
    startingItems: [createHealthPotion(1)],
    passive: 'Pathfinder',
    passiveDesc: 'Traps are always visible',
    unlocked: false,
  },
  [ClassName.Battlemage]: {
    name: ClassName.Battlemage,
    displayName: 'Battlemage',
    description: 'Hybrid warrior-caster.',
    stats: { str: 15, agi: 10, int: 16, end: 14, spd: 12, lck: 13 },
    startingWeapon: createWeapon(WeaponType.Mace, MaterialTier.Iron),
    startingItems: [createManaPotion(1)],
    passive: 'Arcane Blade',
    passiveDesc: 'Melee attacks restore 2 mana',
    unlocked: false,
  },
};

/** Derive HP from stats */
export function calcMaxHp(end: number): number {
  return 50 + end * 3;
}

/** Derive Mana from stats */
export function calcMaxMana(int: number): number {
  return int <= 6 ? 0 : 20 + int * 2;
}
