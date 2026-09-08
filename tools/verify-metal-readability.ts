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
for (const [role, mean, gain] of [
  ['painted-metal', 0.066, 5],
  ['rusted-metal', 0.06, 3],
] as const) {
  const low = materials.metalTextureValue(role, mean - 0.01),
    high = materials.metalTextureValue(role, mean + 0.01);
  assert.ok(
    high - low >= 0.02 * gain - 1e-8,
    'scuffs and grain must not collapse into nearly flat paint',
  );
  assert.ok(
    Math.abs(materials.metalTextureValue(role, mean) - 0.72) < 1e-8,
    'keep the current average finish brightness',
  );
  assert.ok(materials.metalTextureValue(role, 0) >= 0.2);
  assert.ok(materials.metalTextureValue(role, 1) <= 0.95);
  const m = materials.createSourceMaterial(role),
    s: any = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.phong.vertexShader,
      fragmentShader: THREE.ShaderLib.phong.fragmentShader,
    };
  m.onBeforeCompile(s, {} as any);
  assert.ok(
    s.fragmentShader.includes('sourceMetalDetail('),
    'actual shader consumes the contrast-preserving response',
  );
  assert.ok(
    s.fragmentShader.includes('sourceTexel.a'),
    'height/relief remains authored texture data',
  );
}
assert.equal(
  materials.createSourceMaterial('concrete-wall').map!.name,
  '/textures/concrete-clean-base.png',
  'quiet concrete remains protected',
);
console.log(
  'metal readability: stronger texture contrast with stable mean, neutral colour and retained relief passed',
);
