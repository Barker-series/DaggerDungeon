/** EDIT MATERIALS HERE. No shader or world-generation edits for ordinary art tweaks.
 * Save → reload the existing game → inspect the SAME view.
 * SOURCE_SURFACES: packed = runtime image; repeat = tiling (higher = smaller detail),
 * tint = hex colour multiplier, bump = relief, shininess/specular = highlight response.
 * painted-metal = pipe paint; rusted-metal = ladders/fittings; utility-tread = top faces.
 * PIPE_COLORS below owns the ACTUAL per-service pipe colours, not the white material tint.
 * Default pipes use steel blue, weathered green, iron brown and ochre—not white.
 */
import type { RegionType } from './dungeon/region-layer';
import type { MaterialPreset, TextureSpec } from './material-types';
import type { BiomeType } from './dungeon/cells';

export type SourceSurface =
  | 'concrete-wall'
  | 'concrete-floor'
  | 'concrete-ceiling'
  | 'concrete-mineral'
  | 'painted-metal'
  | 'rusted-metal'
  | 'utility-tread';
interface SurfaceProfile {
  /** Hex multiplier; white leaves the source texture/pipe vertex palette unchanged. */
  tint: number;
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
  settings: Pick<SurfaceProfile, 'repeat' | 'bump' | 'shininess' | 'specular'> &
    Partial<SurfaceProfile>,
): SurfaceProfile => ({
  tint: 0xffffff,
  color: `/textures/source/${role}-color.jpg`,
  height: `/textures/source/${role}-height.jpg`,
  packed: `/textures/source/${role}-packed.webp`,
  ...settings,
});
/** Legacy concrete is ordinary RGB: derive subtle relief from luminance,
 * never interpret its opaque alpha as authored packed metal height. */
const quietProfile = (asset: string, settings: Partial<SurfaceProfile>): SurfaceProfile => ({
  tint: 0xffffff,
  color: `/textures/${asset}.png`,
  height: `/textures/${asset}.png`,
  packed: `/textures/${asset}.png`,
  repeat: 1,
  bump: 0,
  shininess: 4,
  specular: 0x171918,
  ...settings,
});
export const SOURCE_SURFACES: Record<SourceSurface, SurfaceProfile> = {
  // Preserve the shipped highlights previously overridden inside DungeonRenderer.
  'concrete-wall': quietProfile('concrete-clean-base', {
    bump: 0.018,
    shininess: 3 + (1 - 0.9) * 12,
  }),
  'concrete-floor': quietProfile('concrete-smooth-precast', {
    bump: 0.012,
    shininess: 3 + (1 - 0.94) * 12,
  }),
  'concrete-ceiling': quietProfile('concrete-clean-base', {
    bump: 0.006,
    shininess: 3 + (1 - 0.97) * 12,
  }),
  'concrete-mineral': quietProfile('concrete-fine-aggregate', {
    bump: 0.012,
    shininess: 3 + (1 - 0.94) * 12,
  }),
  'painted-metal': profile('painted-metal', {
    repeat: 0.5,
    bump: 0.035,
    shininess: 28,
    specular: 0x44483f,
  }),
  'rusted-metal': profile('rusted-metal', {
    repeat: 1,
    bump: 0.045,
    shininess: 10,
    specular: 0x29251e,
  }),
  'utility-tread': profile('utility-tread', {
    repeat: 1.5,
    bump: 0.07,
    shininess: 24,
    specular: 0x454741,
  }),
};
/** Paint is recoloured multiplicatively: retain source luminance ratios and
 * calibrate its measured mean to the existing coat level. Bare iron stays raw. */
export const METAL_TEXTURE_RESPONSE = {
  'painted-metal': { mean: 0.066, gain: 0.72 / 0.066 },
  'rusted-metal': { mean: 0.06, gain: 1 },
} as const;

const trunk: Record<RegionType, number[]> = {
  city: [0x526574, 0x6b5140],
  machine: [0x3c5558, 0x654c3c],
  roads: [0x496879, 0x70533b],
  canyon: [0x745340, 0x5e6354],
  frontier: [0x4e6259, 0x586774],
  fold: [0x435f74, 0x625044],
};

/** All pipe colours in sRGB hex. Selection remains deterministic by owner/region. */
export const PIPE_COLORS = {
  trunk,
  return: { machine: [0x547462, 0x40586b], other: [0x3d6c76, 0x4e5f7a] },
  service: [0x9a733e, 0x745146],
};
export const CABLE_PRESET = { tint: 0x242725, specular: 0x101210, shininess: 3 };
export const FITTING_TREAD = { uvScale: 1.5, upwardStart: 0.65, upwardFull: 0.95 };

