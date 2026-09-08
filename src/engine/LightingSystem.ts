import * as THREE from 'three';
import { FOG_DEFAULT, FOG_NEAR, FOG_FAR } from './visibility-policy';
import { TILE_SIZE, WALL_HEIGHT, TileType, SKY_CEIL } from '../game/types';
import type { DungeonData, WorldData } from '../game/types';
import { tileBiome, type BiomeType } from '../game/dungeon/cells';
import { PILLAR_CELL_TILES } from '../game/dungeon/pillar-layer';
import { infrastructureColumnAt } from '../game/dungeon/infrastructure-columns';


const AMBIENT_COLOR = 0xdedbd2;
const AMBIENT_INTENSITY = 0.40;
const TORCH_COLOR = 0xffd6a0;
const TORCH_INTENSITY = 2.5;
const TORCH_DISTANCE = TILE_SIZE * 10; // must reach cell corners from its center
const TORCH_DECAY = 1.5;

// Each biome lights differently — the strongest cheap mood signal there is
const BIOME_TORCH: Record<BiomeType, { color: number; intensity: number }> = {
  dungeon: { color: 0xffd6a0, intensity: 2.5 }, // warm utility lamps
  cave: { color: 0xe6c79e, intensity: 2.1 }, // dusty work lights
  crypt: { color: 0xc0d2c3, intensity: 2.4 }, // aged fluorescent
  ember: { color: 0xff9452, intensity: 3.1 }, // restrained furnace glow
  outside: { color: 0xd0deea, intensity: 2.8 }, // cool overcast fill
};
const CORRIDOR_LIGHT_COLOR = 0xd4dbc6;
const CORRIDOR_LIGHT_INTENSITY = 1.7;
const CORRIDOR_LIGHT_DISTANCE = TILE_SIZE * 4;
/** THRESHOLD BEACONS — light marks the mouths of the permanent transit
 *  corridors (the Mik principle: guide with light direction, never
 *  yellow paint). The network was 100% reachable but experientially
 *  invisible; a cold marker light at every mouth makes the
 *  infrastructure legible without touching geometry or UI. */
const THRESHOLD_COLOR = 0xd5e4dc;
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
  const mounted = new Set<string>();
  const w = world.levels[0]!.width;
  for (const p of world.pillars.values()) {
    if (!p.frame) continue;
    for (const entry of p.roomSockets) {
      if (entry.role !== 'entry') continue;
      const tx = p.cx * PILLAR_CELL_TILES + entry.lx;
      const tz = p.cz * PILLAR_CELL_TILES + entry.lz;
      const span = world.columns[tz * w + tx]?.find(s => Math.abs(s.floor-entry.y)<0.7 && s.ceil-s.floor>=2);
      if (!span || span.ceil >= SKY_CEIL) continue;
      // Multiple route groups may share a physical stair landing. Navigation
      // entries are not fixture instances: mount and light that ceiling once.
      const key = `${tx},${tz},${span.ceil}`;
      if (mounted.has(key)) continue;
      mounted.add(key);
      out.push({x:(tx+0.5)*TILE_SIZE,y:span.ceil-0.28,z:(tz+0.5)*TILE_SIZE,
        ceilingY:span.ceil,rotation:p.frame.rotation});
    }
  }
  return out;
}

/** Sample complete absolute runs, never the clipped streaming window. Only the
 * exact bore air span can authorize a mount; open sky is not a ceiling. */
export function collectInfrastructureFixtures(world: WorldData): FrameFixture[] {
  const out: FrameFixture[] = [];
  if (!world.infrastructure) return out;
  const mounted = new Set<string>();
  const level = world.levels[0]!;
  const originX = world.originPcx * PILLAR_CELL_TILES * TILE_SIZE;
  const originZ = world.originPcz * PILLAR_CELL_TILES * TILE_SIZE;
  for (const p of world.infrastructure.primitives) {
    if (p.kind !== 'pipe' || !p.innerRadius || p.radius < 3 || p.a[1] !== p.b[1]) continue;
    const dx = p.b[0] - p.a[0], dz = p.b[2] - p.a[2];
    const length = Math.hypot(dx, dz);
    if (length < 100) continue;
    for (let d = 18; d < length; d += 36) {
      const x = p.a[0] + dx * d / length - originX;
      const z = p.a[2] + dz * d / length - originZ;
      if (x < 0 || z < 0 || x >= level.width * TILE_SIZE || z >= level.height * TILE_SIZE) continue;
      const span = infrastructureColumnAt(world, x, z)?.find(s => s.floor <= p.a[1] && s.ceil > p.a[1]);
      if (!span || span.ceil >= SKY_CEIL) continue;
      const key = `${x},${z},${span.ceil}`;
      if (mounted.has(key)) continue;
      mounted.add(key);
      out.push({ x, y: span.ceil - 0.28, z, ceilingY: span.ceil,
        rotation: Math.abs(dx) > Math.abs(dz) ? 1 : 0 });
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
    // Gradual haze preserves mid-distance detail and hides the unchanged far clip.
    this.scene.fog = new THREE.Fog(FOG_DEFAULT, FOG_NEAR, FOG_FAR);
    this.scene.background = new THREE.Color(FOG_DEFAULT);

    // Restrained neutral fill preserves industrial material contrast.
    const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
    this.scene.add(ambient);
    this.globalLights.push(ambient);

    // Hemisphere light for subtle top/bottom color difference
    const hemi = new THREE.HemisphereLight(0xb7c8ce, 0x51473a, 0.42);
    this.scene.add(hemi);
    this.globalLights.push(hemi);

    this.ensurePool();
    this.levelFixtures = world.levels.map((level) => this.collectFixtures(level));
    const frameFixtures = collectFrameFixtures(world);
    const infrastructureFixtures = collectInfrastructureFixtures(world);
    const mountedFixtures = [...frameFixtures, ...infrastructureFixtures];
    if (mountedFixtures.length) {
      this.frameMounts = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.8,0.12,0.25),
        new THREE.MeshBasicMaterial({color:0xffd5a3}),mountedFixtures.length);
      const matrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3(1,1,1);
      const up = new THREE.Vector3(0,1,0);
      mountedFixtures.forEach((f,i) => {
        position.set(f.x,f.ceilingY-0.06,f.z);
        q.setFromAxisAngle(up,f.rotation*Math.PI/2);
        this.frameMounts!.setMatrixAt(i,matrix.compose(position,q,scale));
        const isBore = i >= frameFixtures.length;
        this.levelFixtures[0]!.push({x:f.x,y:f.y,z:f.z,
          color:isBore ? 0xd5e4dc : 0xffd5a3,intensity:2.5,distance:isBore ? 30 : 24});
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
