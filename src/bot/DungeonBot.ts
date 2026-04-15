import { Path } from 'rot-js';
import { TileType, TILE_SIZE, type DungeonData, type GridPos } from '../game/types';
import type { InputAction, KeyboardInput } from '../engine/InputManager';
import type { GridCamera } from '../engine/Camera';
import type { GameState } from '../store/gameStore';

export enum BotState {
  Explore = 'explore',
  Navigate = 'navigate',
  Fight = 'fight',
  Heal = 'heal',
  UseExit = 'useExit',
  Dead = 'dead',
}

export class DungeonBot {
  currentState = BotState.Explore;
  private path: GridPos[] = [];
  private tickAccumulator = 0;
  private readonly TICK_RATE = 0.12;

  private explored = new Set<string>();
  private pushAction: (action: InputAction) => void;
  private getState: () => GameState;
  private input: KeyboardInput;
  private camera: GridCamera;

  // Stuck detection
  private lastX = 0;
  private lastZ = 0;
  private stuckTimer = 0;

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
    this.tickAccumulator += dt;
    if (this.tickAccumulator < this.TICK_RATE) return;
    this.tickAccumulator -= this.TICK_RATE;

    const state = this.getState();
    if (state.screen !== 'playing') {
      this.input.clearMovementOverride();
      return;
    }

    this.explored.add(`${state.playerPos.x},${state.playerPos.y}`);

    if (state.playerHp <= 0) {
      this.currentState = BotState.Dead;
      this.input.clearMovementOverride();
      return;
    }

    // Stuck detection — if we haven't moved 0.3 units in 1.5 seconds, repath
    const pos = this.camera.position;
    const movedDist = Math.sqrt((pos.x - this.lastX) ** 2 + (pos.z - this.lastZ) ** 2);
    if (movedDist < 0.3) {
      this.stuckTimer += this.TICK_RATE;
      if (this.stuckTimer > 1.5) {
        this.path = [];
        this.stuckTimer = 0;
        // Nudge: try a random direction
        this.camera.yaw += (Math.random() - 0.5) * Math.PI;
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastX = pos.x;
    this.lastZ = pos.z;

    // Heal if low
    if (state.playerHp < state.playerMaxHp * 0.35) {
      const potionSlot = state.hotbar.findIndex(
        (item) => item?.kind === 'consumable' && item.type === 'health_potion',
      );
      if (potionSlot >= 0) {
        this.pushAction(`useItem${potionSlot + 1}` as InputAction);
      }
    }

    // Adjacent enemy -> fight
    const adjacentEnemy = this.findAdjacentEnemy(state);
    if (adjacentEnemy) {
      this.currentState = BotState.Fight;
      this.faceTarget(adjacentEnemy);
      this.input.clearMovementOverride();
      this.pushAction('attack');
      return;
    }

    // Nearby enemy -> path toward it
    const nearbyEnemy = this.findNearestEnemy(state);
    if (nearbyEnemy && state.dungeon && this.path.length === 0) {
      this.currentState = BotState.Navigate;
      this.path = this.findPath(state.playerPos, nearbyEnemy.position, state.dungeon);
    }

    // On stairs -> use
    const tile = state.dungeon?.tiles[state.playerPos.y]?.[state.playerPos.x];
    if (tile === TileType.StairsDown) {
      this.currentState = BotState.UseExit;
      this.input.clearMovementOverride();
      this.pushAction('interact');
      this.explored.clear();
      this.path = [];
      return;
    }

    // No path -> explore
    if (this.path.length === 0 && state.dungeon) {
      this.currentState = BotState.Explore;
      const unexplored = this.findNearestUnexplored(state.playerPos, state.dungeon);
      const target = unexplored ?? state.dungeon.exit;
      this.path = this.findPath(state.playerPos, target, state.dungeon);
    }

    // Follow path
    if (this.path.length > 0) {
      this.followPath();
    } else {
      this.input.clearMovementOverride();
    }
  }

  reset(): void {
    this.explored.clear();
    this.path = [];
    this.stuckTimer = 0;
    this.currentState = BotState.Explore;
    this.input.clearMovementOverride();
  }

  private faceTarget(target: GridPos): void {
    const pos = this.camera.position;
    const tx = target.x * TILE_SIZE + TILE_SIZE / 2;
    const tz = target.y * TILE_SIZE + TILE_SIZE / 2;
    this.camera.yaw = Math.atan2(-(tx - pos.x), -(tz - pos.z));
  }

  private followPath(): void {
    const next = this.path[0];
    if (!next) {
      this.input.clearMovementOverride();
      return;
    }

    const pos = this.camera.position;
    const tx = next.x * TILE_SIZE + TILE_SIZE / 2;
    const tz = next.y * TILE_SIZE + TILE_SIZE / 2;
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Tight arrival — must be close to tile center before advancing
    if (dist < 0.8) {
      this.path.shift();
      if (this.path.length === 0) {
        this.input.clearMovementOverride();
        return;
      }
      // Don't recurse — wait for next tick to face new waypoint
      return;
    }

    // Face toward the NEXT waypoint only
    this.camera.yaw = Math.atan2(-dx, -dz);
    this.input.setMovementOverride(1, 0);
  }

  private findAdjacentEnemy(state: GameState): GridPos | null {
    const pos = this.camera.position;
    for (const e of state.enemies) {
      if (e.state === 'dead') continue;
      const dx = e.worldX - pos.x;
      const dz = e.worldZ - pos.z;
      if (dx * dx + dz * dz < 3.5 * 3.5) {
        return e.position;
      }
    }
    return null;
  }

  private findNearestEnemy(state: GameState): { position: GridPos } | null {
    const { playerPos, enemies } = state;
    let nearest: { position: GridPos } | null = null;
    let minDist = Infinity;
    for (const e of enemies) {
      if (e.state === 'dead') continue;
      const dist = Math.abs(e.position.x - playerPos.x) + Math.abs(e.position.y - playerPos.y);
      if (dist < minDist && dist <= 8) {
        minDist = dist;
        nearest = e;
      }
    }
    return nearest;
  }

  private findPath(from: GridPos, to: GridPos, dungeon: DungeonData): GridPos[] {
    const passable = (x: number, y: number): boolean => {
      const tile = dungeon.tiles[y]?.[x];
      return tile !== undefined && tile !== TileType.Wall;
    };
    const astar = new Path.AStar(to.x, to.y, passable, { topology: 4 });
    const path: GridPos[] = [];
    astar.compute(from.x, from.y, (x, y) => { path.push({ x, y }); });
    if (path.length > 0) path.shift();
    return path;
  }

  private findNearestUnexplored(from: GridPos, dungeon: DungeonData): GridPos | null {
    const visited = new Set<string>();
    const queue: GridPos[] = [from];
    visited.add(`${from.x},${from.y}`);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const off of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
        const nx = current.x + off.x;
        const ny = current.y + off.y;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const tile = dungeon.tiles[ny]?.[nx];
        if (tile === undefined || tile === TileType.Wall) continue;
        if (!this.explored.has(key)) return { x: nx, y: ny };
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }
}
