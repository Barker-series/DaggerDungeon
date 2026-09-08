import assert from 'node:assert/strict';
import * as THREE from 'three';
THREE.TextureLoader.prototype.load = function (url: string) {
  const t = new THREE.Texture();
  t.name = url;
  return t;
};
const { createSourceMaterial, quietSlabFactor, getSourceTexture } =
  await import('../src/engine/SourceMaterials');
const heightFirst = getSourceTexture('concrete-mineral', 'height');
const colorSecond = getSourceTexture('concrete-mineral', 'packed');
assert.equal(heightFirst.colorSpace, THREE.NoColorSpace);
assert.equal(
  colorSecond.colorSpace,
  THREE.SRGBColorSpace,
  'aliased legacy image paths must not make colour depend on request order',
);
assert.notEqual(
  heightFirst,
  colorSecond,
  'linear data and sRGB color need separate GPU texture views',
);
assert.ok(
  quietSlabFactor(3, 1, 0.01) < quietSlabFactor(3.2, 1, 0.01),
  'slab joint is restrained but visible',
);
assert.ok(
  quietSlabFactor(3, 1, 2) > quietSlabFactor(3, 1, 0.01),
  'subpixel joints lose contrast rather than shimmer',
);
for (const [x, z] of [
  [-7.2, -4.8],
  [1.5, 1.5],
  [4.5, 7.5],
]) {
  assert.ok(
    Math.abs(quietSlabFactor(x!, z!, 0.01) - quietSlabFactor(x! + 6, z! + 12, 0.01)) < 1e-12,
    'absolute slab field repeats across negative world cells',
  );
  assert.ok(
    quietSlabFactor(x!, z!, 0.01) >= 0.98,
    'panel interior tone changes at most two percent',
  );
}
const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const r: any = new DungeonRenderer(new THREE.Scene());
const m = r.materialsFor('dungeon');
assert.equal(m.wall.map.name, '/textures/concrete-clean-base.png', 'restore the old quiet wall');
assert.equal(m.floor.map.name, '/textures/concrete-smooth-precast.png');
assert.equal(m.ceil.name, 'source-concrete-ceiling');
assert.ok(m.ceil.bumpScale < m.wall.bumpScale);
function shader(material: THREE.Material) {
  const s: any = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.phong.vertexShader,
    fragmentShader: THREE.ShaderLib.phong.fragmentShader,
  };
  material.onBeforeCompile(s, {} as any);
  return s;
}
assert.ok(!shader(m.wall).fragmentShader.includes('sourceOffset('), 'no stochastic concrete');
assert.ok(
  shader(m.floor).fragmentShader.includes('quietSlabFactor(vConcretePosition.xz'),
  'absolute world XZ slabs',
);
assert.ok(!shader(m.ceil).fragmentShader.includes('quietSlabFactor(vConcretePosition.xz'));
assert.ok(!shader(m.ceil).fragmentShader.includes('foldDetailField('));
assert.ok(
  !shader(r.materialsFor('cave').floor).fragmentShader.includes(
    'quietSlabFactor(vConcretePosition.xz',
  ),
);
assert.ok(
  shader(r.foldMaterialsFor(0).floor).fragmentShader.includes(
    'quietSlabFactor(vConcretePosition.xz',
  ),
);
const paint = createSourceMaterial('painted-metal');
assert.equal(paint.vertexColors, true, 'service palette supplies coat RGB');
assert.ok(
  shader(paint).fragmentShader.includes('vec3(wear)'),
  'neutral luminance wear must not force a green coat',
);
assert.equal(Object.keys(r.utilityMaterials).length, 3);
console.log(
  'Quiet materials: old walls, slab floors, calm ceilings, natural ground, neutral vertex paint and three batches passed',
);
