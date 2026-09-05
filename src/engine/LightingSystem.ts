import * as THREE from 'three';
import { TILE_SIZE, WALL_HEIGHT, TileType, SKY_CEIL } from '../game/types';
import type { DungeonData, WorldData } from '../game/types';
import { tileBiome, type BiomeType } from '../game/dungeon/cells';
import { PILLAR_CELL_TILES } from '../game/dungeon/pillar-layer';

const FOG_COLOR = 0x0f0e12;
/** SOLVED, not eyeballed: FogExp2 transmittance exp(-(d*rho)^2) should
 *  reach ~2% just inside the camera far plane (160) so the cutoff is
 *  never visible: rho = sqrt(ln 50)/150 = 0.0132. The old 0.02 went
 *  fully opaque by ~99wu — 60 units of paid-for view were pure black. */
const FOG_DENSITY = 0.0132;
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
/** THRESHOLD BEACONS — light marks the mouths of the permanent transit
 *  corridors (the Mik principle: guide with light direction, never
 *  yellow paint). The network was 100% reachable but experientially
 *  invisible; a cold marker light at every mouth makes the
 *  infrastructure legible without touching geometry or UI. */
const THRESHOLD_COLOR = 0xbfd9ff;
const THRESHOLD_INTENSITY = 2.6;
const THRESHOLD_DISTANCE = TILE_SIZE * 6;

/** FIXED point-light pool (the synthcity free-list idea): exactly this
 *  many real PointLights exist, always visible, recycled onto the nearest
 *  fixtures as the player moves. A CONSTANT light count means Three.js
 *  never recompiles shader programs mid-walk — the old visible-toggling
 *  of per-room lights changed the count every re-cull and hitched. */
const LIGHT_POOL_SIZE = 16;
/** Re-assign after the player moves this far */
const CULL_MOVE_THRESHOLD = TILE_SIZE * 2;

/** A light fixture: pure data, no THREE object until a pool light lands. */
interface Fixture {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export interface FrameFixture {
  x: number; y: number; z: number; ceilingY: number; rotation: number;
}

/** Building landing fixtures derive from actual columns, including roofline
 *  clipping. A roofless landing never receives a floating ceiling light. */
export function collectFrameFixtures(world: WorldData): FrameFixture[] {
  const out: FrameFixture[] = [];
  const w = world.levels[0]!.width;
  for (const p of world.pillars.values()) {
    if (!p.frame) continue;
    for (const entry of p.roomSockets) {
      if (entry.role !== 'entry') continue;
      const tx = p.cx * PILLAR_CELL_TILES + entry.lx;
      const tz = p.cz * PILLAR_CELL_TILES + entry.lz;
      const span = world.columns[tz * w + tx]?.find(s => Math.abs(s.floor-entry.y)<0.7 && s.ceil-s.floor>=2);
      if (!span || span.ceil >= SKY_CEIL) continue;
      out.push({x:(tx+0.5)*TILE_SIZE,y:span.ceil-0.28,z:(tz+0.5)*TILE_SIZE,
        ceilingY:span.ceil,rotation:p.frame.rotation});
    }
  }
  return out;
}

export class LightingSystem {
  private scene: THREE.Scene;
  private globalLights: THREE.Light[] = [];
  /** Fixture DATA per level — the active level and the one below form the
   *  assignment pool (its glow rising through shafts sells the depth) */
  private levelFixtures: Fixture[][] = [];
  /** The fixed light pool + a halo sprite per light (additive billboard
   *  glow — bloom turns it into a soft volumetric-looking source). */
  private pool: THREE.PointLight[] = [];
  private halos: THREE.Sprite[] = [];
  private haloTexture: THREE.Texture | null = null;
  private frameMounts: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null = null;
  private activeLevel = -1;
  private lastCullX = Infinity;
  private lastCullY = Infinity;
  private lastCullZ = Infinity;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private makeHaloTexture(): THREE.Texture {
    if (this.haloTexture) return this.haloTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    this.haloTexture = new THREE.CanvasTexture(canvas);
    return this.haloTexture;
  }

