import * as THREE from 'three';
import { TILE_SIZE } from '../game/types';
import type { GridPos } from '../game/types';

const MAX_SPRITES = 128;
const LERP_SPEED = 10;
const SPRITE_Y = 1.2;

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

function getTexture(path: string): THREE.Texture {
  let tex = texCache.get(path);
  if (!tex) {
    tex = texLoader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    texCache.set(path, tex);
  }
  return tex;
}

interface SpriteEntry {
  id: string;
  color: number;
  scale: number;
  targetPos: THREE.Vector3;
}

export class SpriteManager {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private entries: Map<string, { entry: SpriteEntry; mesh: THREE.Mesh }> = new Map();
  private planeGeom: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.planeGeom = new THREE.PlaneGeometry(1, 1);
  }

  /** Add a sprite at a grid position (color fallback, no texture) */
  addSprite(id: string, gridPos: GridPos, color: number, scale = 1.5): void {
    const wp = gridToWorld(gridPos);
    this.addSpriteWorld(id, wp.x, wp.z, color, scale);
  }

  /** Add a sprite at world position with color fallback */
  addSpriteWorld(id: string, worldX: number, worldZ: number, color: number, scale = 1.5, texturePath?: string): void {
    if (this.entries.size >= MAX_SPRITES) return;

    let material: THREE.Material;
    if (texturePath) {
      material = new THREE.MeshBasicMaterial({
        map: getTexture(texturePath),
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.1,
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
      });
    }

    const mesh = new THREE.Mesh(this.planeGeom, material);
    mesh.scale.set(scale, scale, 1);
    mesh.position.set(worldX, SPRITE_Y, worldZ);

    this.group.add(mesh);
    this.entries.set(id, {
      entry: { id, color, scale, targetPos: new THREE.Vector3(worldX, SPRITE_Y, worldZ) },
      mesh,
    });
  }

  updatePosition(id: string, gridPos: GridPos): void {
    const data = this.entries.get(id);
    if (!data) return;
    const wp = gridToWorld(gridPos);
    data.entry.targetPos.set(wp.x, SPRITE_Y, wp.z);
  }

  updateWorldPosition(id: string, worldX: number, worldZ: number): void {
    const data = this.entries.get(id);
    if (!data) return;
    data.entry.targetPos.set(worldX, SPRITE_Y, worldZ);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const [, data] of this.entries) {
      const pos = data.mesh.position;
      const target = data.entry.targetPos;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.01) {
        const step = Math.min(1, LERP_SPEED * dt / dist);
        pos.x += dx * step;
        pos.z += dz * step;
      } else {
        pos.x = target.x;
        pos.z = target.z;
      }

      data.mesh.quaternion.copy(camera.quaternion);
    }
  }

  setScale(id: string, scale: number): void {
    const data = this.entries.get(id);
    if (!data) return;
    data.mesh.scale.set(scale, scale, 1);
  }

  flashSprite(id: string): void {
    const data = this.entries.get(id);
    if (!data) return;
    const mat = data.mesh.material as THREE.MeshBasicMaterial;
    const origColor = mat.color.getHex();
    mat.color.set(0xffffff);
    setTimeout(() => {
      if (this.entries.has(id)) {
        mat.color.set(origColor);
      }
    }, 100);
  }

  removeSprite(id: string): void {
    const data = this.entries.get(id);
    if (!data) return;
    this.group.remove(data.mesh);
    (data.mesh.material as THREE.Material).dispose();
    this.entries.delete(id);
  }

  clear(): void {
    for (const [, data] of this.entries) {
      this.group.remove(data.mesh);
      (data.mesh.material as THREE.Material).dispose();
    }
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
    this.planeGeom.dispose();
    this.scene.remove(this.group);
  }
}

function gridToWorld(pos: GridPos): THREE.Vector3 {
  return new THREE.Vector3(
    pos.x * TILE_SIZE + TILE_SIZE / 2,
    SPRITE_Y,
    pos.y * TILE_SIZE + TILE_SIZE / 2,
  );
}
