import {
  TileType, TILE_SIZE,
  type DungeonData, type EnemyInstance, type CombatStyle, type AttackDef,
} from './types';
import type { BattleCircle } from './BattleCircle';

// ── Perception ──

const SUSPICION_GROW_VISION = 2.0;  // per second at close range
const SUSPICION_GROW_HEARING = 0.8;
const SUSPICION_DECAY = 0.3;        // per second
const FORGET_TIME = 8;              // seconds before losing interest

export function updatePerception(
  enemy: EnemyInstance,
  playerX: number,
  playerZ: number,
  playerIsMoving: boolean,
  now: number,
  dungeon: DungeonData,
): void {
  const dx = playerX - enemy.worldX;
  const dz = playerZ - enemy.worldZ;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Vision cone check
  let canSee = false;
  if (dist <= enemy.def.viewDistance && dist > 0.1) {
    // Enemy facing direction (approximate from last movement or toward player)
    const facingAngle = Math.atan2(
      enemy.lastKnownPlayerX - enemy.worldX,
      enemy.lastKnownPlayerZ - enemy.worldZ,
    );
    const toPlayerAngle = Math.atan2(dx, dz);
    let angleDiff = Math.abs(facingAngle - toPlayerAngle);
    if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;

    if (angleDiff <= enemy.def.viewAngle / 2) {
      canSee = !gridRayBlocked(enemy.worldX, enemy.worldZ, playerX, playerZ, dungeon);
    }
  }

  // Hearing
  const canHear = playerIsMoving && dist <= enemy.def.hearingRadius;

  // Accumulate suspicion
  const dt = 1 / 60; // approximate, called per frame
  if (canSee) {
    const closeFactor = 1 + (1 - dist / enemy.def.viewDistance);
    enemy.suspicion += SUSPICION_GROW_VISION * closeFactor * dt;
    enemy.lastKnownPlayerX = playerX;
    enemy.lastKnownPlayerZ = playerZ;
    enemy.lastSeenTime = now;
  } else if (canHear) {
    enemy.suspicion += SUSPICION_GROW_HEARING * dt;
    // Hearing gives approximate location
    enemy.lastKnownPlayerX = playerX + (Math.random() - 0.5) * 3;
    enemy.lastKnownPlayerZ = playerZ + (Math.random() - 0.5) * 3;
    enemy.lastSeenTime = now;
  } else {
    enemy.suspicion -= SUSPICION_DECAY * dt;
  }

  enemy.suspicion = Math.max(0, Math.min(1, enemy.suspicion));

  // Map to alert level
  if (enemy.suspicion >= 1.0) {
    enemy.alertLevel = 'combat';
  } else if (enemy.suspicion >= 0.7) {
    enemy.alertLevel = 'alert';
  } else if (enemy.suspicion >= 0.3) {
    enemy.alertLevel = 'suspicious';
  } else {
    enemy.alertLevel = 'idle';
    // Forget player after time
    if (now - enemy.lastSeenTime > FORGET_TIME) {
      enemy.lastKnownPlayerX = enemy.homeX;
      enemy.lastKnownPlayerZ = enemy.homeZ;
    }
  }
}

// ── Alert Propagation ──

export function propagateAlert(
  source: EnemyInstance,
  enemies: EnemyInstance[],
  playerX: number,
  playerZ: number,
): void {
  for (const enemy of enemies) {
    if (enemy.id === source.id || enemy.state === 'dead') continue;
    if (enemy.alertLevel === 'combat') continue;

    const dist = Math.sqrt(
      (enemy.worldX - source.worldX) ** 2 + (enemy.worldZ - source.worldZ) ** 2,
    );

    // Same room (close): near-instant alert
    if (dist < TILE_SIZE * 6) {
      enemy.suspicion = Math.max(enemy.suspicion, 0.85);
      enemy.lastKnownPlayerX = playerX;
      enemy.lastKnownPlayerZ = playerZ;
    } else if (dist < TILE_SIZE * 12) {
      // Heard a shout: partial alert
      enemy.suspicion = Math.max(enemy.suspicion, 0.5);
      enemy.lastKnownPlayerX = playerX + (Math.random() - 0.5) * 5;
      enemy.lastKnownPlayerZ = playerZ + (Math.random() - 0.5) * 5;
    }
  }
}

