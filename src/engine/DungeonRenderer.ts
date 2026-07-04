import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../game/types';
import type { DungeonData } from '../game/types';
import { getCell, type BiomeType } from '../game/dungeon/cells';
import { buildCornerField, sampleCornerField, PIT_LEVEL } from '../game/dungeon/heightfield';
import { buildOrganicContour, isOrganicTile } from '../game/dungeon/organiccontour';

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
  wall: MeshBuffers;
  caveWall: MeshBuffers;
}

export class DungeonRenderer {
  private scene: THREE.Scene;
  private meshGroup: THREE.Group;
  private exitMarker: THREE.Mesh | null = null;
  private exitMarkerBaseY = 0;
  private markerTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
  }

  clear(): void {
    // Dispose all children (textures are shared module-level, kept alive)
    this.meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.meshGroup.clear();
    this.exitMarker = null;
  }

  /** Animate the exit marker (slow spin + bob). Call every frame. */
  update(dt: number): void {
    if (!this.exitMarker) return;
    this.markerTime += dt;
    this.exitMarker.rotation.y += dt * 1.2;
    this.exitMarker.position.y = this.exitMarkerBaseY + Math.sin(this.markerTime * 2) * 0.15;
  }

  build(dungeon: DungeonData): void {
    // Floor and ceiling heights are averaged at tile corners so each forms
    // one continuous surface; walls span the exact same corner heights, so
    // everything seals with no transition patches.
    const cornerFloor = buildCornerField(dungeon.tiles, dungeon.floorHeights, dungeon.width, dungeon.height, 0);
    const cornerCeil = buildCornerField(dungeon.tiles, dungeon.ceilingHeights, dungeon.width, dungeon.height, 3);

    const CELL_TILE_SIZE = 14;
    const regionOf = (tx: number, tz: number): RegionKey => {
      const cell = getCell(Math.floor(tx / CELL_TILE_SIZE), Math.floor(tz / CELL_TILE_SIZE));
      return cell?.active ? cell.biome : 'tunnel';
    };
    const regions = new Map<RegionKey, RegionBuffers>();
    const regionBuffers = (key: RegionKey): RegionBuffers => {
      let b = regions.get(key);
      if (!b) {
        b = { floor: newBuffers(), ceil: newBuffers(), wall: newBuffers(), caveWall: newBuffers() };
        regions.set(key, b);
      }
      return b;
    };
    const stairs = newBuffers();

    const hasFloorNeighbor = (x: number, y: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (!isWall(dungeon, x + dx, y + dz)) return true;
        }
      }
      return false;
    };

    // A tile whose 3x3 neighborhood spans a pit boundary renders at higher
    // tessellation — the plunge geometry earns real curvature
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

    // Wall direction and per-half tangents for each face side
    const FACE_DIRS = {
      north: { w: [0, -1], tA: [-1, 0], tB: [1, 0] },
      south: { w: [0, 1], tA: [-1, 0], tB: [1, 0] },
      west: { w: [-1, 0], tA: [0, -1], tB: [0, 1] },
      east: { w: [1, 0], tA: [0, -1], tB: [0, 1] },
    } as const;

    const emitFace = (
      buf: MeshBuffers,
      x: number, y: number,
      side: WallSide,
      fA: number, fB: number,
      hA: number, hB: number,
    ): void => {
      const d = FACE_DIRS[side];
      const wxT = x + d.w[0];
      const wyT = y + d.w[1];
      if (!isWall(dungeon, wxT, wyT)) return; // no wall on that side

      const halfOpen = (t: readonly [number, number]): boolean => {
        const dxT = wxT + t[0];
        const dyT = wyT + t[1];
        if (isWall(dungeon, dxT, dyT)) return false; // diagonal is wall -> face half stays
        // Chamfer only exists where the contour runs — any organic tile in
        // the corner's 2x2 group
        return (
          isOrganicTile(x, y) || isOrganicTile(wxT, wyT) ||
          isOrganicTile(dxT, dyT) || isOrganicTile(x + t[0], y + t[1])
        );
      };

      const wx = x * TILE_SIZE;
      const wz = y * TILE_SIZE;
      const openA = halfOpen(d.tA);
      const openB = halfOpen(d.tB);
      if (!openA && !openB) {
        addWallQuad(buf, wx, wz, side, fA, fB, hA, hB);
      } else {
        if (!openA) addWallQuad(buf, wx, wz, side, fA, fB, hA, hB, 0, 0.5);
        if (!openB) addWallQuad(buf, wx, wz, side, fA, fB, hA, hB, 0.5, 1);
      }
    };

    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        const tile = dungeon.tiles[y]![x]!;
        if (tile === TileType.Wall) {
          // Organic wall tiles bordering floor get "apron" floor + ceiling
          // quads: the contour chamfers cut across them, exposing their
          // corners, so there must be surface behind the smooth wall
          if (isOrganicTile(x, y) && hasFloorNeighbor(x, y)) {
            const wx = x * TILE_SIZE;
            const wz = y * TILE_SIZE;
            const region = regionOf(x, y);
            const buf = regionBuffers(region);
            addHorizontalQuad(buf.floor, wx, wz, cornerFloor[y]![x]!, cornerFloor[y]![x + 1]!, cornerFloor[y + 1]![x]!, cornerFloor[y + 1]![x + 1]!, true);
            if (region !== 'outside') {
              addHorizontalQuad(buf.ceil, wx, wz, cornerCeil[y]![x]!, cornerCeil[y]![x + 1]!, cornerCeil[y + 1]![x]!, cornerCeil[y + 1]![x + 1]!, false);
            }
          }
          continue;
        }

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;
        const region = regionOf(x, y);
        const buf = regionBuffers(region);

        const f00 = cornerFloor[y]![x]!;
        const f10 = cornerFloor[y]![x + 1]!;
        const f01 = cornerFloor[y + 1]![x]!;
        const f11 = cornerFloor[y + 1]![x + 1]!;
        const h00 = cornerCeil[y]![x]!;
        const h10 = cornerCeil[y]![x + 1]!;
        const h01 = cornerCeil[y + 1]![x]!;
        const h11 = cornerCeil[y + 1]![x + 1]!;

        const floorBuf = tile === TileType.StairsDown ? stairs : buf.floor;
        if (nearPitEdge(x, y)) {
          addTessellatedFloor(floorBuf, wx, wz, cornerFloor, PIT_TESS);
        } else {
          addHorizontalQuad(floorBuf, wx, wz, f00, f10, f01, f11, true);
        }
        // Outside is open to the sky — no ceiling at all
        if (region !== 'outside') {
          addHorizontalQuad(buf.ceil, wx, wz, h00, h10, h01, h11, false);
        }

        // Walls span from the floor corners to the ceiling corners.
        // In organic regions each face is emitted in halves: where the
        // contour chamfers the wall corner, that half of the axis face
        // sits inside the walkable pocket and must NOT render (it's the
        // "clip through the corner" wall). The half toward a corner is
        // open exactly when the diagonal tile at that corner is floor.
        emitFace(buf.wall, x, y, 'north', f00, f10, h00, h10);
        emitFace(buf.wall, x, y, 'south', f01, f11, h01, h11);
        emitFace(buf.wall, x, y, 'west', f00, f01, h00, h01);
        emitFace(buf.wall, x, y, 'east', f10, f11, h10, h11);
      }
    }

    // ── Organic contour walls ──
    // The same segments the collision system uses (single source of truth),
    // extruded from floor to ceiling. They overlay the axis-aligned quads,
    // inset a hair toward the open side to avoid z-fighting on straight runs.
    const INSET = 0.03;
    for (const seg of buildOrganicContour(dungeon).segments) {
      // Bucket by the first organic tile of the segment's group
      let rx = seg.gx;
      let rz = seg.gz;
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (isOrganicTile(seg.gx + ox!, seg.gz + oz!)) {
          rx = seg.gx + ox!;
          rz = seg.gz + oz!;
          break;
        }
      }
      const buf = regionBuffers(regionOf(rx, rz)).caveWall;

      const bottom = Math.min(
        sampleCornerField(cornerFloor, seg.x0, seg.z0),
        sampleCornerField(cornerFloor, seg.x1, seg.z1),
      ) - 0.4; // deep skirt: rolling floors must never peek under the wall
      const top = Math.max(
        sampleCornerField(cornerCeil, seg.x0, seg.z0),
        sampleCornerField(cornerCeil, seg.x1, seg.z1),
      ) + 0.05;

      // Normal points toward the open (floor) side per table winding
      const dx = seg.x1 - seg.x0;
      const dz = seg.z1 - seg.z0;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;

      const x0 = seg.x0 + nx * INSET;
      const z0 = seg.z0 + nz * INSET;
      const x1 = seg.x1 + nx * INSET;
      const z1 = seg.z1 + nz * INSET;

      const vi = buf.verts.length / 3;
      buf.verts.push(x0, bottom, z0);
      buf.verts.push(x1, bottom, z1);
      buf.verts.push(x1, top, z1);
      buf.verts.push(x0, top, z0);
      buf.idxs.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      buf.uvs.push(0, bottom / TILE_SIZE, 1, bottom / TILE_SIZE, 1, top / TILE_SIZE, 0, top / TILE_SIZE);
      buf.norms.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    }

    // Build one mesh set per region with tinted materials
    for (const [key, buf] of regions) {
      const tint = REGION_TINTS[key];
      const emissive = REGION_EMISSIVE[key] ?? 0x000000;
      const wallMat = new THREE.MeshStandardMaterial({ map: WALL_TEX, color: tint, emissive, roughness: 0.85, side: THREE.DoubleSide });
      const floorMat = new THREE.MeshStandardMaterial({ map: FLOOR_TEX, color: tint, emissive, roughness: 0.9, side: THREE.DoubleSide });
      const ceilMat = new THREE.MeshStandardMaterial({ map: CEIL_TEX, color: tint, emissive, roughness: 0.95, side: THREE.DoubleSide });

      this.addMesh(buf.floor, floorMat);
      this.addMesh(buf.ceil, ceilMat);
      this.addMesh(buf.wall, wallMat);
      this.addMesh(buf.caveWall, wallMat);
    }

    const stairsMat = new THREE.MeshStandardMaterial({ map: STAIRS_TEX, roughness: 0.7, emissive: 0x1a3a2a, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    this.addMesh(stairs, stairsMat);

    // Exit marker — a glowing cube floating over the stairs so the exit
    // reads from across a hall, not just when you look at the floor
    const exitX = dungeon.exit.x * TILE_SIZE + TILE_SIZE / 2;
    const exitZ = dungeon.exit.y * TILE_SIZE + TILE_SIZE / 2;
    const exitFloor = dungeon.floorHeights[dungeon.exit.y]?.[dungeon.exit.x] ?? 0;
    this.exitMarkerBaseY = exitFloor + 1.5;
    const markerGeom = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a1a,
      emissive: 0x22ff88,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });
    this.exitMarker = new THREE.Mesh(markerGeom, markerMat);
    this.exitMarker.position.set(exitX, this.exitMarkerBaseY, exitZ);
    this.exitMarker.rotation.set(Math.PI / 5, Math.PI / 4, 0); // corner-up crystal look
    this.meshGroup.add(this.exitMarker);
  }

  private addMesh(buf: MeshBuffers, material: THREE.Material): void {
    if (buf.verts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norms, 3));
    geom.setIndex(buf.idxs);
    const mesh = new THREE.Mesh(geom, material);
    this.meshGroup.add(mesh);
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

