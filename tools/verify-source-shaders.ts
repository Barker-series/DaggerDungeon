/** Compile/link expanded real Phong hooks against Mesa GLES3, without a browser. */
import * as THREE from 'three';
import { createSourceMaterial, createSourceFittingMaterial } from '../src/engine/SourceMaterials';
import { spawnSync } from 'node:child_process';
THREE.TextureLoader.prototype.load = function (url: string) {
  const t = new THREE.Texture();
  t.name = url;
  return t;
};
const { makeConcreteMaterial } = await import('../src/engine/DungeonRenderer');
const materials = [
  createSourceMaterial('painted-metal'),
  createSourceMaterial('rusted-metal'),
  createSourceMaterial('utility-tread'),
  createSourceFittingMaterial(),
  makeConcreteMaterial(0xffffff, 0, 0.8, true, false),
  makeConcreteMaterial(0xffffff, 0, 0.8, true, true),
  makeConcreteMaterial(0xffffff, 0, 0.8, false, false, 'concrete-floor'),
  makeConcreteMaterial(0xffffff, 0, 0.97, true, true, 'concrete-ceiling'),
  makeConcreteMaterial(0xffffff, 0, 0.94, false, false, 'concrete-mineral'),
];
const expand = (s: string): string =>
  s
    .replace(/#include <(\w+)>/g, (_, n) => expand((THREE.ShaderChunk as any)[n]))
    .replace(/\bNUM_\w+\b|\bUNION_CLIPPING_PLANES\b/g, '0');
const common = `#version 300 es
precision highp float;
precision highp int;
#define HIGH_PRECISION
#define USE_MAP
#define USE_BUMPMAP
#define USE_COLOR
#define USE_FOG
#define MAP_UV uv
#define BUMPMAP_UV uv
#define texture2D texture
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
`;
const shaders = materials.map((m) => {
  const shader: any = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.phong.vertexShader,
    fragmentShader: THREE.ShaderLib.phong.fragmentShader,
  };
  m.onBeforeCompile(shader, {} as any);
  return {
    name: m.customProgramCacheKey(),
    vertex:
      common +
      `#define varying out
#define attribute in
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec3 color;
` +
      expand(shader.vertexShader),
    fragment:
      common +
      `#define varying in
out vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
vec4 linearToOutputTexel(vec4 value) {return value;}
` +
      expand(shader.fragmentShader),
  };
});
const result = spawnSync('python', ['tools/compile-source-shaders.py'], {
  input: JSON.stringify(shaders),
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
});
console.log(result.stdout);
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
