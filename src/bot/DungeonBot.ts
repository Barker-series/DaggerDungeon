import { TILE_SIZE } from '../game/types';
import { spanAt } from '../game/dungeon/columns';
import { findForwardExplorationPath, startLevelFor, type WorldStep } from '../game/pathfinding';
import type { InputAction, KeyboardInput } from '../engine/InputManager';
import type { GridCamera } from '../engine/Camera';
import type { GameState } from '../store/gameStore';

export enum BotState {
  Exploring = 'exploring',
}

const ARRIVE_RADIUS = 0.9; // world units to a waypoint before advancing
// A fall (or anything else that teleports us off-route) leaves the next
// waypoint far away — drop the path and replan from where we actually are
const OFF_ROUTE_TILES = 6;

/**
 * Exploration bot: captures the player's exact camera heading when enabled,
 * then repeatedly finds the farthest reachable point in that direction.
 * It routes around walls and pits without inventing a destination.
 */
export class DungeonBot {
  currentState = BotState.Exploring;
  private path: WorldStep[] = [];
  private tickAccumulator = 0;
  private readonly TICK_RATE = 0.12;

  private pushAction: (action: InputAction) => void;
  private getState: () => GameState;
  private input: KeyboardInput;
  private camera: GridCamera;

  // Stuck detection
  private lastX = 0;
  private lastZ = 0;
  private stuckTimer = 0;

  private headingYaw: number | null = null;

  constructor(
    pushAction: (action: InputAction) => void,
    getState: () => GameState,
    input: KeyboardInput,
    camera: GridCamera,
  ) {
    this.pushAction = pushAction;
    this.getState = getState;
    this.input = input;
    this.camera = camera;
  }

  update(dt: number): void {
    const state = this.getState();
    if (state.screen !== 'playing') {
      this.stop();
      return;
    }

    // Steering runs every frame so turning is smooth; planning is tick-gated
    this.steer();

    this.tickAccumulator += dt;
    if (this.tickAccumulator < this.TICK_RATE) return;
    this.tickAccumulator -= this.TICK_RATE;
    this.plan(state);
  }

  reset(): void {
    this.path = [];
    this.stuckTimer = 0;
    this.currentState = BotState.Exploring;
    this.headingYaw = null;
    this.stop();
  }

  /** Release all virtual keys */
  private stop(): void {
    this.input.clearMovementOverride();
    this.input.setSprintOverride(false);
  }

  // ── Per-frame steering ──

  private steer(): void {
    let next = this.path[0];
    if (!next) {
      this.stop();
      // Replan on the very next update instead of waiting out the tick
      this.tickAccumulator = this.TICK_RATE;
      return;
    }

    const pos = this.camera.position;
    let tx = next.x * TILE_SIZE + TILE_SIZE / 2;
    let tz = next.y * TILE_SIZE + TILE_SIZE / 2;

    // Advance through any waypoints we're already close to — no dead frames
    while (next && (tx - pos.x) ** 2 + (tz - pos.z) ** 2 < ARRIVE_RADIUS * ARRIVE_RADIUS) {
      this.path.shift();
      next = this.path[0];
      if (!next) {
        this.stop();
        return;
      }
      tx = next.x * TILE_SIZE + TILE_SIZE / 2;
      tz = next.y * TILE_SIZE + TILE_SIZE / 2;
    }

    // AUTO never owns the camera. Convert the world-space direction to
    // forward/strafe input relative to the player's fixed view instead of
    // rotating that view toward every waypoint.
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const distance = Math.hypot(dx, dz);
    const moveX = distance > 0 ? dx / distance : 0;
    const moveZ = distance > 0 ? dz / distance : 0;
    const forwardX = -Math.sin(this.camera.yaw);
    const forwardZ = -Math.cos(this.camera.yaw);
    const rightX = Math.cos(this.camera.yaw);
    const rightZ = -Math.sin(this.camera.yaw);
    const forwardInput = moveX * forwardX + moveZ * forwardZ;
    const rightInput = moveX * rightX + moveZ * rightZ;

    // Cliff sense — check a body-length toward the next waypoint so even
    // strafe/backward route segments never enter a drop.
    const state = this.getState();
    const world = state.world;
    if (world) {
      const fx = pos.x + moveX * 1.2;
      const fz = pos.z + moveZ * 1.2;
      const ftx = Math.floor(fx / TILE_SIZE);
      const ftz = Math.floor(fz / TILE_SIZE);
      const w = world.levels[0]!.width;
      const spans = ftx >= 0 && ftz >= 0 && ftx < w && ftz < w
        ? world.columns[ftz * w + ftx]
        : undefined;
      const ahead = spans ? spanAt(spans, state.playerY + 1) : null;
      const dropAhead = !ahead || ahead.floor < state.playerY - 3.0;
      if (dropAhead) {
        // NEVER advance toward a drop. The stuck detector will discard the
        // route and request another; the camera remains untouched.
        this.input.clearMovementOverride();
        this.input.setSprintOverride(false);
        return;
      }
    }

    this.input.setMovementOverride(
      Math.abs(forwardInput) > 0.5 ? Math.sign(forwardInput) : 0,
      Math.abs(rightInput) > 0.5 ? Math.sign(rightInput) : 0,
    );
    this.input.setSprintOverride(true);
  }

  // ── Tick-rate planning ──

  private plan(state: GameState): void {
    // Stuck detection — if we haven't moved 0.3 units in 1.5 seconds, repath
    const pos = this.camera.position;
    const movedDist = Math.sqrt((pos.x - this.lastX) ** 2 + (pos.z - this.lastZ) ** 2);
    if (movedDist < 0.3 && this.path.length > 0) {
      this.stuckTimer += this.TICK_RATE;
      if (this.stuckTimer > 1.5) {
        this.path = [];
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastX = pos.x;
    this.lastZ = pos.z;

    // Fell (or otherwise ended up) far from the route — replan from here
    const next = this.path[0];
    if (next && (
      Math.abs(next.x - state.playerPos.x) > OFF_ROUTE_TILES ||
      Math.abs(next.y - state.playerPos.y) > OFF_ROUTE_TILES
    )) {
      this.path = [];
    }

    // Fell into the abyss — do what a player would: respawn and retry
    if (state.world && state.playerY < state.world.levels[state.world.levels.length - 1]!.baseY - 25) {
      this.pushAction('respawn');
      this.path = [];
      return;
    }

    // No path -> continue exploring in the heading captured when AUTO began.
    if (this.path.length === 0 && state.world) {
      this.currentState = BotState.Exploring;
      const li = startLevelFor(state.world, state.playerPos, state.playerY);
      if (li === null) return; // over a void — wait for the landing
      this.headingYaw ??= this.camera.yaw;
      this.path = findForwardExplorationPath(
        state.world,
        { level: li, x: state.playerPos.x, y: state.playerPos.y },
        this.headingYaw,
      );
    }
  }
}
