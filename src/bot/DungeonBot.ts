import { TileType, TILE_SIZE, type GridPos } from '../game/types';
import { findPath } from '../game/pathfinding';
import type { InputAction, KeyboardInput } from '../engine/InputManager';
import type { GridCamera } from '../engine/Camera';
import type { GameState } from '../store/gameStore';

export enum BotState {
  ToExit = 'toExit',
  Arrived = 'arrived',
}

const ARRIVE_RADIUS = 0.9; // world units to a waypoint before advancing
const TURN_RATE = 10; // yaw damping factor — higher turns faster

/** Shortest-arc angle from a to b, in (-PI, PI] */
function angleDelta(a: number, b: number): number {
  return ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * Speedrunner bot: sprints the fastest route to the exit, then stops and
 * hands control back — descending is the player's call.
 */
export class DungeonBot {
  currentState = BotState.ToExit;
  private path: GridPos[] = [];
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

  // Arrival is announced exactly once — plan() ticks several times while
  // crossing the stairs tile, and a second toggle would switch auto back on
  private announcedArrival = false;

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
    this.steer(dt);

    this.tickAccumulator += dt;
    if (this.tickAccumulator < this.TICK_RATE) return;
    this.tickAccumulator -= this.TICK_RATE;
    this.plan(state);
  }

  reset(): void {
    this.path = [];
    this.stuckTimer = 0;
    this.currentState = BotState.ToExit;
    this.announcedArrival = false;
    this.stop();
  }

  /** Release all virtual keys */
  private stop(): void {
    this.input.clearMovementOverride();
    this.input.setSprintOverride(false);
  }

  // ── Per-frame steering ──

  private steer(dt: number): void {
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

    // Damped turn toward the waypoint; movement follows facing, so the
    // walk curves smoothly through corners instead of snapping
    const desiredYaw = Math.atan2(-(tx - pos.x), -(tz - pos.z));
    const blend = 1 - Math.exp(-TURN_RATE * dt);
    this.camera.yaw += angleDelta(this.camera.yaw, desiredYaw) * blend;

    this.input.setMovementOverride(1, 0);
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

    // On stairs -> arrived: release the controls and switch auto off
    const tile = state.dungeon?.tiles[state.playerPos.y]?.[state.playerPos.x];
    if (tile === TileType.StairsDown) {
      this.currentState = BotState.Arrived;
      this.stop();
      this.path = [];
      if (!this.announcedArrival) {
        this.announcedArrival = true;
        this.pushAction('toggleAutoPlay');
      }
      return;
    }

    // No path -> route straight to the exit
    if (this.path.length === 0 && state.dungeon) {
      this.currentState = BotState.ToExit;
      this.path = findPath(state.dungeon, state.playerPos, state.dungeon.exit);
    }
  }
}
