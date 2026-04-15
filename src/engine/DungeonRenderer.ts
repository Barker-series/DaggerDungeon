import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../game/types';
import type { DungeonData } from '../game/types';
import { getCell } from '../game/dungeon/cells';

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

export class DungeonRenderer {
  private scene: THREE.Scene;
  private meshGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);
  }

  clear(): void {
    // Dispose all children
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
  }

  build(dungeon: DungeonData): void {
    // Build a per-tile height map from room data
    const CORRIDOR_HEIGHT = 2.5;
    const heightMap: number[][] = Array.from({ length: dungeon.height }, () =>
      Array.from({ length: dungeon.width }, () => CORRIDOR_HEIGHT),
    );
    for (const room of dungeon.rooms) {
      for (let y = room.top; y < room.top + room.height; y++) {
        for (let x = room.left; x < room.left + room.width; x++) {
          if (y >= 0 && y < dungeon.height && x >= 0 && x < dungeon.width) {
            heightMap[y]![x] = room.ceilingHeight;
          }
        }
      }
    }

    // Per-tile cave biome flag
    const CELL_TILE_SIZE = 14;
    const isCave = (tx: number, tz: number): boolean => {
      const cell = getCell(Math.floor(tx / CELL_TILE_SIZE), Math.floor(tz / CELL_TILE_SIZE));
      return cell?.biome === 'cave';
    };

    const floorVerts: number[] = [];
    const floorIdxs: number[] = [];
    const floorUvs: number[] = [];
    const floorNorms: number[] = [];

    const ceilVerts: number[] = [];
    const ceilIdxs: number[] = [];
    const ceilUvs: number[] = [];
    const ceilNorms: number[] = [];

    const wallVerts: number[] = [];
    const wallIdxs: number[] = [];
    const wallUvs: number[] = [];
    const wallNorms: number[] = [];

    const stairsVerts: number[] = [];
    const stairsIdxs: number[] = [];
    const stairsUvs: number[] = [];
    const stairsNorms: number[] = [];

    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        const tile = dungeon.tiles[y]![x]!;
        if (tile === TileType.Wall) continue;

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;
        const h = heightMap[y]![x]!;

        // Floor + ceiling: always use regular quads (even for cave — no visible jaggedness from inside)
        if (tile === TileType.StairsDown) {
          addFloorQuad(stairsVerts, stairsIdxs, stairsUvs, stairsNorms, wx, wz);
        } else {
          addFloorQuad(floorVerts, floorIdxs, floorUvs, floorNorms, wx, wz);
        }
        addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, h);

        // Walls — use MAX height of adjacent tiles to seal gaps
        const hN = getHeight(heightMap, dungeon, x, y - 1, h);
        const hS = getHeight(heightMap, dungeon, x, y + 1, h);
        const hW = getHeight(heightMap, dungeon, x - 1, y, h);
        const hE = getHeight(heightMap, dungeon, x + 1, y, h);

        // All tiles get regular wall quads. Cave tiles also get marching squares
        // walls on top — the smooth walls cover the axis-aligned ones, and the
        // axis-aligned ones seal any gaps at edges/boundaries.
        if (isWall(dungeon, x, y - 1)) addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'north', Math.max(h, hN));
        if (isWall(dungeon, x, y + 1)) addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'south', Math.max(h, hS));
        if (isWall(dungeon, x - 1, y)) addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'west', Math.max(h, hW));
        if (isWall(dungeon, x + 1, y)) addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'east', Math.max(h, hE));

        // Transition walls — where two floor tiles have different heights,
        // add a wall strip from the lower ceiling to the higher ceiling
        if (!isWall(dungeon, x, y - 1) && hN !== h) {
          const hi = Math.max(h, hN);
          addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'north', hi);
          // Also add a ceiling patch at the lower height to close the gap
          if (h > hN) addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, hN);
        }
        if (!isWall(dungeon, x, y + 1) && hS !== h) {
          const hi = Math.max(h, hS);
          addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'south', hi);
          if (h > hS) addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, hS);
        }
        if (!isWall(dungeon, x - 1, y) && hW !== h) {
          const hi = Math.max(h, hW);
          addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'west', hi);
          if (h > hW) addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, hW);
        }
        if (!isWall(dungeon, x + 1, y) && hE !== h) {
          const hi = Math.max(h, hE);
          addWallQuad(wallVerts, wallIdxs, wallUvs, wallNorms, wx, wz, 'east', hi);
          if (h > hE) addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, hE);
        }
      }
    }

    // ── Marching squares cave walls ──
    // For cave biome regions, generate smooth wall contours instead of axis-aligned quads
    const caveWallVerts: number[] = [];
    const caveWallIdxs: number[] = [];
    const caveWallUvs: number[] = [];
    const caveWallNorms: number[] = [];

    buildCaveWalls(dungeon, heightMap, isCave,
      caveWallVerts, caveWallIdxs, caveWallUvs, caveWallNorms,
      floorVerts, floorIdxs, floorUvs, floorNorms,
      ceilVerts, ceilIdxs, ceilUvs, ceilNorms,
    );

    // Build meshes with textures
    const wallMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/wall-stone.png'), roughness: 0.85, side: THREE.DoubleSide });
    const floorMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/floor-dirt.png'), roughness: 0.9, side: THREE.DoubleSide });
    const ceilMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/ceiling-dark.png'), roughness: 0.95, side: THREE.DoubleSide });
    const stairsMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/stairs-down.png'), roughness: 0.7, emissive: 0x1a3a2a, emissiveIntensity: 0.15, side: THREE.DoubleSide });

    this.addMesh(floorVerts, floorIdxs, floorUvs, floorNorms, floorMat);
    this.addMesh(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, ceilMat);
    this.addMesh(wallVerts, wallIdxs, wallUvs, wallNorms, wallMat);
    // Cave walls get same material for now — can swap to rocky texture later
    this.addMesh(caveWallVerts, caveWallIdxs, caveWallUvs, caveWallNorms, wallMat);
    this.addMesh(stairsVerts, stairsIdxs, stairsUvs, stairsNorms, stairsMat);

    // CryptJS prefab geometry removed — will be reimplemented as a layer
  }

  private addMesh(
    verts: number[],
    idxs: number[],
    uvs: number[],
    norms: number[],
    material: THREE.Material,
  ): void {
    if (verts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
    geom.setIndex(idxs);
    const mesh = new THREE.Mesh(geom, material);
    this.meshGroup.add(mesh);
  }
}