// ── Ambient Behavior ──

export function updateAmbient(enemy: EnemyInstance, dungeon: DungeonData, dt: number, allies: EnemyInstance[]): void {
  enemy.ambientTimer -= dt;

  if (enemy.ambientTimer <= 0) {
    // Pick new ambient behavior
    const roll = Math.random();
    if (roll < 0.4) {
      enemy.ambientBehavior = 'wander';
      enemy.ambientTimer = 3 + Math.random() * 4;
      // Pick random walkable point near home
      const angle = Math.random() * Math.PI * 2;
      const dist = 1 + Math.random() * TILE_SIZE * 3;
      enemy.wanderTargetX = enemy.homeX + Math.cos(angle) * dist;
      enemy.wanderTargetZ = enemy.homeZ + Math.sin(angle) * dist;
    } else if (roll < 0.6) {
      // Try to chat with a nearby idle ally
      const partner = allies.find(
        (a) => a.id !== enemy.id && a.state !== 'dead' && a.alertLevel === 'idle'
          && Math.sqrt((a.worldX - enemy.worldX) ** 2 + (a.worldZ - enemy.worldZ) ** 2) < TILE_SIZE * 3,
      );
      if (partner) {
        enemy.ambientBehavior = 'chat';
        enemy.chatPartnerId = partner.id;
        enemy.ambientTimer = 3 + Math.random() * 3;
        partner.ambientBehavior = 'chat';
        partner.chatPartnerId = enemy.id;
        partner.ambientTimer = enemy.ambientTimer;
      } else {
        enemy.ambientBehavior = 'idle';
        enemy.ambientTimer = 2 + Math.random() * 3;
      }
    } else {
      enemy.ambientBehavior = 'idle';
      enemy.ambientTimer = 2 + Math.random() * 4;
    }
  }

  // Execute ambient behavior
  switch (enemy.ambientBehavior) {
    case 'wander': {
      const dx = enemy.wanderTargetX - enemy.worldX;
      const dz = enemy.wanderTargetZ - enemy.worldZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.3) {
        const moveSpeed = enemy.def.speed * 0.3 * dt; // slow wander
        moveEnemy(enemy, (dx / dist) * moveSpeed, (dz / dist) * moveSpeed, dungeon);
      }
      break;
    }
    case 'chat': {
      // Just stand facing partner
      const partner = allies.find((a) => a.id === enemy.chatPartnerId);
      if (!partner || partner.alertLevel !== 'idle') {
        enemy.ambientBehavior = 'idle';
        enemy.chatPartnerId = null;
      }
      break;
    }
    case 'idle':
      // Slight random rotation
      break;
  }
}

// ── Combat Movement ──