/** Tessellation for floor tiles at pit boundaries — the plunge and its
 *  shoulder get real curvature instead of one giant facet */
const PIT_TESS = 4;

/**
 * One sub-quad of a tessellated floor patch. Heights are sampled from the
 * corner field (smoothstep), UVs span the tile so the texture is unchanged.
 */
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

/** Tessellated floor tile sampled from the corner field. */
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

/**
 * Sloped horizontal quad through four corner heights.
 * facingUp=true for floors, false for ceilings.
 */
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

  // One averaged normal for the (possibly non-planar) quad, from its diagonals
  _a.set(s, h11 - h00, s); // (x,z) -> (x+s,z+s)
  _b.set(-s, h01 - h10, s); // (x+s,z) -> (x,z+s)
  _n.crossVectors(_a, _b).normalize();
  if (facingUp && _n.y < 0) _n.negate();
  if (!facingUp && _n.y > 0) _n.negate();
  for (let k = 0; k < 4; k++) buf.norms.push(_n.x, _n.y, _n.z);
}

const SIDE_DEF = {
  north: { ax: 0, az: 0, bx: 1, bz: 0, nx: 0, nz: 1 },
  south: { ax: 0, az: 1, bx: 1, bz: 1, nx: 0, nz: -1 },
  west: { ax: 0, az: 0, bx: 0, bz: 1, nx: 1, nz: 0 },
  east: { ax: 1, az: 0, bx: 1, bz: 1, nx: -1, nz: 0 },
} as const;

