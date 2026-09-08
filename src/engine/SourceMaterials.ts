/** Shared CC0 diffuse/height library: packed RGBA, no per-chunk textures. */
import * as THREE from 'three';
import { TILE_SIZE } from '../game/types';
import { SOURCE_SAMPLE_GLSL, SOURCE_MAP_FRAGMENT, SOURCE_NORMAL_FRAGMENT } from './SourceSampling';
import { createNativeMaterial, getTexture } from './MaterialResources';
import {
  SOURCE_SURFACES,
  METAL_TEXTURE_RESPONSE,
  CABLE_PRESET,
  FITTING_TREAD,
  type SourceSurface,
} from '../game/material-presets';
export {
  SOURCE_SURFACES,
  METAL_TEXTURE_RESPONSE,
  type SourceSurface,
} from '../game/material-presets';
export { sourceSampleTaps } from './SourceSampling';
const glslFloat = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : String(value);

/** CPU reference of the shader's single-plane projection, before role repeat. */
export function concreteTextureUV(p: number[], n: number[], origin: number[]): [number, number] {
  const a = p.map((v, i) => v + origin[i]!);
  if (Math.abs(n[1]!) >= Math.max(Math.abs(n[0]!), Math.abs(n[2]!)))
    return [a[0]! / TILE_SIZE, a[2]! / TILE_SIZE];
  return [(Math.abs(n[0]!) > Math.abs(n[2]!) ? a[2]! : a[0]!) / TILE_SIZE, a[1]! / TILE_SIZE];
}
export const CONCRETE_UV_GLSL = `
vec2 concreteTextureUV(vec3 p, vec3 n) {
  vec3 a = abs(n);
  return (a.y >= max(a.x, a.z) ? p.xz : vec2(a.x > a.z ? p.z : p.x, p.y)) / ${TILE_SIZE.toFixed(1)};
}`;
/** World metres: 3 x 6 m pours, 12 mm half-joints, bounded 2% panel tone. */
export function quietSlabFactor(x: number, z: number, pixelWidth: number): number {
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  const cx = mod(x, 3),
    cz = mod(z, 6);
  const edge = Math.min(cx, 3 - cx, cz, 6 - cz);
  const aa = Math.max(0.002, pixelWidth);
  const t = Math.max(0, Math.min(1, (edge - 0.012) / aa));
  const joint = (1 - t * t * (3 - 2 * t)) * Math.min(1, 0.06 / aa);
  const tone = 0.98 + 0.02 * mod(Math.floor(x / 3) + Math.floor(z / 6), 2);
  return tone * (1 - 0.18 * joint);
}
export const QUIET_SLAB_GLSL = `
float quietSlabFactor(vec2 p, float pixelWidth) {
  vec2 size = vec2(3.0, 6.0);
  vec2 cell = mod(p, size);
  vec2 edges = min(cell, size - cell);
  float aa = max(0.002, pixelWidth);
  float joint = (1.0 - smoothstep(0.012, 0.012 + aa, min(edges.x, edges.y))) * min(1.0, 0.06 / aa);
  float tone = 0.98 + 0.02 * mod(floor(p.x / 3.0) + floor(p.y / 6.0), 2.0);
  return tone * (1.0 - 0.18 * joint);
}`;

export function metalTextureValue(
  role: keyof typeof METAL_TEXTURE_RESPONSE,
  luminance: number,
): number {
  const p = METAL_TEXTURE_RESPONSE[role];
  return Math.min(1, Math.max(0, luminance * p.gain));
}

