import * as THREE from 'three';
import { TILE_SIZE, WALL_HEIGHT } from '../game/types';
import type { DungeonData } from '../game/types';

const FOG_COLOR = 0x0f0e12;
const AMBIENT_COLOR = 0xffeedd;
const AMBIENT_INTENSITY = 0.6;
const TORCH_COLOR = 0xff9944;
const TORCH_INTENSITY = 2.5;
const TORCH_DISTANCE = TILE_SIZE * 7;
const TORCH_DECAY = 1.5;
const CORRIDOR_LIGHT_COLOR = 0xcc8844;
const CORRIDOR_LIGHT_INTENSITY = 1.5;
const CORRIDOR_LIGHT_DISTANCE = TILE_SIZE * 4;

export class LightingSystem {
  private scene: THREE.Scene;
  private lights: THREE.Light[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  clear(): void {
    for (const light of this.lights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.lights = [];
    this.scene.fog = null;
  }

  setup(dungeon: DungeonData): void {
    // Lighter fog so textures are visible at reasonable distance
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.025);
    this.scene.background = new THREE.Color(FOG_COLOR);

    // Ambient — warm tint, bright enough to see textures even in unlit areas
    const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
    this.scene.add(ambient);
    this.lights.push(ambient);

    // Hemisphere light for subtle top/bottom color difference
    const hemi = new THREE.HemisphereLight(0xffe8cc, 0x443322, 0.3);
    this.scene.add(hemi);
    this.lights.push(hemi);

    // Torch point lights at room centers
    for (const room of dungeon.rooms) {
      const light = new THREE.PointLight(
        TORCH_COLOR,
        TORCH_INTENSITY,
        TORCH_DISTANCE,
        TORCH_DECAY,
      );
      light.position.set(
        room.center.x * TILE_SIZE + TILE_SIZE / 2,
        WALL_HEIGHT * 0.75,
        room.center.y * TILE_SIZE + TILE_SIZE / 2,
      );
      this.scene.add(light);
      this.lights.push(light);

      // Larger rooms get extra lights at corners for better coverage
      if (room.width * room.height > 20) {
        const offsets = [
          [room.left + 1, room.top + 1],
          [room.left + room.width - 2, room.top + room.height - 2],
        ];
        for (const off of offsets) {
          const ox = off[0]!;
          const oy = off[1]!;
          const cornerLight = new THREE.PointLight(
            TORCH_COLOR,
            TORCH_INTENSITY * 0.5,
            TORCH_DISTANCE * 0.7,
            TORCH_DECAY,
          );
          cornerLight.position.set(
            ox * TILE_SIZE + TILE_SIZE / 2,
            WALL_HEIGHT * 0.7,
            oy * TILE_SIZE + TILE_SIZE / 2,
          );
          this.scene.add(cornerLight);
          this.lights.push(cornerLight);
        }
      }
    }

    // Add dim lights along corridors (at door positions) so corridors aren't pitch black
    for (const room of dungeon.rooms) {
      for (const door of room.doors) {
        const corridorLight = new THREE.PointLight(
          CORRIDOR_LIGHT_COLOR,
          CORRIDOR_LIGHT_INTENSITY,
          CORRIDOR_LIGHT_DISTANCE,
          TORCH_DECAY,
        );
        corridorLight.position.set(
          door.x * TILE_SIZE + TILE_SIZE / 2,
          WALL_HEIGHT * 0.6,
          door.y * TILE_SIZE + TILE_SIZE / 2,
        );
        this.scene.add(corridorLight);
        this.lights.push(corridorLight);
      }
    }
  }
}