export type WallSide = keyof typeof SIDE_DEF;

/**
 * Vertical wall quad spanning floor corner heights (fA, fB) to ceiling
 * corner heights (hA, hB) along the [s0, s1] span of the face (0..1 from
 * corner A to corner B). Material is double-sided, so winding is uniform;
 * texture tiles once per TILE_SIZE both ways.
 */
function addWallQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  side: WallSide,
  fA: number, fB: number,
  hA: number, hB: number,
  s0 = 0, s1 = 1,
): void {
  const s = TILE_SIZE;
  const d = SIDE_DEF[side];
  const i = buf.verts.length / 3;

  const ax = wx + d.ax * s;
  const az = wz + d.az * s;
  const bx = wx + d.bx * s;
  const bz = wz + d.bz * s;

  const x0 = ax + (bx - ax) * s0;
  const z0 = az + (bz - az) * s0;
  const x1 = ax + (bx - ax) * s1;
  const z1 = az + (bz - az) * s1;
  const f0 = fA + (fB - fA) * s0;
  const f1 = fA + (fB - fA) * s1;
  const h0 = hA + (hB - hA) * s0;
  const h1 = hA + (hB - hA) * s1;

  buf.verts.push(x0, f0, z0, x1, f1, z1, x1, h1, z1, x0, h0, z0);
  for (let k = 0; k < 4; k++) buf.norms.push(d.nx, 0, d.nz);
  buf.uvs.push(s0, f0 / s, s1, f1 / s, s1, h1 / s, s0, h0 / s);
  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

