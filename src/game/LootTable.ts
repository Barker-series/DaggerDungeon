import { MaterialTier, WeaponType, type WeaponItem, type ConsumableItem, type GameItem } from './types';

let itemIdCounter = 0;
function nextItemId(): string {
  return `item_${itemIdCounter++}`;
}

// ── Material data ──

interface MaterialData {
  damageBonus: number;
  name: string;
}

const MATERIALS: Record<MaterialTier, MaterialData> = {
  [MaterialTier.Iron]: { damageBonus: 0, name: 'Iron' },
  [MaterialTier.Steel]: { damageBonus: 1, name: 'Steel' },
  [MaterialTier.Silver]: { damageBonus: 1, name: 'Silver' },
  [MaterialTier.Elven]: { damageBonus: 2, name: 'Elven' },
  [MaterialTier.Dwarven]: { damageBonus: 3, name: 'Dwarven' },
  [MaterialTier.Mithril]: { damageBonus: 4, name: 'Mithril' },
  [MaterialTier.Ebony]: { damageBonus: 5, name: 'Ebony' },
  [MaterialTier.Daedric]: { damageBonus: 7, name: 'Daedric' },
};

interface WeaponBase {
  type: WeaponType;
  name: string;
  baseDamage: [number, number];
  cooldown: number;
}

const WEAPON_BASES: WeaponBase[] = [
  { type: WeaponType.Dagger, name: 'Dagger', baseDamage: [2, 6], cooldown: 0.5 },
  { type: WeaponType.Shortsword, name: 'Shortsword', baseDamage: [3, 8], cooldown: 0.7 },
  { type: WeaponType.Longsword, name: 'Longsword', baseDamage: [5, 12], cooldown: 1.0 },
  { type: WeaponType.Mace, name: 'Mace', baseDamage: [4, 10], cooldown: 1.1 },
  { type: WeaponType.Staff, name: 'Staff', baseDamage: [2, 5], cooldown: 0.9 },
];

// ── Floor → material tier ──

function materialForFloor(floor: number): MaterialTier {
  if (floor <= 2) return MaterialTier.Iron;
  if (floor <= 4) return MaterialTier.Steel;
  if (floor <= 6) return MaterialTier.Silver;
  if (floor <= 8) return MaterialTier.Elven;
  if (floor <= 10) return MaterialTier.Dwarven;
  if (floor <= 12) return MaterialTier.Mithril;
  return MaterialTier.Ebony;
}

// ── Create items ──

export function createWeapon(type: WeaponType, material: MaterialTier): WeaponItem {
  const base = WEAPON_BASES.find((w) => w.type === type) ?? WEAPON_BASES[0]!;
  const mat = MATERIALS[material];
  return {
    kind: 'weapon',
    id: nextItemId(),
    type: base.type,
    material,
    damage: [base.baseDamage[0] + mat.damageBonus, base.baseDamage[1] + mat.damageBonus],
    cooldown: base.cooldown,
    name: `${mat.name} ${base.name}`,
  };
}

export function createHealthPotion(floor: number): ConsumableItem {
  const major = floor >= 5;
  return {
    kind: 'consumable',
    id: nextItemId(),
    type: 'health_potion',
    name: major ? 'Major Healing Potion' : 'Healing Potion',
    effect: major ? 60 : 25,
  };
}

export function createManaPotion(floor: number): ConsumableItem {
  const major = floor >= 5;
  return {
    kind: 'consumable',
    id: nextItemId(),
    type: 'mana_potion',
    name: major ? 'Major Mana Potion' : 'Mana Potion',
    effect: major ? 50 : 20,
  };
}

// ── Drop table ──

export function rollLoot(floor: number, luckBonus: number): GameItem | null {
  const roll = Math.random() * 100;
  const luckShift = Math.max(0, luckBonus - 10);

  // Adjusted thresholds (lower = better loot)
  const nothingThreshold = 40 - luckShift;
  const goldThreshold = 65 - luckShift; // gold is handled separately by the caller
  const consumableThreshold = 80 - luckShift;
  const equipmentThreshold = 92 - luckShift;

  if (roll < nothingThreshold) return null;
  if (roll < goldThreshold) return null; // gold is added by caller
  if (roll < consumableThreshold) {
    // Random consumable
    return Math.random() < 0.6 ? createHealthPotion(floor) : createManaPotion(floor);
  }

  // Equipment (weapon)
  const material = roll >= equipmentThreshold
    ? materialForFloor(floor + 1) // rare: one tier up
    : materialForFloor(floor);

  const weaponBase = WEAPON_BASES[Math.floor(Math.random() * WEAPON_BASES.length)]!;
  return createWeapon(weaponBase.type, material);
}
