import * as THREE from 'three';
import { DungeonRenderer } from './DungeonRenderer';
import { GridCamera } from './Camera';
import { LightingSystem } from './LightingSystem';
import { SpriteManager } from './SpriteManager';
import { KeyboardInput, type InputAction } from './InputManager';
import { generateWorld } from '../game/DungeonGenerator';
import { buildCornerField, sampleCornerField } from '../game/dungeon/heightfield';
import { spanAt } from '../game/dungeon/columns';
import { buildOrganicContour, segmentDistSq, type OrganicContour } from '../game/dungeon/organiccontour';
import { DungeonBot } from '../bot/DungeonBot';
import { useGameStore } from '../store/gameStore';
import { TileType, Direction, TILE_SIZE, EYE_HEIGHT, ABYSS_FLOOR } from '../game/types';
import type { DungeonData, WorldData } from '../game/types';

const MOVE_SPEED = 7;
const SPRINT_MULT = 1.6;
const PLAYER_RADIUS = 0.35;
const CROUCH_SPEED_MULT = 0.55;
const CROUCH_EYE_DROP = 0.7; // eye height drop when fully crouched
const CROUCH_BLEND_RATE = 12; // how fast the crouch transition settles

// Vertical physics — cliffs are real obstacles
const GRAVITY = 15;
const JUMP_VELOCITY = 5.6; // peak ~1.05: enough to mantle a 1-unit ledge
// Slope limit (rise per unit of horizontal run). All grade-level rolling
// terrain stays comfortably under this, and stairwell ramps peak at ~1.0
// mid-tile (smoothstep steepens their 0.67 average) — you glide up every
// hill and every ramp without jumping. Only shaft walls (slope ~10+)
// exceed it.
const MAX_SLOPE = 1.1;
const AIR_STEP = 0.05; // while airborne, can move onto ground at most this far above the feet
const FALL_DROP = 0.5; // ground falling away further than this puts you airborne
// Ground queries look at most this far above the feet — enough for any
// walkable rise, never far enough to grab the level overhead
const CLIMB_HEADROOM = 1.0;
// How close (world units) the player must be to the stairs to use them
const INTERACT_RADIUS = TILE_SIZE * 1.6;

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

  private world: WorldData | null = null;
  /** Per-level corner-averaged floor fields — physics samples the exact
   *  surfaces the renderer draws */
  private cornerFloors: number[][][] = [];
  private contours: OrganicContour[] = [];
  private seed = 0;
  private bobPhase = 0;
  private vy = 0; // vertical velocity; gridCamera.position.y is the feet
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

    // Far plane covers a full look down (or up) a multi-level shaft
    this.threeCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 160);
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

  /** Generate and enter a megastructure stack — WORLD_LEVELS levels that
   *  physically coexist; the player spawns on the top one. */
  loadStack(stack: number, seed: number): void {
    this.seed = seed;
    this.dungeonRenderer.clear();
    this.lighting.clear();
    this.sprites.clear();
    this.bot.reset();

    this.world = generateWorld({ seed, stack });
    this.cornerFloors = this.world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0));
    this.contours = this.world.levels.map((l) => buildOrganicContour(l));
    this.dungeonRenderer.build(this.world);
    this.lighting.setup(this.world);

    const store = useGameStore.getState();
    store.setWorld(this.world);
    store.setCurrentFloor(stack);

    const top = this.world.levels[0]!;
    const spawnX = top.entrance.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnZ = top.entrance.y * TILE_SIZE + TILE_SIZE / 2;
    this.gridCamera.setPosition(
      spawnX,
      top.baseY + sampleCornerField(this.cornerFloors[0]!, spawnX, spawnZ),
      spawnZ,
    );
    this.vy = 0;
    this.isGrounded = true;
    this.gridCamera.setFacingDirection(Direction.North);
    store.setPlayerPos(top.entrance);
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
    // Head-bob goes on AFTER the camera writes its position —
    // applying it earlier gets overwritten and never shows
    this.threeCamera.position.y += this.bobOffset;

    // Sprites + animated dungeon elements (exit markers)
    this.sprites.update(dt, this.threeCamera);
    this.dungeonRenderer.update(dt);

    // Nearest-K light culling follows the player
    const pos = this.gridCamera.position;
    this.lighting.update(pos.x, pos.y, pos.z);

    // Bot
    if (store.autoPlay) {
      this.bot.update(dt);
    }

    // One-shot actions
    this.processActions();
  }

  // ── Column-model world queries — the ONE authority on solid vs air ──

  /** Air spans of the column containing a world position */
  private columnAt(x: number, z: number) {
    if (!this.world) return undefined;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    if (tx < 0 || tz < 0 || tx >= this.world.levels[0]!.width || tz >= this.world.levels[0]!.height) {
      return undefined;
    }
    return this.world.columns[tz * this.world.levels[0]!.width + tx];
  }

  /** Apron ground at a chamfer pocket (contoured wall column) for a
   *  level, or null. Pockets are standable space the renderer backs with
   *  apron floors — physics must agree. */
  private pocketGround(li: number, tx: number, tz: number, x: number, z: number): number | null {
    const level = this.world!.levels[li]!;
    if (level.tiles[tz]?.[tx] !== TileType.Wall) return null;
    if (!this.contours[li]?.softWalls.has(tz * level.width + tx)) return null;
    return level.baseY + sampleCornerField(this.cornerFloors[li]!, x, z);
  }

  /** Level whose surface the player currently stands in/over (-1 = rock).
   *  Chamfer pockets (no span of their own) attribute by apron height;
   *  otherwise generous span slack: a span's floor is its TILE value, and
   *  the smoothed walk surface (ramps especially) dips ~1 below it. */
  private currentOwner(): number {
    const pos = this.gridCamera.position;
    if (this.world) {
      const tx = Math.floor(pos.x / TILE_SIZE);
      const tz = Math.floor(pos.z / TILE_SIZE);
      for (let li = 0; li < this.world.levels.length; li++) {
        const g = this.pocketGround(li, tx, tz, pos.x, pos.z);
        if (g !== null && Math.abs(g - pos.y) <= 2) return li;
      }
    }
    const spans = this.columnAt(pos.x, pos.z);
    const s = spans ? spanAt(spans, pos.y, 1.6) : null;
    return s ? s.owner : -1;
  }

  /** The level the player currently occupies (for UI/interact) */
  private currentLevel(): DungeonData | null {
    const owner = this.currentOwner();
    return this.world?.levels[owner >= 0 ? owner : useGameStore.getState().currentLevel] ?? null;
  }

  /**
   * Ground at (x, z) at or below limitY: the floor of the air span there.
   * Smooth surfaces sample their owner level's corner field; structural
   * rock is flat; the abyss returns -Infinity (fall forever, R respawns).
   */
  private worldGround(x: number, z: number, limitY: number): number {
    const spans = this.columnAt(x, z);
    if (!spans) return -Infinity;
    let best = -Infinity;
    const s = spanAt(spans, limitY, 0.6);
    if (s && s.floor !== ABYSS_FLOOR) {
      best = s.owner < 0
        ? s.floor
        : this.world!.levels[s.owner]!.baseY + sampleCornerField(this.cornerFloors[s.owner]!, x, z);
    }
    // Chamfer pockets: contoured wall columns carry their apron floor —
    // the drawn surface behind the diagonal wall is real ground, never a
    // gap into the level below
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    for (let li = 0; li < this.world!.levels.length; li++) {
      const g = this.pocketGround(li, tx, tz, x, z);
      if (g !== null && g <= limitY + 0.6 && g > best) best = g;
    }
    return best;
  }

  // ── Player Movement ──

  private processMovement(dt: number): void {
    if (!this.world) return;
    const pos = this.gridCamera.position;
    const groundAt = (x: number, z: number): number =>
      this.worldGround(x, z, pos.y + CLIMB_HEADROOM);

    if (this.isGrounded && this.input.consumeJump()) {
      this.vy = JUMP_VELOCITY;
      this.isGrounded = false;
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

      // Substep so a slow frame can't tunnel through a thin contour wall.
      // A step is blocked by walls AND by ground rising faster than legs
      // can climb — cliffs are obstacles, ramps are not. While airborne,
      // ground at most a hair above the feet is enterable (ledge mantling).
      const canStand = (x: number, z: number, run: number): boolean => {
        const g = groundAt(x, z);
        return this.isGrounded ? g - pos.y <= MAX_SLOPE * run : g <= pos.y + AIR_STEP;
      };
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(velX), Math.abs(velZ)) / 0.25));
      for (let i = 0; i < steps; i++) {
        const nx = pos.x + velX / steps;
        if (!this.collidesAt(nx, pos.z) && canStand(nx, pos.z, Math.abs(velX / steps))) pos.x = nx;
        const nz = pos.z + velZ / steps;
        if (!this.collidesAt(pos.x, nz) && canStand(pos.x, nz, Math.abs(velZ / steps))) pos.z = nz;
        // Grounded feet track the surface between substeps so long slopes
        // accumulate correctly
        if (this.isGrounded) {
          const g = groundAt(pos.x, pos.z);
          if (g >= pos.y - FALL_DROP) pos.y = g;
        }
      }

      if (this.isGrounded) this.bobPhase += dt * speed * 0.7;
    } else {
      this.bobPhase *= 0.9;
    }

    // Vertical resolution
    const ground = groundAt(pos.x, pos.z);
    if (this.isGrounded) {
      if (ground < pos.y - FALL_DROP) {
        // Walked off an edge — over a shaft this is the whole descent
        this.isGrounded = false;
        this.vy = 0;
      } else {
        pos.y = ground;
      }
    }
    if (!this.isGrounded) {
      this.vy -= GRAVITY * dt;
      pos.y += this.vy * dt;
      if (this.vy <= 0 && pos.y <= ground) {
        pos.y = ground;
        this.vy = 0;
        this.isGrounded = true;
      }
    }

    this.bobOffset = this.isGrounded && isMoving ? Math.sin(this.bobPhase * 2) * 0.04 : 0;
  }

  private collidesAt(x: number, z: number): boolean {
    if (!this.world) return true;
    const feetY = this.gridCamera.position.y;
    const owner = this.currentOwner();
    const contour = owner >= 0 ? this.contours[owner] : undefined;
    const dungeon = owner >= 0 ? this.world.levels[owner] : undefined;
    const w = this.world.levels[0]!.width;
    const r = PLAYER_RADIUS;
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    const seen = new Set<unknown>();
    for (let tz = cz - 1; tz <= cz + 1; tz++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        // Solidity comes from the column model: a column blocks the body
        // unless some air span overlaps the torso. (Organic wall tiles are
        // "soft": their pockets are walkable, the contour segments below
        // are their real surface.)
        const spans = tx >= 0 && tz >= 0 && tx < w && tz < w
          ? this.world.columns[tz * w + tx]
          : undefined;
        const soft = dungeon !== undefined
          && dungeon.tiles[tz]?.[tx] === TileType.Wall
          && contour?.softWalls.has(tz * w + tx);
        if (!soft) {
          let open = false;
          if (spans) {
            for (const s of spans) {
              if (s.floor < feetY + 1.5 && s.ceil > feetY + 1.2) {
                open = true;
                break;
              }
            }
          }
          if (!open) {
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
        // Contour segments registered to this tile (exact visual walls)
        const segs = contour?.byTile.get(tz * w + tx);
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
    if (Math.abs(pos.y - store.playerY) > 0.2) {
      store.setPlayerY(pos.y);
    }
    const owner = this.currentOwner();
    if (owner >= 0 && owner !== store.currentLevel) {
      store.setCurrentLevel(owner);
      this.lighting.setActiveLevel(owner);
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
      case 'respawn':
        this.respawn();
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

  /** Return to the stack's entrance on the top level (R to unstick, or the
   *  only way back from a bottomless fall) */
  private respawn(): void {
    if (!this.world) return;
    this.teleport(this.world.levels[0]!.entrance.x, this.world.levels[0]!.entrance.y, undefined, 0);
    this.bot.reset();
  }

  private tryInteract(): void {
    const dungeon = this.currentLevel();
    if (!dungeon || !this.world) return;
    // Stairs down exist only on the bottom level — upper levels descend by
    // shaft. Radius-based: standing anywhere by the stairs works, no need
    // to be on the exact tile.
    if (dungeon.level !== this.world.levels.length - 1) return;
    if (dungeon.tiles[dungeon.exit.y]?.[dungeon.exit.x] !== TileType.StairsDown) return;
    const pos = this.gridCamera.position;
    const ex = dungeon.exit.x * TILE_SIZE + TILE_SIZE / 2;
    const ez = dungeon.exit.y * TILE_SIZE + TILE_SIZE / 2;
    if ((pos.x - ex) ** 2 + (pos.z - ez) ** 2 <= INTERACT_RADIUS ** 2) {
      this.loadStack(useGameStore.getState().currentFloor + 1, this.seed);
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
      this.gridCamera.setPosition(targetX, pos.y, targetZ);
    }
  }

  pushAction(action: InputAction): void {
    this.input.pushAction(action);
  }

  /** Dev/debug helper: place the player at a tile, optionally facing a
   *  yaw/pitch. `level` defaults to the level currently occupied. */
  teleport(tileX: number, tileY: number, yaw?: number, level?: number, pitch?: number): void {
    if (!this.world) return;
    const li = level ?? Math.max(0, this.currentOwner());
    const x = tileX * TILE_SIZE + TILE_SIZE / 2;
    const z = tileY * TILE_SIZE + TILE_SIZE / 2;
    const base = this.world.levels[li]!.baseY;
    const y = base + sampleCornerField(this.cornerFloors[li]!, x, z);
    this.gridCamera.setPosition(x, y, z);
    this.vy = 0;
    this.isGrounded = true;
    if (yaw !== undefined) this.gridCamera.yaw = yaw;
    if (pitch !== undefined) this.gridCamera.pitch = pitch;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.threeCamera;
  }

  getWorld(): WorldData | null {
    return this.world;
  }

  getDungeon(): DungeonData | null {
    return this.currentLevel();
  }
}
