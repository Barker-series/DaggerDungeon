import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// GLTFExporter uses FileReader to assemble a binary GLB. Node provides Blob
// but not FileReader, so this tiny compatibility layer is sufficient for
// geometry-only reference assets.
globalThis.FileReader = class {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const outputDir = new URL('../reference-assets/', import.meta.url);
await fs.mkdir(outputDir, { recursive: true });

const placeholderMaterial = new THREE.MeshStandardMaterial({
  color: 0x8a8a86,
  roughness: 0.9,
  metalness: 0,
});
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xd4a44a });

function namedEmpty(name, x, y, z) {
  const socket = new THREE.Object3D();
  socket.name = name;
  socket.position.set(x, y, z);
  return socket;
}

function playerMarker(x, z) {
  const marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8),
    markerMaterial,
  );
  marker.name = 'REFERENCE_Player_1_6m';
  marker.position.set(x, 0.8, z);
  return marker;
}

async function exportGlb(name, root) {
  const exporter = new GLTFExporter();
  const buffer = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: false,
  });
  await fs.writeFile(new URL(name, outputDir), Buffer.from(buffer));
}

{
  const root = new THREE.Group();
  root.name = 'column_reference_3m';
  const column = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), placeholderMaterial);
  column.name = 'MESH_column_placeholder';
  column.position.y = 1.5;
  root.add(column);
  const collision = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3));
  collision.name = 'COL_column';
  collision.position.y = 1.5;
  collision.visible = false;
  root.add(collision);
  root.add(namedEmpty('SOCKET_BOTTOM', 0, 0, 0));
  root.add(namedEmpty('SOCKET_TOP', 0, 3, 0));
  root.add(playerMarker(2.1, 0));
  await exportGlb('column_reference_3m.glb', root);
}

{
  const root = new THREE.Group();
  root.name = 'stair_reference_3x6';
  const steps = 12;
  const tread = 6 / steps;
  const rise = 3 / steps;
  for (let i = 0; i < steps; i++) {
    const height = rise * (i + 1);
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(3, height, tread),
      placeholderMaterial,
    );
    step.name = `MESH_step_${String(i + 1).padStart(2, '0')}`;
    step.position.set(0, height / 2, -3 + tread * (i + 0.5));
    root.add(step);
  }
  const collision = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, Math.hypot(6, 3)));
  collision.name = 'COL_stair_ramp';
  collision.rotation.x = -Math.atan2(3, 6);
  collision.position.set(0, 1.5, 0);
  collision.visible = false;
  root.add(collision);
  root.add(namedEmpty('SOCKET_BOTTOM', 0, 0, -3));
  root.add(namedEmpty('SOCKET_TOP', 0, 3, 3));
  root.add(playerMarker(2.1, -3));
  await exportGlb('stair_reference_3x6.glb', root);
}

