export type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'attack'
  | 'block'
  | 'interact'
  | 'useItem1'
  | 'useItem2'
  | 'useItem3'
  | 'quickHeal'
  | 'toggleAutoPlay';

/**
 * FPS input manager — Skyrim/Fallout 4 style controls.
 *
 * LMB attack, RMB block, WASD move, E interact,
 * Q quick heal, 1-3 hotbar, Shift sprint, Space jump.
 */
export class KeyboardInput {
  private keysDown = new Set<string>();
  private actionQueue: InputAction[] = [];
  private disposed = false;

  // Mouse buttons (tracked separately since they come from pointer lock)
  private mouseLeft = false;
  private mouseRight = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
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
    return this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
  }

  /** Is the player holding LMB (continuous attack / held swing) */
  isAttacking(): boolean {
    return this.mouseLeft;
  }

  /** Is the player holding RMB (block) */
  isBlocking(): boolean {
    return this.mouseRight;
  }

  /** Did the player just press Space (jump)? Consumed on read. */
  consumeJump(): boolean {
    if (this.keysDown.has('Space')) {
      this.keysDown.delete('Space');
      return true;
    }
    return false;
  }

  consumeAction(): InputAction | null {
    return this.actionQueue.shift() ?? null;
  }

  pushAction(action: InputAction): void {
    this.actionQueue.push(action);
  }

  /** Bot movement override */
  setMovementOverride(forward: number, right: number): void {
    this.keysDown.delete('KeyW');
    this.keysDown.delete('KeyS');
    this.keysDown.delete('KeyA');
    this.keysDown.delete('KeyD');
    if (forward > 0) this.keysDown.add('KeyW');
    if (forward < 0) this.keysDown.add('KeyS');
    if (right > 0) this.keysDown.add('KeyD');
    if (right < 0) this.keysDown.add('KeyA');
  }

  clearMovementOverride(): void {
    this.keysDown.delete('KeyW');
    this.keysDown.delete('KeyS');
    this.keysDown.delete('KeyA');
    this.keysDown.delete('KeyD');
  }

  // ── Keyboard ──

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed) return;
    if (this.isGameKey(e.code)) e.preventDefault();
    this.keysDown.add(e.code);

    if (!e.repeat) {
      switch (e.code) {
        case 'KeyE':
          this.actionQueue.push('interact');
          break;
        case 'KeyQ':
          this.actionQueue.push('quickHeal');
          break;
        case 'Digit1':
          this.actionQueue.push('useItem1');
          break;
        case 'Digit2':
          this.actionQueue.push('useItem2');
          break;
        case 'Digit3':
          this.actionQueue.push('useItem3');
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

  // ── Mouse (only fires when pointer is locked) ──

  private onMouseDown = (e: MouseEvent): void => {
    if (!document.pointerLockElement) return;
    if (e.button === 0) {
      this.mouseLeft = true;
      this.actionQueue.push('attack');
    }
    if (e.button === 2) {
      this.mouseRight = true;
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  };

  private isGameKey(code: string): boolean {
    return [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyP',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'Digit1', 'Digit2', 'Digit3',
      'ShiftLeft', 'ShiftRight',
    ].includes(code);
  }
}
