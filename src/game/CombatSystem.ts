import type { PlayerStats, EnemyInstance } from './types';

/**
 * Calculate hit chance (Daggerfall-inspired formula).
 * Returns true if the attack hits.
 */
export function rollHit(attackerAgi: number, defenderAgi: number): boolean {
  const chance = Math.min(95, Math.max(15, 50 + attackerAgi - defenderAgi));
  return Math.random() * 100 < chance;
}

/**
 * Roll damage within [min, max] range, adding STR bonus for melee.
 */
export function rollDamage(min: number, max: number, strBonus: number): number {
  const base = min + Math.floor(Math.random() * (max - min + 1));
  return Math.max(1, base + Math.floor(strBonus / 2));
}

/**
 * Calculate player attack damage against an enemy.
 */
export function playerAttack(
  stats: PlayerStats,
  weaponDamage: [number, number],
  enemy: EnemyInstance,
): { hit: boolean; damage: number; crit: boolean } {
  const hit = rollHit(stats.agi, enemy.def.agility);
  if (!hit) return { hit: false, damage: 0, crit: false };

  // Crit check
  const critChance = 5 + stats.lck / 2;
  const crit = Math.random() * 100 < critChance;

  let damage = rollDamage(weaponDamage[0], weaponDamage[1], stats.str);
  if (crit) damage = Math.floor(damage * 1.5);

  return { hit: true, damage, crit };
}

/**
 * Calculate enemy attack damage against the player.
 * Uses the enemy's first attack definition for damage range.
 */
export function enemyAttack(
  enemy: EnemyInstance,
  playerAgi: number,
  playerArmor: number,
): { hit: boolean; damage: number } {
  const hit = rollHit(enemy.def.agility, playerAgi);
  if (!hit) return { hit: false, damage: 0 };

  const atk = enemy.def.attacks[0];
  const dmgRange: [number, number] = atk ? atk.damage : [1, 3];

  const damage = Math.max(
    1,
    rollDamage(dmgRange[0], dmgRange[1], 0) - playerArmor,
  );
  return { hit: true, damage };
}
