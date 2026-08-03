import * as THREE from 'three';
import { DungeonRenderer } from './DungeonRenderer';
import { GridCamera } from './Camera';
import { LightingSystem } from './LightingSystem';
import { SpriteManager } from './SpriteManager';
import { KeyboardInput, type InputAction } from './InputManager';
import { generateWorld } from '../game/DungeonGenerator';
import { Movers } from './Movers';
import { buildCornerField, sampleCornerField } from '../game/dungeon/heightfield';
import { spanAt } from '../game/dungeon/columns';
import { buildOrganicContour, segmentDistSq, type OrganicContour } from '../game/dungeon/organiccontour';
import { tileBiome } from '../game/dungeon/cells';
import { DungeonBot } from '../bot/DungeonBot';
import { useGameStore } from '../store/gameStore';
import { TileType, Direction, TILE_SIZE, EYE_HEIGHT, ABYSS_FLOOR } from '../game/types';
import { PILLAR_CELL_TILES } from '../game/dungeon/pillar-layer';
import type { DungeonData, WorldData } from '../game/types';
import type { WorldWorkerRequest } from '../game/world-worker';
import {
  PostProcessing,
  type VisualSettings,
  type RenderDebugMode,
} from './PostProcessing';
import { copyText } from '../utils/copyText';

/** One pillar cell in world units (56 tiles × 3 wu) — the window
 *  recenter/prefetch lattice */
const PCELL = PILLAR_CELL_TILES * TILE_SIZE;

const MOVE_SPEED = 7;
const SPRINT_MULT = 1.6;

// ── Source-style velocity model (CS/GMOD feel) ──
// Velocity persists across frames; input is an acceleration wish, and only
// the PROJECTION of velocity onto the wish direction is capped — the
// classic trick that makes air strafing and bunnyhopping emerge naturally.
// (refs: adrianb.io bunnyhop article; fragsurf MovementConfig)
const GROUND_FRICTION = 6; // exponential decay factor while grounded
const STOP_SPEED = 2; // below this, friction bites at a fixed rate (crisp stops)
const GROUND_ACCEL = 10; // fills wishspeed in ~0.1s: snappy but not instant
/** Airborne wishspeed cap — small, per Source: you can only ADD ~this much
 *  speed toward the wish direction per air period, but strafing rotates
 *  the velocity vector and gains speed. ~30ups equivalent. */
const AIR_CAP = 0.85;
const AIR_ACCEL = 60; // high (surf-server style): the cap does the limiting
const MAX_VELOCITY = 50; // hard safety clamp (matches fragsurf maxVelocity)

// ── Ledge grab / mantle ──
// Airborne, pushing toward a ledge whose top is above step range but
// within arm's reach: the fall stops and the player pulls up onto it.
// Rescues jumps that fall just short (pits!) and makes low plinths
// climbable: from street grade a jump apex puts the feet at ~1.55, so a
// 3.0 block top is a grab away.
const GRAB_HEIGHT = 2.05; // max ledge rise above the feet that hands can catch
// 2.05 makes the 3-unit structural module the standard climb: a jump apex
// (~1.05) leaves a 3.0 plinth tier 1.95 above the feet — caught. Plinth
// terraces chain: street → court → 3 → 6 → 9 → 12.
const MANTLE_UP_SPEED = 6; // vertical pull speed (wu/s)
const MANTLE_FWD_SPEED = 4; // horizontal tuck speed once above the lip
const MANTLE_HEADROOM = 1.7; // the target span must fit a standing body
/** Failed-mantle slingshot (the Lorne's Lure move): a mantle that jams —
 *  blocked tuck, overdue TTL — LAUNCHES the player upward instead of
 *  dropping them. Failure reads as "kicked off the wall": the boost
 *  clears the lip they were grabbing and gravity resolves the rest. */
const MANTLE_BOOST_VY = 5.2;
const MANTLE_BOOST_FWD = 2.5; // gentle carry toward the ledge mid-boost

// ── Body height ──
// Standing body height for passability and ceiling collision. Low spans
// (under-stair wedges, ducts) admit a crouched body only: standing
// movement is blocked, crouching squeezes through, and the airborne
// ceiling clamp keeps a jump from passing through solid overhead.
const STAND_HEIGHT = 1.75;
const CROUCH_HEIGHT = 1.15;

// ── Area fog — the atmosphere follows where you are ──
// Black is the default; specific places override, and the color FADES
// between areas rather than switching (exponential chase toward the
// target). Ember's red identity lives here now, not on its textures.
const FOG_DEFAULT = 0x0f0e12;
const FOG_ROADS = 0x26262b; // dark gray under the open street sky
const FOG_EMBER = 0x2b0a06; // dark heat haze
const FOG_FADE_RATE = 1.2; // per-second chase toward the target color
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
/** Grounded auto-step: lips and stair risers up to this height are
 *  walked over without jumping. Substeps are ~0.25 units of run, so the
 *  slope test alone caps a single riser at ~0.28 — too strict for slab
 *  edges (0.5) and bridge/ramp steps. */
