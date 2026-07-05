import * as THREE from 'three';
import { TILE_SIZE, WALL_HEIGHT, TileType } from '../game/types';
import type { DungeonData, WorldData } from '../game/types';
import { tileBiome, type BiomeType } from '../game/dungeon/cells';

const FOG_COLOR = 0x0f0e12;
const FOG_DENSITY = 0.02; // a touch thinner than the single-level days — shafts and atria need reach
const AMBIENT_COLOR = 0xffeedd;
const AMBIENT_INTENSITY = 0.68;
const TORCH_COLOR = 0xff9944;
const TORCH_INTENSITY = 2.5;
const TORCH_DISTANCE = TILE_SIZE * 10; // must reach cell corners from its center
const TORCH_DECAY = 1.5;

// Each biome lights differently — the strongest cheap mood signal there is
const BIOME_TORCH: Record<BiomeType, { color: number; intensity: number }> = {
  dungeon: { color: 0xff9944, intensity: 2.5 }, // warm torchlight
  cave: { color: 0xffb066, intensity: 2.2 }, // soft amber
  crypt: { color: 0x7799ee, intensity: 2.6 }, // cold witch-light
  ember: { color: 0xff4411, intensity: 3.5 }, // furnace glow
  outside: { color: 0xa8c4ff, intensity: 3.2 }, // moonlight
};
const CORRIDOR_LIGHT_COLOR = 0xcc8844;
const CORRIDOR_LIGHT_INTENSITY = 1.5;
const CORRIDOR_LIGHT_DISTANCE = TILE_SIZE * 4;

/** Visible point-light budget. Every visible light is a per-fragment cost
 *  in the forward renderer, so only the nearest few dozen get to shine —
 *  a torch three rooms away contributes nothing but shader time anyway. */
const MAX_VISIBLE_LIGHTS = 32;
/** Re-cull after the player moves this far */
const CULL_MOVE_THRESHOLD = TILE_SIZE * 2;

export class LightingSystem {
  private scene: THREE.Scene;
  private globalLights: THREE.Light[] = [];
  /** Point lights per level — the active level and the one below form the
   *  cull pool (its glow rising through shafts is what sells the depth) */
  private levelLights: THREE.Light[][] = [];
  private activeLevel = -1;
  private lastCullX = Infinity;
  private lastCullY = Infinity;
  private lastCullZ = Infinity;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  clear(): void {
    for (const light of [...this.globalLights, ...this.levelLights.flat()]) {
      this.scene.remove(light);
      light.dispose();
    }
    this.globalLights = [];
    this.levelLights = [];
    this.activeLevel = -1;
    this.lastCullX = Infinity;
    this.scene.fog = null;
  }

  setup(world: WorldData): void {
    // Lighter fog so textures are visible at reasonable distance
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.scene.background = new THREE.Color(FOG_COLOR);

    // Ambient — warm tint, bright enough to see textures even in unlit areas
    const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
    this.scene.add(ambient);
    this.globalLights.push(ambient);

    // Hemisphere light for subtle top/bottom color difference
    const hemi = new THREE.HemisphereLight(0xffe8cc, 0x443322, 0.3);
    this.scene.add(hemi);
    this.globalLights.push(hemi);

    this.levelLights = world.levels.map((level) => this.buildLevelLights(level));
    this.setActiveLevel(0);
  }

  /** Set which level the player occupies — its lights and the level
   *  below's form the culling pool. */
  setActiveLevel(li: number): void {
    if (li === this.activeLevel) return;
    this.activeLevel = li;
    this.lastCullX = Infinity; // force a re-cull on the next update
  }

  /** Keep only the nearest MAX_VISIBLE_LIGHTS point lights on. Call every
   *  frame with the player position; work happens only after real movement. */
  update(x: number, y: number, z: number): void {
    const dx = x - this.lastCullX;
    const dy = y - this.lastCullY;
    const dz = z - this.lastCullZ;
    if (dx * dx + dy * dy + dz * dz < CULL_MOVE_THRESHOLD * CULL_MOVE_THRESHOLD) return;
    this.lastCullX = x;
    this.lastCullY = y;
    this.lastCullZ = z;

    const pool: { light: THREE.Light; d: number }[] = [];
    for (let i = 0; i < this.levelLights.length; i++) {
      const inPool = i === this.activeLevel || i === this.activeLevel + 1;
      for (const light of this.levelLights[i]!) {
        if (!inPool) {
          light.visible = false;
          continue;
        }
        const lx = light.position.x - x;
        const ly = light.position.y - y;
        const lz = light.position.z - z;
        pool.push({ light, d: lx * lx + ly * ly + lz * lz });
      }
    }
    pool.sort((a, b) => a.d - b.d);
    for (let i = 0; i < pool.length; i++) {
      pool[i]!.light.visible = i < MAX_VISIBLE_LIGHTS;
    }
  }

  private buildLevelLights(dungeon: DungeonData): THREE.Light[] {
    const lights: THREE.Light[] = [];
    const baseY = dungeon.baseY;
    const add = (light: THREE.Light): void => {
      light.visible = false;
      this.scene.add(light);
      lights.push(light);
    };

    // Torch point lights at room centers, hung into the local ceiling vault
    // so tall halls and caverns read instead of going black overhead
    for (const room of dungeon.rooms) {
      const floorH = dungeon.floorHeights[room.center.y]?.[room.center.x] ?? 0;
      // No lights down in the shafts — the void stays black. (Stairwell
      // ramps descend legitimately and keep their torches.)
      if (floorH <= -100) continue;
      const ceilH = dungeon.ceilingHeights[room.center.y]?.[room.center.x] ?? WALL_HEIGHT;
      const lightY = Math.max(floorH + WALL_HEIGHT * 0.75, floorH + (ceilH - floorH) * 0.65);
      const biome = tileBiome(dungeon.cellBiomes, room.center.x, room.center.y);
      const torch = biome ? BIOME_TORCH[biome] : { color: TORCH_COLOR, intensity: TORCH_INTENSITY };
      const light = new THREE.PointLight(
        torch.color,
        torch.intensity,
        TORCH_DISTANCE + ceilH,
        TORCH_DECAY,
      );
      light.position.set(
        room.center.x * TILE_SIZE + TILE_SIZE / 2,
        baseY + lightY,
        room.center.y * TILE_SIZE + TILE_SIZE / 2,
      );
      add(light);

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
            baseY + WALL_HEIGHT * 0.7,
            oy * TILE_SIZE + TILE_SIZE / 2,
          );
          add(cornerLight);
        }
      }
    }

    // Exit beacon — the way down: blue at stairwell doors, green at the
    // real stairs out of the stack (bottom level only)
    let exitFloor = dungeon.floorHeights[dungeon.exit.y]?.[dungeon.exit.x] ?? 0;
    if (exitFloor <= -100) exitFloor = 0;
    const stairsOut = dungeon.tiles[dungeon.exit.y]?.[dungeon.exit.x] === TileType.StairsDown;
    const beacon = new THREE.PointLight(stairsOut ? 0x33ff88 : 0x5599ff, 3, TILE_SIZE * 7, 1.2);
    beacon.position.set(
      dungeon.exit.x * TILE_SIZE + TILE_SIZE / 2,
      baseY + exitFloor + 2.2,
      dungeon.exit.y * TILE_SIZE + TILE_SIZE / 2,
    );
    add(beacon);

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
          baseY + WALL_HEIGHT * 0.6,
          door.y * TILE_SIZE + TILE_SIZE / 2,
        );
        add(corridorLight);
      }
    }

    return lights;
  }
}
