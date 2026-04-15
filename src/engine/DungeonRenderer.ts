import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../game/types';
import type { DungeonData } from '../game/types';
// CryptJS prefabs removed — will be reimplemented as a layer
// import { buildRoomPrefabGeometry, WALL_VARIATIONS } from '../game/dungeon/prefabs';

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

        // Floor
        if (tile === TileType.StairsDown) {
          addFloorQuad(stairsVerts, stairsIdxs, stairsUvs, stairsNorms, wx, wz);
        } else {
          addFloorQuad(floorVerts, floorIdxs, floorUvs, floorNorms, wx, wz);
        }

        // Ceiling at per-tile height
        addCeilingQuad(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, wx, wz, h);

        // Walls — use MAX height of adjacent tiles to seal gaps
        const hN = getHeight(heightMap, dungeon, x, y - 1, h);
        const hS = getHeight(heightMap, dungeon, x, y + 1, h);
        const hW = getHeight(heightMap, dungeon, x - 1, y, h);
        const hE = getHeight(heightMap, dungeon, x + 1, y, h);

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

    // Build meshes with textures
    const wallMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/wall-stone.png'), roughness: 0.85, side: THREE.DoubleSide });
    const floorMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/floor-dirt.png'), roughness: 0.9, side: THREE.DoubleSide });
    const ceilMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/ceiling-dark.png'), roughness: 0.95, side: THREE.DoubleSide });
    const stairsMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/stairs-down.png'), roughness: 0.7, emissive: 0x1a3a2a, emissiveIntensity: 0.15, side: THREE.DoubleSide });

    this.addMesh(floorVerts, floorIdxs, floorUvs, floorNorms, floorMat);
    this.addMesh(ceilVerts, ceilIdxs, ceilUvs, ceilNorms, ceilMat);
    this.addMesh(wallVerts, wallIdxs, wallUvs, wallNorms, wallMat);
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

