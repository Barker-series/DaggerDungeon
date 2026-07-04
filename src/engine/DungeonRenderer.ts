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

interface MeshBuffers {
  verts: number[];
  idxs: number[];
  uvs: number[];
  norms: number[];
}

function newBuffers(): MeshBuffers {
  return { verts: [], idxs: [], uvs: [], norms: [] };
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
    // Ceiling heights are averaged at tile corners so the ceiling forms one
    // continuous surface — per-tile noise becomes slopes, cell steps become
    // short ramps, and walls seal exactly by sharing the corner heights.
    const cornerH = buildCornerHeights(dungeon);

    // Per-tile cave biome flag
    const CELL_TILE_SIZE = 14;
    const isCave = (tx: number, tz: number): boolean => {
      const cell = getCell(Math.floor(tx / CELL_TILE_SIZE), Math.floor(tz / CELL_TILE_SIZE));
      return cell?.biome === 'cave';
    };

    const floor = newBuffers();
    const ceil = newBuffers();
    const wall = newBuffers();
    const stairs = newBuffers();

    for (let y = 0; y < dungeon.height; y++) {
      for (let x = 0; x < dungeon.width; x++) {
        const tile = dungeon.tiles[y]![x]!;
        if (tile === TileType.Wall) continue;

        const wx = x * TILE_SIZE;
        const wz = y * TILE_SIZE;

        if (tile === TileType.StairsDown) {
          addFloorQuad(stairs, wx, wz);
        } else {
          addFloorQuad(floor, wx, wz);
        }

        // Ceiling — sloped quad through the four corner heights
        const h00 = cornerH[y]![x]!;
        const h10 = cornerH[y]![x + 1]!;
        const h01 = cornerH[y + 1]![x]!;
        const h11 = cornerH[y + 1]![x + 1]!;
        addCeilingQuad(ceil, wx, wz, h00, h10, h01, h11);

        // Walls rise to the shared corner heights, so they meet the ceiling
        // with no gap and no transition-strip patches.
        if (isWall(dungeon, x, y - 1)) addWallQuad(wall, wx, wz, 'north', h00, h10);
        if (isWall(dungeon, x, y + 1)) addWallQuad(wall, wx, wz, 'south', h01, h11);
        if (isWall(dungeon, x - 1, y)) addWallQuad(wall, wx, wz, 'west', h00, h01);
        if (isWall(dungeon, x + 1, y)) addWallQuad(wall, wx, wz, 'east', h10, h11);
      }
    }

    // ── Marching squares cave walls ──
    // For cave biome regions, overlay smooth wall contours on the axis-aligned
    // quads (which stay underneath to seal edges and boundaries).
    const caveWall = newBuffers();
    buildCaveWalls(dungeon, cornerH, isCave, caveWall);

    // Build meshes with textures
    const wallMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/wall-stone.png'), roughness: 0.85, side: THREE.DoubleSide });
    const floorMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/floor-dirt.png'), roughness: 0.9, side: THREE.DoubleSide });
    const ceilMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/ceiling-dark.png'), roughness: 0.95, side: THREE.DoubleSide });
    const stairsMat = new THREE.MeshStandardMaterial({ map: loadTex('/textures/stairs-down.png'), roughness: 0.7, emissive: 0x1a3a2a, emissiveIntensity: 0.15, side: THREE.DoubleSide });

    this.addMesh(floor, floorMat);
    this.addMesh(ceil, ceilMat);
    this.addMesh(wall, wallMat);
    // Cave walls get same material for now — can swap to rocky texture later
    this.addMesh(caveWall, wallMat);
    this.addMesh(stairs, stairsMat);
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

/**
 * Average ceiling heights of the (up to 4) floor tiles touching each grid
 * corner. Corners touching no floor tile keep a filler value — no geometry
 * ever references them.
 */
function buildCornerHeights(dungeon: DungeonData): number[][] {
  const w = dungeon.width;
  const h = dungeon.height;
  const corners: number[][] = Array.from({ length: h + 1 }, () =>
    Array.from({ length: w + 1 }, () => 0),
  );

  for (let cy = 0; cy <= h; cy++) {
    for (let cx = 0; cx <= w; cx++) {
      let sum = 0;
      let count = 0;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (tx! < 0 || ty! < 0 || tx! >= w || ty! >= h) continue;
        if (dungeon.tiles[ty!]![tx!] === TileType.Wall) continue;
        sum += dungeon.ceilingHeights[ty!]![tx!]!;
        count++;
      }
      corners[cy]![cx] = count > 0 ? sum / count : 3;
    }
  }

  return corners;
}

