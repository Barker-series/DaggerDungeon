import type { ServiceLadder } from '../game/dungeon/frame-services';

export interface LadderPosition {
  x: number;
  y: number;
  z: number;
}
export type LadderClearance = (position: LadderPosition) => boolean;

/** Strict standing-body fit against ordinary columns at EXPLICIT feet height.
 * Unlike walking collision there is no step-up allowance during a ladder sweep.
 * Column coordinates supplied to the callback are absolute tile coordinates. */
export function serviceBodyClear(
  p: LadderPosition,
  column: (tileX: number, tileZ: number) => readonly { floor: number; ceil: number }[] | undefined,
  height = 1.8,
  radius = 0.35,
): boolean {
  for (let z = Math.floor((p.z - radius) / 3); z <= Math.floor((p.z + radius) / 3); z++) {
    for (let x = Math.floor((p.x - radius) / 3); x <= Math.floor((p.x + radius) / 3); x++) {
      const dx = p.x - Math.max(x * 3, Math.min(p.x, (x + 1) * 3));
      const dz = p.z - Math.max(z * 3, Math.min(p.z, (z + 1) * 3));
      if (dx * dx + dz * dz >= radius * radius) continue;
      if (!column(x, z)?.some((s) => s.floor <= p.y + 1e-6 && s.ceil >= p.y + height - 1e-6))
        return false;
    }
  }
  return true;
}

/** Check the complete body sweep, including both endpoints. No teleport through
 * a shelf/wall on slow frames; mount failure leaves the starting pose intact. */
function sweepClear(from: LadderPosition, to: LadderPosition, clear: LadderClearance): boolean {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / 0.1),
  );
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (
      !clear({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      })
    )
      return false;
  }
  return true;
}

/** Absolute world coordinates throughout: a window recenter cannot move a rung. */
export class ServiceLadders {
  private ladders: readonly ServiceLadder[] = [];
  active: { id: string; phase: 'climbing' | 'dismounting' } | null = null;
  private approachBlocked = false;

  /** Walking into the open face acquires the rungs; looking/passing alongside
   * does not. After release, let go of forward before automatically regrabbing. */
  approach(
    position: LadderPosition,
    forward: { x: number; z: number },
    intent: boolean,
    clear: LadderClearance,
  ): boolean {
    if (!intent) this.approachBlocked = false;
    if (!intent || this.approachBlocked || this.active) return false;
    const ladder = this.ladders.find((l) => {
      const dx = position.x - l.x,
        dz = position.z - l.z;
      const outward = dx * l.nx + dz * l.nz;
      return (
        Math.hypot(dx, dz) <= 1.25 &&
        outward >= -0.15 &&
        forward.x * l.nx + forward.z * l.nz < -0.5 &&
        position.y >= l.bottom - 0.3 &&
        position.y < l.top - 0.3
      );
    });
    return ladder ? this.mount(ladder, position, clear) : false;
  }

  adopt(ladders: readonly ServiceLadder[]): void {
    this.ladders = ladders;
    if (this.active && !ladders.some((l) => l.id === this.active!.id)) this.active = null;
  }

  reset(): void {
    this.active = null;
  }

  /** Returns true for the entire owned frame, including a release frame. */
  step(
    position: LadderPosition,
    direction: number,
    detach: boolean,
    dt: number,
    clear: LadderClearance,
  ): boolean {
    if (!this.active) return false;
    const ladder = this.ladders.find((l) => l.id === this.active!.id);
    if (detach || !ladder) {
      this.reset();
      this.approachBlocked = true;
      return true;
    }
    if (this.active.phase === 'dismounting') {
      const retreat = direction < 0;
      const target = {
        x: retreat ? ladder.x : ladder.exitX,
        y: ladder.top,
        z: retreat ? ladder.z : ladder.exitZ,
      };
      const distance = Math.hypot(target.x - position.x, target.z - position.z);
      const fraction = distance > 0 ? Math.min(1, (3 * dt) / distance) : 1;
      const next = {
        x: position.x + (target.x - position.x) * fraction,
        y: ladder.top,
        z: position.z + (target.z - position.z) * fraction,
      };
      if (sweepClear(position, next, clear)) {
        Object.assign(position, next);
        if (fraction === 1) {
          if (retreat) this.active.phase = 'climbing';
          else this.reset();
        }
      }
      return true;
    }
    const next = {
      x: ladder.x,
      y: Math.max(ladder.bottom, Math.min(ladder.top, position.y + Math.sign(direction) * 3 * dt)),
      z: ladder.z,
    };
    if (sweepClear(position, next, clear)) Object.assign(position, next);
    if (direction > 0 && position.y === ladder.top) this.active.phase = 'dismounting';
    if (direction < 0 && position.y === ladder.bottom) this.reset();
    return true;
  }

  interact(position: LadderPosition, clear: LadderClearance): boolean {
    if (this.active) {
      this.reset();
      this.approachBlocked = true;
      return true;
    }
    const ladder = this.ladders.find(
      (l) =>
        Math.hypot(position.x - l.x, position.z - l.z) <= 2.6 &&
        position.y >= l.bottom - 0.3 &&
        position.y <= l.top + 0.3,
    );
    return ladder ? this.mount(ladder, position, clear) : false;
  }

  private mount(ladder: ServiceLadder, position: LadderPosition, clear: LadderClearance): boolean {
    const target = {
      x: ladder.x,
      y: Math.max(ladder.bottom, Math.min(ladder.top, position.y)),
      z: ladder.z,
    };
    if (!sweepClear(position, target, clear)) return false;
    Object.assign(position, target);
    this.active = { id: ladder.id, phase: 'climbing' };
    return true;
  }
}
