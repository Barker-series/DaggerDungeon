export type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'interact'
  | 'respawn'
  | 'toggleAutoPlay';

/**
 * FPS input manager — modern layout with room for weapons later.
 *
 * WASD move, Space jump, Ctrl/C crouch, Shift sprint, F interact,
 * P auto-play. E/Q/R and mouse buttons stay free for future combat.
 */
export class KeyboardInput {
  /** Physical keyboard state. Virtual bot controls must never mutate this:
   * a held key produces no second keydown after a streaming handoff. */
  private keysDown = new Set<string>();
  private botForward = 0;
  private botRight = 0;
  private botSprint = false;
  private actionQueue: InputAction[] = [];
  private disposed = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /**
   * Get movement direction from held keys.
   * Returns local-space: +Y = forward, -Y = backward, +X = right, -X = left
   */
  getMovementDir(out: { x: number; y: number }): { x: number; y: number } {
    let x = 0;
    let y = 0;

    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) y += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) y -= 1;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) x -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) x += 1;
    y += this.botForward;
    x += this.botRight;

    out.x = x;
    out.y = y;

    // Normalize diagonal
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      out.x /= len;
      out.y /= len;
    }
    return out;
  }

  isSprinting(): boolean {
    return this.botSprint
      || this.keysDown.has('ShiftLeft')
      || this.keysDown.has('ShiftRight');
  }

  /** Ctrl or C — C exists because browsers own Ctrl+W (closes the tab) */
  isCrouching(): boolean {
    return this.keysDown.has('ControlLeft') || this.keysDown.has('ControlRight') || this.keysDown.has('KeyC');
  }

  /** Did the player just press Space (jump)? Consumed on read. */
  consumeJump(): boolean {
    if (this.keysDown.has('Space')) {
      this.keysDown.delete('Space');
      return true;
    }
    return false;
  }

  /** Is Space held right now? (not consumed — Source-style auto-bhop:
   *  holding jump re-jumps the frame you land, before friction applies) */
  jumpHeld(): boolean {
    return this.keysDown.has('Space');
  }

  consumeAction(): InputAction | null {
    return this.actionQueue.shift() ?? null;
  }

  pushAction(action: InputAction): void {
    this.actionQueue.push(action);
  }

  /** Bot movement override */
  setMovementOverride(forward: number, right: number): void {
    this.botForward = Math.sign(forward);
    this.botRight = Math.sign(right);
  }

  clearMovementOverride(): void {
    this.botForward = 0;
    this.botRight = 0;
  }

  /** Is the bot currently driving movement? The engine gives the bot
   *  direct kinematic velocity (no friction/accel model) so its
   *  pathfollowing stays exact under Source-style player physics. */
  hasMovementOverride(): boolean {
    return this.botForward !== 0 || this.botRight !== 0;
  }

  /** Bot sprint override — holds/releases virtual Shift */
  setSprintOverride(on: boolean): void {
    this.botSprint = on;
  }

  // ── Keyboard ──

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    if (this.isGameKey(e.code)) e.preventDefault();
    this.keysDown.add(e.code);

    if (!e.repeat) {
      switch (e.code) {
        case 'KeyF':
          this.actionQueue.push('interact');
          break;
        case 'KeyR':
          this.actionQueue.push('respawn');
          break;
        case 'KeyP':
          this.actionQueue.push('toggleAutoPlay');
          break;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private isGameKey(code: string): boolean {
    return [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyP', 'KeyC', 'KeyR',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    ].includes(code);
  }
}
