import * as THREE from 'three';
import { TileType, TILE_SIZE, SKY_CEIL, ABYSS_FLOOR } from '../game/types';
import type { DungeonData, WorldData, ColumnSpan } from '../game/types';
import { tileBiome, type BiomeType } from '../game/dungeon/cells';
import { buildCornerField, sampleCornerField, PIT_LEVEL } from '../game/dungeon/heightfield';
import { buildOrganicContour, isOrganicTileIn } from '../game/dungeon/organiccontour';

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

// Shared textures — loaded once, tinted per biome via material color
const WALL_TEX = loadTex('/textures/wall-stone.png');
const FLOOR_TEX = loadTex('/textures/floor-dirt.png');
const CEIL_TEX = loadTex('/textures/ceiling-dark.png');
const STAIRS_TEX = loadTex('/textures/stairs-down.png');

/** Region key: a biome, or 'tunnel' for connections carved through void */
type RegionKey = BiomeType | 'tunnel';

const REGION_TINTS: Record<RegionKey, number> = {
  dungeon: 0xffffff,
  cave: 0xd8b494, // warm earth
  crypt: 0x9fb4cc, // cold blue-grey
  ember: 0xff8866, // heat glow
  outside: 0xaec8d8, // moonlit stone
  tunnel: 0xb8b0a8, // drab passage
};

// Ember stone smolders faintly on its own
const REGION_EMISSIVE: Partial<Record<RegionKey, number>> = {
  ember: 0x2a0d04,
};

/** How high canyon walls render into an open sky span */
const RENDER_SKY_TOP = 44;
/** How deep a bottomless pit's walls render below the lowest level */
const RENDER_ABYSS_DROP = 24;

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

