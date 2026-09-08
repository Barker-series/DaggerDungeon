import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as materials from '../src/engine/SourceMaterials';
import * as THREE from 'three';
import { existsSync, statSync } from 'node:fs';

test('packed metal assets retain RGB plus linear relief within a bounded decode budget', () => {
  for (const role of ['painted-metal', 'rusted-metal', 'utility-tread']) {
    const path = `public/textures/source/${role}-packed.webp`;
    assert.ok(existsSync(path), `missing packed derivative ${path}`);
    assert.ok(statSync(path).size < 4 * 1024 * 1024);
  }
});

test('material shader shares packed relief taps, preserves opacity, hooks and aligned tread', async () => {
  const load = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function (url: string) {
    const t = new THREE.Texture();
    t.name = url;
    return t;
  };
  try {
    for (const role of ['painted-metal', 'rusted-metal', 'utility-tread'] as const) {
      const m = materials.createSourceMaterial(role);
      assert.equal(m.map, m.bumpMap, 'RGB/height must share one packed texture');
      assert.equal(m.map!.colorSpace, THREE.SRGBColorSpace);
      const shader: any = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.phong.vertexShader,
        fragmentShader: THREE.ShaderLib.phong.fragmentShader,
      };
      m.onBeforeCompile(shader, {} as any);
      assert.match(shader.fragmentShader, /diffuseColor.rgb \*= sourceTexel.rgb/);
      assert.match(shader.fragmentShader, /sourceTexel.a \* bumpScale/);
      assert.match(shader.fragmentShader, /dFdx\(sourceHeight\)/);
      assert.match(
        shader.fragmentShader,
        role === 'utility-tread' ? /sourceTexel = textureGrad/ : /sourceTexel = sourceSample/,
      );
      assert.ok(!shader.fragmentShader.includes('dHdxy_fwd()'));
    }
    const m = materials.createSourceFittingMaterial();
    const shader: any = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.phong.vertexShader,
      fragmentShader: THREE.ShaderLib.phong.fragmentShader,
    };
    m.onBeforeCompile(shader, {} as any);
    assert.match(shader.fragmentShader, /sourceSample\(map, vMapUv\)/);
    assert.match(shader.fragmentShader, /textureGrad\(sourceTread,/);
    assert.match(shader.fragmentShader, /vSourceUp/);
    assert.ok(!shader.fragmentShader.includes('sourceTreadHeight'));
    const { makeConcreteMaterial } = await import('../src/engine/DungeonRenderer');
    for (const fold of [false, true]) {
      const concrete = makeConcreteMaterial(0xffffff, 0, 0.8, true, fold);
      const s: any = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.phong.vertexShader,
        fragmentShader: THREE.ShaderLib.phong.fragmentShader,
      };
      concrete.onBeforeCompile(s, {} as any);
      assert.equal(
        concrete.map!.name,
        '/textures/concrete-clean-base.png',
        'quiet old concrete remains the default',
      );
      assert.equal(
        s.uniforms.concreteHeightDetail,
        undefined,
        'retired high-frequency dirt/detail layer stays disabled',
      );
      assert.match(s.vertexShader, /vConcretePosition = .*textureWorldOrigin/);
      assert.match(s.vertexShader, /vMapUv = concreteTextureUV/);
      assert.match(s.fragmentShader, /sourceTexel = sourceSample/);
      assert.ok(!s.fragmentShader.includes('sourceFineGrain'));
      assert.ok(
        !s.fragmentShader.includes('sourceOffset('),
        'quiet concrete is not stochastically mottled',
      );
      assert.match(s.fragmentShader, /constructionSeams/);
      assert.equal(concrete.vertexColors, true);
      if (fold) assert.match(s.fragmentShader, /dFdx\(sourceHeight \+ foldDetailH\)/);
    }
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
});

test('three coherent translation taps are continuous, normalized, and break the one-tile period', () => {
  const taps = (materials as any).sourceSampleTaps;
  assert.equal(typeof taps, 'function', 'missing seam-safe stochastic sampler');
  const texture = (u: number, v: number) =>
    Math.sin(u * Math.PI * 2) * 0.3 + Math.cos(v * Math.PI * 2) * 0.2 + 0.5;
  const sample = (u: number, v: number) =>
    taps(u, v).reduce(
      (s: number, t: any) => s + t.weight * texture(u + t.offset[0], v + t.offset[1]),
      0,
    );
  let repeatError = 0;
  for (let i = 0; i < 100; i++) {
    const u = i * 0.071 - 4,
      v = i * 0.193 - 8;
    const t = taps(u, v);
    assert.equal(t.length, 3);
    assert.ok(Math.abs(t.reduce((s: number, t: any) => s + t.weight, 0) - 1) < 1e-12);
    assert.ok(t.every((t: any) => t.weight >= 0));
    repeatError += Math.abs(sample(u, v) - sample(u + 1, v));
    // Square-cell and diagonal boundaries, including negative cells.
    for (const [x, y] of [
      [Math.floor(u), v],
      [u, Math.floor(v)],
      [u, Math.floor(v) + 1 - (u - Math.floor(u))],
    ])
      assert.ok(Math.abs(sample(x! - 1e-7, y!) - sample(x! + 1e-7, y!)) < 1e-5);
  }
  assert.ok(repeatError / 100 > 0.05, `period survives: ${repeatError / 100}`);
});

test('concrete projection is metric, continuous across quads and invariant under recenter', () => {
  const project = (materials as any).concreteTextureUV;
  assert.equal(
    typeof project,
    'function',
    'missing absolute concrete projection; quad UV reset cannot survive noninteger repeats',
  );
  for (const normal of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
  ]) {
    const p = [12, 6, 27],
      origin = [96, 0, -144];
    assert.deepEqual(
      project(p, normal, origin),
      project(
        p.map((v, i) => v + origin[i]!),
        normal,
        [0, 0, 0],
      ),
    );
    const tangent = normal[0] ? 2 : 0;
    const adjacent = [...p];
    adjacent[tangent]! += 3;
    assert.equal(Math.abs(project(adjacent, normal, origin)[0] - project(p, normal, origin)[0]), 1);
    const left = [...p],
      right = [...p];
    left[tangent]! -= 1e-7;
    right[tangent]! += 1e-7;
    assert.ok(
      Math.abs(project(left, normal, origin)[0] - project(right, normal, origin)[0]) < 1e-6,
    );
  }
});
