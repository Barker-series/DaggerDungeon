import * as THREE from 'three';
import { TileType, TILE_SIZE, SKY_CEIL, ABYSS_FLOOR } from '../game/types';
import type { DungeonData, WorldData, ColumnSpan } from '../game/types';
import { tileBiome, type BiomeType } from '../game/dungeon/cells';
import { buildCornerField, PIT_LEVEL } from '../game/dungeon/heightfield';
import { buildOrganicContour, isOrganicTileIn } from '../game/dungeon/organiccontour';
import { bridgeTiles, PIPE_BORE, CLEARANCE } from '../game/dungeon/pillar-bridges';

const loader = new THREE.TextureLoader();

function loadTex(path: string): THREE.Texture {
  const tex = loader.load(
    path,
    (t) => { t.needsUpdate = true; },
    undefined,
    (err) => { console.error(`Failed to load texture: ${path}`, err); },
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// Closely value-matched concrete bases. The renderer blends these with
// per-vertex RGB weights; construction seams belong to trim geometry rather
// than the infinitely repeating terrain material.
const CONCRETE_CLEAN_TEX = loadTex('/textures/concrete-clean-base.png');
const CONCRETE_AGGREGATE_TEX = loadTex('/textures/concrete-fine-aggregate.png');
const CONCRETE_PRECAST_TEX = loadTex('/textures/concrete-smooth-precast.png');
const STAIRS_TEX = loadTex('/textures/stairs-down.png');

/** Region key: a biome, or 'tunnel' for connections carved through void */
type RegionKey = BiomeType | 'tunnel';

const REGION_TINTS: Record<RegionKey, number> = {
  dungeon: 0xffffff,
  cave: 0xd8b494, // warm earth
  crypt: 0x9fb4cc, // cold blue-grey
  ember: 0x8a827c, // darkened neutral stone — the heat lives in the fog now
  outside: 0xaec8d8, // moonlit stone
  tunnel: 0xb8b0a8, // drab passage
};

// Per-region self-illumination (currently none; ember's red moved to fog)
const REGION_EMISSIVE: Partial<Record<RegionKey, number>> = {};

/** REGION_TINTS unpacked to linear-ish RGB triplets for vertex colors. */
const TINT_RGB: Record<RegionKey, [number, number, number]> = Object.fromEntries(
  Object.entries(REGION_TINTS).map(([k, hex]) => {
    const c = new THREE.Color(hex);
    return [k, [c.r, c.g, c.b]];
  }),
) as Record<RegionKey, [number, number, number]>;

const smooth01 = (t: number): number => t * t * (3 - 2 * t);

/**
 * Standard-lit concrete with three albedo layers mixed by the geometry's
 * `splatWeight` RGB attribute. Offsetting and scaling the secondary samples
 * prevents their features from lining up with the base texture's repetition.
 */
function makeConcreteMaterial(
  tint: number,
  emissive: number,
  roughness: number,
  constructionSeams = false,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: CONCRETE_CLEAN_TEX,
    // The albedo doubles as its own bump map (the synthcity trick):
    // brightness variation in the concrete reads as aggregate/formwork
    // relief under the point lights. Derivative-based, no tangents
    // needed — this is NOT the parked normal-map work.
    bumpMap: CONCRETE_CLEAN_TEX,
    bumpScale: 0.6,
    color: tint,
    emissive,
    roughness,
    side: THREE.FrontSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms['concreteAggregate'] = { value: CONCRETE_AGGREGATE_TEX };
    shader.uniforms['concretePrecast'] = { value: CONCRETE_PRECAST_TEX };
    shader.uniforms['constructionSeams'] = { value: constructionSeams ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 splatWeight;
varying vec3 vSplatWeight;
varying vec3 vConcretePosition;
varying vec3 vConcreteNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSplatWeight = splatWeight;
vConcretePosition = position;
vConcreteNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSplatWeight;
varying vec3 vConcretePosition;
varying vec3 vConcreteNormal;
uniform sampler2D concreteAggregate;
uniform sampler2D concretePrecast;
uniform float constructionSeams;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 weights = max(vSplatWeight, vec3(0.001));
          weights /= weights.r + weights.g + weights.b;
          vec4 cleanSample = texture2D(map, vMapUv);
          vec4 aggregateSample = texture2D(concreteAggregate, vMapUv * 0.83 + vec2(0.173, 0.319));
          vec4 precastSample = texture2D(concretePrecast, vMapUv * 1.17 + vec2(0.437, 0.113));
          diffuseColor *= cleanSample * weights.r
            + aggregateSample * weights.g
            + precastSample * weights.b;

          // Large staggered formwork panels are anchored in structure space,
          // not texture UVs, so joints continue across generated tile edges.
          if (constructionSeams > 0.5) {
            vec3 axisWeight = abs(normalize(vConcreteNormal));
            float wallU = axisWeight.x > axisWeight.z
              ? vConcretePosition.z
              : vConcretePosition.x;
            float wallV = vConcretePosition.y;
            float panelHeight = 6.0;
            float panelWidth = 12.0;
            float row = floor(wallV / panelHeight);
            float stagger = mod(row, 2.0) * panelWidth * 0.5;
            vec2 panelCell = vec2(
              mod(wallU + stagger, panelWidth),
              mod(wallV, panelHeight)
            );
            vec2 edgeDistance = min(
              panelCell,
              vec2(panelWidth, panelHeight) - panelCell
            );
            // Distance LOD: fine joints up close, broader silhouettes far
            // away. Screen-space derivatives provide a minimum filtered
            // width so distant seams do not flicker between pixels.
            float cameraDistance = length(vViewPosition);
            float lodWidth = mix(
              0.035,
              0.075,
              smoothstep(10.0, 90.0, cameraDistance)
            );
            float pixelWidth = max(fwidth(wallU), fwidth(wallV));
            float jointWidth = max(lodWidth, pixelWidth * 0.35);
            float jointFeather = max(0.02, pixelWidth * 0.55);
            float verticalJoint = 1.0 - smoothstep(
              jointWidth,
              jointWidth + jointFeather,
              edgeDistance.x
            );
            float horizontalJoint = 1.0 - smoothstep(
              jointWidth,
              jointWidth + jointFeather,
              edgeDistance.y
            );
            float joint = max(verticalJoint, horizontalJoint);
            diffuseColor.rgb *= mix(1.0, 0.76, joint);
          }

        #endif`,
      );
  };
  material.customProgramCacheKey = () =>
    constructionSeams ? 'rgb-concrete-splat-seams-v2' : 'rgb-concrete-splat-v2';
  return material;
}

/** MINIMUM sky-clip altitude for canyon walls in open-sky spans. The
 *  megastructure has no uniform ceiling: the real clip is derived per
 *  build from the tallest structure actually present (supertowers push
 *  it up), never below this floor value. */
const RENDER_SKY_TOP_MIN = 300;
/** Clearance above the tallest crown before the sky clip */
const RENDER_SKY_MARGIN = 300;
/** How deep a bottomless pit's walls render below the lowest level */
const RENDER_ABYSS_DROP = 300;

interface MeshBuffers {
  verts: number[];
  idxs: number[];
  uvs: number[];
  norms: number[];
}

function newBuffers(): MeshBuffers {
  return { verts: [], idxs: [], uvs: [], norms: [] };
}

interface RegionBuffers {
  floor: MeshBuffers;
  ceil: MeshBuffers;
}

interface RegionMaterials {
  wall: THREE.Material;
  floor: THREE.Material;
  ceil: THREE.Material;
}

interface Marker {
  mesh: THREE.Mesh;
  baseY: number; // local to the level group
}

interface RenderBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** One render slice of a window: geometry builds lazily inside the disc
 *  and un-builds (reversibly) outside the evict ring. */
interface RenderSlice {
  bounds: RenderBounds;
  group: THREE.Group;
  built: boolean;
}

export interface PreparedDungeonRender {
  group: THREE.Group;
  world: WorldData;
  cancelled: boolean;
  /** Per-slice lazy registry + the derived fields needed to build more
   *  slices after install. */
  slices: RenderSlice[];
  cornerFloors: number[][][];
  contours: ReturnType<typeof buildOrganicContour>[];
}

// ── DISC STREAMING ──
// Meshes exist only within a disc around the player. The camera far plane
// is 160 and fog is solved to seal just inside it, so geometry beyond
// far + one pillar cell of padding can never be seen. Build radius adds
// the pad; the evict ring adds hysteresis so walking a boundary doesn't
// thrash build/dispose. Physics reads columns, never meshes — an unbuilt
// slice is invisible, not intangible.
const DISC_BUILD_RADIUS = 216; // far(160) + 56 pad
const DISC_EVICT_RADIUS = 288; // + one more pillar cell of hysteresis
const DISC_BUILD_BUDGET = 1; // one slice (~9ms) per frame — spikes stay under a 60fps budget

export class DungeonRenderer {
  private scene: THREE.Scene;
  private meshGroup: THREE.Group;
  /** Active window's lazy slice registry (null = full-build mode, e.g.
   *  the headless debug tools). */
  private activeSlices: RenderSlice[] | null = null;
  private activeWorld: WorldData | null = null;
  private activeCornerFloors: number[][][] = [];
  private activeContours: ReturnType<typeof buildOrganicContour>[] = [];
  /** Materials and their compiled shader programs are window-independent.
   * Keeping them alive avoids a shader-compilation stall at every recenter. */
  private materials = new Map<RegionKey, RegionMaterials>();
  /** World being built — read by the per-vertex tint sampler in addMesh. */
  private tintWorld: WorldData | null = null;
  private stairsMaterial = new THREE.MeshStandardMaterial({
    map: STAIRS_TEX,
    roughness: 0.7,
    emissive: 0x1a3a2a,
    emissiveIntensity: 0.15,
    side: THREE.FrontSide,
  });
  private markers: Marker[] = [];
  private markerTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
  }

  clear(): void {
    // Geometry belongs to a generated window. Materials and textures do not:
    // retaining them keeps WebGL shader programs warm across window swaps.
    this.meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
    this.meshGroup.clear();
    this.markers = [];
    this.activeSlices = null;
    this.activeWorld = null;
    this.activeCornerFloors = [];
    this.activeContours = [];
  }

  /** Distance (wu) from a point to a slice's tile rect. */
  private static sliceDistance(b: RenderBounds, x: number, z: number): number {
    const minX = b.x0 * TILE_SIZE;
    const maxX = b.x1 * TILE_SIZE;
    const minZ = b.z0 * TILE_SIZE;
    const maxZ = b.z1 * TILE_SIZE;
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
    return Math.hypot(dx, dz);
  }

  private static makeSlices(world: WorldData, parent: THREE.Group): RenderSlice[] {
    const slices = 8;
    const width = world.levels[0]!.width;
    const sliceTiles = Math.ceil(width / slices);
    const out: RenderSlice[] = [];
    for (let cz = 0; cz < slices; cz++) {
      for (let cx = 0; cx < slices; cx++) {
        const group = new THREE.Group();
        parent.add(group);
        out.push({
          bounds: {
            x0: cx * sliceTiles,
            z0: cz * sliceTiles,
            x1: Math.min((cx + 1) * sliceTiles, width),
            z1: Math.min((cz + 1) * sliceTiles, width),
          },
          group,
          built: false,
        });
      }
    }
    return out;
  }

  private buildSlice(
    world: WorldData,
    cornerFloors: number[][][],
    contours: ReturnType<typeof buildOrganicContour>[],
    slice: RenderSlice,
  ): void {
    if (slice.built) return;
    this.tintWorld = world;
    for (let li = 0; li < world.levels.length; li++) {
      this.buildLevelSurfaces(world, li, cornerFloors[li]!, contours[li]!, this.materialsFor, slice.group, slice.bounds);
    }
    this.buildWalls(world, cornerFloors, contours, this.materialsFor, slice.group, slice.bounds);
    slice.built = true;
  }

  private unbuildSlice(slice: RenderSlice): void {
    if (!slice.built) return;
    slice.group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    });
    slice.group.clear();
    slice.built = false;
    if (import.meta.env?.DEV) {
      console.debug(`[disc] evicted slice (${slice.bounds.x0},${slice.bounds.z0})`);
    }
  }

  /**
   * DISC STREAMING update: build the nearest missing slices inside the
   * build radius (bounded per call), un-build slices outside the evict
   * ring. No-op in full-build mode. Call every frame with the player.
   */
  updateDisc(x: number, z: number): void {
    const slices = this.activeSlices;
    const world = this.activeWorld;
    if (!slices || !world) return;
    let budget = DISC_BUILD_BUDGET;
    const candidates: { slice: RenderSlice; d: number }[] = [];
    for (const slice of slices) {
      const d = DungeonRenderer.sliceDistance(slice.bounds, x, z);
      if (!slice.built && d <= DISC_BUILD_RADIUS) candidates.push({ slice, d });
      else if (slice.built && d > DISC_EVICT_RADIUS) this.unbuildSlice(slice);
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (budget-- <= 0) break;
      this.buildSlice(world, this.activeCornerFloors, this.activeContours, c.slice);
      if (import.meta.env?.DEV) {
        const built = slices.filter((sl) => sl.built).length;
        console.debug(`[disc] built slice (${c.slice.bounds.x0},${c.slice.bounds.z0}) — ${built}/${slices.length} meshed`);
      }
    }
  }

  /** Disc state for debug displays: which slices currently carry meshes. */
  getDiscState(): { bounds: { x0: number; z0: number; x1: number; z1: number }; built: boolean }[] {
    return (this.activeSlices ?? []).map((s2) => ({ bounds: s2.bounds, built: s2.built }));
  }

  /** Animate the exit marker (slow spin + bob). Call every frame. */
  update(dt: number): void {
    if (this.markers.length === 0) return;
    this.markerTime += dt;
    for (const m of this.markers) {
      m.mesh.rotation.y += dt * 1.2;
      m.mesh.position.y = m.baseY + Math.sin(this.markerTime * 2) * 0.15;
    }
  }

  private materialsFor = (key: RegionKey): RegionMaterials => {
    let m = this.materials.get(key);
    if (!m) {
      // Tint now arrives per-vertex (smoothly blended across biome
      // boundaries by addMesh); the material itself stays white.
      const emissive = REGION_EMISSIVE[key] ?? 0x000000;
      m = {
        wall: makeConcreteMaterial(0xffffff, emissive, 0.9, true),
        floor: makeConcreteMaterial(0xffffff, emissive, 0.94),
        ceil: makeConcreteMaterial(0xffffff, emissive, 0.97),
      };
      this.materials.set(key, m);
    }
    return m;
  };

  /**
   * Build the whole stack. Horizontal surfaces (floors, ceilings) come
   * from each level's height fields, gated by the column model; ALL
   * vertical faces are derived in one pass from span differences between
   * adjacent columns — a face exists exactly where air meets solid.
   */
  build(world: WorldData): void {
    this.tintWorld = world;
    const cornerFloors = world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0, l.pillarGround));

    // One contour per level: the marching-squares line is the single
    // authority on organic wall SHAPE — collision segments and the
    // chamfered wall quads both come from it
    const contours = world.levels.map((l) => buildOrganicContour(l));

    for (let li = 0; li < world.levels.length; li++) {
      this.buildLevelSurfaces(world, li, cornerFloors[li]!, contours[li]!, this.materialsFor, this.meshGroup);
    }
    this.buildWalls(world, cornerFloors, contours, this.materialsFor, this.meshGroup);
    this.buildPipeChamfers(world, this.meshGroup);
  }

  /** Build a neighboring window in pillar-cell-sized slices. Each slice
   * yields to the browser, keeping mesh preparation out of the movement
   * frame that crosses a streaming boundary. */
  prepare(
    world: WorldData,
    onReady: (prepared: PreparedDungeonRender) => void,
    /** Which edge the player will enter from, as the neighbor's offset
     *  from the current window (dx, dz in pillar-window steps). Only the
     *  entry band builds ahead of time; the rest builds lazily from the
     *  disc update after install. */
    entryEdge?: { dx: number; dz: number },
  ): PreparedDungeonRender {
    this.tintWorld = world;
    const group = new THREE.Group();
    const cornerFloors = world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0, l.pillarGround));
    const contours = world.levels.map((l) => buildOrganicContour(l));
    const slices = DungeonRenderer.makeSlices(world, group);
    const prepared: PreparedDungeonRender = {
      group, world, cancelled: false, slices, cornerFloors, contours,
    };
    // Chamfers span slices; build them exactly ONCE per window. (The old
    // per-slice call duplicated every chamfer strip 64x.)
    this.buildPipeChamfers(world, group);

    // Entry band: slices within the disc radius of the edge the player
    // crosses. Without a known edge (shouldn't happen), prepare all.
    const widthWu = world.levels[0]!.width * TILE_SIZE;
    const edgeDistance = (b: RenderBounds): number => {
      if (!entryEdge) return 0;
      if (entryEdge.dx > 0) return b.x0 * TILE_SIZE; // entering from west edge
      if (entryEdge.dx < 0) return widthWu - b.x1 * TILE_SIZE; // east edge
      if (entryEdge.dz > 0) return b.z0 * TILE_SIZE; // north edge
      if (entryEdge.dz < 0) return widthWu - b.z1 * TILE_SIZE; // south edge
      return 0;
    };
    const jobs = slices
      .filter((slice) => edgeDistance(slice.bounds) <= DISC_BUILD_RADIUS)
      .sort((a, b) => edgeDistance(a.bounds) - edgeDistance(b.bounds));
    const runNext = (): void => {
      if (prepared.cancelled) return;
      const slice = jobs.shift();
      if (!slice) {
        onReady(prepared);
        return;
      }
      this.buildSlice(world, cornerFloors, contours, slice);
      requestAnimationFrame(runNext);
    };
    requestAnimationFrame(runNext);
    return prepared;
  }

  install(prepared: PreparedDungeonRender): void {
    this.clear();
    this.meshGroup.add(prepared.group);
    this.activeSlices = prepared.slices;
    this.activeWorld = prepared.world;
    this.activeCornerFloors = prepared.cornerFloors;
    this.activeContours = prepared.contours;
    this.tintWorld = prepared.world;
  }

  /**
   * Disc-streamed synchronous build (the engine's window path): create
   * the lazy slice registry and build only the disc around (px, pz).
   * The full build() below remains for headless tools, which must see
   * every triangle.
   */
  buildActive(world: WorldData, px: number, pz: number): void {
    this.tintWorld = world;
    const cornerFloors = world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0, l.pillarGround));
    const contours = world.levels.map((l) => buildOrganicContour(l));
    const windowGroup = new THREE.Group();
    this.meshGroup.add(windowGroup);
    const slices = DungeonRenderer.makeSlices(world, windowGroup);
    this.buildPipeChamfers(world, windowGroup);
    this.activeSlices = slices;
    this.activeWorld = world;
    this.activeCornerFloors = cornerFloors;
    this.activeContours = contours;
    // Initial fill is synchronous — this replaces what was a whole-window
    // build, and the disc is ~1/3 of the window's area.
    for (const slice of slices) {
      if (DungeonRenderer.sliceDistance(slice.bounds, px, pz) <= DISC_BUILD_RADIUS) {
        this.buildSlice(world, cornerFloors, contours, slice);
      }
    }
  }

  /** Floors, ceilings, aprons, stairs and markers of one level —
   *  everything horizontal. ALL vertical surface lives in buildWalls. */
  private buildLevelSurfaces(
    world: WorldData,
    li: number,
    cornerFloor: number[][],
    contour: ReturnType<typeof buildOrganicContour>,
    materialsFor: (key: RegionKey) => RegionMaterials,
    target: THREE.Group,
    bounds?: RenderBounds,
  ): void {
    const dungeon = world.levels[li]!;
    const w = dungeon.width;

    const group = new THREE.Group();
    group.position.y = dungeon.baseY;
    target.add(group);

    const regionOf = (tx: number, tz: number): RegionKey =>
      tileBiome(dungeon.cellBiomes, tx, tz) ?? 'tunnel';

    const regions = new Map<RegionKey, RegionBuffers>();
    const regionBuffers = (key: RegionKey): RegionBuffers => {
      let b = regions.get(key);
      if (!b) {
        b = { floor: newBuffers(), ceil: newBuffers() };
        regions.set(key, b);
      }
      return b;
    };
    const stairs = newBuffers();

    // Column-model gates: does this level own a floor / a ceiling here?
    const ownsFloor = (x: number, y: number): boolean =>
      world.columns[y * w + x]!.some((s) => s.owner === li);
    const ownsCeil = (x: number, y: number): boolean =>
      world.columns[y * w + x]!.some((s) => s.ceilOwner === li);

    const hasFloorNeighbor = (x: number, y: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (!isWall(dungeon, x + dx, y + dz)) return true;
        }
      }
      return false;
    };



    for (let y = bounds?.z0 ?? 0; y < (bounds?.z1 ?? dungeon.height); y++) {
      for (let x = bounds?.x0 ?? 0; x < (bounds?.x1 ?? dungeon.width); x++) {
        const tile = dungeon.tiles[y]![x]!;
        const region = regionOf(x, y);

        if (tile === TileType.Wall) {
          // Pillar footprint tiles whose ground span belongs to this
          // level draw the SAME corner-field floor as the terrain around
          // them — the rolling surface continues under the pillar, and
          // the footprint boundary is not a seam
          if (dungeon.pillarGround[y]![x] && ownsFloor(x, y)) {
            const wx = x * TILE_SIZE;
            const wz = y * TILE_SIZE;
            // Man-made surfaces are DEAD FLAT at their own slab height.
            // Corner-sampling here let adjacent stair treads (married at
            // different heights) drag each other's corners down into
            // wedges. The corner field still bends the surrounding
            // terrain up to this slab (struct dominance); the riser
            // faces between treads are emitted by the wall pass.
            const f = dungeon.floorHeights[y]![x]!;
            const fbuf = regionBuffers(region).floor;
            addHorizontalQuad(fbuf, wx, wz, f, f, f, f, true);
            // SKIRTS: a flat slab beside a corner-blended floor tile can
            // sit above the terrain's drawn edge with NO wall face — the
            // span floors match, so the wall pass emits nothing, but the
            // terrain edge slides between corner values while the slab
            // lip stays at f (the marked triangle wedges into the void).
            // Drop a quad from the slab lip down to the terrain's corner
            // edge; overshoot is buried inside terrain. Slab-vs-slab
            // needs none (both flat; differing spans get real faces).
            for (const [dx3, dz3] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx3 = x + dx3, nz3 = y + dz3;
              const nt = dungeon.tiles[nz3]?.[nx3];
              if (nt === undefined) continue;
              if (dungeon.pillarGround[nz3]![nx3]) continue;
              if (nt === TileType.Wall) continue;
              // shared-edge corner values on the neighbor's blended edge
              const cA = dx3 !== 0
                ? cornerFloor[y]![dx3 === 1 ? x + 1 : x]!
                : cornerFloor[dz3 === 1 ? y + 1 : y]![x]!;
              const cB = dx3 !== 0
                ? cornerFloor[y + 1]![dx3 === 1 ? x + 1 : x]!
                : cornerFloor[dz3 === 1 ? y + 1 : y]![x + 1]!;
              if (f - Math.min(cA, cB) < 0.02) continue;
              const ex = dx3 === 1 ? wx + TILE_SIZE : wx;
              const ez = dz3 === 1 ? wz + TILE_SIZE : wz;
              const vi = fbuf.verts.length / 3;
              if (dx3 !== 0) {
                fbuf.verts.push(ex, f, wz, ex, f, wz + TILE_SIZE,
                  ex, Math.min(cB, f), wz + TILE_SIZE, ex, Math.min(cA, f), wz);
              } else {
                fbuf.verts.push(wx, f, ez, wx + TILE_SIZE, f, ez,
                  wx + TILE_SIZE, Math.min(cB, f), ez, wx, Math.min(cA, f), ez);
              }
              // World-anchored v like every wall face — a 0..1 v over a
              // half-unit skirt smears the texture into streaks
              const bB = Math.min(cB, f), bA = Math.min(cA, f);
              fbuf.uvs.push(0, f / TILE_SIZE, 1, f / TILE_SIZE,
                1, bB / TILE_SIZE, 0, bA / TILE_SIZE);
              const nnx = dx3, nnz = dz3; // face the neighbor (air side)
              for (let q = 0; q < 4; q++) fbuf.norms.push(nnx, 0, nnz);
              addOrientedQuad(fbuf, vi, nnx, 0, nnz);
            }
            continue;
          }
          // Pillar tiles never take the wall-cap path: their ceilings
          // are span-derived rock; a stray cap plate floats inside the
          // band, and overlapping same-height caps z-fight
          if (dungeon.pillarWall[y]![x]) continue;
          if (hasFloorNeighbor(x, y)) {
            const wx = x * TILE_SIZE;
            const wz = y * TILE_SIZE;
            const buf = regionBuffers(region);
            const soft = contour.softWalls.has(y * w + x);
            // Contoured wall tiles get "apron" floor quads behind the
            // chamfers — without them every chamfer pocket is a hole
            if (soft) {
              const ap = (v: number): number => Math.max(v, -3);
              addHorizontalQuad(buf.floor, wx, wz, ap(cornerFloor[y]![x]!), ap(cornerFloor[y]![x + 1]!), ap(cornerFloor[y + 1]![x]!), ap(cornerFloor[y + 1]![x + 1]!), true);
            }
            // THE ROOF CRASHES THROUGH THE COLUMN, never the other way:
            // the cap over a wall tile continues the roof at its natural
            // interpolated height — the AVERAGE of the adjacent room
            // ceilings. Sight-lines can never reach above a room's own
            // ceiling at a boundary (the room's ceiling quad blocks
            // first) and chamfer diagonals rise to the max, so any cap
            // at or above the local minimum is sealed; the average keeps
            // the visible dip/rise within half the local variation, so
            // the roof reads as continuous THROUGH the column. Not under
            // open sky — that's the sky-clip roof plane's job.
            // Per-NEIGHBOR gating, not per-tile: a wall straddling the
            // outside boundary sits in an outside cell but faces cave
            // rooms — it still needs its cap toward them. Only interior
            // neighbors contribute (outside "ceilings" are sky-high
            // fillers that would skew the cap); walls facing only open
            // sky get no cap at all.
            {
              let sum = 0;
              let count = 0;
              let anyNonTunnel = false;
              for (let dz2 = -1; dz2 <= 1; dz2++) {
                for (let dx2 = -1; dx2 <= 1; dx2++) {
                  const t2 = dungeon.tiles[y + dz2]?.[x + dx2];
                  if (t2 === undefined || t2 === TileType.Wall) continue;
                  if (tileBiome(dungeon.cellBiomes, x + dx2, y + dz2) === 'outside') continue;
                  if (tileBiome(dungeon.cellBiomes, x + dx2, y + dz2) !== null) anyNonTunnel = true;
                  sum += dungeon.ceilingHeights[y + dz2]![x + dx2]!;
                  count++;
                }
              }
              // Wall tiles bordering ONLY tunnel corridors need no cap:
              // the corridor ceiling is uniform carved rock, the wall
              // face seals to cap height, and the mass above is solid —
              // no sightline can ever reach these quads (wireframe
              // audit: a buried strip ringing every tunnel).
              if (!anyNonTunnel) count = 0;
              // Columns with their own air spans (bridge passages carved
              // through walls) get span-derived rock ceilings — a cap on
              // top would coincide with them
              if (count > 0 && world.columns[y * w + x]!.length === 0) {
                // Overlap toward FLOOR neighbors only: the cap tucks
                // over their ceiling quads (nudged up, never coplanar —
                // the true ceiling occludes the ring from below), so the
                // junction line can't leak a hairline. Toward WALL
                // neighbors there is no expansion: the adjacent cap sits
                // at the same height and same-plane overlaps z-fight.
                // Deterministic per-tile jitter: no two caps are EVER
                // coplanar (diagonal neighbors' corner overlaps included)
                const ac = sum / count + 0.06;
                // Overlap flap per side, and ONLY toward a floor
                // neighbor whose ceiling clearly differs from the cap:
                // near-equal heights would z-fight, and a hairline
                // between near-equal surfaces is invisible anyway
                const flap = (dx2: number, dz2: number): number => {
                  const t2 = dungeon.tiles[y + dz2]?.[x + dx2];
                  if (t2 === undefined || t2 === TileType.Wall) return 0;
                  // NEVER flap into open sky: there is no ceiling out
                  // there for the overlap to hide under, so the plate
                  // juts out of the cliff face as a slab of "cave roof"
                  // hanging in the outside biome
                  if (tileBiome(dungeon.cellBiomes, x + dx2, y + dz2) === 'outside') return 0;
                  // The flap exists to hide the HAIRLINE where the cap
                  // meets a neighbouring ceiling of nearly the same
                  // height. Too close and they z-fight; too far apart
                  // and there is no seam to hide — the boundary face
                  // seals that step already, and the flap becomes a
                  // shelf sticking out of the wall in mid-air.
                  const nc = dungeon.ceilingHeights[y + dz2]![x + dx2]!;
                  const gap = Math.abs(nc - ac);
                  return gap > 0.15 && gap < 1.0 ? 0.45 : 0;
                };
                // Center + side strips: strips never reach the corner
                // squares, whose diagonal neighbors may hold a ceiling
                // at yet another height
                addCeilPatch(buf.ceil, wx, wz, wx + TILE_SIZE, wz + TILE_SIZE, ac);
                const fw = flap(-1, 0), fe = flap(1, 0), fn = flap(0, -1), fs = flap(0, 1);
                if (fw > 0) addCeilPatch(buf.ceil, wx - fw, wz, wx, wz + TILE_SIZE, ac);
                if (fe > 0) addCeilPatch(buf.ceil, wx + TILE_SIZE, wz, wx + TILE_SIZE + fe, wz + TILE_SIZE, ac);
                if (fn > 0) addCeilPatch(buf.ceil, wx, wz - fn, wx + TILE_SIZE, wz, ac);
                if (fs > 0) addCeilPatch(buf.ceil, wx, wz + TILE_SIZE, wx + TILE_SIZE, wz + TILE_SIZE + fs, ac);
              }
            }
          }
          continue;
        }

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;
        const buf = regionBuffers(region);

        if (ownsFloor(x, y)) {
          const floorBuf = tile === TileType.StairsDown ? stairs : buf.floor;
          // Pit-rim tiles need no extra tessellation: the corner field is
          // pure bilinear and pit dominance clamps rim corners flat to
          // grade, so a plain quad is exactly as faithful here as on any
          // other tile. (The 4x4 subdivision was a wireframe-visible
          // waste ringing every pit.)
          addHorizontalQuad(
            floorBuf, wx, wz,
            cornerFloor[y]![x]!, cornerFloor[y]![x + 1]!,
            cornerFloor[y + 1]![x]!, cornerFloor[y + 1]![x + 1]!,
            true,
          );
        }
        if (ownsCeil(x, y)) {
          const tc = dungeon.ceilingHeights[y]![x]!;
          addHorizontalQuad(buf.ceil, wx, wz, tc, tc, tc, tc, false);
        }
      }
    }

    for (const [key, buf] of regions) {
      const mats = materialsFor(key);
      this.addMesh(group, buf.floor, mats.floor);
      this.addMesh(group, buf.ceil, mats.ceil);
    }

    if (stairs.verts.length > 0) {
      this.addMesh(group, stairs, this.stairsMaterial);
    }

  }

  /**
   * ALL vertical faces, in one pass, from the column model: for every
   * pair of adjacent columns, every Y-range where exactly one side is air
   * gets a wall face. Gaps are unrepresentable — if air touches solid,
   * the face is here. Face bounds that coincide with a span's floor or
   * ceiling snap to the smooth corner-field surface, so cliff rims and
   * rolling terrain seal exactly against their walls.
   */
  private buildWalls(
    world: WorldData,
    cornerFloors: number[][][],
    contours: ReturnType<typeof buildOrganicContour>[],
    materialsFor: (key: RegionKey) => RegionMaterials,
    target: THREE.Group,
    bounds?: RenderBounds,
  ): void {
    const w = world.levels[0]!.width;
    const h = world.levels[0]!.height;
    // Clips derive from what was BUILT: the sky plane sits above the
    // tallest crown in this window, the abyss below the deepest well
    let tallest = 0;
    let deepest = 0;
    for (const spec of world.pillars.values()) {
      tallest = Math.max(tallest, spec.totalHeight);
      deepest = Math.min(deepest, spec.baseDepth);
    }
    const skyTop = Math.max(RENDER_SKY_TOP_MIN, tallest + 4 + RENDER_SKY_MARGIN);
    const worldBottom = Math.min(
      world.levels[world.levels.length - 1]!.baseY - RENDER_ABYSS_DROP,
      deepest - RENDER_ABYSS_DROP,
    );

    const group = new THREE.Group();
    target.add(group);

    const buffers = new Map<RegionKey, MeshBuffers>();
    const rockFloors = newBuffers();
    const bufferFor = (key: RegionKey): MeshBuffers => {
      let b = buffers.get(key);
      if (!b) {
        b = newBuffers();
        buffers.set(key, b);
      }
      return b;
    };

    const clipY = (y: number): number =>
      y >= SKY_CEIL ? skyTop : (y <= ABYSS_FLOOR ? worldBottom : y);

    /** World-space height of a face bound at a grid corner. A bound that
     *  EQUALS a span's clipped floor/ceiling IS that surface — the cut
     *  list is built from these exact values — so it takes the surface's
     *  corner-field height unconditionally. (A distance tolerance breaks
     *  on rugged terrain: tile value and corner value can differ by more
     *  than any fixed window, and when snapping succeeds on one face but
     *  fails on its neighbor, their shared edge tears open a slit.) */
    const refine = (
      y: number,
      spansA: ColumnSpan[], spansB: ColumnSpan[],
      cx: number, cz: number,
    ): number => {
      for (const spans of [spansA, spansB]) {
        for (const s of spans) {
          if (s.owner >= 0 && Math.abs(clipY(s.floor) - y) < 0.02) {
            const v = cornerFloors[s.owner]![cz]?.[cx];
            if (v !== undefined && v > PIT_LEVEL) return world.levels[s.owner]!.baseY + v;
          }
          // Ceiling bounds stay at the exact cut value — ceilings render
          // flat at their model height, so cut == drawn surface already.
        }
      }
      return y;
    };

    /** Region (material) for a face: the biome of the air side's owner */
    const faceRegion = (spans: ColumnSpan[], lo: number, hi: number, x: number, z: number): RegionKey => {
      for (const s of spans) {
        if (s.owner >= 0 && s.floor <= hi + 0.1 && s.ceil >= lo - 0.1) {
          return tileBiome(world.levels[s.owner]!.cellBiomes, x, z) ?? 'tunnel';
        }
      }
      return 'tunnel';
    };

    // Merge a column's spans into clipped [lo, hi] air ranges
    const airRanges = (spans: ColumnSpan[]): [number, number][] =>
      spans.map((s) => [clipY(s.floor), clipY(s.ceil)] as [number, number]);

    // ── Rock floors/ceilings and the roof plane, MERGED: flat quads at
    // identical heights along a row collapse into one strip each, and
    // roof-plane quads exist only within sight of a sky-open column —
    // a quad buried in solid rock with rock in every direction can
    // never be seen. (Wireframe audit: the per-tile version was ~130k
    // hidden or redundant triangles per window.) ──
    const reachesSkyAt = (x: number, z: number): boolean => {
      if (x < 0 || z < 0 || x >= w || z >= h) return true;
      const col = world.columns[z * w + x]!;
      return col.length > 0 && col[col.length - 1]!.ceil >= SKY_CEIL;
    };
    const nearSky = (x: number, z: number): boolean => {
      for (let dz2 = -2; dz2 <= 2; dz2++) {
        for (let dx2 = -2; dx2 <= 2; dx2++) {
          if (reachesSkyAt(x + dx2, z + dz2)) return true;
        }
      }
      return false;
    };
    // Per row: runs of (height, up/down) keyed by exact height
    type Run = { x0: number; x1: number; y: number; up: boolean };
    const flushRuns = (runs: Map<string, Run>, z: number): void => {
      for (const r of runs.values()) {
        addFlatStrip(rockFloors, r.x0 * TILE_SIZE, z * TILE_SIZE, (r.x1 + 1) * TILE_SIZE, (z + 1) * TILE_SIZE, r.y, r.up);
      }
      runs.clear();
    };
    for (let z = bounds?.z0 ?? 0; z < (bounds?.z1 ?? h); z++) {
      const open = new Map<string, Run>();
      for (let x = bounds?.x0 ?? 0; x < (bounds?.x1 ?? w); x++) {
        const a = world.columns[z * w + x]!;
        const here = new Set<string>();
        const want = (y: number, up: boolean): void => {
          const k = `${up ? 'u' : 'd'}${y}`;
          here.add(k);
          const r = open.get(k);
          if (r && r.x1 === x - 1) r.x1 = x;
          else {
            if (r) addFlatStrip(rockFloors, r.x0 * TILE_SIZE, z * TILE_SIZE, (r.x1 + 1) * TILE_SIZE, (z + 1) * TILE_SIZE, r.y, r.up);
            open.set(k, { x0: x, x1: x, y, up });
          }
        };
        for (const s of a) {
          if (s.owner === -1 && s.floor > ABYSS_FLOOR) want(s.floor, true);
          if (s.ceilOwner === -1 && s.ceil < SKY_CEIL) want(s.ceil, false);
        }
        // The world's top plane is WATERTIGHT where it can be seen:
        // every column within sight of sky either opens to it or carries
        // a roof slab at the clip height.
        if (!reachesSkyAt(x, z) && nearSky(x, z)) want(skyTop, true);
        // Runs whose height vanished at this column flush now
        for (const [k, r] of open) {
          if (!here.has(k) && r.x1 < x) {
            addFlatStrip(rockFloors, r.x0 * TILE_SIZE, z * TILE_SIZE, (r.x1 + 1) * TILE_SIZE, (z + 1) * TILE_SIZE, r.y, r.up);
            open.delete(k);
          }
        }

        // Two directed boundaries per column (east, south) — plus the
        // west/north edges of the map itself, which no pair loop visits
        const sides: [number, number][] = [[1, 0], [0, 1]];
        if (x === 0) sides.push([-1, 0]);
        if (z === 0) sides.push([0, -1]);
        for (const [dx, dz] of sides) {
          const nx = x + dx;
          const nz = z + dz;
          const b = nx >= 0 && nz >= 0 && nx < w && nz < h ? world.columns[nz * w + nx]! : [];

          const ra = airRanges(a);
          const rb = airRanges(b);
          // XOR sweep over breakpoints
          const cuts = [...ra.flat(), ...rb.flat()].sort((p, q) => p - q);
          for (let i = 0; i + 1 < cuts.length; i++) {
            const lo = cuts[i]!;
            const hi = cuts[i + 1]!;
            if (hi - lo < 0.02) continue;
            const mid = (lo + hi) / 2;
            const inA = ra.some(([f, c]) => f <= mid && mid <= c);
            const inB = rb.some(([f, c]) => f <= mid && mid <= c);
            if (inA === inB) continue; // both air (open) or both solid

            const airSpans = inA ? a : b;
            const otherSpans = inA ? b : a;
            // The nearest breakpoint above this segment: face overshoot
            // and transoms must stop there — another face occupies the
            // plane beyond it, and coplanar overlap in a different
            // buffer z-fights
            let nextCut = Infinity;
            for (const c of cuts) {
              if (c > hi + 0.02 && c < nextCut) nextCut = c;
            }
            const extLimit = Math.max(0, Math.min(1.0, nextCut - hi));
            // shared edge corners per side: east (x+1,z)-(x+1,z+1),
            // west (x,z)-(x,z+1), south (x,z+1)-(x+1,z+1), north (x,z)-(x+1,z)
            const c0 = dx !== 0
              ? { cx: dx === 1 ? x + 1 : x, cz: z }
              : { cx: x, cz: dz === 1 ? z + 1 : z };
            const c1 = dx !== 0
              ? { cx: dx === 1 ? x + 1 : x, cz: z + 1 }
              : { cx: x + 1, cz: dz === 1 ? z + 1 : z };
            let lo0 = refine(lo, airSpans, otherSpans, c0.cx, c0.cz);
            let lo1 = refine(lo, airSpans, otherSpans, c1.cx, c1.cz);
            let hi0 = refine(hi, airSpans, otherSpans, c0.cx, c0.cz);
            let hi1 = refine(hi, airSpans, otherSpans, c1.cx, c1.cz);
            // REFINEMENT MUST NEVER COLLAPSE A REAL STEP. Both bounds of
            // a segment can snap to the SAME shared corner value — two
            // foundation tiles at different heights (a pit rim dipping
            // beside a pillar) average at their shared corner to a value
            // neither surface passes through. The face then has zero
            // height, gets skipped, and the step is left as a
            // wedge-shaped hole. Fall back to the raw span bounds there;
            // any overshoot is buried under the floor or inside solid.
            // ...but ONLY where a FLAT structural surface is involved.
            // When both sides are corner-blended they really are
            // continuous at the shared corners, and forcing the raw
            // bounds stands a fin proud of the floor.
            const spanAtFloor = (sp: ColumnSpan[], y: number): ColumnSpan | undefined =>
              sp.find((s2) => Math.abs(clipY(s2.floor) - y) < 0.02);
            const sLo = spanAtFloor(airSpans, lo) ?? spanAtFloor(otherSpans, lo);
            const sHi = spanAtFloor(airSpans, hi) ?? spanAtFloor(otherSpans, hi);
            const flatInvolved = (sLo !== undefined && sLo.owner < 0)
              || (sHi !== undefined && sHi.owner < 0);
            // Married PILLAR surfaces are structural too: they carry
            // owner 0 so they blend at the footprint edge, but they are
            // DOMINANT in the corner field, so their corners already sit
            // at the slab height and raw bounds cannot stand a fin proud
            // of them. Without this every stair riser — a 0.6 step
            // between two married treads — averages at its shared corner
            // to a value neither tread passes through, both halves
            // collapse, and the face vanishes into a see-through slit.
            // Only true terrain-to-terrain joints are safe to let go.
            const pg = world.levels[0]!.pillarGround;
            // ...and married floors DRAW dead flat at their span heights,
            // so any face bound that belongs to a SLAB surface must stay
            // at the raw span value — a corner-refined edge dips below
            // the flat lip and opens a triangle wedge. But ONLY the slab
            // side: a corner-blended terrain surface descending to marry
            // a lower slab really does close the step, and forcing its
            // bound too stands the face proud of the ground as a lip.
            const floorIsSlab = (tx3: number, tz3: number, yv: number): boolean =>
              pg[tz3]?.[tx3] === true
              && world.columns[tz3 * w + tx3]!.some((s2) => Math.abs(clipY(s2.floor) - yv) < 0.02);
            if (floorIsSlab(x, z, hi) || floorIsSlab(nx, nz, hi)) {
              hi0 = Math.max(hi0, hi); hi1 = Math.max(hi1, hi);
            }
            if (floorIsSlab(x, z, lo) || floorIsSlab(nx, nz, lo)) {
              lo0 = Math.min(lo0, lo); lo1 = Math.min(lo1, lo);
            }
            if (flatInvolved) {
              if (hi0 - lo0 < 0.02) { lo0 = Math.min(lo0, lo); hi0 = Math.max(hi0, hi); }
              if (hi1 - lo1 < 0.02) { lo1 = Math.min(lo1, lo); hi1 = Math.max(hi1, hi); }
            }
            if (hi0 - lo0 < 0.02 && hi1 - lo1 < 0.02) continue;

            const airX = inA ? x : nx;
            const airZ = inA ? z : nz;
            const solidX = inA ? nx : x;
            const solidZ = inA ? nz : z;

            const region = faceRegion(airSpans, lo, hi, airX, airZ);
            const buf = bufferFor(region);
            const ex0 = c0.cx * TILE_SIZE;
            const ez0 = c0.cz * TILE_SIZE;
            const ex1 = c1.cx * TILE_SIZE;
            const ez1 = c1.cz * TILE_SIZE;
            // normal toward the air side
            const nrmX = dx === 0 ? 0 : (dx === 1 ? (inA ? -1 : 1) : (inA ? 1 : -1));
            const nrmZ = dz === 0 ? 0 : (dz === 1 ? (inA ? -1 : 1) : (inA ? 1 : -1));
            const lerp = (p: number, q: number, t: number): number => p + (q - p) * t;

            // At the TOP segment of a soft-wall boundary, EVERY half of
            // the face rises to the shared pocket cap (set below) — a
            // flat half stopping at its own room ceiling leaves the band
            // up to the cap wide open into the undrawn pocket void.
            let topOverride: number | null = null;

            const emitFlat = (s0: number, s1: number): void => {
              // Wall-top segments overshoot INTO the solid (clamped at
              // the next breakpoint): the column passes through the
              // ceiling plane, so the junction has face material behind
              // it and T-junction hairlines have nothing to leak into
              const ext = topOverride !== null ? extLimit : 0;
              const t0 = lerp(hi0, hi1, s0) + ext;
              const t1 = lerp(hi0, hi1, s1) + ext;
              const vi = buf.verts.length / 3;
              buf.verts.push(
                lerp(ex0, ex1, s0), lerp(lo0, lo1, s0), lerp(ez0, ez1, s0),
                lerp(ex0, ex1, s1), lerp(lo0, lo1, s1), lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s1), t1, lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s0), t0, lerp(ez0, ez1, s0),
              );
              for (let k = 0; k < 4; k++) buf.norms.push(nrmX, 0, nrmZ);
              buf.uvs.push(
                s0, lerp(lo0, lo1, s0) / TILE_SIZE,
                s1, lerp(lo0, lo1, s1) / TILE_SIZE,
                s1, t1 / TILE_SIZE,
                s0, t0 / TILE_SIZE,
              );
              addOrientedQuad(buf, vi, nrmX, 0, nrmZ);
            };

            // ── ONE WALL SYSTEM: where the solid side is a CONTOURED wall
            // OF THE LEVEL THAT OWNS THIS AIR, the corner half swings onto
            // the marching-squares diagonal — the drawn wall IS the
            // collision line, in its exact plane. The matching half comes
            // from the perpendicular boundary at the same corner; their
            // shared edge uses the same grid-corner heights, so they seam
            // exactly. Owner-matching is the load-bearing rule: a level's
            // contour chamfers only its own interior. Chamfering some
            // OTHER band's range at the same boundary (a pit collar under
            // a level-1 cave wall) displaces that face off the boundary
            // plane its floors seal against, tearing slivers. ──
            let chamferLc = -1;
            let airSpanTop = hi;
            let airIsSky = false;
            let airTopKnown = false;
            const solidIn = solidX >= 0 && solidZ >= 0 && solidX < w && solidZ < h;
            if (solidIn) {
              let airOwner = -1;
              for (const s of airSpans) {
                if (mid >= clipY(s.floor) && mid <= clipY(s.ceil)) {
                  airOwner = s.owner;
                  airSpanTop = clipY(s.ceil);
                  airIsSky = s.ceil >= SKY_CEIL;
                  airTopKnown = true;
                  break;
                }
              }
              if (airOwner >= 0 && contours[airOwner]!.softWalls.has(solidZ * w + solidX)) {
                chamferLc = airOwner;
              }
            }

            // The shared wall cap: max of the neighboring room ceilings,
            // matching the cap quad drawn over the wall tile. At the top
            // segment, EVERY face against a wall — chamfered halves,
            // flat halves, and fully HARD walls alike — rises to this
            // plane. A wall's cap sits at the max neighbor ceiling; if a
            // face against a LOWER room stopped at that room's ceiling,
            // the band between the two planes would be open sideways — a
            // visible gap ring around every column that touches the
            // roof. (Never under open sky, and never for the massive
            // pillars — their geometry is span-derived.)
            const solidIsWall = solidIn
              && world.levels[0]!.tiles[solidZ]![solidX] === TileType.Wall;
            // PILLAR-INTERNAL boundaries (both columns in one footprint)
            // never take the override: room ceilings are meaningless up
            // on a ramp, and extending slab faces there pokes blades
            // through the plaza floors. The override exists for
            // room↔wall junctions only — and only when the air span was
            // actually identified (the default airSpanTop equals hi and
            // would pass the top-segment test vacuously).
            const pillarInternal = solidIn
              && world.levels[0]!.pillarWall[solidZ]![solidX]
              && airX >= 0 && airZ >= 0 && airX < w && airZ < h
              && world.levels[0]!.pillarWall[airZ]![airX];
            // Per-NEIGHBOR gating (see the cap): straddler walls in
            // outside cells still seal toward the interior rooms they
            // face; only interior ceilings define the override.
            // Only for wall columns that actually CARRY the cap quad —
            // bridge passages carved through walls have their own spans
            // and no cap (span-derived rock ceilings instead), so the
            // extension has nothing to meet and pokes out beside the
            // bridge deck as a floating plate.
            if (solidIsWall && !pillarInternal && airTopKnown && !airIsSky
              && world.columns[solidZ * w + solidX]!.length === 0
              && Math.abs(hi - airSpanTop) < 0.03) {
              const L = world.levels[0]!;
              let pc = -Infinity;
              for (let dz2 = -1; dz2 <= 1; dz2++) {
                for (let dx2 = -1; dx2 <= 1; dx2++) {
                  const t2 = L.tiles[solidZ + dz2]?.[solidX + dx2];
                  if (t2 === undefined || t2 === TileType.Wall) continue;
                  if (tileBiome(L.cellBiomes, solidX + dx2, solidZ + dz2) === 'outside') continue;
                  pc = Math.max(pc, L.ceilingHeights[solidZ + dz2]![solidX + dx2]!);
                }
              }
              if (Number.isFinite(pc)) topOverride = L.baseY + pc;
            }

            let o0 = false;
            let o1 = false;
            const tangents: [number, number][] = dx !== 0
              ? [[0, -1], [0, 1]]
              : [[-1, 0], [1, 0]];
            if (chamferLc >= 0) {
              const L = world.levels[chamferLc]!;
              const wallAt = (tx: number, tz: number): boolean =>
                tx < 0 || tz < 0 || tx >= w || tz >= h || L.tiles[tz]![tx] === TileType.Wall;
              const org = (tx: number, tz: number): boolean =>
                isOrganicTileIn(L.cellBiomes, tx, tz);
              // A chamfer half replaces the flat face with a DIAGONAL set
              // back inside the wall tile; the boundary plane itself is
              // then sealed only by the matching half from the
              // perpendicular boundary at that corner. That half exists
              // only where the tangent column is ALSO open at this
              // height. Where it isn't (a cave ceiling beside open sky,
              // a low room beside a tall one), the diagonal stands alone
              // and leaves a half-tile-wide, full-height SLIT — the
              // classic see-through corner. So: chamfer only where the
              // corner is genuinely open at this height; otherwise emit
              // the flat face and seal the plane.
              // MUTUAL AGREEMENT, or no chamfer. A chamfer half is only
              // half of the corner cut; the other half comes from the
              // perpendicular boundary. That boundary computes over ITS
              // air column's range, so if the two columns differ (a room
              // capped at 21.5 meeting one open to sky) one side
              // chamfers and the other goes flat — the lone diagonal
              // leaves a see-through wedge. Requiring the tangent to
              // have a span EXACTLY equal to this segment makes the test
              // symmetric: both sides chamfer, or neither does and flat
              // faces seal the plane.
              const tangentOpen = (t: [number, number]): boolean => {
                const tx2 = solidX + t[0];
                const tz2 = solidZ + t[1];
                if (tx2 < 0 || tz2 < 0 || tx2 >= w || tz2 >= h) return false;
                const sp = world.columns[tz2 * w + tx2]!;
                return sp.some((s2) =>
                  Math.abs(clipY(s2.floor) - lo) < 0.05 && Math.abs(clipY(s2.ceil) - hi) < 0.05);
              };
              // The contour is a 2D marching-squares line over the TILE
              // GRID; a chamfer is only meaningful where the 3D air/solid
              // structure at this height matches that 2D picture. Air
              // inside a WALL tile (a bridge passage, a pillar interior)
              // breaks the assumption: the perpendicular boundary at the
              // corner sees a wall on our side and will not emit its
              // matching half, so our diagonal stands alone and leaves a
              // see-through slit. Require both the air side and the
              // tangent to be genuine 2D floor AND open here in 3D.
              const airIsRealFloor = !wallAt(airX, airZ);
              const openHalf = (t: [number, number]): boolean => {
                if (!airIsRealFloor) return false;
                const dxT = solidX + t[0];
                const dzT = solidZ + t[1];
                if (wallAt(dxT, dzT)) return false;
                if (!tangentOpen(t)) return false;
                return org(airX, airZ) || org(solidX, solidZ) || org(dxT, dzT) || org(airX + t[0], airZ + t[1]);
              };
              o0 = openHalf(tangents[0]!);
              o1 = openHalf(tangents[1]!);
            }

            const emitChamfer = (k: 0 | 1): void => {
              const loK = k === 0 ? lo0 : lo1;
              const loM = (lo0 + lo1) / 2;
              // At the top of the air, both halves rise to the shared
              // pocket cap (topOverride) — per-boundary ceilings differ
              // across the corner and would open a triangle between the
              // halves. UNDER OPEN SKY there is no pocket ceiling: the
              // chamfer rises to the sky clip like its flat neighbors.
              let hiK = k === 0 ? hi0 : hi1;
              let hiM = (hi0 + hi1) / 2;
              if (topOverride !== null) {
                // ONLY RAISE, NEVER LOWER. The override lifts corner
                // halves to the shared cap so no triangle opens between
                // them — but the cap is derived from interior room
                // ceilings, and at a biome boundary the air on this side
                // can rise far above them (a cave roof beside open sky).
                // Overwriting there SHRANK the face and left the band
                // above the cave roof undrawn: the exact "no wall geo
                // above them" gap, through which DoubleSide showed the
                // backs of distant surfaces.
                hiK = Math.max(hiK, topOverride);
                hiM = Math.max(hiM, topOverride);
              }
              const mAx = (ex0 + ex1) / 2;
              const mAz = (ez0 + ez1) / 2;
              const t = tangents[k]!;
              const mBx = ((solidX + solidX + t[0] + 1) / 2) * TILE_SIZE;
              const mBz = ((solidZ + solidZ + t[1] + 1) / 2) * TILE_SIZE;
              const ccx = (mAx + mBx) / 2;
              const ccz = (mAz + mBz) / 2;
              // small margins tuck the diagonal into the apron floor below
              // and the ceiling above (bilinear floors are only exact
              // along tile edges, not along the diagonal)
              const b0 = loM - 0.4;
              const b1 = loK - 0.4;
              const topMargin = topOverride !== null ? 1.0 : 0.2;
              const t0 = hiM + topMargin;
              const t1 = hiK + topMargin;
              let nrx = -(ccz - mAz);
              let nrz = ccx - mAx;
              const acx = airX * TILE_SIZE + TILE_SIZE / 2;
              const acz = airZ * TILE_SIZE + TILE_SIZE / 2;
              if (nrx * (acx - mAx) + nrz * (acz - mAz) < 0) {
                nrx = -nrx;
                nrz = -nrz;
              }
              const nl = Math.hypot(nrx, nrz) || 1;
              nrx /= nl;
              nrz /= nl;
              const vi = buf.verts.length / 3;
              buf.verts.push(
                mAx, b0, mAz,
                ccx, b1, ccz,
                ccx, t1, ccz,
                mAx, t0, mAz,
              );
              for (let i2 = 0; i2 < 4; i2++) buf.norms.push(nrx, 0, nrz);
              buf.uvs.push(0, b0 / TILE_SIZE, 0.5, b1 / TILE_SIZE, 0.5, t1 / TILE_SIZE, 0, t0 / TILE_SIZE);
              addOrientedQuad(buf, vi, nrx, 0, nrz);
            };

            // TRANSOM: an open (chamfered) half leaves its boundary
            // plane undrawn — a ray can enter the pocket under ONE
            // neighbor's ceiling and exit above a LOWER neighbor's,
            // passing clean through the world (found via DDSNAP). Seal
            // the band from this boundary's ceiling up to the cap.
            const emitTransom = (s0: number, s1: number): void => {
              if (topOverride === null) return;
              const top = Math.min(topOverride + 1.0, nextCut);
              const lo0T = lerp(hi0, hi1, s0);
              const lo1T = lerp(hi0, hi1, s1);
              if (top <= Math.min(lo0T, lo1T) + 0.02) return;
              const vi = buf.verts.length / 3;
              buf.verts.push(
                lerp(ex0, ex1, s0), lo0T, lerp(ez0, ez1, s0),
                lerp(ex0, ex1, s1), lo1T, lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s1), top, lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s0), top, lerp(ez0, ez1, s0),
              );
              for (let k = 0; k < 4; k++) buf.norms.push(nrmX, 0, nrmZ);
              buf.uvs.push(
                s0, lo0T / TILE_SIZE,
                s1, lo1T / TILE_SIZE,
                s1, top / TILE_SIZE,
                s0, top / TILE_SIZE,
              );
              addOrientedQuad(buf, vi, nrmX, 0, nrmZ);
            };

            // Octagonal-tunnel gate: full-height wall segment facing a
            // 'tunnel'-region corridor (null-biome cell, real floor).
            const TUNNEL_CH = 0.6;
            const emitOctagonal = (() => {
              if (chamferLc >= 0 && (o0 || o1)) return false;
              if (airX < 0 || airZ < 0 || airX >= w || airZ >= h) return false;
              if (tileBiome(world.levels[0]!.cellBiomes, airX, airZ) !== null) return false;
              if (world.levels[0]!.tiles[airZ]![airX] === TileType.Wall) return false;
              return airTopKnown && !airIsSky
                && Math.abs(hi - airSpanTop) < 0.03
                && spanAtFloor(airSpans, lo) !== undefined
                && hi - lo >= 2.2;
            })();
            if (chamferLc >= 0 && (o0 || o1)) {
              if (o0) {
                emitChamfer(0);
                emitTransom(0, 0.5);
              } else {
                emitFlat(0, 0.5);
              }
              if (o1) {
                emitChamfer(1);
                emitTransom(0.5, 1);
              } else {
                emitFlat(0.5, 1);
              }
            } else if (!emitOctagonal) {
              emitFlat(0, 1);
            }

            // ── OCTAGONAL TUNNEL CORRIDORS — REAL wall geometry, not
            // cladding. A full-height tunnel wall segment is emitted as
            // three surfaces: shortened flat band, floor diagonal, and
            // ceiling diagonal. Where the chamfer does not CONTINUE into
            // the next segment along the wall (doorway, corner, span
            // change), triangular END CAPS close the wedge. The floor
            // and ceiling quads behind the diagonals stay full-width:
            // hidden structural sealing per the junction doctrine.
            // (This replaces emitFlat for these segments — see the
            // emission choice above, which skips flat when octagonal.)
            if (emitOctagonal) {
              const TCH = TUNNEL_CH;
              const S2 = Math.SQRT1_2;
              const inX = nrmX * TCH;
              const inZ = nrmZ * TCH;
              const pushQ = (
                a0x: number, a0y: number, a0z: number,
                a1x: number, a1y: number, a1z: number,
                b1x: number, b1y: number, b1z: number,
                b0x: number, b0y: number, b0z: number,
                qnx: number, qny: number, qnz: number,
              ): void => {
                const vi = buf.verts.length / 3;
                buf.verts.push(a0x, a0y, a0z, a1x, a1y, a1z, b1x, b1y, b1z, b0x, b0y, b0z);
                for (let k = 0; k < 4; k++) buf.norms.push(qnx, qny, qnz);
                buf.uvs.push(0, a0y / TILE_SIZE, 1, a1y / TILE_SIZE, 1, b1y / TILE_SIZE, 0, b0y / TILE_SIZE);
                addOrientedQuad(buf, vi, qnx, qny, qnz);
              };
              // Shortened flat wall band
              pushQ(
                ex0, lo0 + TCH, ez0, ex1, lo1 + TCH, ez1,
                ex1, hi1 - TCH, ez1, ex0, hi0 - TCH, ez0,
                nrmX, 0, nrmZ,
              );
              // Diagonals (floor and ceiling)
              pushQ(
                ex0, lo0 + TCH, ez0, ex1, lo1 + TCH, ez1,
                ex1 + inX, lo1, ez1 + inZ, ex0 + inX, lo0, ez0 + inZ,
                nrmX * S2, S2, nrmZ * S2,
              );
              pushQ(
                ex0, hi0 - TCH, ez0, ex1, hi1 - TCH, ez1,
                ex1 + inX, hi1, ez1 + inZ, ex0 + inX, hi0, ez0 + inZ,
                nrmX * S2, -S2, nrmZ * S2,
              );
              // Cap band above the ceiling junction when the shared wall
              // cap sits higher than this segment (the old override band)
              if (topOverride !== null && topOverride > hi + 0.02) {
                pushQ(
                  ex0, hi0, ez0, ex1, hi1, ez1,
                  ex1, topOverride, ez1, ex0, topOverride, ez0,
                  nrmX, 0, nrmZ,
                );
              }
              // End caps: does the chamfer continue past each end? The
              // next boundary along the wall must be the same pairing —
              // tunnel air beside Wall — with the same span bounds.
              const tangent: [number, number] = dx !== 0 ? [0, 1] : [1, 0];
              const continues = (dir: 1 | -1): boolean => {
                const nAirX = airX + tangent[0] * dir;
                const nAirZ = airZ + tangent[1] * dir;
                const nSolX = solidX + tangent[0] * dir;
                const nSolZ = solidZ + tangent[1] * dir;
                if (nAirX < 0 || nAirZ < 0 || nAirX >= w || nAirZ >= h) return false;
                if (world.levels[0]!.tiles[nAirZ]![nAirX] === TileType.Wall) return false;
                if (tileBiome(world.levels[0]!.cellBiomes, nAirX, nAirZ) !== null) return false;
                if (nSolX < 0 || nSolZ < 0 || nSolX >= w || nSolZ >= h) return false;
                if (world.levels[0]!.tiles[nSolZ]![nSolX] !== TileType.Wall) return false;
                return world.columns[nAirZ * w + nAirX]!.some((s2) =>
                  Math.abs(clipY(s2.floor) - lo) < 0.05 && Math.abs(clipY(s2.ceil) - hi) < 0.05);
              };
              /** Close one end of the octagonal run. Three cases:
               *  - CONTINUES: nothing (handled by caller).
               *  - CONVEX CORNER (the wall mass ends; a perpendicular
               *    tunnel wall with the same span turns the corner):
               *    emit MITER triangles — the corner pieces that make
               *    the chamfer turn the corner as one surface. X-facing
               *    boundaries own the miter so it isn't drawn twice.
               *  - OTHERWISE (doorway, span change): plane end caps
               *    close the wedges. */
              const closeEnd = (end: 0 | 1): void => {
                const ex = end === 0 ? ex0 : ex1;
                const ez = end === 0 ? ez0 : ez1;
                const loE = end === 0 ? lo0 : lo1;
                const hiE = end === 0 ? hi0 : hi1;
                const dirSign = end === 0 ? -1 : 1;
                const cnx = tangent[0] * dirSign;
                const cnz = tangent[1] * dirSign;
                const tri = (
                  p0x: number, p0y: number, p0z: number,
                  p1x: number, p1y: number, p1z: number,
                  p2x: number, p2y: number, p2z: number,
                  gnx: number, gny: number, gnz: number,
                ): void => {
                  const vi = buf.verts.length / 3;
                  buf.verts.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z);
                  const nl = Math.hypot(gnx, gny, gnz) || 1;
                  for (let k = 0; k < 3; k++) buf.norms.push(gnx / nl, gny / nl, gnz / nl);
                  buf.uvs.push(0, 0, 1, 0, 0.5, 1);
                  const p = buf.verts;
                  const b0 = vi * 3;
                  const abx = p[b0 + 3]! - p[b0]!, aby = p[b0 + 4]! - p[b0 + 1]!, abz = p[b0 + 5]! - p[b0 + 2]!;
                  const acx = p[b0 + 6]! - p[b0]!, acy2 = p[b0 + 7]! - p[b0 + 1]!, acz = p[b0 + 8]! - p[b0 + 2]!;
                  const gx = aby * acz - abz * acy2;
                  const gy = abz * acx - abx * acz;
                  const gz = abx * acy2 - aby * acx;
                  if (gx * gnx + gy * gny + gz * gnz >= 0) buf.idxs.push(vi, vi + 1, vi + 2);
                  else buf.idxs.push(vi, vi + 2, vi + 1);
                };
                // Convex-corner test: past this end, the SOLID side opens
                // to air whose column carries the same span — the wall
                // turns; the corner piece belongs there.
                const bSolX = solidX + tangent[0] * dirSign;
                const bSolZ = solidZ + tangent[1] * dirSign;
                const beyondOpen = bSolX >= 0 && bSolZ >= 0 && bSolX < w && bSolZ < h
                  && world.levels[0]!.tiles[bSolZ]![bSolX] !== TileType.Wall
                  && tileBiome(world.levels[0]!.cellBiomes, bSolX, bSolZ) === null
                  && world.columns[bSolZ * w + bSolX]!.some((s2) =>
                    Math.abs(clipY(s2.floor) - lo) < 0.05 && Math.abs(clipY(s2.ceil) - hi) < 0.05);
                if (beyondOpen) {
                  // The z-facing partner draws nothing: x-facing owns it.
                  if (dx === 0) return;
                  // Ceiling corner piece: corner edge at hi-C up to the
                  // two inward ceiling points of the meeting chamfers.
                  tri(
                    ex, hiE - TCH, ez,
                    ex + inX, hiE, ez + inZ,
                    ex + cnx * TCH, hiE, ez + cnz * TCH,
                    nrmX + cnx, -1, nrmZ + cnz,
                  );
                  // Floor corner piece, mirrored.
                  tri(
                    ex, loE + TCH, ez,
                    ex + inX, loE, ez + inZ,
                    ex + cnx * TCH, loE, ez + cnz * TCH,
                    nrmX + cnx, 1, nrmZ + cnz,
                  );
                  return;
                }
                // Plane end caps (doorways, span changes; concave ends
                // land buried inside the perpendicular wall — harmless).
                tri(ex, loE, ez, ex, loE + TCH, ez, ex + inX, loE, ez + inZ, cnx, 0, cnz);
                tri(ex, hiE, ez, ex, hiE - TCH, ez, ex + inX, hiE, ez + inZ, cnx, 0, cnz);
              };
              if (!continues(-1)) closeEnd(0);
              if (!continues(1)) closeEnd(1);
            }
          }
        }
      }
      flushRuns(open, z);
    }

    for (const [key, buf] of buffers) {
      this.addMesh(group, buf, materialsFor(key).wall);
    }
    this.addMesh(group, rockFloors, materialsFor('tunnel').floor);
  }

  /**
   * OCTAGONAL TUNNELS: pipe and subway bores are square in the column
   * model (one flat span per tile — the leak-proofing contract), so the
   * eight-sided cross-section is drawn: four 45-degree chamfer strips
   * run the length of each bore, corner-filling where wall meets floor
   * and ceiling. Emitted only where a REAL wall stands beyond the bore
   * (solid across the band) — flying pipe causeways with open sides get
   * no floating diagonals. Collision stays square: the wedges are within
   * body-radius reach of walls, so the clip is imperceptible.
   */
  private buildPipeChamfers(world: WorldData, target: THREE.Group): void {
    const C = 0.6; // chamfer leg — strong enough to read as an octagon
    const S = Math.SQRT1_2;
    const w = world.levels[0]!.width;
    const buf = newBuffers();

    const solidAcross = (tx: number, tz: number, lo: number, hi: number): boolean => {
      if (tx < 0 || tz < 0 || tx >= w || tz >= w) return false;
      const spans = world.columns[tz * w + tx]!;
      return !spans.some((sp) => sp.floor < hi - 0.05 && sp.ceil > lo + 0.05);
    };

    /** One chamfer strip segment: a quad from edge (a0->a1) to edge (b0->b1). */
    const strip = (
      ax0: number, ay0: number, az0: number, ax1: number, ay1: number, az1: number,
      bx0: number, by0: number, bz0: number, bx1: number, by1: number, bz1: number,
      nx: number, ny: number, nz: number,
    ): void => {
      const vi = buf.verts.length / 3;
      buf.verts.push(ax0, ay0, az0, ax1, ay1, az1, bx1, by1, bz1, bx0, by0, bz0);
      for (let k = 0; k < 4; k++) buf.norms.push(nx, ny, nz);
      buf.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      addOrientedQuad(buf, vi, nx, ny, nz);
    };

    // EVERY bore gets chamfers where it tunnels through solid — pipes,
    // subways, AND ordinary bridges boring passages into pillars/walls.
    // The wall gate keeps open-air spans clean.
    const pipes = [...world.bridges, ...world.subways];
    for (const br of pipes) {
      // LEVEL bores only: on sloped decks the per-tile strips stagger
      // against the stepped treads and read as broken paneling.
      if (Math.abs(br.yB - br.yA) > 0.01) continue;
      const tiles = bridgeTiles(br);
      for (let j = 0; j + 2 < tiles.length; j += 3) {
        const lowT = tiles[j]!;
        const center = tiles[j + 1]!;
        const highT = tiles[j + 2]!;
        const h = center.h;
        const top = h + (br.pipe ? PIPE_BORE : CLEARANCE);
        if (br.dir === 'east') {
          const x0 = center.tx * TILE_SIZE;
          const x1 = x0 + TILE_SIZE;
          const zLo = lowT.tz * TILE_SIZE;
          const zHi = (highT.tz + 1) * TILE_SIZE;
          if (solidAcross(lowT.tx, lowT.tz - 1, h + 0.2, top - 0.2)) {
            strip(x0, h, zLo + C, x1, h, zLo + C, x0, h + C, zLo, x1, h + C, zLo, 0, S, S);
            strip(x0, top, zLo + C, x1, top, zLo + C, x0, top - C, zLo, x1, top - C, zLo, 0, -S, S);
          }
          if (solidAcross(highT.tx, highT.tz + 1, h + 0.2, top - 0.2)) {
            strip(x0, h, zHi - C, x1, h, zHi - C, x0, h + C, zHi, x1, h + C, zHi, 0, S, -S);
            strip(x0, top, zHi - C, x1, top, zHi - C, x0, top - C, zHi, x1, top - C, zHi, 0, -S, -S);
          }
        } else {
          const z0 = center.tz * TILE_SIZE;
          const z1 = z0 + TILE_SIZE;
          const xLo = lowT.tx * TILE_SIZE;
          const xHi = (highT.tx + 1) * TILE_SIZE;
          if (solidAcross(lowT.tx - 1, lowT.tz, h + 0.2, top - 0.2)) {
            strip(xLo + C, h, z0, xLo + C, h, z1, xLo, h + C, z0, xLo, h + C, z1, S, S, 0);
            strip(xLo + C, top, z0, xLo + C, top, z1, xLo, top - C, z0, xLo, top - C, z1, S, -S, 0);
          }
          if (solidAcross(highT.tx + 1, highT.tz, h + 0.2, top - 0.2)) {
            strip(xHi - C, h, z0, xHi - C, h, z1, xHi, h + C, z0, xHi, h + C, z1, -S, S, 0);
            strip(xHi - C, top, z0, xHi - C, top, z1, xHi, top - C, z0, xHi, top - C, z1, -S, -S, 0);
          }
        }
      }
    }
    this.addMesh(target, buf, this.materialsFor('tunnel').wall);
  }

  /**
   * Biome tint at a world position, blended SMOOTHLY across cell
   * boundaries (bilinear over the 2x2 nearest cells with smoothstep
   * fractions) so districts fade into each other instead of switching
   * at a line. Pillar structures override the blend entirely: one tint,
   * sampled at the pillar's center cell, for the whole monument — a
   * tower reads as a single object, never striped by the fields it
   * happens to straddle.
   */
  private tintAt(x: number, z: number, out: [number, number, number]): void {
    const w = this.tintWorld;
    if (!w) { out[0] = out[1] = out[2] = 1; return; }
    const L = w.levels[0]!;
    const cellTiles = Math.floor(L.width / L.cellBiomes.length) || L.width;
    const tx = Math.min(L.width - 1, Math.max(0, Math.floor(x / TILE_SIZE)));
    const tz = Math.min(L.height - 1, Math.max(0, Math.floor(z / TILE_SIZE)));
    if (L.pillarWall[tz]?.[tx]) {
      const pillarTiles = cellTiles * 4; // one pillar cell = 4x4 dungeon cells
      const ctx = Math.floor(tx / pillarTiles) * pillarTiles + Math.floor(pillarTiles / 2);
      const ctz = Math.floor(tz / pillarTiles) * pillarTiles + Math.floor(pillarTiles / 2);
      const t = TINT_RGB[tileBiome(L.cellBiomes, ctx, ctz) ?? 'tunnel'];
      out[0] = t[0]; out[1] = t[1]; out[2] = t[2];
      return;
    }
    const n = L.cellBiomes.length;
    const cellWu = cellTiles * TILE_SIZE;
    const cxf = x / cellWu - 0.5;
    const czf = z / cellWu - 0.5;
    const c0 = Math.floor(cxf);
    const r0 = Math.floor(czf);
    const fx = smooth01(Math.min(1, Math.max(0, cxf - c0)));
    const fz = smooth01(Math.min(1, Math.max(0, czf - r0)));
    out[0] = 0; out[1] = 0; out[2] = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const cc = Math.min(n - 1, Math.max(0, c0 + dx));
        const cr = Math.min(n - 1, Math.max(0, r0 + dz));
        const t = TINT_RGB[(L.cellBiomes[cr]?.[cc] ?? 'tunnel') as RegionKey];
        const wgt = (dx === 0 ? 1 - fx : fx) * (dz === 0 ? 1 - fz : fz);
        out[0] += t[0] * wgt; out[1] += t[1] * wgt; out[2] += t[2] * wgt;
      }
    }
  }

  private addMesh(parent: THREE.Group, buf: MeshBuffers, material: THREE.Material): void {
    if (buf.verts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norms, 3));
    const splatWeights: number[] = [];
    for (let i = 0; i < buf.verts.length; i += 3) {
      const x = buf.verts[i]!;
      const y = buf.verts[i + 1]!;
      const z = buf.verts[i + 2]!;
      // Broad, deterministic fields act like procedural terrain-paint strokes.
      // Multiple incommensurate waves avoid a visible square or checker grid.
      const r = 0.55 + 0.30 * Math.sin(x * 0.071 + z * 0.043);
      const g = 0.50 + 0.32 * Math.sin(z * 0.059 - y * 0.083 + 1.9);
      const b = 0.48 + 0.29 * Math.sin(x * 0.037 + y * 0.067 - z * 0.031 + 4.1);
      const sum = r + g + b;
      splatWeights.push(r / sum, g / sum, b / sum);
    }
    geom.setAttribute('splatWeight', new THREE.Float32BufferAttribute(splatWeights, 3));
    // Per-vertex biome tint — smoothly blended fields, single-tint pillars.
    const colors: number[] = [];
    const tint: [number, number, number] = [1, 1, 1];
    for (let i = 0; i < buf.verts.length; i += 3) {
      const x = buf.verts[i]!;
      const z = buf.verts[i + 2]!;
      this.tintAt(x, z, tint);
      colors.push(tint[0], tint[1], tint[2]);
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(buf.idxs);
    if (import.meta.env?.DEV) {
      let reversed = 0;
      let degenerate = 0;
      for (let t = 0; t < buf.idxs.length; t += 3) {
        const ia = buf.idxs[t]! * 3;
        const ib = buf.idxs[t + 1]! * 3;
        const ic = buf.idxs[t + 2]! * 3;
        const abx = buf.verts[ib]! - buf.verts[ia]!;
        const aby = buf.verts[ib + 1]! - buf.verts[ia + 1]!;
        const abz = buf.verts[ib + 2]! - buf.verts[ia + 2]!;
        const acx = buf.verts[ic]! - buf.verts[ia]!;
        const acy = buf.verts[ic + 1]! - buf.verts[ia + 1]!;
        const acz = buf.verts[ic + 2]! - buf.verts[ia + 2]!;
        const gx = aby * acz - abz * acy;
        const gy = abz * acx - abx * acz;
        const gz = abx * acy - aby * acx;
        const areaSq = gx * gx + gy * gy + gz * gz;
        if (areaSq < 1e-10) {
          degenerate++;
          continue;
        }
        const nx = buf.norms[ia]! + buf.norms[ib]! + buf.norms[ic]!;
        const ny = buf.norms[ia + 1]! + buf.norms[ib + 1]! + buf.norms[ic + 1]!;
        const nz = buf.norms[ia + 2]! + buf.norms[ib + 2]! + buf.norms[ic + 2]!;
        if (gx * nx + gy * ny + gz * nz <= 0) reversed++;
      }
      if (reversed > 0 || degenerate > 0) {
        console.error(
          `[geometry] invalid triangles: reversed=${reversed} `
          + `degenerate=${degenerate} total=${buf.idxs.length / 3}`,
        );
      }
    }
    const mesh = new THREE.Mesh(geom, material);
    parent.add(mesh);
  }
}

