import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
assert.ok(
  existsSync(new URL('../src/engine/MaterialResources.ts', import.meta.url)),
  'one texture/material resource implementation is required',
);
THREE.TextureLoader.prototype.load = function (path: string) {
  const t = new THREE.Texture();
  t.name = path;
  return t;
} as any;
const { getTexture, createNativeMaterial } = await import('../src/engine/MaterialResources');
const a = getTexture({ path: '/textures/new-panel.png' });
assert.equal(
  a,
  getTexture({ path: '/textures/new-panel.png', colorSpace: 'srgb' }),
  'equivalent requests share textures',
);
assert.notEqual(
  a,
  getTexture({ path: '/textures/new-panel.png', colorSpace: 'linear' }),
  'data never shares sRGB upload',
);
assert.notEqual(
  a,
  getTexture({ path: '/textures/new-panel.png', repeat: 2 }),
  'sampler settings do not leak between roles',
);
assert.equal(
  getTexture({ path: '/textures/new-panel.png', repeat: 2 }).wrapS,
  THREE.RepeatWrapping,
  'setting repeat must actually tile rather than clamp to an edge',
);
assert.throws(() => getTexture({ path: '/textures/a.png', repeat: 0 }), /repeat/);
const m = createNativeMaterial({
  kind: 'standard',
  color: 0x335577,
  roughness: 0.65,
  metalness: 0.8,
  map: { path: '/textures/new-panel.png' },
  normalMap: { path: '/textures/new-normal.png' },
  normalScale: [0.5, 0.5],
});
assert.ok(m instanceof THREE.MeshStandardMaterial);
assert.equal(m.map, a);
assert.equal(m.normalMap!.colorSpace, THREE.NoColorSpace);
assert.equal(m.color.getHex(), 0x335577);
assert.equal(m.roughness, 0.65);
assert.equal(m.metalness, 0.8);
assert.deepEqual(m.normalScale.toArray(), [0.5, 0.5]);
assert.equal(
  createNativeMaterial({
    kind: 'sprite',
    map: { path: '/textures/new-panel.png' },
    transparent: true,
  }).type,
  'SpriteMaterial',
);
assert.equal(createNativeMaterial({ kind: 'line', color: 0x556677 }).type, 'LineBasicMaterial');
assert.equal(createNativeMaterial({ kind: 'phong', shininess: 22 }).type, 'MeshPhongMaterial');
assert.equal(createNativeMaterial({ kind: 'normal' }).type, 'MeshNormalMaterial');
assert.throws(() => createNativeMaterial({ kind: 'bad' } as any), /kind/);
console.log(
  'shared material resources: new PBR/sprite/line roles, texture sharing and color/data isolation pass',
);
assert.ok(
  existsSync(new URL('../src/engine/MaterialLibrary.ts', import.meta.url)),
  'new and existing content must share one public creation API',
);
const { createMaterial } = await import('../src/engine/MaterialLibrary');
const { NATIVE_MATERIALS } = await import('../src/game/material-presets');
NATIVE_MATERIALS['test-new-panel'] = {
  kind: 'standard',
  color: 0x274966,
  roughness: 0.65,
  metalness: 0.8,
  map: { path: '/textures/new-panel.png' },
};
try {
  const material = createMaterial<THREE.MeshStandardMaterial>('test-new-panel');
  assert.equal(material.color.getHex(), 0x274966);
  assert.equal(material.map, a);
  assert.equal(createMaterial('painted-metal').type, 'MeshPhongMaterial');
  assert.equal(createMaterial('fitting').type, 'MeshPhongMaterial');
  assert.equal(createMaterial('painted-panel').type, 'MeshStandardMaterial');
  assert.throws(() => createMaterial('missing-role'), /Unknown material/);
} finally {
  delete NATIVE_MATERIALS['test-new-panel'];
}
console.log('material library: new catalogue entry creates a material without factory edits');
const { SpriteManager } = await import('../src/engine/SpriteManager');
NATIVE_MATERIALS['test-native-sprite'] = { kind: 'sprite', color: 0x335577 };
const scene = new THREE.Scene(),
  sprites = new SpriteManager(scene);
try {
  sprites.addSpriteWorld('new-sprite', 0, 0, 0xffffff, 1, undefined, 'test-native-sprite');
  assert.equal(
    (scene.children[0]!.children[0] as THREE.Sprite).isSprite,
    true,
    'a sprite preset must create a real sprite, not put its shader on a mesh',
  );
} finally {
  sprites.dispose();
  delete NATIVE_MATERIALS['test-native-sprite'];
}
const { makeConcreteMaterial } = await import('../src/engine/DungeonRenderer');
NATIVE_MATERIALS['concrete-wall'] = {
  kind: 'standard',
  color: 0x264860,
  emissive: 0x102030,
  vertexColors: false,
  map: { path: '/textures/new-panel.png', repeat: [2, 3] },
};
try {
  const wall = makeConcreteMaterial(0xffffff, 0, 0.9);
  assert.equal(
    wall.color.getHex(),
    0x264860,
    'native replacement colour must not be overridden by the structural caller',
  );
  assert.equal(wall.emissive.getHex(), 0x102030, 'native replacement emission must survive');
  assert.equal(wall.vertexColors, false, 'explicit native vertex paint choice must survive');
  const shader: any = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  wall.onBeforeCompile(shader, {} as any);
  assert.match(
    shader.vertexShader,
    /vec2\(2\.0+, 3\.0+\)/,
    'structural UV projection must use replacement texture scale',
  );
  NATIVE_MATERIALS['concrete-wall'] = { kind: 'basic', color: 0x264860 };
  assert.doesNotThrow(
    () => makeConcreteMaterial(0xffffff, 0, 0.9),
    'unlit replacement has no emissive property',
  );
} finally {
  delete NATIVE_MATERIALS['concrete-wall'];
}
