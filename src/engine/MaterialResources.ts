/** Shared native material construction and texture ownership. Author values live in material-presets. */
import * as THREE from 'three';
import type { MaterialPreset, TextureSpec } from '../game/material-types';
export type { MaterialPreset, TextureSpec } from '../game/material-types';
const slots = [
  'map',
  'bumpMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
] as const;
type TextureSlot = (typeof slots)[number];
export type MaterialOverrides = Omit<Partial<MaterialPreset>, TextureSlot> & {
  [K in TextureSlot]?: TextureSpec | THREE.Texture | null;
};
const textures = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
export function getTexture(spec: TextureSpec): THREE.Texture {
  if ((!spec.path && !spec.generator) || (spec.path && spec.generator))
    throw new Error('Texture needs one path or generator');
  if (spec.path && !/^(\/|https?:\/\/|data:image\/)/.test(spec.path))
    throw new Error(`Texture path must be absolute or an image URL: ${spec.path}`);
  const repeat =
    typeof spec.repeat === 'number' ? [spec.repeat, spec.repeat] : (spec.repeat ?? [1, 1]);
  if (repeat.length !== 2 || repeat.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error('Texture repeat must be two positive numbers');
  const config = {
    path: spec.path,
    generator: spec.generator,
    size: spec.size ?? 64,
    stops: spec.stops,
    colorSpace: spec.colorSpace ?? 'srgb',
    wrap: spec.wrap ?? (spec.repeat === undefined ? 'clamp' : 'repeat'),
    repeat,
    magFilter: spec.magFilter ?? 'linear',
    minFilter: spec.minFilter ?? 'mipmap',
    anisotropy: spec.anisotropy ?? 1,
    premultiplyAlpha: spec.premultiplyAlpha ?? false,
    mipmaps: spec.mipmaps ?? true,
  };
  const key = JSON.stringify(config);
  const existing = textures.get(key);
  if (existing) return existing;
  let texture: THREE.Texture;
  if (spec.generator) {
    if (spec.generator !== 'halo') throw new Error(`Unknown texture generator: ${spec.generator}`);
    if (!Number.isInteger(config.size) || config.size < 1 || config.size > 4096)
      throw new Error('Halo texture size must be 1..4096');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = config.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D unavailable for halo texture');
    const c = config.size / 2,
      gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    for (const stop of config.stops ?? []) gradient.addColorStop(stop.at, stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, config.size, config.size);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = loader.load(spec.path!, undefined, undefined, (error) =>
      console.error(`[material texture] ${spec.path}`, error),
    );
  }
  texture.name = spec.path ?? `generated:${spec.generator}`;
  texture.colorSpace = config.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT =
    config.wrap === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeat[0]!, repeat[1]!);
  texture.magFilter = config.magFilter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter =
    config.minFilter === 'linear'
      ? THREE.LinearFilter
      : config.minFilter === 'nearest-mipmap'
        ? THREE.NearestMipmapNearestFilter
        : THREE.LinearMipmapLinearFilter;
  texture.anisotropy = config.anisotropy;
  texture.premultiplyAlpha = config.premultiplyAlpha;
  texture.generateMipmaps = config.mipmaps;
  // Consumers own materials, not shared textures. Explicit disposal invalidates this cache entry.
  texture.addEventListener('dispose', () => {
    if (textures.get(key) === texture) textures.delete(key);
  });
  textures.set(key, texture);
  return texture;
}
const constructors: Record<MaterialPreset['kind'], new (parameters?: any) => THREE.Material> = {
  basic: THREE.MeshBasicMaterial,
  standard: THREE.MeshStandardMaterial,
  phong: THREE.MeshPhongMaterial,
  sprite: THREE.SpriteMaterial,
  line: THREE.LineBasicMaterial,
  normal: THREE.MeshNormalMaterial,
};
export function createNativeMaterial<T extends THREE.Material = THREE.Material>(
  preset: MaterialPreset,
  overrides: MaterialOverrides = {},
): T {
  const merged = { ...preset, ...overrides };
  if (!Object.prototype.hasOwnProperty.call(constructors, merged.kind))
    throw new Error(`Unknown material kind: ${merged.kind}`);
  return new constructors[merged.kind](resolveParameters(merged)) as T;
}
export function applyMaterialOverrides<T extends THREE.Material>(
  material: T,
  overrides: MaterialOverrides,
): T {
  material.setValues(resolveParameters(overrides));
  return material;
}
function resolveParameters(merged: MaterialOverrides): Record<string, unknown> {
  for (const key of ['opacity', 'alphaTest', 'roughness', 'metalness'] as const) {
    const v = merged[key];
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1))
      throw new Error(`Material ${key} must be 0..1`);
  }
  const { kind, ...parameters } = merged;
  const args: Record<string, unknown> = { ...parameters };
  if (merged.side !== undefined)
    args['side'] = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide }[
      merged.side
    ];
  if (merged.blending !== undefined)
    args['blending'] =
      merged.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  if (merged.normalScale) args['normalScale'] = new THREE.Vector2(...merged.normalScale);
  for (const slot of slots) {
    const value = merged[slot];
    if (value === undefined) continue;
    args[slot] =
      value === null
        ? null
        : (value as THREE.Texture).isTexture
          ? value
          : getTexture({
              ...(value as TextureSpec),
              colorSpace:
                (value as TextureSpec).colorSpace ??
                (slot === 'map' || slot === 'emissiveMap' ? 'srgb' : 'linear'),
            });
  }
  return args;
}