export function getSourceTexture(
  role: SourceSurface,
  channel: 'color' | 'height' | 'packed',
): THREE.Texture {
  const p = SOURCE_SURFACES[role],
    path = p[channel];
  return getTexture({
    path,
    colorSpace: channel === 'height' ? 'linear' : 'srgb',
    wrap: 'repeat',
    repeat: p.repeat,
    premultiplyAlpha: false,
    magFilter: 'linear',
    minFilter: 'mipmap',
    mipmaps: true,
    anisotropy: 4,
  });
}
export function createSourceMaterial(
  role: SourceSurface | 'rubber',
  tint = 0xffffff,
): THREE.MeshPhongMaterial {
  if (role === 'rubber') {
    const material = createNativeMaterial<THREE.MeshPhongMaterial>({
      kind: 'phong',
      color: CABLE_PRESET.tint,
      specular: CABLE_PRESET.specular,
      shininess: CABLE_PRESET.shininess,
      side: 'front',
    });
    material.name = 'source-rubber';
    return material;
  }
  const p = SOURCE_SURFACES[role];
  const material = createNativeMaterial<THREE.MeshPhongMaterial>(
    {
      kind: 'phong',
      bumpScale: p.bump,
      color: tint,
      specular: p.specular,
      shininess: p.shininess,
      side: 'front',
    },
    { map: getSourceTexture(role, 'packed'), bumpMap: getSourceTexture(role, 'packed') },
  );
  material.name = `source-${role}`;
  material.color.multiply(new THREE.Color(p.tint));
  material.vertexColors = role === 'painted-metal';
  const sampling = role.startsWith('concrete-')
    ? `
vec4 sourceSample(sampler2D tex, vec2 uv) {
  vec4 texel = textureGrad(tex, uv, dFdx(uv), dFdy(uv));
  return vec4(texel.rgb, dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)));
}
float sourceHeight = 0.0;
`
    : role === 'painted-metal'
      ? SOURCE_SAMPLE_GLSL.replace('vec4 sourceSample(', 'vec4 sourceRawSample(') +
        `
float sourceMetalDetail(float luminance) {
  return clamp(luminance * ${METAL_TEXTURE_RESPONSE[role].gain.toPrecision(17)}, 0.0, 1.0);
}
vec4 sourceSample(sampler2D tex, vec2 uv) {
  vec4 sourceTexel = sourceRawSample(tex, uv);
  float wear = sourceMetalDetail(dot(sourceTexel.rgb, vec3(0.2126, 0.7152, 0.0722)));
  return vec4(vec3(wear), sourceTexel.a);
}`
      : SOURCE_SAMPLE_GLSL;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${sampling}`)
      .replace(
        '#include <map_fragment>',
        role === 'utility-tread'
          ? SOURCE_MAP_FRAGMENT.replace(
              'sourceSample(map, vMapUv)',
              'textureGrad(map, vMapUv, dFdx(vMapUv), dFdy(vMapUv))',
            )
          : SOURCE_MAP_FRAGMENT,
      )
      .replace('#include <normal_fragment_maps>', SOURCE_NORMAL_FRAGMENT);
  };
  material.customProgramCacheKey = () =>
    `source-quiet-v5:${role}:${role === 'painted-metal' ? METAL_TEXTURE_RESPONSE[role].gain : ''}`;
  return material;
}

/** Keep the fittings batch: aligned nonslip deck, original iron texture sides. */
export function createSourceFittingMaterial(): THREE.MeshPhongMaterial {
  const material = createSourceMaterial('rusted-metal');
  const baseCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(material, shader, renderer);
    shader.uniforms['sourceTread'] = { value: getSourceTexture('utility-tread', 'packed') };
    shader.uniforms['sourceTreadRelief'] = { value: SOURCE_SURFACES['utility-tread'].bump };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSourceUp;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSourceUp = max(normal.y, 0.0);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSourceUp;
uniform sampler2D sourceTread;
uniform float sourceTreadRelief;`,
      )
      .replace(
        SOURCE_MAP_FRAGMENT,
        `#ifdef USE_MAP
 float sourceTopWeight = smoothstep(${glslFloat(FITTING_TREAD.upwardStart)}, ${glslFloat(FITTING_TREAD.upwardFull)}, vSourceUp);
 vec4 iron = sourceSample(map, vMapUv);
 vec2 treadUV = vMapUv * ${glslFloat(FITTING_TREAD.uvScale)};
 vec4 tread = textureGrad(sourceTread, treadUV, dFdx(treadUV), dFdy(treadUV));
 diffuseColor.rgb *= mix(iron.rgb, tread.rgb, sourceTopWeight);
 #ifdef USE_BUMPMAP
 sourceHeight = mix(iron.a * bumpScale, tread.a * sourceTreadRelief, sourceTopWeight);
 #endif
#endif`,
      );
  };
  material.customProgramCacheKey = () =>
    `source-fittings-iron-tread-v5:${JSON.stringify(FITTING_TREAD)}`;
  return material;
}
