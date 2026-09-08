import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert.ok(
  existsSync(new URL('../src/game/material-presets.ts', import.meta.url)),
  'material choices need one editable preset file',
);
const presets = await import('../src/game/material-presets');
const THREE = await import('three');
THREE.TextureLoader.prototype.load = function (url: string) {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
} as any;
const materials = await import('../src/engine/SourceMaterials');
const { pipeFinish } = await import('../src/game/dungeon/infrastructure-finishes');
const { makeConcreteMaterial } = await import('../src/engine/DungeonRenderer');
for (const [role, roughness] of [
  ['concrete-wall', 0.9],
  ['concrete-floor', 0.94],
  ['concrete-ceiling', 0.97],
  ['concrete-mineral', 0.94],
] as const) {
  assert.equal(
    makeConcreteMaterial(0xffffff, 0, roughness, false, false, role).shininess,
    3 + (1 - roughness) * 12,
    'keep the actual shipped concrete shine',
  );
}
const wall = presets.SOURCE_SURFACES['concrete-wall'];
const oldShine = wall.shininess;
try {
  wall.shininess = 29;
  assert.equal(
    makeConcreteMaterial(0xffffff, 0, 0.9).shininess,
    29,
    'the renderer must not override the editable concrete shine',
  );
} finally {
  wall.shininess = oldShine;
}
const ladder = presets.SOURCE_SURFACES['rusted-metal'];
const saved = { ...ladder };
try {
  Object.assign(ladder, {
    tint: 0x335577,
    repeat: 2.25,
    bump: 0.12,
    shininess: 35,
    packed: '/textures/source/painted-metal-packed.webp',
  });
  const m = materials.createSourceFittingMaterial();
  assert.equal(m.color.getHex(), ladder.tint);
  assert.equal(m.map!.name, ladder.packed);
  assert.equal(m.map!.repeat.x, ladder.repeat);
  assert.equal(m.bumpScale, ladder.bump);
  assert.equal(m.shininess, ladder.shininess);
} finally {
  Object.assign(ladder, saved);
}
const palette = presets.PIPE_COLORS.trunk;
for (const colors of Object.values(palette))
  for (const hex of colors) {
    assert.ok(
      Math.max((hex >> 16) & 255, (hex >> 8) & 255, hex & 255) <= 0x80,
      'default trunk coats must read as industrial colour, not pale white paint',
    );
  }
const old = structuredClone(palette);
try {
  for (const values of Object.values(palette)) values.fill(0x335577);
  const finish = pipeFinish(1234, {
    id: 'infra:-2,1:east:1',
    kind: 'pipe',
    a: [-650, 70, 355],
    b: [-320, 70, 355],
    radius: 6,
    innerRadius: 5.1,
  });
  assert.equal(finish.hex, 0x335577, 'the actual pipe owner uses preset colours');
} finally {
  Object.assign(palette, old);
}
assert.equal(materials.SOURCE_SURFACES, presets.SOURCE_SURFACES);
console.log('material presets: texture, tint, scale, relief, shine and real pipe colors are wired');