function addFloorQuad(buf: MeshBuffers, wx: number, wz: number): void {
  const s = TILE_SIZE;
  const i = buf.verts.length / 3;
  // Four corners of the floor tile at y=0
  buf.verts.push(wx, 0, wz);
  buf.verts.push(wx + s, 0, wz);
  buf.verts.push(wx + s, 0, wz + s);
  buf.verts.push(wx, 0, wz + s);
  // Indices (two triangles, CCW for upward-facing normal)
  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
  // UVs
  buf.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  // Normals (up)
  buf.norms.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

function addCeilingQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  h00: number, h10: number, h01: number, h11: number,
): void {
  const s = TILE_SIZE;
  const i = buf.verts.length / 3;
  buf.verts.push(wx, h00, wz);
  buf.verts.push(wx, h01, wz + s);
  buf.verts.push(wx + s, h11, wz + s);
  buf.verts.push(wx + s, h10, wz);
  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
  buf.uvs.push(0, 0, 0, 1, 1, 1, 1, 0);

  // One averaged downward-facing normal for the (possibly non-planar) quad
  _a.set(s, h10 - h01, -s); // v3 - v1
  _b.set(s, h11 - h00, s); // v2 - v0
  _n.crossVectors(_a, _b).normalize();
  if (_n.y > 0) _n.negate();
  for (let k = 0; k < 4; k++) buf.norms.push(_n.x, _n.y, _n.z);
}

/**
 * Vertical wall quad whose top edge follows the ceiling corner heights
 * (hA at the first corner of the side, hB at the second).
 * Texture tiles once per TILE_SIZE both ways so tall walls don't stretch.
 */
function addWallQuad(
  buf: MeshBuffers,
  wx: number, wz: number,
  side: 'north' | 'south' | 'east' | 'west',
  hA: number, hB: number,
): void {
  const s = TILE_SIZE;
  const i = buf.verts.length / 3;

  switch (side) {
    case 'north':
      buf.verts.push(wx, 0, wz, wx + s, 0, wz, wx + s, hB, wz, wx, hA, wz);
      buf.norms.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      break;
    case 'south':
      buf.verts.push(wx + s, 0, wz + s, wx, 0, wz + s, wx, hA, wz + s, wx + s, hB, wz + s);
      buf.norms.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
      break;
    case 'west':
      buf.verts.push(wx, 0, wz + s, wx, 0, wz, wx, hA, wz, wx, hB, wz + s);
      buf.norms.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
      break;
    case 'east':
      buf.verts.push(wx + s, 0, wz, wx + s, 0, wz + s, wx + s, hB, wz + s, wx + s, hA, wz);
      buf.norms.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
      break;
  }

  // Vertex order is bottom0, bottom1, top1, top0 — top v coords follow height
  const v2 = buf.verts[(i + 2) * 3 + 1]! / s;
  const v3 = buf.verts[(i + 3) * 3 + 1]! / s;
  buf.uvs.push(0, 0, 1, 0, 1, v2, 0, v3);

  buf.idxs.push(i, i + 1, i + 2, i, i + 2, i + 3);
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
  cornerH: number[][],
  isCave: (tx: number, tz: number) => boolean,
  buf: MeshBuffers,
): void {
  const s = TILE_SIZE;

  // Helper: get tile value, treating out-of-bounds as wall
  const getTile = (tx: number, tz: number): number => {
    if (tx < 0 || tz < 0 || tx >= dungeon.width || tz >= dungeon.height) return 0;
    return dungeon.tiles[tz]![tx] !== TileType.Wall ? 1 : 0;
  };

  // Height above an edge midpoint — midpoint of the edge's two grid corners.
  // Slightly overshooting the ceiling is fine (hidden above it); undershooting
  // would open a gap, so take the max toward the sealing axis wall behind.
  const edgeTop = (cx0: number, cz0: number, cx1: number, cz1: number): number => {
    const a = cornerH[cz0]?.[cx0] ?? 3;
    const b = cornerH[cz1]?.[cx1] ?? 3;
    return Math.max(a, b);
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

      // Edge midpoints in world space + their top heights (from the two
      // grid corners each midpoint sits between).
      // 0=top (between TL and TR), 1=right (between TR and BR),
      // 2=bottom (between BL and BR), 3=left (between TL and BL)
      const edgeMid: [number, number, number][] = [
        [wx + s * 0.5, wz, edgeTop(tx, tz, tx + 1, tz)],                 // top
        [wx + s, wz + s * 0.5, edgeTop(tx + 1, tz, tx + 1, tz + 1)],     // right
        [wx + s * 0.5, wz + s, edgeTop(tx, tz + 1, tx + 1, tz + 1)],     // bottom
        [wx, wz + s * 0.5, edgeTop(tx, tz, tx, tz + 1)],                 // left
      ];

      // For each segment, extrude a vertical wall quad
      for (const seg of (segments ?? [])) {
        if (!seg || seg.length < 2) continue;
        const e0 = seg[0]!;
        const e1 = seg[1]!;
        const p0 = edgeMid[e0]!;
        const p1 = edgeMid[e1]!;
        const h = Math.max(p0[2], p1[2]);

        // Wall quad: p0 bottom → p1 bottom → p1 top → p0 top
        const vi = buf.verts.length / 3;
        buf.verts.push(p0[0], 0, p0[1]);
        buf.verts.push(p1[0], 0, p1[1]);
        buf.verts.push(p1[0], h, p1[1]);
        buf.verts.push(p0[0], h, p0[1]);

        buf.idxs.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        buf.uvs.push(0, 0, 1, 0, 1, h / s, 0, h / s);

        // Normal: perpendicular to the segment, pointing toward floor side
        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        buf.norms.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      }
    }
  }
}
