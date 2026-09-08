import assert from 'node:assert/strict';
import * as THREE from 'three';
THREE.TextureLoader.prototype.load = function (url: string) {
  const t = new THREE.Texture();
  t.name = url;
  return t;
} as any;
const materials = await import('../src/engine/SourceMaterials');
assert.equal(
  typeof materials.metalTextureValue,
  'function',
  'neutral metal texture response needs a contrast-preserving mapping',
);
const mean = materials.METAL_TEXTURE_RESPONSE['painted-metal'].mean;
assert.equal(
  materials.metalTextureValue('painted-metal', 0),
  0,
  'black scuffs must stay black, not become a pale additive coating',
);
assert.ok(Math.abs(materials.metalTextureValue('painted-metal', mean) - 0.72) < 1e-8);
assert.ok(
  Math.abs(materials.metalTextureValue('painted-metal', mean / 2) - 0.36) < 1e-8,
  'recolouring must retain source luminance ratios below saturation',
);
assert.equal(materials.metalTextureValue('painted-metal', 1), 1);
for (const value of [0, 0.01, 0.06, 0.5, 1])
  assert.equal(
    materials.metalTextureValue('rusted-metal', value),
    value,
    'unpainted iron keeps its authored luminance',
  );
for (const role of ['painted-metal', 'rusted-metal'] as const) {
  const m = materials.createSourceMaterial(role),
    s: any = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.phong.vertexShader,
      fragmentShader: THREE.ShaderLib.phong.fragmentShader,
    };
  m.onBeforeCompile(s, {} as any);
  assert.equal(
    s.fragmentShader.includes('sourceMetalDetail('),
    role === 'painted-metal',
    'only recoloured paint uses a luminance response; iron must keep source RGB',
  );
  assert.equal(s.fragmentShader.includes('vec3(wear)'), role === 'painted-metal');
  if (role === 'painted-metal') {
    const gain = materials.METAL_TEXTURE_RESPONSE[role].gain.toPrecision(17);
    assert.ok(
      s.fragmentShader.includes(`return clamp(luminance * ${gain}, 0.0, 1.0);`),
      'the actual shader must match the multiplicative CPU response, not restore an additive wash',
    );
  }
  assert.ok(
    s.fragmentShader.includes('sourceTexel.a'),
    'height/relief remains authored texture data',
  );
}
const fitting = materials.createSourceFittingMaterial();
const fittingShader: any = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.phong.vertexShader,
  fragmentShader: THREE.ShaderLib.phong.fragmentShader,
};
fitting.onBeforeCompile(fittingShader, {} as any);
assert.ok(
  !fittingShader.fragmentShader.includes('sourceMetalDetail('),
  'real ladder batch retains iron colour',
);
assert.ok(
  fittingShader.fragmentShader.includes('mix(iron.rgb, tread.rgb, sourceTopWeight)'),
  'tread tops unchanged',
);
assert.equal(
  materials.createSourceMaterial('concrete-wall').map!.name,
  '/textures/concrete-clean-base.png',
  'quiet concrete remains protected',
);
console.log(
  'metal readability: source-relative pipe contrast, original ladder iron RGB and protected concrete passed',
);
