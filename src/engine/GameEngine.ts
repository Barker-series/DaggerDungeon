import * as THREE from 'three';
import { DungeonRenderer } from './DungeonRenderer';
import { GridCamera } from './Camera';
import { LightingSystem } from './LightingSystem';
import { SpriteManager } from './SpriteManager';
import { KeyboardInput, type InputAction } from './InputManager';
import { generateDungeon } from '../game/DungeonGenerator';
import { buildCornerField, sampleCornerField } from '../game/dungeon/heightfield';
import { buildOrganicContour, segmentDistSq, type OrganicContour } from '../game/dungeon/organiccontour';
import { DungeonBot } from '../bot/DungeonBot';
import { useGameStore } from '../store/gameStore';
import { TileType, Direction, TILE_SIZE, EYE_HEIGHT } from '../game/types';
import type { DungeonData } from '../game/types';

const MOVE_SPEED = 7;
const SPRINT_MULT = 1.6;
const PLAYER_RADIUS = 0.35;
const CROUCH_SPEED_MULT = 0.55;
const CROUCH_EYE_DROP = 0.7; // eye height drop when fully crouched
const CROUCH_BLEND_RATE = 12; // how fast the crouch transition settles

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = { x: 0, y: 0 };

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private threeCamera: THREE.PerspectiveCamera;
  private timer: THREE.Timer;
  private animFrameId = 0;
  private stopped = false;

  private dungeonRenderer: DungeonRenderer;
  private gridCamera: GridCamera;
  private lighting: LightingSystem;
  private sprites: SpriteManager;
  private input: KeyboardInput;
  private bot: DungeonBot;

  private dungeon: DungeonData | null = null;
  private cornerFloor: number[][] | null = null;
  private contour: OrganicContour | null = null;
  private seed = 0;
  private bobPhase = 0;
  private jumpVelocity = 0;
  private jumpHeight = 0;
  private isGrounded = true;
  private crouchAmount = 0; // 0 = standing, 1 = fully crouched
  private bobOffset = 0;

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
    this.input = new KeyboardInput();
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
    this.bot.reset();

    this.dungeon = generateDungeon({ seed, floor });
    this.cornerFloor = buildCornerField(
      this.dungeon.tiles, this.dungeon.floorHeights,
      this.dungeon.width, this.dungeon.height, 0,
    );
    this.contour = buildOrganicContour(this.dungeon);
    this.dungeonRenderer.build(this.dungeon);
    this.lighting.setup(this.dungeon);

    const store = useGameStore.getState();
    store.setDungeon(this.dungeon);
    store.setCurrentFloor(floor);

    const spawnX = this.dungeon.entrance.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnZ = this.dungeon.entrance.y * TILE_SIZE + TILE_SIZE / 2;
    this.gridCamera.setPosition(spawnX, 0, spawnZ);
    this.gridCamera.setFacingDirection(Direction.North);
    store.setPlayerPos(this.dungeon.entrance);
    store.setPlayerFacing(Direction.North);
  }

  start(): void {
    const loop = (timestamp: number) => {
      if (this.stopped) return;
      this.animFrameId = requestAnimationFrame(loop);
      this.timer.update(timestamp);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      this.update(dt);
      this.renderer.render(this.scene, this.threeCamera);
    };
    // Store the FIRST frame's id too — stop() before the first frame fires
    // (React StrictMode does exactly this) must not leave a zombie loop
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.animFrameId);
    this.input.dispose();
    this.gridCamera.detach();
    this.sprites.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }

  private update(dt: number): void {
    const store = useGameStore.getState();

    // Player movement
    this.processMovement(dt);
    this.syncGridPos(store);
    this.gridCamera.update();
    // Jump and head-bob offsets go on AFTER the camera writes its position —
    // applying them earlier gets overwritten and the jump never shows
    this.threeCamera.position.y += this.jumpHeight + this.bobOffset;

    // Sprites + animated dungeon elements (exit marker)
    this.sprites.update(dt, this.threeCamera);
    this.dungeonRenderer.update(dt);

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

    // Crouch — smooth blend of eye height and speed
    const crouchTarget = this.input.isCrouching() ? 1 : 0;
    this.crouchAmount += (crouchTarget - this.crouchAmount) * (1 - Math.exp(-CROUCH_BLEND_RATE * dt));
    this.gridCamera.eyeHeight = EYE_HEIGHT - CROUCH_EYE_DROP * this.crouchAmount;

    this.input.getMovementDir(_moveDir);
    const isMoving = _moveDir.x !== 0 || _moveDir.y !== 0;

    if (isMoving) {
      const speed = MOVE_SPEED
        * (this.input.isSprinting() ? SPRINT_MULT : 1)
        * (1 - (1 - CROUCH_SPEED_MULT) * this.crouchAmount);
      this.gridCamera.getForward(_forward);
      this.gridCamera.getRight(_right);

      const velX = (_forward.x * _moveDir.y + _right.x * _moveDir.x) * speed * dt;
      const velZ = (_forward.z * _moveDir.y + _right.z * _moveDir.x) * speed * dt;

      // Substep so a slow frame can't tunnel through a thin contour wall
      const pos = this.gridCamera.position;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(velX), Math.abs(velZ)) / 0.25));
      for (let i = 0; i < steps; i++) {
        if (!this.collidesAt(pos.x + velX / steps, pos.z)) pos.x += velX / steps;
        if (!this.collidesAt(pos.x, pos.z + velZ / steps)) pos.z += velZ / steps;
      }

      if (this.isGrounded) this.bobPhase += dt * speed * 0.7;
    } else {
      this.bobPhase *= 0.9;
    }

    // Feet follow the same corner-averaged floor surface the renderer draws
    if (this.cornerFloor) {
      const pos = this.gridCamera.position;
      pos.y = sampleCornerField(this.cornerFloor, pos.x, pos.z);
    }

    this.bobOffset = this.isGrounded && isMoving ? Math.sin(this.bobPhase * 2) * 0.04 : 0;
  }

  private collidesAt(x: number, z: number): boolean {
    if (!this.dungeon) return true;
    const r = PLAYER_RADIUS;
    const w = this.dungeon.width;
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    const seen = new Set<unknown>();
    for (let tz = cz - 1; tz <= cz + 1; tz++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        const tile = this.dungeon.tiles[tz]?.[tx];
        // Wall tiles in organic cells collide via the contour segments
        // below (the wall you see), not their tile box
        const soft = tile !== undefined && this.contour?.softWalls.has(tz * w + tx);
        if ((tile === undefined || tile === TileType.Wall) && !soft) {
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
        // Contour segments registered to this tile (exact visual walls)
        const segs = this.contour?.byTile.get(tz * w + tx);
        if (segs) {
          for (const seg of segs) {
            if (seen.has(seg)) continue;
            seen.add(seg);
            if (segmentDistSq(seg, x, z) < r * r) return true;
          }
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

  // ── Actions ──

  private processActions(): void {
    // Drain the whole queue — actions left to next frame execute stale
    let action: InputAction | null;
    while ((action = this.input.consumeAction())) {
      this.processAction(action);
    }
  }

  private processAction(action: InputAction): void {
    switch (action) {
      case 'interact':
        this.tryInteract();
        break;
      case 'toggleAutoPlay': {
        const store = useGameStore.getState();
        store.toggleAutoPlay();
        // Release the bot's virtual keys when switching off mid-walk
        if (!useGameStore.getState().autoPlay) this.bot.reset();
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

  private tryInteract(): void {
    if (!this.dungeon) return;
    const store = useGameStore.getState();
    const { x, y } = store.playerPos;
    const tile = this.dungeon.tiles[y]?.[x];
    if (tile === TileType.StairsDown) {
      this.loadFloor(store.currentFloor + 1, this.seed);
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

  /** Dev/debug helper: place the player at a tile, optionally facing a yaw. */
  teleport(tileX: number, tileY: number, yaw?: number): void {
    this.gridCamera.setPosition(
      tileX * TILE_SIZE + TILE_SIZE / 2,
      0,
      tileY * TILE_SIZE + TILE_SIZE / 2,
    );
    if (yaw !== undefined) this.gridCamera.yaw = yaw;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.threeCamera;
  }

  getDungeon(): DungeonData | null {
    return this.dungeon;
  }
}
