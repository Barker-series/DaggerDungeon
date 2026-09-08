import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as presets from '../src/game/material-presets';

const native = (presets as unknown as { NATIVE_MATERIALS: Record<string, Record<string, unknown>> })
  .NATIVE_MATERIALS;
assert.ok(native, 'Nonstructural appearance must be owned by NATIVE_MATERIALS');
assert.deepEqual(native['stairs'], {
  kind: 'standard',
  map: {
    path: '/textures/stairs-down.png',
    colorSpace: 'srgb',
    wrap: 'repeat',
    magFilter: 'linear',
    minFilter: 'mipmap',
    anisotropy: 1,
  },
  roughness: 0.7,
  emissive: 0x1a3a2a,
  emissiveIntensity: 0.15,
  side: 'front',
});
assert.deepEqual(native['elevator-car'], {
  kind: 'standard',
  color: 0x8a8578,
  roughness: 0.55,
  metalness: 0.45,
});
assert.deepEqual(native['elevator-call'], {
  kind: 'standard',
  color: 0xb53022,
  roughness: 0.35,
  metalness: 0.55,
  emissive: 0x481008,
  emissiveIntensity: 1.2,
});
assert.deepEqual(native['sprite-color'], {
  kind: 'basic',
  side: 'double',
  transparent: true,
  opacity: 0.95,
});
assert.equal(native['sprite-textured']!.alphaTest, 0.1);
assert.deepEqual(native['light-halo']!.map, {
  generator: 'halo',
  colorSpace: 'linear',
  size: 64,
  stops: [
    { at: 0, color: 'rgba(255,255,255,0.85)' },
    { at: 0.35, color: 'rgba(255,255,255,0.25)' },
    { at: 1, color: 'rgba(255,255,255,0)' },
  ],
});
assert.equal(native['light-halo']!.blending, 'additive');
assert.equal(native['light-halo']!.depthWrite, false);
assert.equal(native['light-halo']!.opacity, 0);
assert.equal(native['light-mount']!.color, 0xffd5a3);
assert.equal(native['debug-solid']!.side, 'front');
assert.equal(native['debug-wireframe']!.wireframe, true);
assert.equal(native['debug-normals']!.kind, 'normal');
assert.equal(native['editor-selection-face']!.polygonOffsetFactor, -2);
assert.equal(native['editor-grid-cell']!.opacity, 0.25);
assert.equal(native['editor-grid-chunk']!.opacity, 0.6);
assert.equal(
  native['editor-selection-box']!.toneMapped,
  false,
  'Match implicit Box3Helper material setting',
);
assert.deepEqual(presets.SPRITE_TEXTURE_STYLE, { colorSpace: 'srgb', magFilter: 'nearest' });
assert.deepEqual(presets.BIOME_TORCH, {
  dungeon: { color: 0xffd6a0, intensity: 2.5 },
  cave: { color: 0xe6c79e, intensity: 2.1 },
  crypt: { color: 0xc0d2c3, intensity: 2.4 },
  ember: { color: 0xff9452, intensity: 3.1 },
  outside: { color: 0xd0deea, intensity: 2.8 },
});
assert.equal(presets.LIGHT_STYLE.hemisphereSky, 0xb7c8ce);
assert.equal(presets.LIGHT_STYLE.hemisphereGround, 0x51473a);
assert.equal(presets.LIGHT_STYLE.hemisphereIntensity, 0.42);