// ── Geometry helpers ──

function isWall(dungeon: DungeonData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= dungeon.width || y >= dungeon.height) return true;
  return dungeon.tiles[y]![x] === TileType.Wall;
}

function getHeight(heightMap: number[][], dungeon: DungeonData, x: number, y: number, fallback: number): number {
  if (x < 0 || y < 0 || x >= dungeon.width || y >= dungeon.height) return fallback;
  return heightMap[y]![x] ?? fallback;
}

function addFloorQuad(
  verts: number[], idxs: number[], uvs: number[], norms: number[],
  wx: number, wz: number,
): void {
  const s = TILE_SIZE;
  const i = verts.length / 3;
  // Four corners of the floor tile at y=0
  verts.push(wx, 0, wz);
  verts.push(wx + s, 0, wz);
  verts.push(wx + s, 0, wz + s);
  verts.push(wx, 0, wz + s);
  // Indices (two triangles, CCW for upward-facing normal)
  idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
  // UVs
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  // Normals (up)
  norms.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
}

function addCeilingQuad(
  verts: number[], idxs: number[], uvs: number[], norms: number[],
  wx: number, wz: number, h: number,
): void {
  const s = TILE_SIZE;
  const i = verts.length / 3;
  verts.push(wx, h, wz);
  verts.push(wx, h, wz + s);
  verts.push(wx + s, h, wz + s);
  verts.push(wx + s, h, wz);
  idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
  uvs.push(0, 0, 0, 1, 1, 1, 1, 0);
  norms.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
}

function addWallQuad(
  verts: number[], idxs: number[], uvs: number[], norms: number[],
  wx: number, wz: number,
  side: 'north' | 'south' | 'east' | 'west',
  h: number,
): void {
  const s = TILE_SIZE;
  const i = verts.length / 3;

  switch (side) {
    case 'north':
      verts.push(wx, 0, wz, wx + s, 0, wz, wx + s, h, wz, wx, h, wz);
      norms.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      break;
    case 'south':
      verts.push(wx + s, 0, wz + s, wx, 0, wz + s, wx, h, wz + s, wx + s, h, wz + s);
      norms.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      break;
    case 'west':
      verts.push(wx, 0, wz + s, wx, 0, wz, wx, h, wz, wx, h, wz + s);
      norms.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
      break;
    case 'east':
      verts.push(wx + s, 0, wz, wx + s, 0, wz + s, wx + s, h, wz + s, wx + s, h, wz);
      norms.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
      break;
  }

  idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
}