const STEP_UP = 0.65;
const AIR_STEP = 0.05; // while airborne, can move onto ground at most this far above the feet
const FALL_DROP = 0.5; // ground falling away further than this puts you airborne
// Ground queries look at most this far above the feet — enough for any
// walkable rise, never far enough to grab the level overhead
const CLIMB_HEADROOM = 1.0;
// How close (world units) the player must be to the stairs to use them

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = { x: 0, y: 0 };

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private postProcessing: PostProcessing;
  private scene: THREE.Scene;
  private threeCamera: THREE.PerspectiveCamera;
  private timer: THREE.Timer;
  private animFrameId = 0;
  private stopped = false;
  private paused = false;

  private dungeonRenderer: DungeonRenderer;
  private movers: Movers | null = null;
  /** Window origin on the infinite plane, in pillar cells */
  private originPcx = 0;
  private originPcz = 0;
  private gridCamera: GridCamera;
  private lighting: LightingSystem;
  private sprites: SpriteManager;
  private input: KeyboardInput;
  private bot: DungeonBot;
  private worldWorker: Worker;
  /** Dedicated lane for the exact window the player is approaching.
   * It must not wait behind speculative cardinal-neighbor generation. */
  private urgentWorldWorker: Worker;
  private worldCache = new Map<string, WorldData>();
  private pendingWorlds = new Set<string>();
  private urgentPendingWorlds = new Set<string>();
  private readonly maxCachedWorlds = 10;

  private world: WorldData | null = null;
  /** Per-level corner-averaged floor fields — physics samples the exact
   *  surfaces the renderer draws */
  private cornerFloors: number[][][] = [];
  private contours: OrganicContour[] = [];
  private seed = 0;
  private vy = 0; // vertical velocity; gridCamera.position.y is the feet
  // Persistent horizontal velocity (Source model) — survives frames and
  // jumps; input accelerates it, friction decays it
  private velX = 0;
  private velZ = 0;
  private wasBotDriving = false;
  /** Active ledge mantle: rise to y, then tuck to (x, z). Null = none.
   *  ttl is a hard cap: a mantle that hasn't finished in this long is
   *  cancelled into a plain fall — whatever state produced it, it can
   *  never become sustained movement. */
  private mantle: { x: number; z: number; y: number; ttl: number } | null = null;
  /** No re-grab for this long after a mantle ends — a mantle that lands
   *  on a surface lower than its span's nominal floor must FALL to it,
   *  not chain into the next grab (the ratchet flew players through
   *  walls at constant height). */
  private mantleCooldown = 0;
  /** User quality slider: multiplies devicePixelRatio (0.5 = fast/soft,
   *  1.5 = supersampled). Post-processing rescales with it. */
  private renderScale = 1;
  private fogColor = new THREE.Color(FOG_DEFAULT);
  private readonly fogTarget = new THREE.Color(FOG_DEFAULT);
  /** Camera-only smoothed feet height. Physics snaps up stair risers
   *  tile by tile; the EYE eases onto each new level instead of popping
   *  with it — stairs read as a glide, not a jackhammer. */
  private smoothFeetY = 0;
  private isGrounded = true;
  private crouchAmount = 0; // 0 = standing, 1 = fully crouched
  /** Debug marks: click-tagged world points, embedded in DDSNAP strings
   *  so the viewer highlights the exact geometry being reported */
  private marks: { pos: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  private playerSpeedMultiplier = 1;
  private debugMaterials: Record<Exclude<RenderDebugMode, 'lit'>, THREE.Material> = {
    // Structural geometry is front-facing only. Debug views keep culling
    // enabled so they reveal winding and missing-face bugs instead of hiding
    // them behind a different material contract.
    solid: new THREE.MeshBasicMaterial({ color: 0xb8b2a8, side: THREE.FrontSide }),
    wireframe: new THREE.MeshBasicMaterial({
      color: 0xd4a44a,
      wireframe: true,
      side: THREE.FrontSide,
    }),
    normals: new THREE.MeshNormalMaterial({ side: THREE.FrontSide }),
  };

  constructor(
    canvas: HTMLCanvasElement,
    private onNotice: (message: string) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();

    // Far plane covers a full look down (or up) a multi-level shaft
    this.threeCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 160);
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.threeCamera);
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
    this.worldWorker = new Worker(
      new URL('../game/world-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.urgentWorldWorker = new Worker(
      new URL('../game/world-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worldWorker.onmessage = (event) => this.acceptPreparedWorld(event, false);
    this.urgentWorldWorker.onmessage = (event) => this.acceptPreparedWorld(event, true);
    this.worldWorker.onerror = (event) => {
      console.error('[stream] background generation failed', event.message);
    };
    this.urgentWorldWorker.onerror = (event) => {
      console.error('[stream] urgent generation failed', event.message);
    };
    this.timer = new THREE.Timer();

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleSnapshotKey);
    window.addEventListener('mousedown', this.handleMarkClick);
  }

  /** Pointer-locked LMB: mark the surface under the crosshair with a
   *  red beacon; RMB: remove the nearest mark. Marks ride along in the
   *  DDSNAP snapshot so the debug viewer highlights EXACTLY the
   *  geometry being reported. */
  private handleMarkClick = (e: MouseEvent) => {
    if (!this.gridCamera.getIsPointerLocked()) return;
    if (e.button === 0) {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), this.threeCamera);
      ray.far = 200;
      const hits = ray.intersectObjects(this.scene.children, true)
        .filter((h) => !(h.object as THREE.Mesh).userData['debugMark'] && (h.object as THREE.Mesh).isMesh);
      const hit = hits[0];
      if (!hit) return;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff2020 }),
      );
      mesh.userData['debugMark'] = true;
      mesh.position.copy(hit.point);
      this.scene.add(mesh);
      this.marks.push({ pos: hit.point.clone(), mesh });
      console.log(`[mark] ${this.marks.length} @ (${hit.point.x.toFixed(1)}, ${hit.point.y.toFixed(1)}, ${hit.point.z.toFixed(1)})`);
    } else if (e.button === 2) {
      const eyePos = this.threeCamera.position;
      let best = -1;
      let bestD = Infinity;
      this.marks.forEach((m, i) => {
        const d = m.pos.distanceTo(eyePos);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const [m] = this.marks.splice(best, 1);
        this.scene.remove(m!.mesh);
        m!.mesh.geometry.dispose();
        (m!.mesh.material as THREE.Material).dispose();
        console.log(`[mark] removed, ${this.marks.length} left`);
      }
    }
  };

  /** F8 — copy a DDSNAP repro string to the clipboard. Paste it to the
   *  assistant: tools/debug-view.ts regenerates this exact world and
   *  renders this exact view headlessly, so a seen bug becomes a
   *  reproducible one. */
  private handleSnapshotKey = (e: KeyboardEvent) => {
    if (e.code !== 'F8') return;
    e.preventDefault();
    const pos = this.gridCamera.position;
    const snap = `DDSNAP1${JSON.stringify({
      seed: this.seed,
      stack: useGameStore.getState().currentFloor,
      ...(this.originPcx !== 0 || this.originPcz !== 0
        ? { opx: this.originPcx, opz: this.originPcz } : {}),
      x: +pos.x.toFixed(2),
      y: +pos.y.toFixed(2),
      z: +pos.z.toFixed(2),
      yaw: +this.gridCamera.yaw.toFixed(3),
      pitch: +this.gridCamera.pitch.toFixed(3),
      ...(this.marks.length > 0 && {
        marks: this.marks.map((m) => [+m.pos.x.toFixed(2), +m.pos.y.toFixed(2), +m.pos.z.toFixed(2)]),
      }),
    })}`;
    console.log('[snapshot]', snap);
    void copyText(snap).then((copied) => {
      this.onNotice(copied ? 'Snapshot copied' : 'Snapshot copy failed');
    });
  };

  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.5, Math.min(1.5, scale));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.handleResize();
  }

  private handleResize = () => {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.renderer.setSize(w, h);
    this.postProcessing.setSize(w, h);
    this.threeCamera.aspect = w / h;
    this.threeCamera.updateProjectionMatrix();
  };

  /** Generate and enter a megastructure stack — one tall floor of
   *  pillars, bridges, and dungeon ground. */
  /** (Re)generate the current window and rebuild everything derived
   *  from it. The world is a 4x4-pillar-cell window onto the endless
   *  plane at (originPcx, originPcz). */
  private worldKey(stack: number, originPcx: number, originPcz: number): string {
    return `${this.seed}:${stack}:${originPcx},${originPcz}`;
  }

  private acceptPreparedWorld(
    event: MessageEvent<{ key: string; world: WorldData; generationMs: number }>,
    urgent: boolean,
  ): void {
    const { key, world, generationMs } = event.data;
    (urgent ? this.urgentPendingWorlds : this.pendingWorlds).delete(key);
    // A seed can change while either worker is finishing an old request.
    if (!key.startsWith(`${this.seed}:`)) return;
    this.worldCache.delete(key);
    this.worldCache.set(key, world);
    while (this.worldCache.size > this.maxCachedWorlds) {
      const oldest = this.worldCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.worldCache.delete(oldest);
    }
    if (import.meta.env.DEV) {
      console.debug(
        `[stream] ${urgent ? 'urgent ' : ''}prepared ${key} off-thread in `
        + `${generationMs.toFixed(1)} ms`,
      );
    }
  }

  private requestWorld(stack: number, originPcx: number, originPcz: number): void {
    const key = this.worldKey(stack, originPcx, originPcz);
    if (this.worldCache.has(key) || this.pendingWorlds.has(key)) return;
    this.pendingWorlds.add(key);
    const request: WorldWorkerRequest = {
      key,
      seed: this.seed,
      stack,
      originPcx,
      originPcz,
    };
    this.worldWorker.postMessage(request);
  }

  private requestUrgentWorld(stack: number, originPcx: number, originPcz: number): void {
    const key = this.worldKey(stack, originPcx, originPcz);
    if (this.worldCache.has(key) || this.urgentPendingWorlds.has(key)) return;
    this.urgentPendingWorlds.add(key);
    const request: WorldWorkerRequest = {
      key,
      seed: this.seed,
      stack,
      originPcx,
      originPcz,
    };
    this.urgentWorldWorker.postMessage(request);
  }

  /** Watch actual player position, including diagonal movement and sudden
   * direction changes. The exact next window gets a dedicated worker lane
   * well before the recenter threshold. */
  private prefetchApproachingWindow(stack: number): void {
    const margin = PCELL * 0.65;
    const pos = this.gridCamera.position;
    let dx = 0;
    let dz = 0;
    if (pos.x < PCELL + margin) dx = -1;
    else if (pos.x >= 3 * PCELL - margin) dx = 1;
    if (pos.z < PCELL + margin) dz = -1;
    else if (pos.z >= 3 * PCELL - margin) dz = 1;
    if (dx !== 0 || dz !== 0) {
      this.requestUrgentWorld(stack, this.originPcx + dx, this.originPcz + dz);
    }
  }

  /** Prepare the four windows reachable at the next boundary. At normal
   * sprint speed this gives the worker many seconds of lead time. */
  private prefetchAdjacentWindows(stack: number): void {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.requestWorld(stack, this.originPcx + dx, this.originPcz + dz);
    }
  }

  private buildWindow(stack: number): void {
    const buildStarted = performance.now();
    const phaseTimes: Record<string, number> = {};
    let phaseStarted = buildStarted;
    const markPhase = (name: string): void => {
      const now = performance.now();
      phaseTimes[name] = now - phaseStarted;
      phaseStarted = now;
    };
    const key = this.worldKey(stack, this.originPcx, this.originPcz);
    this.lighting.clear();
    this.sprites.clear();
    this.bot.reset();
    this.movers?.dispose(this.scene);
    markPhase('clear');
    const preparedWorld = this.worldCache.get(key);
    if (preparedWorld) {
      this.worldCache.delete(key);
      this.world = preparedWorld;
    } else {
      // Initial load (or movement faster than prefetch) retains a safe
      // synchronous fallback. Ordinary boundary crossings should be prepared.
      this.world = generateWorld({
        seed: this.seed, stack,
        originPcx: this.originPcx, originPcz: this.originPcz,
      });
      if (import.meta.env.DEV && (this.originPcx !== 0 || this.originPcz !== 0)) {
        console.warn(`[stream] cache miss at ${key}; synchronous fallback`);
      }
    }
    markPhase('world');
    this.cornerFloors = this.world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0, l.pillarGround));
    this.contours = this.world.levels.map((l) => buildOrganicContour(l));
    markPhase('collision');
    // Adopt the window as the chunk data source. No geometry is built
    // here: chunks stream in via updateChunks each frame — surviving
    // core chunks carry across, rim chunks rebuild in the background.
    this.dungeonRenderer.setWindow(this.world);
    markPhase('geometry-adopt');
    this.movers = new Movers(this.world, this.scene);
    markPhase('movers');
    this.lighting.setup(this.world);
    markPhase('lighting');
    useGameStore.getState().setWorld(this.world);
    this.prefetchAdjacentWindows(stack);
    markPhase('state');
    if (import.meta.env.DEV) {
      console.info(
        `[stream] adopted ${key} (${preparedWorld ? 'prefetched' : 'synchronous'}) in `
        + `${(performance.now() - buildStarted).toFixed(1)} ms `
        + Object.entries(phaseTimes)
          .map(([name, ms]) => `${name}=${ms.toFixed(1)}`)
          .join(' '),
      );
    }
  }

  /** THE ENDLESS WALK: when the player leaves the center 2x2 pillar
   *  cells of the window, shift the window so they are central again
   *  and regenerate. Field-driven ground is window-stable, so the
   *  world around the player persists; the horizon is recomputed.
   *  (v1: a full-window rebuild — a short hitch at each crossing.) */
  private recenterWindow(): void {
    if (!this.world) return;
    const pos = this.gridCamera.position;
    let shiftX = 0;
    let shiftZ = 0;
    while (pos.x - shiftX * PCELL < PCELL) shiftX--;
    while (pos.x - shiftX * PCELL >= 3 * PCELL) shiftX++;
    while (pos.z - shiftZ * PCELL < PCELL) shiftZ--;
    while (pos.z - shiftZ * PCELL >= 3 * PCELL) shiftZ++;
    if (shiftX === 0 && shiftZ === 0) return;
    const wasGrounded = this.isGrounded;
    const previousFeetY = pos.y;
    this.originPcx += shiftX;
    this.originPcz += shiftZ;
    pos.x -= shiftX * PCELL;
    pos.z -= shiftZ * PCELL;
    for (const m of this.marks) {
      m.pos.x -= shiftX * PCELL;
      m.pos.z -= shiftZ * PCELL;
    }
    this.buildWindow(useGameStore.getState().currentFloor);
    if (wasGrounded) this.stabilizeGroundedHandoff(previousFeetY);
  }

  /**
   * A few legacy whole-window passes can still disagree in overlap: a tunnel
   * present in the old window may be solid in the new one. Recenter is a
   * transaction for a grounded player — do not resume physics until the new
   * column model supplies compatible walkable air. Prefer the exact position;
   * otherwise recover to the nearest same-height span in a bounded radius.
   */
  private stabilizeGroundedHandoff(previousFeetY: number): void {
    if (!this.world) return;
    const pos = this.gridCamera.position;
    const w = this.world.levels[0]!.width;
    const startTx = Math.floor(pos.x / TILE_SIZE);
    const startTz = Math.floor(pos.z / TILE_SIZE);
    const MAX_HANDOFF_RADIUS_TILES = 16;
    const MAX_VERTICAL_DELTA = 2;

    let best: { x: number; z: number; y: number; score: number } | null = null;
    for (let radius = 0; radius <= MAX_HANDOFF_RADIUS_TILES; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const tx = startTx + dx;
          const tz = startTz + dz;
          if (tx < 0 || tz < 0 || tx >= w || tz >= w) continue;
          const exactColumn = dx === 0 && dz === 0;
          const x = exactColumn ? pos.x : tx * TILE_SIZE + TILE_SIZE / 2;
          const z = exactColumn ? pos.z : tz * TILE_SIZE + TILE_SIZE / 2;
          for (const span of this.world.columns[tz * w + tx]!) {
            if (span.floor === ABYSS_FLOOR || span.ceil - span.floor < EYE_HEIGHT + 0.2) continue;
            const y = span.owner < 0
              ? span.floor
              : this.world.levels[span.owner]!.baseY
                + sampleCornerField(this.cornerFloors[span.owner]!, x, z);
            const verticalDelta = Math.abs(y - previousFeetY);
            if (verticalDelta > MAX_VERTICAL_DELTA) continue;
            const score = dx * dx + dz * dz + verticalDelta * verticalDelta * 4;
            if (!best || score < best.score) best = { x, z, y, score };
          }
        }
      }
      if (best) break;
    }

    const recovery = best as { x: number; z: number; y: number; score: number } | null;
    if (!recovery) {
      // No compatible continuation exists nearby. Returning to the known-safe
      // entrance is preferable to silently dropping through a regenerated
      // solid/void boundary.
      console.warn('[stream] no compatible overlap support; returning to entrance');
      this.respawn();
      return;
    }

    const moved = Math.hypot(recovery.x - pos.x, recovery.z - pos.z) > TILE_SIZE * 0.75;
    pos.set(recovery.x, recovery.y, recovery.z);
    this.vy = 0;
    this.velX = 0;
    this.velZ = 0;
    this.mantle = null;
    this.isGrounded = true;
    this.smoothFeetY = recovery.y;
    if (moved) {
      console.warn(
        `[stream] overlap changed at tunnel handoff; recovered ${Math.sqrt(recovery.score).toFixed(1)} units away`,
      );
    }
  }

  loadStack(stack: number, seed: number): void {
    this.seed = seed;
    this.worldCache.clear();
    this.pendingWorlds.clear();
    this.urgentPendingWorlds.clear();
    this.originPcx = 0;
    this.originPcz = 0;
    this.buildWindow(stack);

    const store = useGameStore.getState();
    store.setCurrentFloor(stack);

    const top = this.world!.levels[0]!;
    const spawnX = top.entrance.x * TILE_SIZE + TILE_SIZE / 2;
    const spawnZ = top.entrance.y * TILE_SIZE + TILE_SIZE / 2;
    this.gridCamera.setPosition(
      spawnX,
      top.baseY + sampleCornerField(this.cornerFloors[0]!, spawnX, spawnZ),
      spawnZ,
    );
    this.vy = 0;
    this.velX = 0;
    this.velZ = 0;
    this.mantle = null;
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
      if (!this.paused) this.update(dt);
      this.postProcessing.render(dt);
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
    window.removeEventListener('keydown', this.handleSnapshotKey);
    window.removeEventListener('mousedown', this.handleMarkClick);
    this.sprites.dispose();
    this.postProcessing.dispose();
    for (const material of Object.values(this.debugMaterials)) material.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.worldWorker.terminate();
    this.urgentWorldWorker.terminate();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setBrightness(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  setMouseSensitivity(multiplier: number): void {
    this.gridCamera.setMouseSensitivity(multiplier);
  }

  setPlayerSpeed(multiplier: number): void {
    this.playerSpeedMultiplier = multiplier;
  }

  setVisualSettings(settings: VisualSettings): void {
    this.postProcessing.apply(settings);
    this.scene.overrideMaterial = settings.renderMode === 'lit'
      ? null
      : this.debugMaterials[settings.renderMode];
  }

  private update(dt: number): void {
    const store = useGameStore.getState();

    // Player movement
    this.recenterWindow();
    this.movers?.update(dt);
    // An elevator under your feet carries you with it
    {
      const pos = this.gridCamera.position;
      const carry = this.movers?.carryVelocity(pos.x, pos.z, pos.y) ?? 0;
      if (carry !== 0 && this.isGrounded) pos.y += carry * dt;
    }
    this.processMovement(dt);
    this.prefetchApproachingWindow(store.currentFloor);
    this.syncGridPos(store);
    this.gridCamera.update();
    // Vertical camera smoothing: while grounded, the eye eases toward
    // the feet (stair steps become a glide); airborne it tracks tightly
    // so falls and jumps stay 1:1. Large jumps (respawn, teleport) snap.
    const feetY = this.gridCamera.position.y;
    const diff = feetY - this.smoothFeetY;
    if (Math.abs(diff) > 3) {
      this.smoothFeetY = feetY;
    } else {
      const rate = this.isGrounded ? 14 : 40;
      this.smoothFeetY += diff * (1 - Math.exp(-rate * dt));
    }
    this.threeCamera.position.y += this.smoothFeetY - feetY;

    // Sprites + animated dungeon elements (exit markers)
    this.sprites.update(dt, this.threeCamera);
    this.dungeonRenderer.update(dt);
    // Chunk streaming: create/evict/build render chunks around the
    // player's final position for this frame
    this.dungeonRenderer.updateChunks(this.gridCamera.position.x, this.gridCamera.position.z);

    // Nearest-K light culling follows the player
    const pos = this.gridCamera.position;
    this.lighting.update(pos.x, pos.y, pos.z);
    this.updateAreaFog(dt, pos.x, pos.z);

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
    // Kinetic movers: an elevator platform top is real ground
    const mg = this.movers?.groundAt(x, z, limitY);
    if (mg !== null && mg !== undefined && mg > best) best = mg;
    return best;
  }

  /**
   * Supporting ground under the player's circular footprint. A center-only
   * query can drop the feet onto a lower stair tread while the capsule still
   * overlaps the neighboring riser, leaving the camera embedded in its wall.
   * Sampling the footprint makes the higher tread support the capsule until
   * its full radius has cleared the edge. Every sample still comes from the
   * same column/corner/mover authority as visible geometry.
   */
  private playerGround(x: number, z: number, limitY: number): number {
    let best = this.worldGround(x, z, limitY);
    const radius = PLAYER_RADIUS * 0.98;
    const diagonal = radius / Math.SQRT2;
    for (const [dx, dz] of [
      [radius, 0], [-radius, 0], [0, radius], [0, -radius],
      [diagonal, diagonal], [diagonal, -diagonal],
      [-diagonal, diagonal], [-diagonal, -diagonal],
    ] as const) {
      best = Math.max(best, this.worldGround(x + dx, z + dz, limitY));
    }
    return best;
  }

  // ── Player Movement ──

  private processMovement(dt: number): void {
    if (!this.world) return;
    const pos = this.gridCamera.position;
    const groundAt = (x: number, z: number): number =>
      this.playerGround(x, z, pos.y + CLIMB_HEADROOM);

    // ── Ledge mantle in progress: it owns the player until done. The
    // target span was validated at grab time; rise above the lip first,
    // then tuck forward onto the surface. ──
    this.mantleCooldown = Math.max(0, this.mantleCooldown - dt);
    if (this.mantle) {
      const m = this.mantle;
      m.ttl -= dt;
      if (m.ttl <= 0) {
        // Overdue: slingshot up and out of whatever state this was.
        this.slingshotFromMantle(m, pos);
        return;
      }
      if (pos.y < m.y - 0.01) {
        pos.y = Math.min(m.y, pos.y + MANTLE_UP_SPEED * dt);
      } else {
        const ddx = m.x - pos.x;
        const ddz = m.z - pos.z;
        const dist = Math.hypot(ddx, ddz);
        const step = MANTLE_FWD_SPEED * dt;
        const finish = (): void => {
          this.mantle = null;
          this.mantleCooldown = 0.25;
          // Ground on the REAL walk surface, which on corner-blended
          // tiles can sit well below the span's nominal floor. If it's
          // out of reach, fall to it — never hover at mantle height.
          const g = groundAt(pos.x, pos.z);
          if (g > pos.y - 3) {
            pos.y = Math.max(g, pos.y - 3);
            this.isGrounded = true;
          } else {
            this.isGrounded = false;
            this.vy = 0;
          }
        };
        if (dist <= step) {
          pos.x = m.x;
          pos.z = m.z;
          finish();
        } else {
          const nx = pos.x + (ddx / dist) * step;
          const nz = pos.z + (ddz / dist) * step;
          if (this.collidesAt(nx, nz)) {
            // Tuck blocked by a wall: slingshot instead of grinding.
            // (Finishing in place grounded the player on a footprint
            // sample of the ledge while hanging beside it — the seed of
            // the repeat-grab crawl.)
            this.slingshotFromMantle(m, pos);
          } else {
            pos.x = nx;
            pos.z = nz;
          }
        }
      }
      return;
    }

    // ── Source-style velocity model ──
    // Order matters for bunnyhopping: jump BEFORE friction, so landing
    // with jump held re-launches without ever paying a friction frame.
    if (this.isGrounded && (this.input.jumpHeld() || this.input.consumeJump())) {
      this.vy = JUMP_VELOCITY;
      this.isGrounded = false;
    }

    // Crouch — smooth blend of eye height and speed. Under a low ceiling
    // (crouched into an under-stair wedge) the crouch is HELD even if the
    // key is released: standing up would push the head through solid.
    let crouchTarget = this.input.isCrouching() ? 1 : 0;
    {
      const hereSpans = this.columnAt(pos.x, pos.z);
      const here = hereSpans ? spanAt(hereSpans, pos.y, 0.05) : null;
      if (here && here.ceil < 1e8 && here.ceil - pos.y < STAND_HEIGHT) crouchTarget = 1;
    }
    this.crouchAmount += (crouchTarget - this.crouchAmount) * (1 - Math.exp(-CROUCH_BLEND_RATE * dt));
    this.gridCamera.eyeHeight = EYE_HEIGHT - CROUCH_EYE_DROP * this.crouchAmount;

    this.input.getMovementDir(_moveDir);
    const isMoving = _moveDir.x !== 0 || _moveDir.y !== 0;

    // Wish direction (unit, horizontal) and wish speed from input
    let wishX = 0;
    let wishZ = 0;
    if (isMoving) {
      this.gridCamera.getForward(_forward);
      this.gridCamera.getRight(_right);
      wishX = _forward.x * _moveDir.y + _right.x * _moveDir.x;
      wishZ = _forward.z * _moveDir.y + _right.z * _moveDir.x;
      const len = Math.hypot(wishX, wishZ);
      if (len > 1e-6) {
        wishX /= len;
        wishZ /= len;
      }
    }
    const wishSpeed = MOVE_SPEED
      * this.playerSpeedMultiplier
      * (this.input.isSprinting() ? SPRINT_MULT : 1)
      * (1 - (1 - CROUCH_SPEED_MULT) * this.crouchAmount);

    // Bot override: exact kinematic velocity, no feel-model. The bot's
    // pathfollowing assumes movement stops when it stops steering; giving
    // it friction/accel ramps made it overshoot every corner. Stopping
    // is likewise immediate the frame the override drops.
    const botDriving = this.input.hasMovementOverride();
    if (!botDriving && this.wasBotDriving) {
      this.velX = 0;
      this.velZ = 0;
    }
    this.wasBotDriving = botDriving;
    if (botDriving) {
      this.velX = wishX * wishSpeed;
      this.velZ = wishZ * wishSpeed;
    } else
    // Friction — grounded only; airborne velocity is sacred (that's the
    // whole trick). Below STOP_SPEED, friction uses a fixed control value
    // so stops are crisp instead of asymptotic.
    if (this.isGrounded) {
      const speed = Math.hypot(this.velX, this.velZ);
      if (speed < 1e-4) {
        this.velX = 0;
        this.velZ = 0;
      } else {
        const control = Math.max(speed, STOP_SPEED);
        const drop = control * GROUND_FRICTION * dt;
        const scale = Math.max(speed - drop, 0) / speed;
        this.velX *= scale;
        this.velZ *= scale;
      }
    }

    // Accelerate — cap only the PROJECTION of velocity onto the wish
    // direction. Grounded caps at wishSpeed; airborne caps at AIR_CAP,
    // which is what makes strafe-turning add speed instead of clamping it.
    if (isMoving) {
      const capSpeed = this.isGrounded ? wishSpeed : Math.min(wishSpeed, AIR_CAP);
      const accel = this.isGrounded ? GROUND_ACCEL : AIR_ACCEL;
      const projVel = this.velX * wishX + this.velZ * wishZ;
      const addSpeed = capSpeed - projVel;
      if (addSpeed > 0) {
        const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
        this.velX += wishX * accelSpeed;
        this.velZ += wishZ * accelSpeed;
      }
    }

    // Hard safety clamp
    const vmag = Math.hypot(this.velX, this.velZ);
    if (vmag > MAX_VELOCITY) {
      this.velX *= MAX_VELOCITY / vmag;
      this.velZ *= MAX_VELOCITY / vmag;
    }

    const moveX = this.velX * dt;
    const moveZ = this.velZ * dt;
    if (moveX !== 0 || moveZ !== 0) {
      // Substep so a slow frame can't tunnel through a thin contour wall.
      // A step is blocked by walls AND by ground rising faster than legs
      // can climb — cliffs are obstacles, ramps are not. While airborne,
      // ground at most a hair above the feet is enterable (ledge mantling).
      const canStand = (x: number, z: number, run: number): boolean => {
        const g = groundAt(x, z);
        return this.isGrounded
          ? g - pos.y <= Math.max(MAX_SLOPE * run, STEP_UP)
          : g <= pos.y + AIR_STEP;
      };
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(moveX), Math.abs(moveZ)) / 0.25));
      for (let i = 0; i < steps; i++) {
        const nx = pos.x + moveX / steps;
        if (!this.collidesAt(nx, pos.z) && canStand(nx, pos.z, Math.abs(moveX / steps))) {
          pos.x = nx;
        } else {
          // Blocked: kill that velocity component (Source clips velocity
          // against the wall plane; axis-separated movement makes this a
          // per-axis zero, which also gives free wall-sliding)
          this.velX = 0;
        }
        const nz = pos.z + moveZ / steps;
        if (!this.collidesAt(pos.x, nz) && canStand(pos.x, nz, Math.abs(moveZ / steps))) {
          pos.z = nz;
        } else {
          this.velZ = 0;
        }
        // Grounded feet track the surface between substeps so long slopes
        // accumulate correctly
        if (this.isGrounded) {
          const g = groundAt(pos.x, pos.z);
          if (g >= pos.y - FALL_DROP) pos.y = g;
        }
      }
    }

    // ── Ledge grab: airborne, past the jump's rising burst, pushing
    // toward a ledge whose top is beyond step range but within reach —
    // catch it and start the mantle. Humans only; the bot never grabs. ──
    if (!this.isGrounded && !botDriving && this.mantleCooldown <= 0 && this.vy < 1.0 && (wishX !== 0 || wishZ !== 0)) {
      const px = pos.x + wishX * (PLAYER_RADIUS + 0.45);
      const pz = pos.z + wishZ * (PLAYER_RADIUS + 0.45);
      const spans = this.columnAt(px, pz);
      if (spans) {
        for (const s of spans) {
          const rise = s.floor - pos.y;
          if (rise > AIR_STEP && rise <= GRAB_HEIGHT && s.ceil - s.floor >= MANTLE_HEADROOM) {
            this.mantle = { x: px, z: pz, y: s.floor + 0.02, ttl: 0.6 };
            this.vy = 0;
            this.velX = 0;
            this.velZ = 0;
            break;
          }
        }
      }
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
      // Ceiling collision: rising into solid overhead stops at it — a
      // jump under a stair flight or slab bonks instead of passing
      // through the solid and landing on top.
      if (this.vy > 0) {
        const overheadSpans = this.columnAt(pos.x, pos.z);
        const span = overheadSpans ? spanAt(overheadSpans, pos.y, 0.05) : null;
        if (span && span.ceil < 1e8) {
          const bodyHeight = STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * this.crouchAmount;
          if (pos.y + bodyHeight > span.ceil) {
            pos.y = span.ceil - bodyHeight;
            this.vy = 0;
          }
        }
      }
      if (this.vy <= 0 && pos.y <= ground) {
        pos.y = ground;
        this.vy = 0;
        this.isGrounded = true;
      }
    }

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
          // A span admits the body only if there's BODY HEIGHT of air
          // between the standing surface and its ceiling. Crouching
          // shrinks the body: low wedges (under-stair spaces, ducts)
          // block standing movement but admit a crouched squeeze. The
          // bot always uses crouch height — it verified reachability on
          // the column model and must never be stopped by posture.
          const bodyHeight = this.input.hasMovementOverride()
            ? CROUCH_HEIGHT
            : STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * this.crouchAmount;
          let open = false;
          if (spans) {
            for (const s of spans) {
              if (s.floor < feetY + 1.5 && s.ceil - Math.max(s.floor, feetY) >= bodyHeight) {
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

  /** A jammed mantle launches instead of dropping: upward boost plus a
   *  gentle carry toward the ledge. Long cooldown so the flight resolves
   *  as a normal jump arc, never a re-grab chain. */
  private slingshotFromMantle(m: { x: number; z: number }, pos: THREE.Vector3): void {
    const ddx = m.x - pos.x;
    const ddz = m.z - pos.z;
    const dist = Math.hypot(ddx, ddz);
    this.mantle = null;
    this.mantleCooldown = 0.5;
    this.isGrounded = false;
    this.vy = MANTLE_BOOST_VY;
    if (dist > 1e-4) {
      this.velX = (ddx / dist) * MANTLE_BOOST_FWD;
      this.velZ = (ddz / dist) * MANTLE_BOOST_FWD;
    }
  }

  /** Fade the distance fog toward the color of the area the player is
   *  in: dark gray in roads districts, dark red in ember, black default. */
  private updateAreaFog(dt: number, x: number, z: number): void {
    const L = this.world?.levels[0];
    if (!L) return;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    const cellTiles = Math.floor(L.width / L.cellBiomes.length) || L.width;
    const inRoads = L.roadsCells?.[Math.floor(tz / cellTiles)]?.[Math.floor(tx / cellTiles)] ?? false;
    const biome = tileBiome(L.cellBiomes, tx, tz);
    this.fogTarget.setHex(inRoads ? FOG_ROADS : biome === 'ember' ? FOG_EMBER : FOG_DEFAULT);
    this.fogColor.lerp(this.fogTarget, 1 - Math.exp(-FOG_FADE_RATE * dt));
    const fog = this.scene.fog;
    if (fog) fog.color.copy(this.fogColor);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.fogColor);
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
        {
          const pos = this.gridCamera.position;
          const notice = this.movers?.interact(pos.x, pos.z, pos.y);
          if (notice) this.onNotice(notice);
        }
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
    this.velX = 0;
    this.velZ = 0;
    this.mantle = null;
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