export function updateCombatMovement(
  enemy: EnemyInstance,
  playerX: number,
  playerZ: number,
  dungeon: DungeonData,
  dt: number,
): void {
  // Re-evaluate combat style periodically
  enemy.combatStyleTimer -= dt;
  if (enemy.combatStyleTimer <= 0) {
    enemy.combatStyle = pickCombatStyle(enemy, playerX, playerZ);
    enemy.combatStyleTimer = 1.0 + Math.random() * 1.5;
  }

  // Don't move during attack animations
  if (enemy.attackPhase !== 'none') return;

  const toPlayerX = playerX - enemy.worldX;
  const toPlayerZ = playerZ - enemy.worldZ;
  const dist = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
  if (dist < 0.1) return;

  const dirX = toPlayerX / dist;
  const dirZ = toPlayerZ / dist;
  const perpX = -dirZ;
  const perpZ = dirX;

  // Hard minimum distance — never crowd into the player's face
  const MIN_DIST = 1.8;
  if (dist < MIN_DIST) {
    // Push away from player
    const pushSpeed = enemy.def.speed * 1.5 * dt;
    moveEnemy(enemy, -dirX * pushSpeed, -dirZ * pushSpeed, dungeon);
    return;
  }

  let moveX = 0;
  let moveZ = 0;
  const speed = enemy.def.speed * dt;

  // Preferred distance: enemies try to stay at their attack range, not closer
  const preferredDist = Math.max(enemy.def.attackRange * 0.8, 2.5);
  const tooClose = dist < preferredDist * 0.7;
  const pullFactor = tooClose ? -0.3 : (dist > preferredDist * 1.3 ? 0.5 : 0);

  switch (enemy.combatStyle) {
    case 'approach':
      moveX = dirX * 0.7 + perpX * 0.3 * enemy.preferredStrafeDir;
      moveZ = dirZ * 0.7 + perpZ * 0.3 * enemy.preferredStrafeDir;
      break;
    case 'circleLeft':
      moveX = perpX * -1 + dirX * pullFactor;
      moveZ = perpZ * -1 + dirZ * pullFactor;
      break;
    case 'circleRight':
      moveX = perpX + dirX * pullFactor;
      moveZ = perpZ + dirZ * pullFactor;
      break;
    case 'backstep':
      moveX = -dirX;
      moveZ = -dirZ;
      break;
    case 'flee':
      moveX = -dirX;
      moveZ = -dirZ;
      break;
    case 'hold':
      // Jitter + distance maintenance
      moveX = (Math.random() - 0.5) * 0.3 + dirX * pullFactor;
      moveZ = (Math.random() - 0.5) * 0.3 + dirZ * pullFactor;
      break;
  }

  // Normalize and apply speed
  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 0.01) {
    moveEnemy(enemy, (moveX / len) * speed, (moveZ / len) * speed, dungeon);
  }
}

function pickCombatStyle(enemy: EnemyInstance, playerX: number, playerZ: number): CombatStyle {
  const dist = Math.sqrt((playerX - enemy.worldX) ** 2 + (playerZ - enemy.worldZ) ** 2);
  const hpRatio = enemy.hp / enemy.def.hp;
  const inRange = dist <= enemy.def.attackRange;
  const tooClose = dist < enemy.def.attackRange * 0.4;
  const tooFar = dist > enemy.def.attackRange * 2;

  const w = enemy.def.combatWeights;
  const scores: [CombatStyle, number][] = [
    ['approach', w.approach * (tooFar ? 2 : inRange ? 0.2 : 1)],
    ['circleLeft', w.circleLeft * (inRange ? 1.5 : 0.3)],
    ['circleRight', w.circleRight * (inRange ? 1.5 : 0.3)],
    ['backstep', w.backstep * (tooClose ? 3 : hpRatio < 0.3 ? 1.5 : 0.2)],
    ['hold', w.hold * (inRange && enemy.attackCooldown > 0.5 ? 1.5 : 0.3)],
    ['flee', w.flee * (hpRatio < 0.15 ? 3 : 0)],
  ];

  // Add randomness
  const randomized = scores.map(([style, score]): [CombatStyle, number] =>
    [style, score + Math.random() * 0.3],
  );
  randomized.sort((a, b) => b[1] - a[1]);
  return randomized[0]![0];
}

// ── Attack State Machine ──

export function updateAttack(
  enemy: EnemyInstance,
  playerX: number,
  playerZ: number,
  dt: number,
  battleCircle: BattleCircle,
): { hitPlayer: boolean; spawnProjectile: AttackDef | null } {
  let hitPlayer = false;
  let spawnProjectile: AttackDef | null = null;

  if (enemy.attackPhase !== 'none') {
    enemy.attackTimer -= dt;

    if (enemy.attackTimer <= 0) {
      switch (enemy.attackPhase) {
        case 'windUp':
          enemy.attackPhase = 'active';
          enemy.attackTimer = (enemy.currentAttack?.activeMs ?? 100) / 1000;
          break;
        case 'active':
          // Damage check
          if (enemy.currentAttack) {
            if (enemy.currentAttack.isRanged) {
              spawnProjectile = enemy.currentAttack;
            } else {
              const dist = Math.sqrt((playerX - enemy.worldX) ** 2 + (playerZ - enemy.worldZ) ** 2);
              if (dist <= enemy.currentAttack.range) {
                hitPlayer = true;
              }
            }
          }
          enemy.attackPhase = 'recovery';
          enemy.attackTimer = (enemy.currentAttack?.recoveryMs ?? 500) / 1000;
          break;
        case 'recovery':
          enemy.attackPhase = 'none';
          enemy.currentAttack = null;
          battleCircle.releaseSlot(enemy.id);
          enemy.attackCooldown = 1.5 + Math.random() * 1.5;
          break;
      }
    }
    return { hitPlayer, spawnProjectile };
  }

  // Try to start an attack
  enemy.attackCooldown -= dt;
  if (enemy.attackCooldown > 0) return { hitPlayer: false, spawnProjectile: null };

  const dist = Math.sqrt((playerX - enemy.worldX) ** 2 + (playerZ - enemy.worldZ) ** 2);
  if (dist > enemy.def.attackRange) return { hitPlayer: false, spawnProjectile: null };

  // Request attack slot from battle circle
  if (!battleCircle.requestSlot(enemy.id)) return { hitPlayer: false, spawnProjectile: null };

  // Pick attack
  const attacks = enemy.def.attacks;
  const attack = attacks[Math.floor(Math.random() * attacks.length)];
  if (!attack) return { hitPlayer: false, spawnProjectile: null };

  enemy.currentAttack = attack;
  enemy.attackPhase = 'windUp';
  enemy.attackTimer = attack.windUpMs / 1000;

  return { hitPlayer: false, spawnProjectile: null };
}

