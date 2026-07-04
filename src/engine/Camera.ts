import * as THREE from 'three';
import { EYE_HEIGHT, Direction } from '../game/types';

const MOUSE_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI * 0.45;

/**
 * Standard FPS camera. Free mouse look, continuous world position.
 * No grid snapping. No interpolation. Just a camera you move directly.
 */
export class GridCamera {
  private camera: THREE.PerspectiveCamera;

  // World position (continuous, not grid-locked)
  readonly position = new THREE.Vector3();

  // Free-look angles
  yaw = 0;
  pitch = 0;

  // Pointer lock
  private canvas: HTMLElement | null = null;
  private isPointerLocked = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener('click', this.requestPointerLock);
    canvas.addEventListener('contextmenu', this.preventContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  detach(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.requestPointerLock);
      this.canvas.removeEventListener('contextmenu', this.preventContextMenu);
    }
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }
  }

  getIsPointerLocked(): boolean {
    return this.isPointerLocked;
  }

  /** Set position directly */
  setPosition(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
  }

  /** Set yaw from a cardinal direction (for initial spawn, bot) */
  setFacingDirection(dir: Direction): void {
    const angles: Record<Direction, number> = {
      [Direction.North]: Math.PI,
      [Direction.East]: Math.PI / 2,
      [Direction.South]: 0,
      [Direction.West]: -Math.PI / 2,
    };
    this.yaw = angles[dir];
    this.pitch = 0;
  }

  /** Get the forward direction vector on the XZ plane (normalized, Y=0) */
  getForward(out: THREE.Vector3): THREE.Vector3 {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    return out;
  }

  /** Get the right direction vector on the XZ plane */
  getRight(out: THREE.Vector3): THREE.Vector3 {
    out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    return out;
  }

  /** Get the closest cardinal direction the camera faces */
  getFacingDirection(): Direction {
    const y = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (y >= Math.PI * 0.25 && y < Math.PI * 0.75) return Direction.East;
    if (y >= Math.PI * 0.75 && y < Math.PI * 1.25) return Direction.North;
    if (y >= Math.PI * 1.25 && y < Math.PI * 1.75) return Direction.West;
    return Direction.South;
  }

  /** Apply position + rotation to the Three.js camera. Call every frame. */
  update(): void {
    // position.y is the ground height under the player's feet
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  // ── Pointer lock ──

  private requestPointerLock = () => {
    if (!this.isPointerLocked) {
      this.canvas?.requestPointerLock();
    }
  };

  private preventContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private onPointerLockChange = () => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  };
}
