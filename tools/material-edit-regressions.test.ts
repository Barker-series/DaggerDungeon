import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createMaterial } from '../src/engine/MaterialLibrary';
import { CABLE_PRESET, SOURCE_SURFACES, NATIVE_MATERIALS } from '../src/game/material-presets';
import { LightingSystem } from '../src/engine/LightingSystem';

test('rubber honors exact caller color while retaining its default cable tint', () => {
  const defaultMaterial = createMaterial<THREE.MeshPhongMaterial>('rubber');
  assert.equal(defaultMaterial.color.getHex(), CABLE_PRESET.tint);
  for (const color of [0xff0000, 0x000000, 0xffffff]) {
    const material = createMaterial<THREE.MeshPhongMaterial>('rubber', { color });
    assert.equal(material.color.getHex(), color);
    material.dispose();
  }
  defaultMaterial.dispose();
});

for (const mode of ['null', 'omitted', 'textured'] as const) {
  test(`halo preset map ${mode} preserves pool and shared resources`, () => {
    const preset = NATIVE_MATERIALS['light-halo']!;
    const original = preset.map;
    const load = THREE.TextureLoader.prototype.load;
    THREE.TextureLoader.prototype.load = () => new THREE.Texture();
    try {
      if (mode === 'omitted') delete preset.map;
      else
        preset.map =
          mode === 'null' ? null : { path: '/textures/halo-edit-test.png', colorSpace: 'linear' };
      const scene = new THREE.Scene();
      const lighting = new LightingSystem(scene);
      const access = lighting as unknown as { ensurePool(): void };
      access.ensurePool();
      const halos = scene.children.filter(
        (child): child is THREE.Sprite => child instanceof THREE.Sprite,
      );
      assert.equal(halos.length, 16);
      assert.equal(scene.children.filter((child) => child instanceof THREE.PointLight).length, 16);
      const map = halos[0]!.material.map;
      if (mode === 'textured') assert.ok(map instanceof THREE.Texture);
      else assert.equal(map, null);
      assert.ok(halos.every((halo) => halo.material.map === map));
      assert.equal(new Set(halos.map((halo) => halo.material)).size, 16);
      let disposals = 0;
      map?.addEventListener('dispose', () => disposals++);
      const objects = [...scene.children];
      lighting.clear();
      access.ensurePool();
      assert.deepEqual(scene.children, objects);
      assert.ok(halos.every((halo) => halo.material.opacity === 0));
      assert.equal(disposals, 0);
    } finally {
      preset.map = original;
      THREE.TextureLoader.prototype.load = load;
    }
  });
}

// Evaluate only the map replacement's simple feature guards, not a GLSL compiler.
function activeMapCode(code: string, defines: Set<string>): string {
  const stack = [true];
  const lines: string[] = [];
  for (const line of code.split('\n')) {
    const guard = line.match(/^\s*#ifdef (\w+)/);
    if (guard) stack.push(stack.at(-1)! && defines.has(guard[1]!));
    else if (/^\s*#endif/.test(line)) stack.pop();
    else if (stack.at(-1)) lines.push(line);
  }
  assert.equal(stack.length, 1, 'balanced map feature guards');
  return lines.join('\n');
}

test('source and fitting map edits never reference disabled map uniforms', () => {
  const load = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    assert.match(
      THREE.ShaderChunk.bumpmap_pars_fragment,
      /#ifdef USE_BUMPMAP[\s\S]*uniform float bumpScale/,
    );
    for (const id of [...Object.keys(SOURCE_SURFACES), 'fitting']) {
      for (const mapEnabled of [true, false])
        for (const bumpEnabled of [false, true]) {
          const material = createMaterial<THREE.MeshPhongMaterial>(id, {
            ...(mapEnabled ? {} : { map: null }),
            ...(bumpEnabled ? {} : { bumpMap: null }),
          });
          const shader = {
            uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.phong.uniforms),
            vertexShader: THREE.ShaderLib.phong.vertexShader,
            fragmentShader: THREE.ShaderLib.phong.fragmentShader,
          };
          material.onBeforeCompile(
            shader as THREE.WebGLProgramParametersWithUniforms,
            null as unknown as THREE.WebGLRenderer,
          );
          const fragment = shader.fragmentShader
            .split('#include <logdepthbuf_fragment>')[1]!
            .split('#include <alphamap_fragment>')[0]!;
          assert.ok(fragment.includes('sourceHeight'), `${id}: hook replaced map chunk`);
          const defines = new Set<string>();
          if (material.map) defines.add('USE_MAP');
          if (material.bumpMap) defines.add('USE_BUMPMAP');
          const active = activeMapCode(fragment, defines);
          if (!bumpEnabled) assert.doesNotMatch(active, /\bbumpScale\b/, `${id}: bumpMap:null`);
          if (!mapEnabled)
            assert.doesNotMatch(
              active,
              /\b(map|vMapUv|sourceTexel|iron|tread)\b/,
              `${id}: map:null`,
            );
          if (mapEnabled && bumpEnabled) {
            assert.match(active, /sourceHeight\s*=.*bumpScale/, `${id}: default relief retained`);
            assert.match(active, /diffuseColor.rgb \*=/, `${id}: default albedo retained`);
          }
          material.dispose();
        }
    }
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
});
