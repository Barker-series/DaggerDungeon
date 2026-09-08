import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
assert.ok(
  existsSync(new URL('../src/engine/SourceMaterials.ts', import.meta.url)),
  'Source-style materials need a shared material/texture contract',
);
const THREE = await import('three');
const { createSourceMaterial, getSourceTexture, SOURCE_SURFACES } =
  await import('../src/engine/SourceMaterials');
for (const role of [
  'concrete-wall',
  'concrete-floor',
  'concrete-ceiling',
  'concrete-mineral',
  'painted-metal',
  'rusted-metal',
  'utility-tread',
] as const) {
  const a = createSourceMaterial(role),
    b = createSourceMaterial(role);
  assert.ok(
    a instanceof THREE.MeshPhongMaterial,
    'Source-inspired diffuse/specular lighting, not uniformly metallic PBR',
  );
  assert.ok(a.map && a.bumpMap, 'authored diffuse and restrained surface relief');
  assert.equal(a.map, b.map, 'shared textures survive streaming/material instances');
  assert.equal(a.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(a.bumpMap, a.map, 'single shared sample supplies albedo and role-specific relief');
  assert.equal(a.map.premultiplyAlpha, false);
  assert.ok(
    a.bumpScale > 0 && a.bumpScale < 0.15,
    'texture relief must not turn concrete into lumpy rock',
  );
  assert.equal(a.side, THREE.FrontSide);
  assert.equal(a.map.wrapS, THREE.RepeatWrapping);
  assert.ok(a.map.generateMipmaps && a.map.anisotropy <= 4, 'filtered, bounded texture cost');
  assert.ok(
    SOURCE_SURFACES[role].color.endsWith(role.startsWith('concrete-') ? '.png' : '-color.jpg'),
  );
}
assert.equal(
  getSourceTexture('painted-metal', 'color'),
  getSourceTexture('painted-metal', 'color'),
);
const rubber = createSourceMaterial('rubber');
assert.equal(rubber.map, null);
assert.ok(rubber.shininess <= 4);
console.log(
  'Source materials: distinct diffuse/height families, shared filtered textures, restrained relief and front faces passed',
);

const { DungeonRenderer } = await import('../src/engine/DungeonRenderer');
const renderer: any = new DungeonRenderer(new THREE.Scene());
const concrete = renderer.materialsFor('dungeon');
assert.ok(
  concrete.wall instanceof THREE.MeshPhongMaterial,
  'shipping concrete uses the Source-inspired response',
);
assert.ok(concrete.wall.map.name.endsWith('concrete-clean-base.png'));
assert.ok(
  concrete.floor.map.name.endsWith('concrete-smooth-precast.png'),
  'floors are a distinct material family',
);
assert.equal(
  Object.keys(renderer.utilityMaterials).length,
  3,
  'material pass must not multiply infrastructure draw batches',
);
assert.ok(
  renderer.utilityMaterials.pipe.map.name.endsWith('painted-metal-packed.webp'),
  'pipes are weathered painted metal, not flat grey',
);
assert.ok(renderer.utilityMaterials.fitting.map.name.endsWith('rusted-metal-packed.webp'));
const shader: any = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.phong.vertexShader,
  fragmentShader: THREE.ShaderLib.phong.fragmentShader,
};
concrete.wall.onBeforeCompile(shader, {});
assert.ok(
  !shader.uniforms.concreteHeightDetail,
  'quiet concrete reuses its single filtered sample for subtle luminance relief',
);
assert.ok(
  shader.fragmentShader.includes('textureGrad(tex, uv, dFdx(uv), dFdy(uv))') &&
    !shader.fragmentShader.includes('sourceFineGrain'),
  'mip-filtered quiet concrete avoids extra stochastic grain fetches',
);
console.log('Source materials: real renderer roles, detail shader and constant batch count passed');
const fittingShader: any = {
  uniforms: {},
  vertexShader: THREE.ShaderLib.phong.vertexShader,
  fragmentShader: THREE.ShaderLib.phong.fragmentShader,
};
renderer.utilityMaterials.fitting.onBeforeCompile(fittingShader, {});
assert.ok(
  fittingShader.uniforms.sourceTread,
  'walkway tops get a real tread texture without another draw batch',
);
assert.equal(fittingShader.uniforms.sourceTread.value.colorSpace, THREE.SRGBColorSpace);
assert.ok(
  fittingShader.fragmentShader.includes('tread.a * sourceTreadRelief'),
  'tread linear alpha supplies aligned relief',
);
assert.ok(
  fittingShader.vertexShader.includes('vSourceUp = max(normal.y, 0.0)'),
  'tread belongs on upward faces, not undersides',
);