// ── Geometry helpers ──

function isWall(dungeon: DungeonData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= dungeon.width || y >= dungeon.height) return true;
  return dungeon.tiles[y]![x] === TileType.Wall;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Add a quad with triangle winding that agrees with its authored normal.
 * Procedural surfaces previously used one fixed index order even when their
 * intended normal reversed, forcing every structural material to DoubleSide. */
function addOrientedQuad(
  buf: MeshBuffers,
  i: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  const p = buf.verts;
  const addTriangle = (a: number, b: number, c: number): void => {
    const p0 = a * 3;
    const p1 = b * 3;
    const p2 = c * 3;
    const ax = p[p1]! - p[p0]!;
    const ay = p[p1 + 1]! - p[p0 + 1]!;
    const az = p[p1 + 2]! - p[p0 + 2]!;
    const bx = p[p2]! - p[p0]!;
    const by = p[p2 + 1]! - p[p0 + 1]!;
    const bz = p[p2 + 2]! - p[p0 + 2]!;
    const gx = ay * bz - az * by;
    const gy = az * bx - ax * bz;
    const gz = ax * by - ay * bx;
    if (gx * gx + gy * gy + gz * gz < 1e-10) return;
    if (gx * nx + gy * ny + gz * nz >= 0) buf.idxs.push(a, b, c);
    else buf.idxs.push(a, c, b);
  };
  // A terrain quad can be non-planar. Validate its triangles separately:
  // flipping the whole quad still left one triangle backward on twisted
  // height-field and chamfer junctions.
  addTriangle(i, i + 1, i + 2);
  addTriangle(i, i + 2, i + 3);
}