// ── Marching Squares Cave Walls ──

/**
 * Marching squares lookup table.
 * For each 2x2 cell configuration (4-bit index from TL,TR,BR,BL corners),
 * returns line segments as pairs of edge indices.
 * Edge indices: 0=top, 1=right, 2=bottom, 3=left
 * Each edge midpoint is where the contour crosses.
 */
const MS_TABLE: number[][][] = [
  [],                // 0: all wall
  [[3, 2]],          // 1: BL floor
  [[2, 1]],          // 2: BR floor
  [[3, 1]],          // 3: BL+BR floor
  [[1, 0]],          // 4: TR floor
  [[3, 0], [1, 2]],  // 5: BL+TR (saddle)
  [[2, 0]],          // 6: BR+TR floor
  [[3, 0]],          // 7: BL+BR+TR floor
  [[0, 3]],          // 8: TL floor
  [[0, 2]],          // 9: TL+BL floor
  [[0, 1], [2, 3]],  // 10: TL+BR (saddle)
  [[0, 1]],          // 11: TL+BL+BR floor
  [[1, 3]],          // 12: TL+TR floor
  [[1, 2]],          // 13: TL+TR+BL floor
  [[2, 3]],          // 14: TL+TR+BR floor
  [],                // 15: all floor
];

function buildCaveWalls(
  dungeon: DungeonData,
  heightMap: number[][],
  isCave: (tx: number, tz: number) => boolean,
  verts: number[], idxs: number[], uvs: number[], norms: number[],
  _floorVerts: number[], _floorIdxs: number[], _floorUvs: number[], _floorNorms: number[],
  _ceilVerts: number[], _ceilIdxs: number[], _ceilUvs: number[], _ceilNorms: number[],
): void {
  const s = TILE_SIZE;

  // Helper: get tile value, treating out-of-bounds as wall
  const getTile = (tx: number, tz: number): number => {
    if (tx < 0 || tz < 0 || tx >= dungeon.width || tz >= dungeon.height) return 0;
    return dungeon.tiles[tz]![tx] !== TileType.Wall ? 1 : 0;
  };

  // Walk every 2x2 group — include last column/row by treating OOB as wall
  for (let tz = 0; tz < dungeon.height; tz++) {
    for (let tx = 0; tx < dungeon.width; tx++) {
      // Process if at least one corner is in cave biome
      if (!isCave(tx, tz) && !isCave(tx + 1, tz) && !isCave(tx, tz + 1) && !isCave(tx + 1, tz + 1)) continue;

      // Build 4-bit index: TL=bit3, TR=bit2, BR=bit1, BL=bit0
      const tl = getTile(tx, tz);
      const tr = getTile(tx + 1, tz);
      const br = getTile(tx + 1, tz + 1);
      const bl = getTile(tx, tz + 1);

      const caseIdx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (caseIdx === 0) continue; // all wall, nothing to do

      const segments = MS_TABLE[caseIdx];

      // World position of this 2x2 cell's top-left corner
      const wx = tx * s;
      const wz = tz * s;

      // Edge midpoints in world space
      // 0=top (between TL and TR), 1=right (between TR and BR),
      // 2=bottom (between BL and BR), 3=left (between TL and BL)
      const edgeMid: [number, number][] = [
        [wx + s * 0.5, wz],         // top
        [wx + s,       wz + s * 0.5], // right
        [wx + s * 0.5, wz + s],     // bottom
        [wx,           wz + s * 0.5], // left
      ];

      // Get ceiling height for this area
      const h = heightMap[tz]?.[tx] ?? 3;

      // For each segment, extrude a vertical wall quad
      for (const seg of (segments ?? [])) {
        if (!seg || seg.length < 2) continue;
        const e0 = seg[0]!;
        const e1 = seg[1]!;
        const p0 = edgeMid[e0]!;
        const p1 = edgeMid[e1]!;

        // Wall quad: p0 bottom → p1 bottom → p1 top → p0 top
        const vi = verts.length / 3;
        verts.push(p0[0], 0, p0[1]);
        verts.push(p1[0], 0, p1[1]);
        verts.push(p1[0], h, p1[1]);
        verts.push(p0[0], h, p0[1]);

        idxs.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

        // Normal: perpendicular to the segment, pointing toward floor side
        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        norms.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      }

      // Floor + ceiling use regular tile quads — only walls get marching squares
    }
  }
}
