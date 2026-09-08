/** Shared CC0 diffuse/height library: packed RGBA, no per-chunk textures. */
import * as THREE from 'three';
import { TILE_SIZE } from '../game/types';
import { SOURCE_SAMPLE_GLSL, SOURCE_MAP_FRAGMENT, SOURCE_NORMAL_FRAGMENT } from './SourceSampling';
export { sourceSampleTaps } from './SourceSampling';

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
export type SourceSurface =
  | 'concrete-wall'
  | 'concrete-floor'
  | 'concrete-ceiling'
  | 'concrete-mineral'
  | 'painted-metal'
  | 'rusted-metal'
  | 'utility-tread';
interface SurfaceProfile {
  color: string;
  height: string;
  packed: string;
  repeat: number;
  bump: number;
  shininess: number;
  specular: number;
}
const profile = (
  role: SourceSurface,
  repeat: number,
  bump: number,
  shininess: number,
  specular: number,
): SurfaceProfile => ({
  color: `/textures/source/${role}-color.jpg`,
  height: `/textures/source/${role}-height.jpg`,
  packed: `/textures/source/${role}-packed.webp`,
  repeat,
  bump,
  shininess,
  specular,
});
/** Legacy concrete is ordinary RGB: derive subtle relief from luminance,
 * never interpret its opaque alpha as authored packed metal height. */
const quietProfile = (asset: string, bump: number): SurfaceProfile => ({
  color: `/textures/${asset}.png`,
  height: `/textures/${asset}.png`,
  packed: `/textures/${asset}.png`,
  repeat: 1,
  bump,
  shininess: 4,
  specular: 0x171918,
});
export const SOURCE_SURFACES: Record<SourceSurface, SurfaceProfile> = {
  'concrete-wall': quietProfile('concrete-clean-base', 0.018),
  'concrete-floor': quietProfile('concrete-smooth-precast', 0.012),
  'concrete-ceiling': quietProfile('concrete-clean-base', 0.006),
  'concrete-mineral': quietProfile('concrete-fine-aggregate', 0.012),
  'painted-metal': profile('painted-metal', 0.5, 0.035, 28, 0x44483f),
  'rusted-metal': profile('rusted-metal', 1, 0.045, 10, 0x29251e),
  'utility-tread': profile('utility-tread', 1.5, 0.07, 24, 0x454741),
};
/** Measured linear-luminance centres of the current CC0 maps. Neutralising
 * their hue must not squash all scratches/pitting into a near-constant value. */
export const METAL_TEXTURE_RESPONSE = {
  'painted-metal': { mean: 0.066, gain: 5 },
  'rusted-metal': { mean: 0.06, gain: 3 },
} as const;
export function metalTextureValue(
  role: keyof typeof METAL_TEXTURE_RESPONSE,
  luminance: number,
): number {
  const p = METAL_TEXTURE_RESPONSE[role];
  return Math.min(0.95, Math.max(0.25, 0.72 + (luminance - p.mean) * p.gain));
}
const textures = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
export function getSourceTexture(
  role: SourceSurface,
  channel: 'color' | 'height' | 'packed',
): THREE.Texture {
  const p = SOURCE_SURFACES[role],
    path = p[channel];
  const cacheKey = `${path}:${channel === 'height' ? 'data' : 'srgb'}:${p.repeat}`;
  const cached = textures.get(cacheKey);
  if (cached) return cached;
  const t = loader.load(path, undefined, undefined, (error) =>
    console.error(`Failed to load material texture: ${path}`, error),
  );
  t.name = path;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(p.repeat, p.repeat);
  // Hardware sRGB decode affects RGB only, NOT linear height alpha.
  t.colorSpace = channel === 'height' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.premultiplyAlpha = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  textures.set(cacheKey, t);
  return t;
}
export function createSourceMaterial(
  role: SourceSurface | 'rubber',
  tint = 0xffffff,
): THREE.MeshPhongMaterial {
  if (role === 'rubber')
    return new THREE.MeshPhongMaterial({
      name: 'source-rubber',
      color: 0x242725,
      specular: 0x101210,
      shininess: 3,
      side: THREE.FrontSide,
    });
  const p = SOURCE_SURFACES[role];
  const material = new THREE.MeshPhongMaterial({
    name: `source-${role}`,
    map: getSourceTexture(role, 'packed'),
    bumpMap: getSourceTexture(role, 'packed'),
    bumpScale: p.bump,
    color: tint,
    specular: p.specular,
    shininess: p.shininess,
    side: THREE.FrontSide,
  });
  material.vertexColors = role === 'painted-metal';
  const sampling = role.startsWith('concrete-')
    ? `
vec4 sourceSample(sampler2D tex, vec2 uv) {
  vec4 texel = textureGrad(tex, uv, dFdx(uv), dFdy(uv));
  return vec4(texel.rgb, dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)));
}
float sourceHeight = 0.0;
`
    : role === 'painted-metal' || role === 'rusted-metal'
      ? SOURCE_SAMPLE_GLSL.replace('vec4 sourceSample(', 'vec4 sourceRawSample(') +
        `
float sourceMetalDetail(float luminance) {
  return clamp(0.72 + (luminance - ${METAL_TEXTURE_RESPONSE[role].mean.toFixed(3)}) * ${METAL_TEXTURE_RESPONSE[role].gain.toFixed(1)}, 0.25, 0.95);
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
  material.customProgramCacheKey = () => `source-quiet-v4:${role}`;
  return material;
}

/** Keep the fittings batch: aligned nonslip deck, neutral worn steel sides. */
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
 float sourceTopWeight = smoothstep(0.65, 0.95, vSourceUp);
 vec4 iron = sourceSample(map, vMapUv);
 vec2 treadUV = vMapUv * 1.5;
 vec4 tread = textureGrad(sourceTread, treadUV, dFdx(treadUV), dFdy(treadUV));
 diffuseColor.rgb *= mix(iron.rgb, tread.rgb, sourceTopWeight);
 sourceHeight = mix(iron.a * bumpScale, tread.a * sourceTreadRelief, sourceTopWeight);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'source-fittings-neutral-tread-v4';
  return material;
}
