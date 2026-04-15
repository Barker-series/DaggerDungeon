/**
 * CryptJS Prefab System — ported to Three.js r183 BufferGeometry
 *
 * Original: DhrBaksteen/CryptJS (Three.js r69, Geometry + Face3)
 * Ported: BufferGeometry + Float32Array attributes
 *
 * Builds detailed 3D room geometry from pre-authored prefab wall segments.
 * Each wall tile gets a prefab (flat wall, arch, pillar, beam, etc.)
 * rotated to face the correct direction.
 */

import * as THREE from 'three';
import prefabData from './data/prefabs.json';

// ── Types matching the JSON format ──

interface PrefabVertex { x: number; y: number; z: number }
interface PrefabUV { u: number; v: number }
interface PrefabFace {
  matGroup: string;
  v: [number, number, number];
  vn: [number, number, number];
  vt: [number, number, number];
}
interface PrefabGeom {
  vertices: PrefabVertex[];
  textureVertices: PrefabUV[];
  normalVertices: PrefabVertex[];
  faces: PrefabFace[];
}
interface Prefab {
  name: string;
  geometry: PrefabGeom;
}

const prefabs = (prefabData as { prefabs: Prefab[] }).prefabs;

// ── Direction rotation matrices (from CryptJS prefab_factory.js) ──

const DIR_MATRICES: Record<number, THREE.Matrix4> = {
  0: new THREE.Matrix4().set( // NORTH — identity
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ),
  1: new THREE.Matrix4().set( // EAST — 90° CW around Y
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  ),
  2: new THREE.Matrix4().set( // SOUTH — 180°
    -1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -1, 0,
    0, 0, 0, 1,
  ),
  3: new THREE.Matrix4().set( // WEST — 270° CW
    0, 0, 1, 0,
    0, 1, 0, 0,
    -1, 0, 0, 0,
    0, 0, 0, 1,
  ),
};

// ── Build BufferGeometry from a prefab ──

export function createPrefabGeometry(prefabName: string): THREE.BufferGeometry | null {
  const prefab = prefabs.find((p) => p.name === prefabName);
  if (!prefab) return null;

  const pg = prefab.geometry;
  const faceCount = pg.faces.length;

  // Each face is a triangle = 3 vertices
  const positions = new Float32Array(faceCount * 3 * 3);
  const normals = new Float32Array(faceCount * 3 * 3);
  const uvs = new Float32Array(faceCount * 3 * 2);

  for (let fi = 0; fi < faceCount; fi++) {
    const face = pg.faces[fi]!;
    for (let vi = 0; vi < 3; vi++) {
      const vIdx = face.v[vi as 0 | 1 | 2];
      const nIdx = face.vn[vi as 0 | 1 | 2];
      const tIdx = face.vt[vi as 0 | 1 | 2];

      const vert = pg.vertices[vIdx]!;
      const norm = pg.normalVertices[nIdx]!;
      const uv = pg.textureVertices[tIdx]!;

      const idx3 = (fi * 3 + vi) * 3;
      const idx2 = (fi * 3 + vi) * 2;

      positions[idx3] = vert.x;
      positions[idx3 + 1] = vert.y;
      positions[idx3 + 2] = vert.z;

      normals[idx3] = norm.x;
      normals[idx3 + 1] = norm.y;
      normals[idx3 + 2] = norm.z;

      uvs[idx2] = uv.u;
      uvs[idx2 + 1] = uv.v;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  return geom;
}

/**
 * Place a prefab at a grid position with rotation.
 * Returns a new BufferGeometry translated + rotated.
 *
 * row/col: grid position (CryptJS uses row=Z, col=X)
 * direction: 0=North, 1=East, 2=South, 3=West
 */
export function placePrefab(
  prefabName: string,
  row: number, col: number,
  direction: number = 0,
): THREE.BufferGeometry | null {
  const geom = createPrefabGeometry(prefabName);
  if (!geom) return null;

  const clone = geom.clone();

  // Build transform: rotation + translation
  const matrix = DIR_MATRICES[direction % 4]!.clone();
  matrix.setPosition(col, 0, row);

  clone.applyMatrix4(matrix);
  return clone;
}

/**
 * Build complete room geometry from prefabs (port of CryptJS Room.construct).
 *
 * rows/cols: room size in grid units
 * Returns a merged BufferGeometry with all wall/floor/ceiling prefabs.
 */
export function buildRoomPrefabGeometry(
  rows: number,
  cols: number,
  wallPrefab: string = 'wall',
  variationPrefab: string = 'wall_arch',
  worldOffsetX: number = 0,
  worldOffsetZ: number = 0,
): THREE.BufferGeometry | null {
  const geometries: THREE.BufferGeometry[] = [];

  const halfRows = Math.floor(rows / 2);
  const halfCols = Math.floor(cols / 2);

  for (let row = -halfRows; row < Math.ceil(rows / 2); row++) {
    for (let col = -halfCols; col < Math.ceil(cols / 2); col++) {
      // Floor + ceiling for every cell
      const fc = placePrefab('floor_ceiling', row + worldOffsetZ, col + worldOffsetX);
      if (fc) geometries.push(fc);

      const northEdge = row === -halfRows;
      const southEdge = row === Math.ceil(rows / 2) - 1;
      const eastEdge = col === -halfCols;
      const westEdge = col === Math.ceil(cols / 2) - 1;

      // Pick wall type — alternate between base wall and variation
      const useVariation = ((northEdge || southEdge) && col % 2 === 0) ||
                           ((eastEdge || westEdge) && row % 2 === 0);
      const wp = useVariation ? variationPrefab : wallPrefab;

      // Place walls on edges
      if (northEdge) {
        const g = placePrefab(wp, row + worldOffsetZ, col + worldOffsetX, 0);
        if (g) geometries.push(g);
      }
      if (southEdge) {
        const g = placePrefab(wp, row + worldOffsetZ, col + worldOffsetX, 2);
        if (g) geometries.push(g);
      }
      if (eastEdge) {
        const g = placePrefab(wp, row + worldOffsetZ, col + worldOffsetX, 3);
        if (g) geometries.push(g);
      }
      if (westEdge) {
        const g = placePrefab(wp, row + worldOffsetZ, col + worldOffsetX, 1);
        if (g) geometries.push(g);
      }
    }
  }

  if (geometries.length === 0) return null;

  // Merge all geometries into one
  return mergeGeometries(geometries);
}

/** Simple geometry merge (no BufferGeometryUtils dependency) */
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  for (const g of geoms) {
    totalVerts += g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let offset3 = 0;
  let offset2 = 0;

  for (const g of geoms) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const norm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;

    positions.set(pos.array as Float32Array, offset3);
    normals.set(norm.array as Float32Array, offset3);
    uvs.set(uv.array as Float32Array, offset2);

    offset3 += pos.count * 3;
    offset2 += uv.count * 2;

    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return merged;
}

/** Available prefab names */
export const PREFAB_NAMES = prefabs.map((p) => p.name);

/** Available wall variations for the crypt style */
export const WALL_VARIATIONS = [
  'wall_beam', 'wall_round_out', 'wall_round_in',
  'wall_arch', 'wall_inset', 'wall_pilar',
];