// ── Investigation (suspicious/alert) ──

export function updateInvestigation(
  enemy: EnemyInstance,
  dungeon: DungeonData,
  dt: number,
): void {
  // Move toward last known player position
  const dx = enemy.lastKnownPlayerX - enemy.worldX;
  const dz = enemy.lastKnownPlayerZ - enemy.worldZ;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 1.0) {
    const speed = enemy.def.speed * 0.6 * dt;
    moveEnemy(enemy, (dx / dist) * speed, (dz / dist) * speed, dungeon);
  }
}

// ── Movement with collision ──

const ENEMY_RADIUS = 0.4;

function moveEnemy(enemy: EnemyInstance, dx: number, dz: number, dungeon: DungeonData): void {
  const newX = enemy.worldX + dx;
  const newZ = enemy.worldZ + dz;

  // Check collision per axis (wall sliding)
  if (!collidesAt(newX, enemy.worldZ, dungeon)) {
    enemy.worldX = newX;
  }
  if (!collidesAt(enemy.worldX, newZ, dungeon)) {
    enemy.worldZ = newZ;
  }

  // Update grid position
  enemy.position = {
    x: Math.floor(enemy.worldX / TILE_SIZE),
    y: Math.floor(enemy.worldZ / TILE_SIZE),
  };
}

function collidesAt(x: number, z: number, dungeon: DungeonData): boolean {
  const cx = Math.floor(x / TILE_SIZE);
  const cz = Math.floor(z / TILE_SIZE);

  for (let tz = cz - 1; tz <= cz + 1; tz++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      const tile = dungeon.tiles[tz]?.[tx];
      if (tile === undefined || tile === TileType.Wall) {
        const tMinX = tx * TILE_SIZE;
        const tMaxX = tMinX + TILE_SIZE;
        const tMinZ = tz * TILE_SIZE;
        const tMaxZ = tMinZ + TILE_SIZE;
        const closestX = Math.max(tMinX, Math.min(x, tMaxX));
        const closestZ = Math.max(tMinZ, Math.min(z, tMaxZ));
        const ddx = x - closestX;
        const ddz = z - closestZ;
        if (ddx * ddx + ddz * ddz < ENEMY_RADIUS * ENEMY_RADIUS) return true;
      }
    }
  }
  return false;
}

// ── Line-of-sight raycast through tile grid ──

function gridRayBlocked(
  x1: number, z1: number, x2: number, z2: number, dungeon: DungeonData,
): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(dist / (TILE_SIZE * 0.5));
  const stepX = dx / steps;
  const stepZ = dz / steps;

  for (let i = 1; i < steps; i++) {
    const sx = x1 + stepX * i;
    const sz = z1 + stepZ * i;
    const gx = Math.floor(sx / TILE_SIZE);
    const gz = Math.floor(sz / TILE_SIZE);
    const tile = dungeon.tiles[gz]?.[gx];
    if (tile === undefined || tile === TileType.Wall) return true;
  }
  return false;
}