if (!process.argv.includes('--presets-only')) {
  for (const file of ['SpriteManager', 'LightingSystem', 'Movers', 'GameEngine']) {
    const source = readFileSync(new URL(`../src/engine/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /new THREE\.(?:\w*Material|CanvasTexture|TextureLoader|Box3Helper)\(/,
      `${file} must use shared factories`,
    );
    assert.match(source, /from '.\/MaterialLibrary'/);
  }

  const { SpriteManager } = await import('../src/engine/SpriteManager');
  const scene = new THREE.Scene();
  const sprites = new SpriteManager(scene);
  sprites.addSpriteWorld('a', 2, 3, 0x123456);
  sprites.addSpriteWorld('b', 5, 7, 0xabcdef);
  const group = scene.children[0]!;
  const a = group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const b = group.children[1] as typeof a;
  assert.notEqual(a.material, b.material, 'Entity materials must not share mutable color');
  assert.equal(a.geometry, b.geometry, 'Billboards still share geometry');
  assert.equal(a.material.color.getHex(), 0x123456);
  assert.equal(a.material.opacity, 0.95);
  assert.equal(a.material.side, THREE.DoubleSide);
  assert.deepEqual(a.position.toArray(), [2, 1.2, 3]);
  // The loader boundary is mocked; sampling/cache/material behavior stays real.
  const load = THREE.TextureLoader.prototype.load;
  let loads = 0;
  THREE.TextureLoader.prototype.load = function () {
    loads++;
    return new THREE.Texture();
  };
  try {
    sprites.addSpriteWorld('tex1', 0, 0, 0xff0000, 2, '/textures/consumer-test.png');
    sprites.addSpriteWorld('tex2', 0, 0, 0x00ff00, 2, '/textures/consumer-test.png');
    const tex1 = group.children[2] as typeof a;
    const tex2 = group.children[3] as typeof a;
    assert.equal(loads, 1);
    assert.equal(tex1.material.map, tex2.material.map);
    assert.equal(tex1.material.map!.colorSpace, THREE.SRGBColorSpace);
    assert.equal(tex1.material.map!.magFilter, THREE.NearestFilter);
    assert.equal(tex1.material.alphaTest, 0.1);
    assert.equal(
      tex1.material.color.getHex(),
      0xffffff,
      'Legacy textured sprites ignore fallback color',
    );
    let textureDisposals = 0;
    tex1.material.map!.addEventListener('dispose', () => textureDisposals++);
    sprites.removeSprite('tex1');
    sprites.removeSprite('tex2');
    assert.equal(textureDisposals, 0, 'Sprite removal does not dispose library-owned maps');
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
  const originalMarkColor = presets.NATIVE_MATERIALS['debug-mark']!.color;
  presets.NATIVE_MATERIALS['debug-mark']!.color = 0x345678;
  try {
    sprites.addSpriteWorld('role', 0, 0, 0xffffff, 1, undefined, 'debug-mark');
    const role = group.children[2] as typeof a;
    assert.equal(
      role.material.color.getHex(),
      0x345678,
      'Central role edits flow into real consumers',
    );
    sprites.removeSprite('role');
  } finally {
    presets.NATIVE_MATERIALS['debug-mark']!.color = originalMarkColor;
  }
  let disposed = 0;
  a.material.addEventListener('dispose', () => disposed++);
  sprites.removeSprite('a');
  assert.equal(disposed, 1);
  assert.equal(group.children.length, 1);
  sprites.dispose();
  assert.equal(scene.children.length, 0);

  const { Movers } = await import('../src/engine/Movers');
  const world = {
    pillars: new Map([['test', { elevator: true, cx: 0, cz: 0, baseDepth: -30, totalHeight: 30 }]]),
  };
  const movers = new Movers(world as never, scene);
  const carGroup = scene.children[0]!;
  const car = carGroup.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  const call = carGroup.children[1] as typeof car;
  assert.equal(car.material.color.getHex(), 0x8a8578);
  assert.equal(car.material.roughness, 0.55);
  assert.equal(call.material.emissive.getHex(), 0x481008);
  assert.equal(call.material.emissiveIntensity, 1.2);
  assert.equal((carGroup.children[2] as typeof car).material, call.material);
  let moverDisposals = 0;
  car.material.addEventListener('dispose', () => moverDisposals++);
  call.material.addEventListener('dispose', () => moverDisposals++);
  movers.dispose(scene);
  assert.equal(moverDisposals, 2, 'Shared mover role materials disposed once');
  assert.equal(scene.children.length, 0);

  // Canvas drawing is the only browser facility needed by the real halo pool.
  const stops: Array<[number, string]> = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({
            addColorStop: (at: number, color: string) => stops.push([at, color]),
          }),
          fillRect() {},
        }),
      }),
    },
  });
  const { LightingSystem } = await import('../src/engine/LightingSystem');
  const lighting = new LightingSystem(scene);
  const poolAccess = lighting as unknown as { ensurePool(): void };
  poolAccess.ensurePool();
  const lights = scene.children.filter((o) => o instanceof THREE.PointLight) as THREE.PointLight[];
  const halos = scene.children.filter((o) => o instanceof THREE.Sprite) as THREE.Sprite[];
  assert.equal(lights.length, 16);
  assert.equal(halos.length, 16);
  assert.deepEqual(stops, [
    [0, 'rgba(255,255,255,0.85)'],
    [0.35, 'rgba(255,255,255,0.25)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  assert.equal(halos[0]!.material.map, halos[1]!.material.map);
  assert.equal(halos[0]!.material.map!.colorSpace, THREE.NoColorSpace);
  assert.notEqual(halos[0]!.material, halos[1]!.material);
  assert.equal(halos[0]!.material.blending, THREE.AdditiveBlending);
  assert.equal(halos[0]!.material.depthWrite, false);
  lights[0]!.intensity = 2;
  halos[0]!.material.opacity = 0.5;
  lighting.clear();
  poolAccess.ensurePool();
  assert.equal(scene.children.length, 32, 'Pool persists without allocation across clears');
  assert.ok(lights.every((light) => light.visible && light.intensity === 0));
  assert.ok(halos.every((halo) => halo.material.opacity === 0));
}
console.log('Material consumer appearance contracts passed');
