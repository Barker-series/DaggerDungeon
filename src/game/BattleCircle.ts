/**
 * Battle Circle — limits simultaneous attackers so the player isn't overwhelmed.
 * Enemies request an attack slot before starting their wind-up.
 * Max 2 attackers at once. After releasing, cooldown before re-requesting.
 */
export class BattleCircle {
  private maxAttackers: number;
  private activeAttackers = new Set<string>();
  private cooldowns = new Map<string, number>();

  constructor(maxAttackers = 2) {
    this.maxAttackers = maxAttackers;
  }

  requestSlot(enemyId: string): boolean {
    if (this.activeAttackers.has(enemyId)) return true; // already has slot
    if (this.activeAttackers.size >= this.maxAttackers) return false;
    const cd = this.cooldowns.get(enemyId) ?? 0;
    if (cd > 0) return false;

    this.activeAttackers.add(enemyId);
    return true;
  }

  releaseSlot(enemyId: string): void {
    this.activeAttackers.delete(enemyId);
    this.cooldowns.set(enemyId, 2.0 + Math.random() * 1.5);
  }

  update(dt: number): void {
    for (const [id, cd] of this.cooldowns) {
      const next = cd - dt;
      if (next <= 0) {
        this.cooldowns.delete(id);
      } else {
        this.cooldowns.set(id, next);
      }
    }
  }

  clear(): void {
    this.activeAttackers.clear();
    this.cooldowns.clear();
  }
}
