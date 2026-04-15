import * as THREE from 'three';
import { DungeonRenderer } from './DungeonRenderer';
import { GridCamera } from './Camera';
import { LightingSystem } from './LightingSystem';
import { SpriteManager } from './SpriteManager';
import { ProjectileManager } from './ProjectileManager';
import { KeyboardInput, type InputAction } from './InputManager';
import { generateDungeon } from '../game/DungeonGenerator';
import { spawnEnemies } from '../game/EntityManager';
import {
  updatePerception, propagateAlert, updateAmbient,
  updateCombatMovement, updateAttack, updateInvestigation,
} from '../game/EnemyAI';
import { BattleCircle } from '../game/BattleCircle';
import { playerAttack } from '../game/CombatSystem';
import { rollLoot } from '../game/LootTable';
import { DungeonBot } from '../bot/DungeonBot';
import { useGameStore } from '../store/gameStore';
import { TileType, Direction, TILE_SIZE, EYE_HEIGHT } from '../game/types';
import type { DungeonData, WeaponItem, EnemyInstance, GridPos } from '../game/types';

function gridToWorld(pos: GridPos): { x: number; z: number } {
  return { x: pos.x * TILE_SIZE + TILE_SIZE / 2, z: pos.y * TILE_SIZE + TILE_SIZE / 2 };
}

