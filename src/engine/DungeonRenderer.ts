import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../game/types';
import type { DungeonData } from '../game/types';
import { getCell, type BiomeType } from '../game/dungeon/cells';
import { buildCornerField, sampleCornerField } from '../game/dungeon/heightfield';
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
            const buf = regionBuffers(regionOf(x, y));
            addHorizontalQuad(buf.floor, wx, wz, cornerFloor[y]![x]!, cornerFloor[y]![x + 1]!, cornerFloor[y + 1]![x]!, cornerFloor[y + 1]![x + 1]!, true);
            addHorizontalQuad(buf.ceil, wx, wz, cornerCeil[y]![x]!, cornerCeil[y]![x + 1]!, cornerCeil[y + 1]![x]!, cornerCeil[y + 1]![x + 1]!, false);
          }
          continue;
        }

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;
        const buf = regionBuffers(regionOf(x, y));

        const f00 = cornerFloor[y]![x]!;
        const f10 = cornerFloor[y]![x + 1]!;
        const f01 = cornerFloor[y + 1]![x]!;
        const f11 = cornerFloor[y + 1]![x + 1]!;
        const h00 = cornerCeil[y]![x]!;
        const h10 = cornerCeil[y]![x + 1]!;
        const h01 = cornerCeil[y + 1]![x]!;
        const h11 = cornerCeil[y + 1]![x + 1]!;

        addHorizontalQuad(tile === TileType.StairsDown ? stairs : buf.floor, wx, wz, f00, f10, f01, f11, true);
        addHorizontalQuad(buf.ceil, wx, wz, h00, h10, h01, h11, false);

        // Walls span from the floor corners to the ceiling corners
        if (isWall(dungeon, x, y - 1)) addWallQuad(buf.wall, wx, wz, 'north', f00, f10, h00, h10);
        if (isWall(dungeon, x, y + 1)) addWallQuad(buf.wall, wx, wz, 'south', f01, f11, h01, h11);
        if (isWall(dungeon, x - 1, y)) addWallQuad(buf.wall, wx, wz, 'west', f00, f01, h00, h01);
        if (isWall(dungeon, x + 1, y)) addWallQuad(buf.wall, wx, wz, 'east', f10, f11, h10, h11);
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
      ) - 0.15;
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

/**
 * Vertical wall quad spanning floor corner heights (fA, fB) to ceiling
 * corner heights (hA, hB). A/B are the side's two corners in the same
 * order for floor and ceiling. Texture tiles once per TILE_SIZE both ways.
 */
function addWallQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  side: 'north' | 'south' | 'east' | 'west',
  fA: number, fB: number,
  hA: number, hB: number,
): void {
  const s = TILE_SIZE;
  const i = buf.verts.length / 3;

  switch (side) {
    case 'north':
      buf.verts.push(wx, fA, wz, wx + s, fB, wz, wx + s, hB, wz, wx, hA, wz);
      buf.norms.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      break;
    case 'south':
      buf.verts.push(wx + s, fB, wz + s, wx, fA, wz + s, wx, hA, wz + s, wx + s, hB, wz + s);
      buf.norms.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      break;
    case 'west':
      buf.verts.push(wx, fB, wz + s, wx, fA, wz, wx, hA, wz, wx, hB, wz + s);
      buf.norms.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
      break;
    case 'east':
      buf.verts.push(wx + s, fA, wz, wx + s, fB, wz + s, wx + s, hB, wz + s, wx + s, hA, wz);
      buf.norms.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
      break;
  }

  // v coordinate follows world height so the texture never stretches
  const y0 = buf.verts[i * 3 + 1]! / s;
  const y1 = buf.verts[(i + 1) * 3 + 1]! / s;
  const y2 = buf.verts[(i + 2) * 3 + 1]! / s;
  const y3 = buf.verts[(i + 3) * 3 + 1]! / s;
  buf.uvs.push(0, y0, 1, y1, 1, y2, 0, y3);

  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