/** Native Three.js roles: static appearance belongs here, not in consumers. */
export const NATIVE_MATERIALS: Record<string, MaterialPreset> = {
  // Example for new props: ordinary RGB image, no packed-alpha/shader preparation.
  'painted-panel': {
    kind: 'standard',
    color: 0x286d94,
    roughness: 0.6,
    metalness: 0.25,
    map: { path: '/textures/concrete-clean-base.png', wrap: 'repeat', repeat: 2 },
  },
  stairs: {
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
  },
  'sprite-color': { kind: 'basic', side: 'double', transparent: true, opacity: 0.95 },
  'sprite-textured': { kind: 'basic', side: 'double', transparent: true, alphaTest: 0.1 },
  'light-halo': {
    kind: 'sprite',
    blending: 'additive',
    depthWrite: false,
    transparent: true,
    opacity: 0,
    map: {
      generator: 'halo',
      colorSpace: 'linear',
      size: 64,
      stops: [
        { at: 0, color: 'rgba(255,255,255,0.85)' },
        { at: 0.35, color: 'rgba(255,255,255,0.25)' },
        { at: 1, color: 'rgba(255,255,255,0)' },
      ],
    },
  },
  'light-mount': { kind: 'basic', color: 0xffd5a3 },
  'elevator-car': { kind: 'standard', color: 0x8a8578, roughness: 0.55, metalness: 0.45 },
  'elevator-call': {
    kind: 'standard',
    color: 0xb53022,
    roughness: 0.35,
    metalness: 0.55,
    emissive: 0x481008,
    emissiveIntensity: 1.2,
  },
  'debug-solid': { kind: 'basic', color: 0xb8b2a8, side: 'front' },
  'debug-wireframe': { kind: 'basic', color: 0xd4a44a, wireframe: true, side: 'front' },
  'debug-normals': { kind: 'normal', side: 'front' },
  'debug-mark': { kind: 'basic', color: 0xff2020 },
  'editor-grid-cell': {
    kind: 'line',
    color: 0x2a6a8a,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  },
  'editor-grid-chunk': {
    kind: 'line',
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  },
  'editor-selection-face': {
    kind: 'basic',
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.5,
    side: 'double',
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  },
  'editor-selection-box': { kind: 'line', color: 0x00e5ff, toneMapped: false },
};

/** Sampling for the backward-compatible caller-supplied sprite texture path. */
export const SPRITE_TEXTURE_STYLE: TextureSpec = { colorSpace: 'srgb', magFilter: 'nearest' };
export const SPRITE_STYLE = { flashColor: 0xffffff };
/** Structural vertex/fold tint multipliers; consumed by DungeonRenderer. */
export const STRUCTURE_STYLE = {
  regionTints: {
    dungeon: 0xffffff,
    cave: 0xc8bbaa,
    crypt: 0xb4bfba,
    ember: 0xa89a89,
    outside: 0xc9ceca,
    tunnel: 0xc5beb0,
  },
  regionEmissive: {} as Partial<
    Record<'dungeon' | 'cave' | 'crypt' | 'ember' | 'outside' | 'tunnel', number>
  >,
  foldTints: [0xc1b8a3, 0xa4aba5, 0xb6a896, 0xadb5ad],
};
export const LIGHT_STYLE = {
  ambientColor: 0xdedbd2,
  ambientIntensity: 0.4,
  torchColor: 0xffd6a0,
  torchIntensity: 2.5,
  torchDecay: 1.5,
  corridorColor: 0xd4dbc6,
  corridorIntensity: 1.7,
  thresholdColor: 0xd5e4dc,
  thresholdIntensity: 2.6,
  hemisphereSky: 0xb7c8ce,
  hemisphereGround: 0x51473a,
  hemisphereIntensity: 0.42,
  poolColor: 0xffffff,
  mountColor: 0xffd5a3,
  boreColor: 0xd5e4dc,
  mountIntensity: 2.5,
  haloScale: 0.6,
  haloMaxOpacity: 0.6,
  haloIntensityOpacity: 0.18,
};
export const BIOME_TORCH: Record<BiomeType, { color: number; intensity: number }> = {
  dungeon: { color: 0xffd6a0, intensity: 2.5 },
  cave: { color: 0xe6c79e, intensity: 2.1 },
  crypt: { color: 0xc0d2c3, intensity: 2.4 },
  ember: { color: 0xff9452, intensity: 3.1 },
  outside: { color: 0xd0deea, intensity: 2.8 },
};