/** A FLAT horizontal strip spanning [x0..x1] x [z0..z1] at one height —
 *  the merged form of a run of identical addHorizontalQuad tiles. UVs in
 *  tile units so the texture density matches the per-tile quads. */
function addFlatStrip(
  buf: MeshBuffers,
  x0: number, z0: number, x1: number, z1: number,
  y: number, facingUp: boolean,
): void {
  const i = buf.verts.length / 3;
  const u1 = (x1 - x0) / TILE_SIZE;
  const v1 = (z1 - z0) / TILE_SIZE;
  if (facingUp) {
    buf.verts.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    buf.uvs.push(0, 0, u1, 0, u1, v1, 0, v1);
  } else {
    buf.verts.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    buf.uvs.push(0, 0, 0, v1, u1, v1, u1, 0);
  }
  const ny = facingUp ? 1 : -1;
  for (let k = 0; k < 4; k++) buf.norms.push(0, ny, 0);
  addOrientedQuad(buf, i, 0, ny, 0);
}

function addCeilPatch(
  buf: MeshBuffers,
  x0: number, z0: number, x1: number, z1: number,
  h: number,
): void {
  const i = buf.verts.length / 3;
  buf.verts.push(x0, h, z0);
  buf.verts.push(x0, h, z1);
  buf.verts.push(x1, h, z1);
  buf.verts.push(x1, h, z0);
  buf.uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
  for (let k = 0; k < 4; k++) buf.norms.push(0, -1, 0);
  addOrientedQuad(buf, i, 0, -1, 0);
}

function addHorizontalQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  h00: number, h10: number, h01: number, h11: number,
  facingUp: boolean,
  /** Expand the quad outward past the tile on every side — overdraw
   *  that hides junction hairlines under neighboring geometry */
  expand: number = 0,
): void {
  const x0 = wx - expand;
  const z0 = wz - expand;
  const s = TILE_SIZE + 2 * expand;
  const i = buf.verts.length / 3;

  if (facingUp) {
    buf.verts.push(x0, h00, z0);
    buf.verts.push(x0 + s, h10, z0);
    buf.verts.push(x0 + s, h11, z0 + s);
    buf.verts.push(x0, h01, z0 + s);
    buf.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  } else {
    buf.verts.push(x0, h00, z0);
    buf.verts.push(x0, h01, z0 + s);
    buf.verts.push(x0 + s, h11, z0 + s);
    buf.verts.push(x0 + s, h10, z0);
    buf.uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
  }
  _a.set(s, h11 - h00, s);
  _b.set(-s, h01 - h10, s);
  _n.crossVectors(_a, _b).normalize();
  if (facingUp && _n.y < 0) _n.negate();
  if (!facingUp && _n.y > 0) _n.negate();
  for (let k = 0; k < 4; k++) buf.norms.push(_n.x, _n.y, _n.z);
  addOrientedQuad(buf, i, _n.x, _n.y, _n.z);
}
