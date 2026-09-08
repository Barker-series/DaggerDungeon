/** Data-only material/texture authoring contract. No renderer imports. */
export interface TextureSpec {
  path?: string;
  generator?: 'halo';
  size?: number;
  stops?: { at: number; color: string }[];
  colorSpace?: 'srgb' | 'linear';
  wrap?: 'repeat' | 'clamp';
  repeat?: number | [number, number];
  magFilter?: 'nearest' | 'linear';
  minFilter?: 'linear' | 'mipmap' | 'nearest-mipmap';
  anisotropy?: number;
  premultiplyAlpha?: boolean;
  mipmaps?: boolean;
}
export interface MaterialPreset {
  kind: 'basic' | 'standard' | 'phong' | 'sprite' | 'line' | 'normal';
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  shininess?: number;
  specular?: number;
  opacity?: number;
  transparent?: boolean;
  alphaTest?: number;
  depthWrite?: boolean;
  depthTest?: boolean;
  toneMapped?: boolean;
  wireframe?: boolean;
  vertexColors?: boolean;
  side?: 'front' | 'back' | 'double';
  blending?: 'normal' | 'additive';
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  map?: TextureSpec | null;
  bumpMap?: TextureSpec | null;
  normalMap?: TextureSpec | null;
  roughnessMap?: TextureSpec | null;
  metalnessMap?: TextureSpec | null;
  emissiveMap?: TextureSpec | null;
  alphaMap?: TextureSpec | null;
  bumpScale?: number;
  normalScale?: [number, number];
}