const MOVE_SPEED = 7;
const SPRINT_MULT = 1.6;
const PLAYER_RADIUS = 0.35;
const ATTACK_RANGE = TILE_SIZE * 2.2;
const MAX_AIM_DOT = 0.5;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = { x: 0, y: 0 };

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private threeCamera: THREE.PerspectiveCamera;
  private timer: THREE.Timer;
  private animFrameId = 0;

  private dungeonRenderer: DungeonRenderer;
  private gridCamera: GridCamera;
  private lighting: LightingSystem;
  private sprites: SpriteManager;
  private projectiles: ProjectileManager;
  private input: KeyboardInput;
  private bot: DungeonBot;
  private battleCircle: BattleCircle;

  private dungeon: DungeonData | null = null;
  private attackCooldown = 0;
  private seed = 0;
  private bobPhase = 0;
  private jumpVelocity = 0;
  private jumpHeight = 0;
  private isGrounded = true;
  private gameTime = 0;

  // Track if player is moving for enemy perception
  private playerIsMoving = false;
  // Previous alert level per enemy (for propagation trigger)
  private prevAlertLevels = new Map<string, string>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();

    this.threeCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 50);
    this.gridCamera = new GridCamera(this.threeCamera);
    this.gridCamera.attach(canvas);

    this.dungeonRenderer = new DungeonRenderer(this.scene);
    this.lighting = new LightingSystem(this.scene);
    this.sprites = new SpriteManager(this.scene);
    this.projectiles = new ProjectileManager(this.scene);
    this.input = new KeyboardInput();
    this.battleCircle = new BattleCircle(2);
    this.bot = new DungeonBot(
      (action) => this.input.pushAction(action),
      () => useGameStore.getState(),
      this.input,
      this.gridCamera,
    );
    this.timer = new THREE.Timer();

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = () => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.renderer.setSize(w, h);
    this.threeCamera.aspect = w / h;
    this.threeCamera.updateProjectionMatrix();
  };

  loadFloor(floor: number, seed: number): void {
    this.seed = seed;
    this.dungeonRenderer.clear();
    this.lighting.clear();
    this.sprites.clear();
    this.projectiles.clear();
    this.battleCircle.clear();
    this.prevAlertLevels.clear();
    this.bot.reset();

    this.dungeon = generateDungeon({ seed, floor });
    this.dungeonRenderer.build(this.dungeon);
    this.lighting.setup(this.dungeon);

    const enemies = spawnEnemies(this.dungeon);
    for (const enemy of enemies) {
      this.sprites.addSpriteWorld(enemy.id, enemy.worldX, enemy.worldZ, enemy.def.color, 2.0, enemy.def.sprite);
    }

    const store = useGameStore.getState();
    store.setDungeon(this.dungeon);
    store.setCurrentFloor(floor);
    store.setEnemies(enemies);

    const spawnX = this.dungeon.entrance.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnZ = this.dungeon.entrance.y * TILE_SIZE + TILE_SIZE / 2;
    this.gridCamera.setPosition(spawnX, 0, spawnZ);
    this.gridCamera.setFacingDirection(Direction.North);
    store.setPlayerPos(this.dungeon.entrance);
    store.setPlayerFacing(Direction.North);
  }

  start(): void {
    const loop = (timestamp: number) => {
      this.animFrameId = requestAnimationFrame(loop);
      this.timer.update(timestamp);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      this.gameTime += dt;
      this.update(dt);
      this.renderer.render(this.scene, this.threeCamera);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animFrameId);
    this.input.dispose();
    this.gridCamera.detach();
    this.sprites.dispose();
    this.projectiles.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }

  private update(dt: number): void {
    const store = useGameStore.getState();

    if (store.playerHp <= 0 && store.screen === 'playing') {
      store.setScreen('dead');
      return;
    }

    // Player movement
    this.processMovement(dt);
    this.syncGridPos(store);
    this.gridCamera.update();

    // Sprites
    this.sprites.update(dt, this.threeCamera);

    // Attack cooldown
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Enemy AI
    this.battleCircle.update(dt);
    this.updateEnemies(dt, store);

    // Projectiles
    if (this.dungeon) {
      const pos = this.gridCamera.position;
      const projDamage = this.projectiles.update(dt, pos.x, EYE_HEIGHT, pos.z, this.dungeon);
      if (projDamage > 0) {
        store.takeDamage(projDamage);
        store.addDamagePopup({
          text: `-${projDamage}`,
          x: 50 + (Math.random() - 0.5) * 30,
          y: 55 + (Math.random() - 0.5) * 10,
          color: '#f84',
        });
      }
    }

    // Bot
    if (store.autoPlay) {
      this.bot.update(dt);
    }

    // One-shot actions
    this.processActions();
  }

  // ── Player Movement ──

  private processMovement(dt: number): void {
    if (!this.dungeon) return;

    if (this.input.consumeJump() && this.isGrounded) {
      this.jumpVelocity = 5.0;
      this.isGrounded = false;
    }
    if (!this.isGrounded) {
      this.jumpVelocity -= 15.0 * dt;
      this.jumpHeight += this.jumpVelocity * dt;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.jumpVelocity = 0;
        this.isGrounded = true;
      }
    }

    this.input.getMovementDir(_moveDir);
    const isMoving = _moveDir.x !== 0 || _moveDir.y !== 0;
    this.playerIsMoving = isMoving;

    if (isMoving) {
      const speed = MOVE_SPEED * (this.input.isSprinting() ? SPRINT_MULT : 1);
      this.gridCamera.getForward(_forward);
      this.gridCamera.getRight(_right);

      const velX = (_forward.x * _moveDir.y + _right.x * _moveDir.x) * speed * dt;
      const velZ = (_forward.z * _moveDir.y + _right.z * _moveDir.x) * speed * dt;

      const pos = this.gridCamera.position;
      if (!this.collidesAt(pos.x + velX, pos.z)) pos.x += velX;
      if (!this.collidesAt(pos.x, pos.z + velZ)) pos.z += velZ;

      if (this.isGrounded) this.bobPhase += dt * speed * 0.7;
    } else {
      this.bobPhase *= 0.9;
    }

    const bob = this.isGrounded && isMoving ? Math.sin(this.bobPhase * 2) * 0.04 : 0;
    this.threeCamera.position.y += this.jumpHeight + bob;

    this.tryPickupItems();
  }

  private collidesAt(x: number, z: number): boolean {
    if (!this.dungeon) return true;
    const r = PLAYER_RADIUS;
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    for (let tz = cz - 1; tz <= cz + 1; tz++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        const tile = this.dungeon.tiles[tz]?.[tx];
        if (tile === undefined || tile === TileType.Wall) {
          const tMinX = tx * TILE_SIZE;
          const tMaxX = tMinX + TILE_SIZE;
          const tMinZ = tz * TILE_SIZE;
          const tMaxZ = tMinZ + TILE_SIZE;
          const closestX = Math.max(tMinX, Math.min(x, tMaxX));
          const closestZ = Math.max(tMinZ, Math.min(z, tMaxZ));
          const ddx = x - closestX;
          const ddz = z - closestZ;
          if (ddx * ddx + ddz * ddz < r * r) return true;
        }
      }
    }
    return false;
  }

  private syncGridPos(store: ReturnType<typeof useGameStore.getState>): void {
    const pos = this.gridCamera.position;
    const gx = Math.floor(pos.x / TILE_SIZE);
    const gz = Math.floor(pos.z / TILE_SIZE);
    if (gx !== store.playerPos.x || gz !== store.playerPos.y) {
      store.setPlayerPos({ x: gx, y: gz });
    }
    const facing = this.gridCamera.getFacingDirection();
    if (facing !== store.playerFacing) {
      store.setPlayerFacing(facing);
    }
    store.setPlayerYaw(this.gridCamera.yaw);
  }

  // ── Enemy AI ──

  private updateEnemies(dt: number, store: ReturnType<typeof useGameStore.getState>): void {
    if (!this.dungeon) return;
    const playerPos = this.gridCamera.position;
    const playerX = playerPos.x;
    const playerZ = playerPos.z;
    const enemies = store.enemies;

    const updatedEnemies: EnemyInstance[] = [];

    for (const enemy of enemies) {
      if (enemy.state === 'dead') {
        updatedEnemies.push(enemy);
        continue;
      }

      // Clone for mutation
      const e = { ...enemy };

      // 1. Perception
      updatePerception(e, playerX, playerZ, this.playerIsMoving, this.gameTime, this.dungeon!);

      // 2. Alert propagation (when entering combat for the first time)
      const prevAlert = this.prevAlertLevels.get(e.id);
      if (e.alertLevel === 'combat' && prevAlert !== 'combat') {
        propagateAlert(e, enemies, playerX, playerZ);
      }
      this.prevAlertLevels.set(e.id, e.alertLevel);

      // 3. Behavior based on alert level
      switch (e.alertLevel) {
        case 'idle':
          updateAmbient(e, this.dungeon!, dt, enemies);
          break;

        case 'suspicious':
        case 'alert':
          updateInvestigation(e, this.dungeon!, dt);
          break;

        case 'combat': {
          // Combat movement
          updateCombatMovement(e, playerX, playerZ, this.dungeon!, dt);

          // Attack state machine
          const attackResult = updateAttack(e, playerX, playerZ, dt, this.battleCircle);

          if (attackResult.hitPlayer) {
            const atk = e.currentAttack;
            if (atk) {
              const dmg = atk.damage[0] + Math.floor(Math.random() * (atk.damage[1] - atk.damage[0] + 1));
              store.takeDamage(dmg);
              store.addDamagePopup({
                text: `-${dmg}`,
                x: 50 + (Math.random() - 0.5) * 30,
                y: 55 + (Math.random() - 0.5) * 10,
                color: '#f44',
              });
            }
          }

          if (attackResult.spawnProjectile) {
            const atk = attackResult.spawnProjectile;
            const dx = playerX - e.worldX;
            const dz = playerZ - e.worldZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 0.1) {
              const dirX = dx / dist;
              const dirZ = dz / dist;
              // Lob upward slightly for arc
              const dirY = (atk.projectileGravity ?? 0) !== 0 ? 0.3 : 0;
              this.projectiles.spawn(
                e.worldX, 1.0, e.worldZ,
                dirX, dirY, dirZ,
                atk.projectileSpeed ?? 8,
                {
                  damage: atk.damage[0] + Math.floor(Math.random() * (atk.damage[1] - atk.damage[0] + 1)),
                  gravity: atk.projectileGravity ?? 0,
                  color: 0xff4400,
                  radius: 0.25,
                },
              );
            }
          }
          break;
        }
      }

      // Update sprite position from world coords
      this.sprites.updateWorldPosition(e.id, e.worldX, e.worldZ);

      // Attack telegraph visual: pulse sprite scale during windUp
      if (e.attackPhase === 'windUp') {
        const pulse = 2.0 + Math.sin(this.gameTime * 15) * 0.3;
        this.sprites.setScale(e.id, pulse);
      } else if (e.attackPhase === 'active') {
        this.sprites.setScale(e.id, 2.5); // big during hit
      } else {
        this.sprites.setScale(e.id, 2.0);
      }

      updatedEnemies.push(e);
    }

    store.setEnemies(updatedEnemies);
  }

  // ── Actions ──

  private processActions(): void {
    const action = this.input.consumeAction();
    if (!action) return;

    switch (action) {
      case 'attack':
        this.tryAttack();
        break;
      case 'interact':
        this.tryInteract();
        break;
      case 'quickHeal':
        this.tryQuickHeal();
        break;
      case 'toggleAutoPlay':
        useGameStore.getState().toggleAutoPlay();
        break;
      case 'useItem1':
      case 'useItem2':
      case 'useItem3': {
        const slot = parseInt(action.slice(-1)) - 1;
        this.tryUseItem(slot);
        break;
      }
      case 'turnLeft':
        this.gridCamera.yaw += Math.PI / 2;
        break;
      case 'turnRight':
        this.gridCamera.yaw -= Math.PI / 2;
        break;
      case 'moveForward':
      case 'moveBackward':
      case 'strafeLeft':
      case 'strafeRight':
        this.botMovePulse(action);
        break;
    }
  }

  private tryAttack(): void {
    if (this.attackCooldown > 0) return;

    const store = useGameStore.getState();
    const weapon = store.weapon as WeaponItem | null;
    const weaponDmg: [number, number] = weapon ? weapon.damage : [1, 3];
    const cooldown = weapon ? weapon.cooldown : 0.8;
    this.attackCooldown = cooldown;
    store.triggerSwing();

    const pos = this.gridCamera.position;
    this.gridCamera.getForward(_forward);
    const { playerStats, enemies } = store;

    let bestTarget: EnemyInstance | null = null;
    let bestDot = MAX_AIM_DOT;

    for (const enemy of enemies) {
      if (enemy.state === 'dead') continue;
      const dx = enemy.worldX - pos.x;
      const dz = enemy.worldZ - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ATTACK_RANGE || dist < 0.1) continue;
      const dot = (dx / dist) * _forward.x + (dz / dist) * _forward.z;
      if (dot > bestDot) {
        bestDot = dot;
        bestTarget = enemy;
      }
    }

    if (!bestTarget) {
      store.addDamagePopup({ text: 'miss', x: 50, y: 45, color: '#888' });
      return;
    }

    const result = playerAttack(playerStats, weaponDmg, bestTarget);

    if (!result.hit) {
      store.addDamagePopup({ text: 'miss', x: 50, y: 45, color: '#888' });
      return;
    }

    const newHp = bestTarget.hp - result.damage;
    this.sprites.flashSprite(bestTarget.id);

    const popupColor = result.crit ? '#ffaa00' : '#fff';
    const popupText = result.crit ? `${result.damage}!` : `${result.damage}`;
    store.addDamagePopup({
      text: popupText,
      x: 50 + (Math.random() - 0.5) * 20,
      y: 40 + (Math.random() - 0.5) * 10,
      color: popupColor,
    });

    if (newHp <= 0) {
      store.updateEnemy(bestTarget.id, { hp: 0, state: 'dead' });
      store.addKill();
      store.addSoulShards(bestTarget.def.xpValue);
      store.addGold(Math.floor(Math.random() * 10) + 1);
      store.addDamagePopup({ text: `${bestTarget.def.name} slain`, x: 50, y: 35, color: '#4f4' });

      const loot = rollLoot(store.currentFloor, store.playerStats.lck);
      if (loot) {
        const dropId = `drop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        store.addItemDrop({ id: dropId, item: loot, position: { ...bestTarget.position } });
        const dropColor = loot.kind === 'weapon' ? 0xffcc00 : 0x00ccff;
        let dropSprite: string | undefined;
        if (loot.kind === 'weapon') dropSprite = '/sprites/item-weapon.png';
        else if (loot.kind === 'consumable' && loot.type === 'health_potion') dropSprite = '/sprites/item-potion-health.png';
        else if (loot.kind === 'consumable' && loot.type === 'mana_potion') dropSprite = '/sprites/item-potion-mana.png';
        const wp = gridToWorld(bestTarget.position);
        this.sprites.addSpriteWorld(dropId, wp.x, wp.z, dropColor, 0.8, dropSprite);
      }

      const deadId = bestTarget.id;
      setTimeout(() => {
        this.sprites.removeSprite(deadId);
        useGameStore.getState().removeEnemy(deadId);
      }, 300);
    } else {
      store.updateEnemy(bestTarget.id, { hp: newHp });
    }
  }

  private tryInteract(): void {
    if (!this.dungeon) return;
    const store = useGameStore.getState();
    const { x, y } = store.playerPos;
    const tile = this.dungeon.tiles[y]?.[x];
    if (tile === TileType.StairsDown) {
      this.loadFloor(store.currentFloor + 1, this.seed);
    }
  }

  private tryQuickHeal(): void {
    const store = useGameStore.getState();
    const slot = store.hotbar.findIndex(
      (item) => item?.kind === 'consumable' && item.type === 'health_potion',
    );
    if (slot >= 0) this.tryUseItem(slot);
  }

  private tryUseItem(slot: number): void {
    const store = useGameStore.getState();
    const item = store.hotbar[slot];
    if (!item || item.kind !== 'consumable') return;
    if (item.type === 'health_potion') {
      store.heal(item.effect);
      store.removeFromHotbar(slot);
    } else if (item.type === 'mana_potion') {
      store.removeFromHotbar(slot);
    }
  }

  private tryPickupItems(): void {
    const store = useGameStore.getState();
    const pos = this.gridCamera.position;
    const PICKUP_RADIUS = 1.5;

    const nearby = store.itemDrops.filter((d) => {
      const wp = gridToWorld(d.position);
      const dx = wp.x - pos.x;
      const dz = wp.z - pos.z;
      return dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS;
    });

    for (const drop of nearby) {
      if (drop.item.kind === 'weapon') {
        const current = store.weapon as WeaponItem | null;
        if (!current || drop.item.damage[1] > current.damage[1]) {
          store.equipWeapon(drop.item);
        }
      } else {
        store.addToHotbar(drop.item);
      }
      this.sprites.removeSprite(drop.id);
      store.removeItemDrop(drop.id);
    }
  }

  private botMovePulse(action: InputAction): void {
    const facing = this.gridCamera.getFacingDirection();
    const DIR_OFFSETS: Record<number, [number, number]> = {
      [Direction.North]: [0, -1], [Direction.East]: [1, 0],
      [Direction.South]: [0, 1], [Direction.West]: [-1, 0],
    };
    let dir: Direction;
    switch (action) {
      case 'moveForward': dir = facing; break;
      case 'moveBackward': dir = ((facing + 2) % 4) as Direction; break;
      case 'strafeLeft': dir = ((facing + 3) % 4) as Direction; break;
      case 'strafeRight': dir = ((facing + 1) % 4) as Direction; break;
      default: return;
    }
    const pos = this.gridCamera.position;
    const [dx, dz] = DIR_OFFSETS[dir]!;
    const targetX = (Math.floor(pos.x / TILE_SIZE) + dx) * TILE_SIZE + TILE_SIZE / 2;
    const targetZ = (Math.floor(pos.z / TILE_SIZE) + dz) * TILE_SIZE + TILE_SIZE / 2;
    if (!this.collidesAt(targetX, targetZ)) {
      this.gridCamera.setPosition(targetX, 0, targetZ);
    }
  }

  pushAction(action: InputAction): void {
    this.input.pushAction(action);
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.threeCamera;
  }

  getDungeon(): DungeonData | null {
    return this.dungeon;
  }
}