export class DungeonRenderer {
  private scene: THREE.Scene;
  private meshGroup: THREE.Group;
  private markers: Marker[] = [];
  private markerTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
  }

  clear(): void {
    // Dispose all children (textures are shared module-level, kept alive)
    const seenMats = new Set<THREE.Material>();
    this.meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          if (!seenMats.has(m)) {
            seenMats.add(m);
            m.dispose();
          }
        }
      }
    });
    this.meshGroup.clear();
    this.markers = [];
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

  /**
   * Build the whole stack. Horizontal surfaces (floors, ceilings) come
   * from each level's height fields, gated by the column model; ALL
   * vertical faces are derived in one pass from span differences between
   * adjacent columns — a face exists exactly where air meets solid.
   */
  build(world: WorldData): void {
    const cornerFloors = world.levels.map((l) =>
      buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0));

    const materials = new Map<RegionKey, RegionMaterials>();
    const materialsFor = (key: RegionKey): RegionMaterials => {
      let m = materials.get(key);
      if (!m) {
        const tint = REGION_TINTS[key];
        const emissive = REGION_EMISSIVE[key] ?? 0x000000;
        m = {
          wall: new THREE.MeshStandardMaterial({ map: WALL_TEX, color: tint, emissive, roughness: 0.85, side: THREE.DoubleSide }),
          floor: new THREE.MeshStandardMaterial({ map: FLOOR_TEX, color: tint, emissive, roughness: 0.9, side: THREE.DoubleSide }),
          ceil: new THREE.MeshStandardMaterial({ map: CEIL_TEX, color: tint, emissive, roughness: 0.95, side: THREE.DoubleSide }),
        };
        materials.set(key, m);
      }
      return m;
    };

    // One contour per level: the marching-squares line is the single
    // authority on organic wall SHAPE — collision segments and the
    // chamfered wall quads both come from it
    const contours = world.levels.map((l) => buildOrganicContour(l));

    for (let li = 0; li < world.levels.length; li++) {
      this.buildLevelSurfaces(world, li, cornerFloors[li]!, contours[li]!, materialsFor);
    }
    this.buildWalls(world, cornerFloors, contours, materialsFor);
  }

  /** Floors, ceilings, aprons, stairs and markers of one level —
   *  everything horizontal. ALL vertical surface lives in buildWalls. */
  private buildLevelSurfaces(
    world: WorldData,
    li: number,
    cornerFloor: number[][],
    contour: ReturnType<typeof buildOrganicContour>,
    materialsFor: (key: RegionKey) => RegionMaterials,
  ): void {
    const dungeon = world.levels[li]!;
    const w = dungeon.width;
    const isBottom = li === world.levels.length - 1;

    const group = new THREE.Group();
    group.position.y = dungeon.baseY;
    this.meshGroup.add(group);

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

    // A tile whose 3x3 neighborhood spans a hole boundary renders at
    // higher tessellation — rim curvature is earned there
    const nearPitEdge = (x: number, y: number): boolean => {
      let hasPit = false;
      let hasGrade = false;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isWall(dungeon, x + dx, y + dz)) continue;
          if (dungeon.floorHeights[y + dz]![x + dx]! <= PIT_LEVEL) hasPit = true;
          else hasGrade = true;
        }
      }
      return hasPit && hasGrade;
    };

    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        const tile = dungeon.tiles[y]![x]!;
        const region = regionOf(x, y);

        if (tile === TileType.Wall) {
          // Contoured wall tiles get "apron" floor + ceiling quads behind
          // the chamfers — without them every chamfer pocket is a hole
          if (contour.softWalls.has(y * w + x) && hasFloorNeighbor(x, y)) {
            const wx = x * TILE_SIZE;
            const wz = y * TILE_SIZE;
            const buf = regionBuffers(region);
            const ap = (v: number): number => Math.max(v, -3);
            addHorizontalQuad(buf.floor, wx, wz, ap(cornerFloor[y]![x]!), ap(cornerFloor[y]![x + 1]!), ap(cornerFloor[y + 1]![x]!), ap(cornerFloor[y + 1]![x + 1]!), true);
            if (!dungeon.openUp[y]![x]) {
              // Pocket cap: the apron ceiling over a contoured wall tile
              // sits at the HIGHEST adjacent room ceiling (the wall tile's
              // own value is meaningless filler). Chamfer tops rise to the
              // same value, so pillar pockets seal against one plane.
              let ac = dungeon.ceilingHeights[y]![x]!;
              for (let dz2 = -1; dz2 <= 1; dz2++) {
                for (let dx2 = -1; dx2 <= 1; dx2++) {
                  const t2 = dungeon.tiles[y + dz2]?.[x + dx2];
                  if (t2 !== undefined && t2 !== TileType.Wall) {
                    ac = Math.max(ac, dungeon.ceilingHeights[y + dz2]![x + dx2]!);
                  }
                }
              }
              addHorizontalQuad(buf.ceil, wx, wz, ac, ac, ac, ac, false);
            }
          }
          continue;
        }

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;
        const buf = regionBuffers(region);

        if (ownsFloor(x, y)) {
          const floorBuf = tile === TileType.StairsDown ? stairs : buf.floor;
          if (nearPitEdge(x, y)) {
            addTessellatedFloor(floorBuf, wx, wz, cornerFloor, PIT_TESS);
          } else {
            addHorizontalQuad(
              floorBuf, wx, wz,
              cornerFloor[y]![x]!, cornerFloor[y]![x + 1]!,
              cornerFloor[y + 1]![x]!, cornerFloor[y + 1]![x + 1]!,
              true,
            );
          }
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
      const stairsMat = new THREE.MeshStandardMaterial({ map: STAIRS_TEX, roughness: 0.7, emissive: 0x1a3a2a, emissiveIntensity: 0.15, side: THREE.DoubleSide });
      this.addMesh(group, stairs, stairsMat);
    }

    // Exit crystal — only where the way out really is: the bottom stairs
    if (isBottom) {
      const exitX = dungeon.exit.x * TILE_SIZE + TILE_SIZE / 2;
      const exitZ = dungeon.exit.y * TILE_SIZE + TILE_SIZE / 2;
      const exitFloor = dungeon.floorHeights[dungeon.exit.y]?.[dungeon.exit.x] ?? 0;
      const markerGeom = new THREE.BoxGeometry(1.1, 1.1, 1.1);
      const markerMat = new THREE.MeshStandardMaterial({
        color: 0x0a2a1a,
        emissive: 0x22ff88,
        emissiveIntensity: 0.9,
        roughness: 0.4,
      });
      const marker = new THREE.Mesh(markerGeom, markerMat);
      const markerBaseY = exitFloor + 1.5;
      marker.position.set(exitX, markerBaseY, exitZ);
      marker.rotation.set(Math.PI / 5, Math.PI / 4, 0);
      group.add(marker);
      this.markers.push({ mesh: marker, baseY: markerBaseY });
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
  ): void {
    const w = world.levels[0]!.width;
    const h = world.levels[0]!.height;
    const worldBottom = world.levels[world.levels.length - 1]!.baseY - RENDER_ABYSS_DROP;

    const group = new THREE.Group();
    this.meshGroup.add(group);

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
      y >= SKY_CEIL ? RENDER_SKY_TOP : (y <= ABYSS_FLOOR ? worldBottom : y);

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

    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const a = world.columns[z * w + x]!;

        // Structural rock floors (a shaft ending on the slab below)
        for (const s of a) {
          if (s.owner === -1 && s.floor > ABYSS_FLOOR) {
            addHorizontalQuad(rockFloors, x * TILE_SIZE, z * TILE_SIZE, s.floor, s.floor, s.floor, s.floor, true);
          }
        }

        // Rooftops: a solid column beside open sky renders a roof slab at
        // the sky clip height — canyon walls are otherwise open-topped
        // tubes, and steep sightlines from below see through the slit
        // between their faces.
        const reachesSky = a.length > 0 && a[a.length - 1]!.ceil >= SKY_CEIL;
        if (!reachesSky) {
          let skyNear = false;
          for (let oz = -2; oz <= 2 && !skyNear; oz++) {
            for (let ox = -2; ox <= 2 && !skyNear; ox++) {
              const nx2 = x + ox;
              const nz2 = z + oz;
              if (nx2 < 0 || nz2 < 0 || nx2 >= w || nz2 >= h) continue;
              const nb = world.columns[nz2 * w + nx2]!;
              if (nb.length > 0 && nb[nb.length - 1]!.ceil >= SKY_CEIL) skyNear = true;
            }
          }
          if (skyNear) {
            addHorizontalQuad(rockFloors, x * TILE_SIZE, z * TILE_SIZE, RENDER_SKY_TOP, RENDER_SKY_TOP, RENDER_SKY_TOP, RENDER_SKY_TOP, true);
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
            // shared edge corners per side: east (x+1,z)-(x+1,z+1),
            // west (x,z)-(x,z+1), south (x,z+1)-(x+1,z+1), north (x,z)-(x+1,z)
            const c0 = dx !== 0
              ? { cx: dx === 1 ? x + 1 : x, cz: z }
              : { cx: x, cz: dz === 1 ? z + 1 : z };
            const c1 = dx !== 0
              ? { cx: dx === 1 ? x + 1 : x, cz: z + 1 }
              : { cx: x + 1, cz: dz === 1 ? z + 1 : z };
            const lo0 = refine(lo, airSpans, otherSpans, c0.cx, c0.cz);
            const lo1 = refine(lo, airSpans, otherSpans, c1.cx, c1.cz);
            const hi0 = refine(hi, airSpans, otherSpans, c0.cx, c0.cz);
            const hi1 = refine(hi, airSpans, otherSpans, c1.cx, c1.cz);
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

            const emitFlat = (s0: number, s1: number): void => {
              const vi = buf.verts.length / 3;
              buf.verts.push(
                lerp(ex0, ex1, s0), lerp(lo0, lo1, s0), lerp(ez0, ez1, s0),
                lerp(ex0, ex1, s1), lerp(lo0, lo1, s1), lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s1), lerp(hi0, hi1, s1), lerp(ez0, ez1, s1),
                lerp(ex0, ex1, s0), lerp(hi0, hi1, s0), lerp(ez0, ez1, s0),
              );
              for (let k = 0; k < 4; k++) buf.norms.push(nrmX, 0, nrmZ);
              buf.uvs.push(
                s0, lerp(lo0, lo1, s0) / TILE_SIZE,
                s1, lerp(lo0, lo1, s1) / TILE_SIZE,
                s1, lerp(hi0, hi1, s1) / TILE_SIZE,
                s0, lerp(hi0, hi1, s0) / TILE_SIZE,
              );
              buf.idxs.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
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
            const solidIn = solidX >= 0 && solidZ >= 0 && solidX < w && solidZ < h;
            if (solidIn) {
              let airOwner = -1;
              for (const s of airSpans) {
                if (mid >= clipY(s.floor) && mid <= clipY(s.ceil)) {
                  airOwner = s.owner;
                  airSpanTop = clipY(s.ceil);
                  break;
                }
              }
              if (airOwner >= 0 && contours[airOwner]!.softWalls.has(solidZ * w + solidX)) {
                chamferLc = airOwner;
              }
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
              const openHalf = (t: [number, number]): boolean => {
                const dxT = solidX + t[0];
                const dzT = solidZ + t[1];
                if (wallAt(dxT, dzT)) return false;
                return org(airX, airZ) || org(solidX, solidZ) || org(dxT, dzT) || org(airX + t[0], airZ + t[1]);
              };
              o0 = openHalf(tangents[0]!);
              o1 = openHalf(tangents[1]!);
            }

            const emitChamfer = (k: 0 | 1): void => {
              const loK = k === 0 ? lo0 : lo1;
              const loM = (lo0 + lo1) / 2;
              // At the top of the air, both halves at a pillar corner rise
              // to the SOLID tile's shared pocket ceiling (max of adjacent
              // room ceilings) — per-boundary ceilings differ across the
              // corner and would open a triangle between the halves.
              let hiK = k === 0 ? hi0 : hi1;
              let hiM = (hi0 + hi1) / 2;
              if (chamferLc >= 0 && Math.abs(hi - airSpanTop) < 0.03) {
                const L = world.levels[chamferLc]!;
                let pc = L.ceilingHeights[solidZ]?.[solidX] ?? 3;
                for (let dz2 = -1; dz2 <= 1; dz2++) {
                  for (let dx2 = -1; dx2 <= 1; dx2++) {
                    const t2 = L.tiles[solidZ + dz2]?.[solidX + dx2];
                    if (t2 !== undefined && t2 !== TileType.Wall) {
                      pc = Math.max(pc, L.ceilingHeights[solidZ + dz2]![solidX + dx2]!);
                    }
                  }
                }
                hiK = L.baseY + pc;
                hiM = L.baseY + pc;
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
              const t0 = hiM + 0.2;
              const t1 = hiK + 0.2;
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
              buf.idxs.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            };

            if (chamferLc >= 0 && (o0 || o1)) {
              if (o0) emitChamfer(0);
              else emitFlat(0, 0.5);
              if (o1) emitChamfer(1);
              else emitFlat(0.5, 1);
            } else {
              emitFlat(0, 1);
            }
          }
        }
      }
    }

    for (const [key, buf] of buffers) {
      this.addMesh(group, buf, materialsFor(key).wall);
    }
    this.addMesh(group, rockFloors, materialsFor('tunnel').floor);
  }

  private addMesh(parent: THREE.Group, buf: MeshBuffers, material: THREE.Material): void {
    if (buf.verts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norms, 3));
    geom.setIndex(buf.idxs);
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