  private ensurePool(): void {
    if (this.pool.length > 0) return;
    const halo = this.makeHaloTexture();
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, TORCH_DISTANCE, TORCH_DECAY);
      light.visible = true; // ALWAYS visible — constant shader light count
      this.scene.add(light);
      this.pool.push(light);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: halo,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }));
      sprite.scale.set(0.6, 0.6, 1); // small lamp glint — full-size halos read as floating orbs
      this.scene.add(sprite);
      this.halos.push(sprite);
    }
  }

  clear(): void {
    if (this.frameMounts) {
      this.scene.remove(this.frameMounts);
      this.frameMounts.geometry.dispose();
      this.frameMounts.material.dispose();
      this.frameMounts.dispose();
      this.frameMounts = null;
    }
    for (const light of this.globalLights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.globalLights = [];
    this.levelFixtures = [];
    // The pool persists across worlds — lights just go dark until the
    // next assignment. (Constant count is the whole point.)
    for (const light of this.pool) light.intensity = 0;
    for (const halo of this.halos) halo.material.opacity = 0;
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

    this.ensurePool();
    this.levelFixtures = world.levels.map((level) => this.collectFixtures(level));
    const frameFixtures = collectFrameFixtures(world);
    if (frameFixtures.length) {
      this.frameMounts = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.8,0.12,0.25),
        new THREE.MeshBasicMaterial({color:0xffd5a3}),frameFixtures.length);
      const matrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3(1,1,1);
      const up = new THREE.Vector3(0,1,0);
      frameFixtures.forEach((f,i) => {
        position.set(f.x,f.ceilingY-0.06,f.z);
        q.setFromAxisAngle(up,f.rotation*Math.PI/2);
        this.frameMounts!.setMatrixAt(i,matrix.compose(position,q,scale));
        this.levelFixtures[0]!.push({x:f.x,y:f.y,z:f.z,color:0xffd5a3,intensity:2.5,distance:24});
      });
      this.frameMounts.instanceMatrix.needsUpdate = true;
      this.frameMounts.computeBoundingSphere();
      this.scene.add(this.frameMounts);
    }
    this.setActiveLevel(0);
  }

  /** Set which level the player occupies — its lights and the level
   *  below's form the culling pool. */
  setActiveLevel(li: number): void {
    if (li === this.activeLevel) return;
    this.activeLevel = li;
    this.lastCullX = Infinity; // force a re-cull on the next update
  }

  /** Recycle the fixed pool onto the nearest fixtures. Call every frame
   *  with the player position; work happens only after real movement. */
  update(x: number, y: number, z: number): void {
    const dx = x - this.lastCullX;
    const dy = y - this.lastCullY;
    const dz = z - this.lastCullZ;
    if (dx * dx + dy * dy + dz * dz < CULL_MOVE_THRESHOLD * CULL_MOVE_THRESHOLD) return;
    this.lastCullX = x;
    this.lastCullY = y;
    this.lastCullZ = z;

    const candidates: { f: Fixture; d: number }[] = [];
    for (let i = 0; i < this.levelFixtures.length; i++) {
      if (i !== this.activeLevel && i !== this.activeLevel + 1) continue;
      for (const f of this.levelFixtures[i]!) {
        const lx = f.x - x;
        const ly = f.y - y;
        const lz = f.z - z;
        candidates.push({ f, d: lx * lx + ly * ly + lz * lz });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i]!;
      const halo = this.halos[i]!;
      const c = candidates[i];
      if (!c) {
        light.intensity = 0;
        halo.material.opacity = 0;
        continue;
      }
      light.position.set(c.f.x, c.f.y, c.f.z);
      light.color.setHex(c.f.color);
      light.intensity = c.f.intensity;
      light.distance = c.f.distance;
      halo.position.set(c.f.x, c.f.y, c.f.z);
      halo.material.color.setHex(c.f.color);
      halo.material.opacity = Math.min(0.6, c.f.intensity * 0.18);
    }
  }

  private collectFixtures(dungeon: DungeonData): Fixture[] {
    const fixtures: Fixture[] = [];
    const baseY = dungeon.baseY;

    // Torch point lights at room centers, hung into the local ceiling vault
    // so tall halls and caverns read instead of going black overhead
    for (const room of dungeon.rooms) {
      const floorH = dungeon.floorHeights[room.center.y]?.[room.center.x] ?? 0;
      // No lights down in the shafts — the void stays black. (Stairwell
      // ramps descend legitimately and keep their torches.)
      if (floorH <= -100) continue;
      const ceilH = dungeon.ceilingHeights[room.center.y]?.[room.center.x] ?? WALL_HEIGHT;
      // MOUNTED, not floating: fixtures hug the ceiling (a hanging lamp),
      // never hover mid-air in tall halls — a glow orb in open space
      // reads as a bug, a glow at the ceiling reads as a light fitting.
      const lightY = Math.max(floorH + 2, ceilH - 0.8);
      const biome = tileBiome(dungeon.cellBiomes, room.center.x, room.center.y);
      const torch = biome ? BIOME_TORCH[biome] : { color: TORCH_COLOR, intensity: TORCH_INTENSITY };
      fixtures.push({
        x: room.center.x * TILE_SIZE + TILE_SIZE / 2,
        y: baseY + lightY,
        z: room.center.y * TILE_SIZE + TILE_SIZE / 2,
        color: torch.color,
        intensity: torch.intensity,
        distance: TORCH_DISTANCE + ceilH,
      });

      // Larger rooms get extra lights at corners for better coverage
      if (room.width * room.height > 20) {
        const offsets = [
          [room.left + 1, room.top + 1],
          [room.left + room.width - 2, room.top + room.height - 2],
        ];
        for (const off of offsets) {
          const ox = off[0]!;
          const oy = off[1]!;
          const cornerCeil = dungeon.ceilingHeights[oy]?.[ox] ?? WALL_HEIGHT;
          fixtures.push({
            x: ox * TILE_SIZE + TILE_SIZE / 2,
            y: baseY + Math.max(2, cornerCeil - 0.8),
            z: oy * TILE_SIZE + TILE_SIZE / 2,
            color: TORCH_COLOR,
            intensity: TORCH_INTENSITY * 0.5,
            distance: TORCH_DISTANCE * 0.7,
          });
        }
      }
    }

    // Add dim lights along corridors (at door positions) so corridors aren't pitch black
    for (const room of dungeon.rooms) {
      for (const door of room.doors) {
        const doorCeil = dungeon.ceilingHeights[door.y]?.[door.x] ?? WALL_HEIGHT;
        fixtures.push({
          x: door.x * TILE_SIZE + TILE_SIZE / 2,
          y: baseY + Math.max(2, doorCeil - 0.8),
          z: door.y * TILE_SIZE + TILE_SIZE / 2,
          color: CORRIDOR_LIGHT_COLOR,
          intensity: CORRIDOR_LIGHT_INTENSITY,
          distance: CORRIDOR_LIGHT_DISTANCE,
        });
      }
    }

    // ── Threshold beacons at transit-corridor mouths. A mouth is a
    // null-biome (tunnel-region) floor tile 4-adjacent to a real-biome
    // floor tile — detected from data the level already carries, so it
    // works identically from worker-generated worlds. One beacon per
    // contiguous mouth (skip if the neighbor toward -x/-z already
    // qualified). ──
    const w = dungeon.width;
    const isFloor = (tx: number, tz: number): boolean =>
      tx >= 0 && tz >= 0 && tx < w && tz < dungeon.height
      && dungeon.tiles[tz]![tx] !== TileType.Wall
      && (dungeon.floorHeights[tz]![tx] ?? -1000) > -900;
    const isMouth = (tx: number, tz: number): boolean => {
      if (!isFloor(tx, tz)) return false;
      if (tileBiome(dungeon.cellBiomes, tx, tz) !== null) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (isFloor(tx + dx, tz + dz) && tileBiome(dungeon.cellBiomes, tx + dx, tz + dz) !== null) return true;
      }
      return false;
    };
    for (let tz = 0; tz < dungeon.height; tz++) {
      for (let tx = 0; tx < w; tx++) {
        if (!isMouth(tx, tz)) continue;
        if (isMouth(tx - 1, tz) || isMouth(tx, tz - 1)) continue; // one per mouth
        const mouthCeil = dungeon.ceilingHeights[tz]?.[tx] ?? WALL_HEIGHT;
        const floorH = dungeon.floorHeights[tz]![tx]!;
        fixtures.push({
          x: tx * TILE_SIZE + TILE_SIZE / 2,
          y: baseY + Math.max(floorH + 2, floorH + mouthCeil - 0.8),
          z: tz * TILE_SIZE + TILE_SIZE / 2,
          color: THRESHOLD_COLOR,
          intensity: THRESHOLD_INTENSITY,
          distance: THRESHOLD_DISTANCE,
        });
      }
    }

    return fixtures;
  }
}
