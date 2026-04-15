import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../game/types';
import type { DungeonData } from '../game/types';

interface Projectile {
  mesh: THREE.Mesh;
  velX: number;
  velY: number;
  velZ: number;
  gravity: number;
  damage: number;
  age: number;
  maxAge: number;
  radius: number;
  active: boolean;
}

const POOL_SIZE = 64;
const PLAYER_RADIUS = 0.5;

export class ProjectileManager {
  private scene: THREE.Scene;
  private pool: Projectile[] = [];
  private sharedGeo: THREE.SphereGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sharedGeo = new THREE.SphereGeometry(0.15, 6, 4);

    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
      const mesh = new THREE.Mesh(this.sharedGeo, mat);
      mesh.visible = false;
      scene.add(mesh);

      this.pool.push({
        mesh,
        velX: 0, velY: 0, velZ: 0,
        gravity: 0,
        damage: 0,
        age: 0,
        maxAge: 5,
        radius: 0.15,
        active: false,
      });
    }
  }

  spawn(
    x: number, y: number, z: number,
    dirX: number, dirY: number, dirZ: number,
    speed: number,
    opts: { damage: number; gravity?: number; color?: number; radius?: number; maxAge?: number },
  ): void {
    const p = this.pool.find((p) => !p.active);
    if (!p) return;

    p.mesh.position.set(x, y, z);
    p.velX = dirX * speed;
    p.velY = dirY * speed;
    p.velZ = dirZ * speed;
    p.gravity = opts.gravity ?? 0;
    p.damage = opts.damage;
    p.radius = opts.radius ?? 0.2;
    p.maxAge = opts.maxAge ?? 5;
    p.age = 0;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(p.radius * 4);

    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(opts.color ?? 0xff4400);
  }

  /** Update all projectiles. Returns damage dealt to player this frame. */
  update(dt: number, playerX: number, playerY: number, playerZ: number, dungeon: DungeonData): number {
    let damageToPlayer = 0;

    for (const p of this.pool) {
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.maxAge) {
        this.despawn(p);
        continue;
      }

      // Gravity
      p.velY += p.gravity * dt;

      // Move
      p.mesh.position.x += p.velX * dt;
      p.mesh.position.y += p.velY * dt;
      p.mesh.position.z += p.velZ * dt;

      // Collision with player
      const dx = p.mesh.position.x - playerX;
      const dy = p.mesh.position.y - playerY;
      const dz = p.mesh.position.z - playerZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      const rSum = p.radius + PLAYER_RADIUS;
      if (distSq < rSum * rSum) {
        damageToPlayer += p.damage;
        this.despawn(p);
        continue;
      }

      // Collision with walls
      if (this.wallCollision(p.mesh.position.x, p.mesh.position.z, p.radius, dungeon)) {
        this.despawn(p);
        continue;
      }

      // Kill if below floor
      if (p.mesh.position.y < -1) {
        this.despawn(p);
      }
    }

    return damageToPlayer;
  }

  private despawn(p: Projectile): void {
    p.active = false;
    p.mesh.visible = false;
  }

  private wallCollision(x: number, z: number, radius: number, dungeon: DungeonData): boolean {
    const cx = Math.floor(x / TILE_SIZE);
    const cz = Math.floor(z / TILE_SIZE);
    for (let tz = cz - 1; tz <= cz + 1; tz++) {
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        const tile = dungeon.tiles[tz]?.[tx];
        if (tile === undefined || tile === TileType.Wall) {
          const tMinX = tx * TILE_SIZE;
          const tMaxX = tMinX + TILE_SIZE;
          const tMinZ = tz * TILE_SIZE;
          const tMaxZ = tMinZ + TILE_SIZE;
          const closestX = Math.max(tMinX, Math.min(x, tMaxX));
          const closestZ = Math.max(tMinZ, Math.min(z, tMaxZ));
          const ddx = x - closestX;
          const ddz = z - closestZ;
          if (ddx * ddx + ddz * ddz < radius * radius) return true;
        }
      }
    }
    return false;
  }

  clear(): void {
    for (const p of this.pool) {
      this.despawn(p);
    }
  }

  dispose(): void {
    this.clear();
    this.sharedGeo.dispose();
    for (const p of this.pool) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}