/** Tessellation for floor tiles at hole boundaries */
const PIT_TESS = 4;

function addFloorPatch(
  buf: MeshBuffers,
  x0: number, z0: number, x1: number, z1: number,
  h00: number, h10: number, h01: number, h11: number,
  u0: number, v0: number, u1: number, v1: number,
): void {
  const i = buf.verts.length / 3;
  buf.verts.push(x0, h00, z0);
  buf.verts.push(x1, h10, z0);
  buf.verts.push(x1, h11, z1);
  buf.verts.push(x0, h01, z1);
  buf.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);

  _a.set(x1 - x0, h11 - h00, z1 - z0);
  _b.set(x0 - x1, h01 - h10, z1 - z0);
  _n.crossVectors(_a, _b).normalize();
  if (_n.y < 0) _n.negate();
  for (let k = 0; k < 4; k++) buf.norms.push(_n.x, _n.y, _n.z);
}

function addTessellatedFloor(
  buf: MeshBuffers,
  wx: number, wz: number,
  corners: number[][],
  n: number,
): void {
  const s = TILE_SIZE;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = wx + (s * i) / n;
      const x1 = wx + (s * (i + 1)) / n;
      const z0 = wz + (s * j) / n;
      const z1 = wz + (s * (j + 1)) / n;
      addFloorPatch(
        buf,
        x0, z0, x1, z1,
        sampleCornerField(corners, x0, z0),
        sampleCornerField(corners, x1, z0),
        sampleCornerField(corners, x0, z1),
        sampleCornerField(corners, x1, z1),
        i / n, j / n, (i + 1) / n, (j + 1) / n,
      );
    }
  }
}

function addHorizontalQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  h00: number, h10: number, h01: number, h11: number,
  facingUp: boolean,
): void {
  const s = TILE_SIZE;
  const i = buf.verts.length / 3;

  if (facingUp) {
    buf.verts.push(wx, h00, wz);
    buf.verts.push(wx + s, h10, wz);
    buf.verts.push(wx + s, h11, wz + s);
    buf.verts.push(wx, h01, wz + s);
    buf.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  } else {
    buf.verts.push(wx, h00, wz);
    buf.verts.push(wx, h01, wz + s);
    buf.verts.push(wx + s, h11, wz + s);
    buf.verts.push(wx + s, h10, wz);
    buf.uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
  }
  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);

  _a.set(s, h11 - h00, s);
  _b.set(-s, h01 - h10, s);
  _n.crossVectors(_a, _b).normalize();
  if (facingUp && _n.y < 0) _n.negate();
  if (!facingUp && _n.y > 0) _n.negate();
  for (let k = 0; k < 4; k++) buf.norms.push(_n.x, _n.y, _n.z);
}
