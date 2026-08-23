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
import { buildPitContour, inPitCut, pitFillGround, type PitContour } from '../game/dungeon/pitcontour';
import { buildRoadsContour, type RoadsContour } from '../game/dungeon/roadscontour';
import { buildFoldContour, contourTerrain, foldCutGround, foldFillGround, inFoldWedge, type FoldContour } from '../game/dungeon/fold-contour';
import { tileBiome, tileCrest, CELL_TILE_SIZE } from '../game/dungeon/cells';
import { applyTunables, dirtyLevelFor, TUNABLES, type Tunables } from '../game/dungeon/tunables';
import { sliceAt } from '../game/mapslice';
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
  private worldCache = new Map<string, WorldData>();
  private pendingWorlds = new Set<string>();
  private readonly maxCachedWorlds = 10;

  /** Frame-limiter period in ms; 0 = present at native refresh */
  private fpsCapMs = 0;

  private world: WorldData | null = null;
  /** Per-level corner-averaged floor fields — physics samples the exact
   *  surfaces the renderer draws */
  private cornerFloors: number[][][] = [];
  private contours: OrganicContour[] = [];
  /** Pit rim contour (level 0) — smoothed hole edges; the cut wedge of
   *  a rim tile has NO ground (fall exactly where the hole is drawn) */
  private pitContour: PitContour | null = null;
  /** Fold contour (smooth presets): cut wedges are air, fill wedges are
   *  solid, diagonals collide — the renderer's exact geometry */
  private foldContour: FoldContour | null = null;
  private roadsContour: RoadsContour | null = null;
  private seed = 0;

  // ── DaggerKit editor mode (E1): dev-only noclip inspection. The
  // editor camera IS the player camera — streaming, recenter, chunk
  // and light culling all follow it for free (the editor is simply
  // the top dependency's focus, LayerProcGen rule 7). ──
  private editorMode = false;
  private editorSpeed = 24;
  /** The view (as a DDSNAP string) where the player stood when editor
   *  mode was entered — the HUD's "return" bookmark */
  editorReturn: string | null = null;
  private editorGridOn = false;
  private editorGridGroup: THREE.Group | null = null;
  /** E3: a tunables rebuild of the current window is in flight */
  private tunablesRebuildPending = false;
  private tunablesEpoch = 0;
  /** The exact request key we await; stale-epoch results are dropped */
  private awaitedTunablesKey: string | null = null;
  /** E2 selection highlight (triangle overlays + tile boxes) */
  private editorSelGroup: THREE.Group | null = null;
  /** LMB held in editor mode: sweep the crosshair to paint-select */
  private editorPainting = false;
  /** The face the mousedown click already handled — the drag must not
   *  re-add it (a click-to-toggle-off is several frames of held button,
   *  and painting was instantly re-selecting the face it just removed) */
  private editorPaintSkip: string | null = null;
  /** Drag polarity: a drag that STARTS by deselecting keeps erasing;
   *  one that starts by selecting keeps painting */
  private editorPaintRemove = false;
  /** Accumulated multi-select hits (Shift+LMB toggles membership) */
  private editorSelHits: {
    key: string; point: THREE.Vector3; lines: string[]; sub: THREE.Group;
  }[] = [];
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
    this.worldWorker.onmessage = (event) => this.acceptPreparedWorld(event);
    this.worldWorker.onerror = (event) => {
      console.error('[stream] background generation failed', event.message);
    };
    this.timer = new THREE.Timer();

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleSnapshotKey);
    window.addEventListener('keydown', this.handleEditorKey);
    window.addEventListener('wheel', this.handleEditorWheel, { passive: false });
    window.addEventListener('mousedown', this.handleMarkClick);
    window.addEventListener('mouseup', this.handleEditorMouseUp);
  }

  /** Pointer-locked LMB: mark the surface under the crosshair with a
   *  red beacon; RMB: remove the nearest mark. Marks ride along in the
   *  DDSNAP snapshot so the debug viewer highlights EXACTLY the
   *  geometry being reported. */
  private handleMarkClick = (e: MouseEvent) => {
    if (!this.gridCamera.getIsPointerLocked()) return;
    if (this.editorMode) {
      if (e.button === 0) {
        const k = this.editorSelect(e.shiftKey);
        this.editorPaintSkip = k;
        // If the initial click REMOVED the face, the drag erases
        this.editorPaintRemove = k !== null
          && !this.editorSelHits.some((h) => h.key === k);
        this.editorPainting = true;
      } else if (e.button === 2) {
        this.clearEditorSelection();
      }
      return;
    }
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
  /** The current view as a DDSNAP string — the one serialization for
   *  repro strings, editor bookmarks, and teleport targets. */
  currentSnap(): string {
    const pos = this.gridCamera.position;
    return `DDSNAP1${JSON.stringify({
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
  }

  private handleSnapshotKey = (e: KeyboardEvent) => {
    if (e.code !== 'F8') return;
    e.preventDefault();
    const snap = this.currentSnap();
    console.log('[snapshot]', snap);
    void copyText(snap).then((copied) => {
      this.onNotice(copied ? 'Snapshot copied' : 'Snapshot copy failed');
    });
  };

  /** DaggerKit is dev tooling: available in dev builds, or in any
   *  build via ?editor=1 (troubleshooting a deploy). */
  private editorAllowed(): boolean {
    return Boolean(import.meta.env?.DEV)
      || new URLSearchParams(window.location.search).has('editor');
  }

  private handleEditorKey = (e: KeyboardEvent) => {
    if (e.code === 'F6' && this.editorAllowed()) {
      e.preventDefault();
      this.setEditorMode(!this.editorMode);
      return;
    }
    if (!this.editorMode) return;
    if (e.code === 'KeyG') {
      this.editorGridOn = !this.editorGridOn;
      this.rebuildEditorGrid();
    }
  };

  private handleEditorMouseUp = (e: MouseEvent) => {
    if (e.button === 0 && this.editorPainting) {
      this.editorPainting = false;
      // One console report for the whole drag (per-face logs are
      // suppressed while painting)
      if (this.editorSelHits.length > 0) this.publishSelection();
    }
  };

  private handleEditorWheel = (e: WheelEvent) => {
    if (!this.editorMode || !this.gridCamera.getIsPointerLocked()) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    this.editorSpeed = Math.max(2, Math.min(600, this.editorSpeed * factor));
    useGameStore.getState().setEditorSpeed(Math.round(this.editorSpeed));
  };

  private setEditorMode(on: boolean): void {
    if (on === this.editorMode) return;
    this.editorMode = on;
    const store = useGameStore.getState();
    store.setEditorActive(on);
    if (on) {
      this.editorReturn = this.currentSnap();
      this.velX = 0;
      this.velZ = 0;
      this.vy = 0;
      this.onNotice('Editor mode — WASD fly, Space/C up/down, wheel speed, G grid, F6 exit');
    } else {
      // Exit in place: gravity resumes wherever the camera is. The
      // pre-editor position lives on as the HUD's "return" bookmark.
      this.vy = 0;
      this.isGrounded = false;
      if (this.editorGridGroup) {
        this.editorGridOn = false;
        this.rebuildEditorGrid();
      }
      this.clearEditorSelection();
      this.onNotice('Editor mode off');
    }
  }

  /** Noclip fly: WASD along the LOOK direction (pitch included),
   *  Space/C for world up/down, ShiftLeft sprint. No collision, no
   *  gravity — the world streams around the camera as usual. */
  private processEditorMovement(dt: number): void {
    const dir = this.input.getMovementDir({ x: 0, y: 0 });
    const speed = this.editorSpeed * (this.input.isKeyDown('ShiftLeft') ? 4 : 1);
    const cam = this.gridCamera;
    const cosP = Math.cos(cam.pitch);
    // Look-direction forward (yaw 0 = -Z; pitch>0 looks up)
    const fx = -Math.sin(cam.yaw) * cosP;
    const fy = Math.sin(cam.pitch);
    const fz = -Math.cos(cam.yaw) * cosP;
    const rx = Math.cos(cam.yaw);
    const rz = -Math.sin(cam.yaw);
    let vx = fx * dir.y + rx * dir.x;
    let vy = fy * dir.y;
    let vz = fz * dir.y + rz * dir.x;
    if (this.input.isKeyDown('Space')) vy += 1;
    if (this.input.isKeyDown('KeyC')) vy -= 1;
    const len = Math.hypot(vx, vy, vz);
    if (len > 1e-6) {
      const k = (speed * dt) / len;
      cam.position.x += vx * k;
      cam.position.y += vy * k;
      cam.position.z += vz * k;
    }
    this.isGrounded = false;
  }

  /** E3: apply new generation tunables everywhere they generate (this
   *  thread's legacy fallback AND the worker's chunked layers), drop
   *  every cached window, and rebuild the current one off-thread. The
   *  window adopts when the worker delivers (deferred adoption — no
   *  frame hitch; the HUD shows a regenerating flag meanwhile). */
  private consumeEditorTunables(store: ReturnType<typeof useGameStore.getState>): void {
    const values = store.editorTunables;
    if (values) {
      store.requestEditorTunables(null);
      // Only genuinely-changed keys drive invalidation depth
      const changed = (Object.keys(values) as (keyof Tunables)[])
        .filter((k) => typeof values[k] === 'number' && TUNABLES[k] !== values[k]);
      if (changed.length === 0) return;
      const resetFrom = dirtyLevelFor(changed);
      applyTunables(values);
      this.worldWorker.postMessage({ type: 'tunables', values, resetFrom });
      this.worldCache.clear();
      this.pendingWorlds.clear();
      const stack = store.currentFloor;
      // Epoch-suffixed request key: results generated under OLD
      // tunables (posted before this change) can never adopt
      this.tunablesEpoch++;
      const key = `${this.worldKey(stack, this.originPcx, this.originPcz)}#t${this.tunablesEpoch}`;
      this.awaitedTunablesKey = key;
      this.worldWorker.postMessage({
        key, seed: this.seed, stack,
        originPcx: this.originPcx, originPcz: this.originPcz,
      });
      this.tunablesRebuildPending = true;
      store.setEditorRegenerating(true);
    }
    if (this.tunablesRebuildPending) {
      const stack = store.currentFloor;
      const key = this.worldKey(stack, this.originPcx, this.originPcz);
      if (this.worldCache.has(key)) {
        this.tunablesRebuildPending = false;
        // Same seed, different generation config: every rendered chunk
        // is stale — bump the epoch so adoption rebuilds them all
        this.dungeonRenderer.bumpConfigEpoch();
        this.buildWindow(stack);
        store.setEditorRegenerating(false);
      }
    }
  }

  /** Consume a DDSNAP teleport request from the HUD. Same-window jumps
   *  are instant; window/seed changes rebuild (synchronous fallback is
   *  acceptable in a dev tool — the worker cache usually has it). */
  private consumeEditorTeleport(store: ReturnType<typeof useGameStore.getState>): void {
    const snap = store.editorTeleport;
    if (!snap) return;
    store.requestEditorTeleport(null);
    try {
      const raw = snap.trim();
      const json = raw.startsWith('DDSNAP1') ? raw.slice('DDSNAP1'.length) : raw;
      const t = JSON.parse(json) as {
        seed?: number; stack?: number; opx?: number; opz?: number;
        x: number; y: number; z: number; yaw?: number; pitch?: number;
      };
      const opx = t.opx ?? 0;
      const opz = t.opz ?? 0;
      const stack = t.stack ?? store.currentFloor;
      const seedChanged = t.seed !== undefined && t.seed !== this.seed;
      if (seedChanged) {
        this.seed = t.seed!;
        store.setSeed(t.seed!);
        this.worldCache.clear();
        this.pendingWorlds.clear();
      }
      if (seedChanged || opx !== this.originPcx || opz !== this.originPcz
        || stack !== store.currentFloor) {
        this.originPcx = opx;
        this.originPcz = opz;
        store.setCurrentFloor(stack);
        this.buildWindow(stack);
      }
      this.gridCamera.setPosition(t.x, t.y, t.z);
      if (t.yaw !== undefined) this.gridCamera.yaw = t.yaw;
      if (t.pitch !== undefined) this.gridCamera.pitch = t.pitch;
      this.velX = 0;
      this.velZ = 0;
      this.vy = 0;
      this.onNotice('Teleported');
    } catch {
      this.onNotice('Bad DDSNAP string');
    }
  }

  /** Chunk (pillar-cell) + dungeon-cell grid overlay: vertical edge
   *  posts at cell corners, brighter at chunk corners. Rebuilt per
   *  window; cheap line geometry. */
  private rebuildEditorGrid(): void {
    if (this.editorGridGroup) {
      this.scene.remove(this.editorGridGroup);
      this.editorGridGroup.traverse((o) => {
        const m = o as THREE.LineSegments;
        if (m.geometry) m.geometry.dispose();
      });
      this.editorGridGroup = null;
    }
    if (!this.editorGridOn || !this.world) return;
    const w = this.world.levels[0]!.width;
    const CELL_T = 14;
    const CHUNK_T = 56;
    const y0 = -45;
    const y1 = 320;
    const cellVerts: number[] = [];
    const chunkVerts: number[] = [];
    for (let tz = 0; tz <= w; tz += CELL_T) {
      for (let tx = 0; tx <= w; tx += CELL_T) {
        const wx = tx * TILE_SIZE;
        const wz = tz * TILE_SIZE;
        const target = tx % CHUNK_T === 0 && tz % CHUNK_T === 0 ? chunkVerts : cellVerts;
        target.push(wx, y0, wz, wx, y1, wz);
      }
    }
    const group = new THREE.Group();
    const mk = (verts: number[], color: number, opacity: number): void => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      group.add(new THREE.LineSegments(g, mat));
    };
    mk(cellVerts, 0x2a6a8a, 0.25);
    mk(chunkVerts, 0x00e5ff, 0.6);
    this.scene.add(group);
    this.editorGridGroup = group;
  }

  private clearEditorSelection(): void {
    this.editorSelHits = [];
    if (this.editorSelGroup) {
      this.scene.remove(this.editorSelGroup);
      this.editorSelGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.editorSelGroup = null;
    }
    useGameStore.getState().setEditorSelection(null);
  }

  /** E2 PROVENANCE SELECTION: raycast the crosshair, resolve the hit
   *  into its causal chain — emitter pass (mesh name), tile/cell/chunk,
   *  biome, crest, column spans, slice — and publish a copyable report
   *  (DDSNAP with the hit as a mark, so tools/debug-view.ts reproduces
   *  the exact selection headlessly). */
  private editorSelect(additive = false, paint: 'add' | 'remove' | null = null): string | null {
    if (!this.world) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.threeCamera);
    ray.far = 600;
    const hits = ray.intersectObjects(this.scene.children, true).filter((h) => {
      const o = h.object as THREE.Mesh;
      return o.isMesh && !o.userData['debugMark'] && !o.userData['ddkit'];
    });
    const hit = hits[0];
    if (!hit) return null;
    const mesh = hit.object as THREE.Mesh;
    // TOGGLE: clicking an already-selected face deselects it
    const faceKey = `${mesh.uuid}:${hit.faceIndex ?? -1}`;
    if (paint && faceKey === this.editorPaintSkip) return faceKey;
    const existing = this.editorSelHits.findIndex((h) => h.key === faceKey);
    if (paint === 'add' && existing >= 0) return faceKey; // re-crossed
    if (paint === 'remove' && existing < 0) return faceKey; // nothing to erase
    if (existing >= 0) {
      const [removed] = this.editorSelHits.splice(existing, 1);
      if (removed && this.editorSelGroup) {
        this.editorSelGroup.remove(removed.sub);
        removed.sub.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      }
      this.publishSelection();
      return faceKey;
    }
    if (!additive) this.clearEditorSelection();
    const p = hit.point;
    const L = this.world.levels[0]!;
    const w = L.width;
    const tx = Math.floor(p.x / TILE_SIZE);
    const tz = Math.floor(p.z / TILE_SIZE);
    const inGrid = tx >= 0 && tz >= 0 && tx < w && tz < L.height;
    const opx = this.world.originPcx;
    const opz = this.world.originPcz;
    const absTx = opx * 56 + tx;
    const absTz = opz * 56 + tz;
    const absCx = Math.floor(absTx / CELL_TILE_SIZE);
    const absCz = Math.floor(absTz / CELL_TILE_SIZE);
    const pass = mesh.name || 'unnamed-pass';
    const nrm = hit.face
      ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
      : new THREE.Vector3();

    const lines: string[] = [];
    lines.push(`pass ${pass}`);
    lines.push(`hit (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) n(${nrm.x.toFixed(2)},${nrm.y.toFixed(2)},${nrm.z.toFixed(2)})`);
    let spans: import('../game/types').ColumnSpan[] = [];
    if (inGrid) {
      spans = this.world.columns[tz * w + tx]!;
      const biome = tileBiome(L.cellBiomes, tx, tz) ?? 'tunnel';
      const crest = tileCrest(L.cellCrests, tx, tz);
      const flags = [
        L.tiles[tz]![tx] === TileType.Wall ? 'WALL' : 'floor',
        L.pillarWall[tz]![tx] ? 'pillarWall' : '',
        L.pillarGround[tz]![tx] ? 'pillarGround' : '',
        this.contours[0]?.softWalls.has(tz * w + tx) ? 'softWall' : '',
        L.roadsCells?.[Math.floor(tz / CELL_TILE_SIZE)]?.[Math.floor(tx / CELL_TILE_SIZE)] ? 'roadsCell' : '',
      ].filter(Boolean).join(' ');
      lines.push(`tile local(${tx},${tz}) abs(${absTx},${absTz}) · cell(${absCx},${absCz}) ${biome} crest=${crest} · chunk(${Math.floor(absTx / 56)},${Math.floor(absTz / 56)})`);
      lines.push(`${flags} floorH=${L.floorHeights[tz]![tx]!.toFixed(1)} ceilH=${L.ceilingHeights[tz]![tx]!.toFixed(1)}`);
      lines.push(`spans: ${spans.length === 0 ? '(none — solid column)' : spans.map((sp) =>
        `${sp.floor <= -900 ? 'ABYSS' : sp.floor.toFixed(1)}..${sp.ceil >= 1e8 ? 'SKY' : sp.ceil.toFixed(1)}(${sp.owner},${sp.ceilOwner})`).join(' ')}`);
      const slice = sliceAt(spans, p.y);
      lines.push(`slice@hitY: ${JSON.stringify(slice)}`);
    } else {
      lines.push('hit outside the window grid');
    }

    // ── Highlight subgroup for this hit ──
    const group = this.editorSelGroup ?? new THREE.Group();
    group.userData['ddkit'] = true;
    const parentGroup = group;
    const sub = new THREE.Group();
    sub.userData['ddkit'] = true;
    this.editorSelHits.push({ key: faceKey, point: p.clone(), lines, sub });
    if (hit.face) {
      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position');
      const tri = new THREE.BufferGeometry();
      const verts: number[] = [];
      for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
        const v = new THREE.Vector3(
          posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi),
        ).applyMatrix4(mesh.matrixWorld);
        verts.push(v.x, v.y, v.z);
      }
      tri.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      tri.setIndex([0, 1, 2]);
      const triMesh = new THREE.Mesh(tri, new THREE.MeshBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        depthWrite: false,
      }));
      triMesh.userData['ddkit'] = true;
      sub.add(triMesh);
    }
    if (inGrid) {
      const span = spans.find((sp) => p.y >= sp.floor - 0.6 && p.y <= sp.ceil + 0.6);
      const y0 = span ? Math.max(span.floor, p.y - 40) : p.y - 3;
      const y1 = span ? Math.min(span.ceil >= 1e8 ? p.y + 40 : span.ceil, p.y + 40) : p.y + 3;
      const box = new THREE.Box3(
        new THREE.Vector3(tx * TILE_SIZE, y0, tz * TILE_SIZE),
        new THREE.Vector3((tx + 1) * TILE_SIZE, y1, (tz + 1) * TILE_SIZE),
      );
      const helper = new THREE.Box3Helper(box, 0x00e5ff);
      helper.userData['ddkit'] = true;
      sub.add(helper);
    }
    parentGroup.add(sub);
    if (!this.editorSelGroup) {
      this.scene.add(parentGroup);
      this.editorSelGroup = parentGroup;
    }
    this.publishSelection();
    return faceKey;
  }

  /** Rebuild + publish the selection report from the current hit set
   *  (add and toggle-remove both funnel through here). */
  private publishSelection(): void {
    const store = useGameStore.getState();
    const n = this.editorSelHits.length;
    if (n === 0 || !this.world) {
      store.setEditorSelection(null);
      return;
    }
    const opx = this.world.originPcx;
    const opz = this.world.originPcz;
    const pos = this.gridCamera.position;
    const snap = `DDSNAP1${JSON.stringify({
      seed: this.seed,
      stack: store.currentFloor,
      ...(opx !== 0 || opz !== 0 ? { opx, opz } : {}),
      x: +pos.x.toFixed(2),
      y: +pos.y.toFixed(2),
      z: +pos.z.toFixed(2),
      yaw: +this.gridCamera.yaw.toFixed(3),
      pitch: +this.gridCamera.pitch.toFixed(3),
      marks: this.editorSelHits.map((h) =>
        [+h.point.x.toFixed(2), +h.point.y.toFixed(2), +h.point.z.toFixed(2)]),
    })}`;
    const report = [
      `DDKIT SELECTION (${n} hit${n === 1 ? '' : 's'})`,
      snap,
      ...this.editorSelHits.flatMap((h, i) =>
        [n > 1 ? `-- hit ${i + 1} --` : '', ...h.lines].filter(Boolean)),
    ].join('\n');
    const last = this.editorSelHits[n - 1]!.lines;
    const summary = n > 1 ? [`${n} hits (report has all)`, ...last] : last;
    store.setEditorSelection({ report, summary });
    if (!this.editorPainting) console.log('[ddkit]\n' + report);
  }

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
  ): void {
    const { key, world, generationMs } = event.data;
    this.pendingWorlds.delete(key);
    // A seed can change while either worker is finishing an old request.
    if (!key.startsWith(`${this.seed}:`)) return;
    // E3 tunables rebuilds: only the awaited epoch may land; results
    // from superseded epochs are discarded outright
    if (key.includes('#t')) {
      if (key !== this.awaitedTunablesKey) return;
      this.awaitedTunablesKey = null;
      const baseKey = key.slice(0, key.indexOf('#t'));
      this.worldCache.set(baseKey, world);
      if (import.meta.env.DEV) {
        console.debug(`[ddkit] tunables window regenerated in ${generationMs.toFixed(1)} ms`);
      }
      return;
    }
    this.worldCache.delete(key);
    this.worldCache.set(key, world);
    while (this.worldCache.size > this.maxCachedWorlds) {
      const oldest = this.worldCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.worldCache.delete(oldest);
    }
    if (import.meta.env.DEV) {
      console.debug(
        `[stream] prepared ${key} off-thread in ${generationMs.toFixed(1)} ms`,
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

  /** ONE worker lane (since milestone B): the worker's chunk cache
   *  makes adjacent-window prep ~400ms warm, so a second "urgent"
   *  worker — whose separate module state meant a COLD chunk cache —
   *  was slower than just queueing on the warm one. Urgency is now
   *  simply "request it if nothing has yet". */
  private requestUrgentWorld(stack: number, originPcx: number, originPcz: number): void {
    this.requestWorld(stack, originPcx, originPcz);
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
    const worldCols = this.world.columns;
    this.contours = this.world.levels.map((l) => buildOrganicContour(l, worldCols));
    this.pitContour = buildPitContour(this.world.levels[0]!, this.world.columns);
    this.foldContour = buildFoldContour(this.world);
    this.roadsContour = buildRoadsContour(this.world);
    markPhase('collision');
    // Adopt the window as the chunk data source. No geometry is built
    // here: chunks stream in via updateChunks each frame — surviving
    // core chunks carry across, rim chunks rebuild in the background.
    this.dungeonRenderer.setWindow(this.world);
    if (this.editorGridOn) this.rebuildEditorGrid();
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
    // NEVER generate a window on the main thread mid-travel: the
    // synchronous fallback froze the frame ~1.5s (the travel lag
    // spikes). If the target window isn't prepared yet, keep playing
    // on the current one — a full pillar cell of generated world
    // remains ahead (~10s at sprint), the worker prep takes ~1.5s,
    // and this runs every frame so adoption happens the moment the
    // world arrives. Desperation clamp: a player who somehow outruns
    // even that margin eats the hitch rather than walking off the
    // edge of the world.
    {
      const stack = useGameStore.getState().currentFloor;
      const key = this.worldKey(stack, this.originPcx + shiftX, this.originPcz + shiftZ);
      if (!this.worldCache.has(key)) {
        const desperate = pos.x < PCELL * 0.35 || pos.x >= 3.65 * PCELL
          || pos.z < PCELL * 0.35 || pos.z >= 3.65 * PCELL;
        if (!desperate) {
          this.requestUrgentWorld(stack, this.originPcx + shiftX, this.originPcz + shiftZ);
          return;
        }
      }
    }
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
    this.originPcx = 0;
    this.originPcz = 0;
    this.buildWindow(stack);

    const store = useGameStore.getState();
    store.setCurrentFloor(stack);

    const top = this.world!.levels[0]!;
    // loadStack always builds window (0,0), so this entrance IS the
    // run's absolute spawn — record it for maps/respawn UI
    store.setSpawnAbs({ x: top.entrance.x, y: top.entrance.y });
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

  /** 0 = uncapped (native refresh). Set 60 to skip vsync ticks down to
   *  a 60 FPS presentation rate on high-refresh displays. */
  setFpsCap(fps: number): void {
    this.fpsCapMs = fps > 0 ? 1000 / fps : 0;
  }

  start(): void {
    let fpsFrames = 0;
    let fpsWindowStart = 0;
    let lastCapTick = 0;
    const loop = (timestamp: number) => {
      if (this.stopped) return;
      this.animFrameId = requestAnimationFrame(loop);
      if (this.fpsCapMs > 0) {
        // Frame limiter: skip vsync ticks until a cap period has passed.
        // The -1ms tolerance stops refresh/cap beat frequencies from
        // halving the rate; advancing by the period (not the timestamp)
        // keeps long-run pacing exact, with a snap when we fall behind.
        if (timestamp - lastCapTick < this.fpsCapMs - 1) return;
        lastCapTick = timestamp - lastCapTick > this.fpsCapMs * 2
          ? timestamp
          : lastCapTick + this.fpsCapMs;
      }
      this.timer.update(timestamp);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      if (!this.paused) this.update(dt);
      this.postProcessing.render(dt);
      // FPS: count real presented frames, publish twice a second
      fpsFrames++;
      if (fpsWindowStart === 0) fpsWindowStart = timestamp;
      const elapsed = timestamp - fpsWindowStart;
      if (elapsed >= 500) {
        useGameStore.getState().setFps(Math.round((fpsFrames * 1000) / elapsed));
        fpsFrames = 0;
        fpsWindowStart = timestamp;
      }
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
    window.removeEventListener('keydown', this.handleEditorKey);
    window.removeEventListener('wheel', this.handleEditorWheel);
    window.removeEventListener('mouseup', this.handleEditorMouseUp);
    window.removeEventListener('mousedown', this.handleMarkClick);
    this.sprites.dispose();
    this.postProcessing.dispose();
    for (const material of Object.values(this.debugMaterials)) material.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.worldWorker.terminate();
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
    if (this.editorMode) {
      this.consumeEditorTeleport(store);
      this.consumeEditorTunables(store);
      this.processEditorMovement(dt);
      // Drag-select: while LMB is held, every face the crosshair
      // sweeps over joins the selection (never toggles off mid-drag)
      if (this.editorPainting) {
        this.editorSelect(true, this.editorPaintRemove ? 'remove' : 'add');
      }
      // Drain queued one-shot actions so they don't fire stale on exit
      while (this.input.consumeAction()) { /* discarded in editor */ }
    } else {
      // An elevator under your feet carries you with it
      {
        const pos = this.gridCamera.position;
        const carry = this.movers?.carryVelocity(pos.x, pos.z, pos.y) ?? 0;
        if (carry !== 0 && this.isGrounded) pos.y += carry * dt;
      }
      this.processMovement(dt);
    }
    this.prefetchApproachingWindow(store.currentFloor);
    this.syncGridPos(store);
    this.gridCamera.update();
    // Vertical camera smoothing: while grounded, the eye eases toward
    // the feet (stair steps become a glide); airborne it tracks tightly
    // so falls and jumps stay 1:1. Large jumps (respawn, teleport) snap.
    const feetY = this.gridCamera.position.y;
    if (this.editorMode) this.smoothFeetY = feetY; // fly cam tracks 1:1
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

    // Bot (never while the editor is flying the camera)
    if (store.autoPlay && !this.editorMode) {
      this.bot.update(dt);
    }

    // One-shot actions
    if (!this.editorMode) this.processActions();
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
    // Roads soft plinths: the cut wedge at a smoothed block corner is
    // standable street continuing into the tile footprint — its drawn
    // floor is the corner field, same as organic pockets. Without this,
    // ground inside a wedge is -Infinity (the plinth span floor is the
    // block TOP) and a body that walks in gets stuck falling in place.
    const soft = this.contours[li]?.softWalls.has(tz * level.width + tx)
      || (li === 0 && this.roadsContour?.softPlinths.has(tz * level.width + tx));
    if (!soft) return null;
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
      // Smoothed pit rims: the cut wedge of a rim tile is drawn as
      // open hole — its level-0 terrain floor must not support feet
      const rimCut = s.owner === 0
        && this.pitContour !== null
        && inPitCut(
          this.pitContour, this.world!.levels[0]!.width,
          Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE), x, z,
        );
      // Fold contour: a fold top whose solid is CUT at this corner has no
      // floor on the wedge (the drawn cap is clipped there)
      let foldCut = false;
      if (!rimCut && s.owner < 0 && this.foldContour) {
        const ftx = Math.floor(x / TILE_SIZE);
        const ftz = Math.floor(z / TILE_SIZE);
        const bands = this.foldContour.cuts.get(ftz * this.foldContour.w + ftx);
        if (bands) {
          for (const b of bands) {
            if (Math.abs(b.yHi - s.floor) > 0.05) continue;
            for (let c = 0; c < 4; c++) if ((b.corners & (1 << c)) && inFoldWedge(ftx, ftz, c, x, z)) { foldCut = true; break; }
            if (foldCut) break;
          }
        }
      }
      if (!rimCut && !foldCut) {
        best = s.owner < 0
          ? s.floor
          : this.world!.levels[s.owner]!.baseY + sampleCornerField(this.cornerFloors[s.owner]!, x, z);
      }
    }
    // Chamfer pockets: contoured wall columns carry their apron floor —
    // the drawn surface behind the diagonal wall is real ground, never a
    // gap into the level below
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    // Smoothed pit rims, fill side: the patch bridging a concave pit
    // corner is real drawn floor — stand on its exact plane
    if (this.pitContour) {
      const fg = pitFillGround(
        this.pitContour, this.world!.levels[0]!.width, tx, tz, x, z,
        (px, pz) => sampleCornerField(this.cornerFloors[0]!, px, pz),
      );
      if (fg !== null && fg <= limitY + 0.6 && fg > best) best = fg;
    }
    // Fold contour, fill side: an exposed fill-wedge top is real drawn
    // floor — stand on its exact plane
    if (this.foldContour) {
      const fg = foldFillGround(this.foldContour, tx, tz, x, z, limitY);
      if (fg !== null && fg > best) best = fg;
      // ...and a cut wedge's floor cap (terrain plane or flat band bottom)
      const L0 = this.world!.levels[0]!;
      const cg = foldCutGround(
        this.foldContour, tx, tz, x, z, limitY,
        (px, pz) => contourTerrain(this.cornerFloors[0]!, L0.baseY, px, pz),
      );
      if (cg !== null && cg > best) best = cg;
    }
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
      const dtStep = dt / steps;
      // Blocked by a wall: clip velocity against the wall's TRUE normal
      // (Source-style). For axis-aligned tile faces this is identical to
      // the old per-axis zeroing; for contour segments it projects the
      // velocity onto the wall tangent, so diagonal walls GLIDE — the
      // old axis-zero response caught/released along them and read as
      // stair-step bouncing even though the collision line is smooth.
      const clipVelocity = (nrm: [number, number] | null): void => {
        if (!nrm) return;
        const into = this.velX * nrm[0] + this.velZ * nrm[1];
        if (into < 0) {
          this.velX -= into * nrm[0];
          this.velZ -= into * nrm[1];
        }
      };
      for (let i = 0; i < steps; i++) {
        // Live velocity per substep: after a clip, later substeps
        // advance along the wall instead of retrying the blocked path
        const sdx = this.velX * dtStep;
        if (sdx !== 0) {
          const nx = pos.x + sdx;
          const nrm = this.collisionNormalAt(nx, pos.z);
          if (nrm === null && canStand(nx, pos.z, Math.abs(sdx))) {
            pos.x = nx;
          } else if (nrm !== null) {
            clipVelocity(nrm);
          } else {
            this.velX = 0; // cliff/step block: not a wall plane
          }
        }
        const sdz = this.velZ * dtStep;
        if (sdz !== 0) {
          const nz = pos.z + sdz;
          const nrm = this.collisionNormalAt(pos.x, nz);
          if (nrm === null && canStand(pos.x, nz, Math.abs(sdz))) {
            pos.z = nz;
          } else if (nrm !== null) {
            clipVelocity(nrm);
          } else {
            this.velZ = 0;
          }
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
    return this.collisionNormalAt(x, z) !== null;
  }

  /** Outward push normal of the NEAREST blocking primitive at (x,z),
   *  or null when the position is free. The normal is what the slide
   *  response clips velocity against: for axis-aligned tile faces it
   *  reproduces per-axis zeroing exactly; for contour segments it is
   *  the segment's true normal, so diagonal walls glide instead of
   *  stair-step catching (the "bounce outward in tunnels" feel). */
  private collisionNormalAt(x: number, z: number): [number, number] | null {
    if (!this.world) return [1, 0];
    let bestD2 = Infinity;
    let bestNx = 0;
    let bestNz = 0;
    let hit = false;
    const consider = (d2: number, px: number, pz: number): void => {
      // px/pz = closest point on the blocking primitive
      hit = true;
      if (d2 >= bestD2) return;
      const dx = x - px;
      const dz = z - pz;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) return; // penetrating dead-center: keep prior/fallback
      bestD2 = d2;
      bestNx = dx / len;
      bestNz = dz / len;
    };
    const feetY = this.gridCamera.position.y;
    const owner = this.currentOwner();
    const contour = owner >= 0 ? this.contours[owner] : undefined;
    const dungeon = owner >= 0 ? this.world.levels[owner] : undefined;
    const w = this.world.levels[0]!.width;
    const r = PLAYER_RADIUS;
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    const seen = new Set<unknown>();
    const seenRoads = new Set<unknown>();
    const seenFold = new Set<unknown>();
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
          && (contour?.softWalls.has(tz * w + tx)
            || this.roadsContour?.softPlinths.has(tz * w + tx));
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
            const d2 = ddx * ddx + ddz * ddz;
            // FOLD CONTOUR: a cut wedge is AIR — if the box's closest
            // point lies in a cut wedge at body height, the diagonal
            // segment (below) decides instead of the square box
            let inWedge = false;
            const fbands = this.foldContour?.cuts.get(tz * w + tx);
            if (fbands && spans) {
              for (const b of fbands) {
                if (b.yHi < feetY + 0.2 || b.yLo > feetY + bodyHeight) continue;
                for (let c = 0; c < 4; c++) {
                  if ((b.corners & (1 << c)) && inFoldWedge(tx, tz, c, closestX, closestZ)) { inWedge = true; break; }
                }
                if (inWedge) break;
              }
            }
            if (!inWedge && d2 < r * r) consider(d2, closestX, closestZ);
          }
        }
        // Fold contour diagonals over the body's height band (cut and
        // fill alike — the segment IS the drawn wall)
        const fsegs = this.foldContour?.segsByTile.get(tz * w + tx);
        if (fsegs) {
          const bodyH = this.input.hasMovementOverride()
            ? CROUCH_HEIGHT
            : STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * this.crouchAmount;
          for (const seg of fsegs) {
            if (seenFold.has(seg)) continue;
            seenFold.add(seg);
            if (seg.yHi < feetY + 0.2 || seg.yLo > feetY + bodyH) continue;
            const sdx = seg.x1 - seg.x0;
            const sdz = seg.z1 - seg.z0;
            const ll = sdx * sdx + sdz * sdz || 1;
            const t = Math.max(0, Math.min(1, ((x - seg.x0) * sdx + (z - seg.z0) * sdz) / ll));
            const px = seg.x0 + sdx * t;
            const pz = seg.z0 + sdz * t;
            const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
            if (d2 < r * r) consider(d2, px, pz);
          }
        }
        // Contour segments registered to this tile (exact visual walls)
        const segs = contour?.byTile.get(tz * w + tx);
        if (segs) {
          for (const seg of segs) {
            if (seen.has(seg)) continue;
            seen.add(seg);
            const d2 = segmentDistSq(seg, x, z);
            if (d2 < r * r) {
              // Closest point on the segment (mirrors segmentDistSq)
              const sdx = seg.x1 - seg.x0;
              const sdz = seg.z1 - seg.z0;
              const ll = sdx * sdx + sdz * sdz || 1;
              const t = Math.max(0, Math.min(1, ((x - seg.x0) * sdx + (z - seg.z0) * sdz) / ll));
              consider(d2, seg.x0 + sdx * t, seg.z0 + sdz * t);
            }
          }
        }
        // Roads contour bands (plinth cliffs, One Wall v2 slice 2):
        // height-banded with the SQUARE span rule's semantics — a body
        // passes a band once its feet are within 1.5 of the band top
        // (exactly when the old square tile check let it through), so
        // mantling onto plinths and walking their tops is unchanged.
        const rsegs = this.roadsContour?.byTile.get(tz * w + tx);
        if (rsegs) {
          for (const seg of rsegs) {
            if (seenRoads.has(seg)) continue;
            seenRoads.add(seg);
            if (feetY > seg.hi - 1.5) continue;
            const d2 = segmentDistSq(seg, x, z);
            if (d2 < r * r) {
              const sdx = seg.x1 - seg.x0;
              const sdz = seg.z1 - seg.z0;
              const ll = sdx * sdx + sdz * sdz || 1;
              const t = Math.max(0, Math.min(1, ((x - seg.x0) * sdx + (z - seg.z0) * sdz) / ll));
              consider(d2, seg.x0 + sdx * t, seg.z0 + sdz * t);
            }
          }
        }
      }
    }
    if (!hit) return null;
    // Dead-center penetration with no usable direction: arbitrary push
    if (bestD2 === Infinity) return [1, 0];
    return [bestNx, bestNz];
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
    // The run has ONE respawn point: the original spawn of window (0,0)
    // for this seed. Each window recomputes its own entrance, so
    // respawning to the CURRENT window's entrance would make the respawn
    // point drift as the player travels. Window (0,0) is deterministic
    // per seed, so returning to it always lands on the same spot.
    // (A set-respawn mechanic can move this later.)
    if (this.originPcx !== 0 || this.originPcz !== 0) {
      this.originPcx = 0;
      this.originPcz = 0;
      this.buildWindow(useGameStore.getState().currentFloor);
    }
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
