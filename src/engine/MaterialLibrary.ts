/** The public material API for ALL new content. Add named presets, not constructors.
 * Each call owns its material; textures are shared by path + sampler + color space.
 * Existing structural shader families remain available through the same entry point. */
import * as THREE from 'three';
import { NATIVE_MATERIALS, SOURCE_SURFACES } from '../game/material-presets';
import {
  createSourceMaterial,
  createSourceFittingMaterial,
  type SourceSurface,
} from './SourceMaterials';
import {
  createNativeMaterial,
  applyMaterialOverrides,
  type MaterialOverrides,
} from './MaterialResources';
export { getTexture } from './MaterialResources';
export type { TextureSpec, MaterialPreset, MaterialOverrides } from './MaterialResources';
export function createMaterial<T extends THREE.Material = THREE.Material>(
  id: string,
  overrides: MaterialOverrides = {},
): T {
  if (Object.prototype.hasOwnProperty.call(NATIVE_MATERIALS, id)) {
    const m = createNativeMaterial<T>(NATIVE_MATERIALS[id]!, overrides);
    m.name = id;
    return m;
  }
  if (id === 'fitting')
    return applyMaterialOverrides(createSourceFittingMaterial(), overrides) as unknown as T;
  if (id === 'rubber' || Object.prototype.hasOwnProperty.call(SOURCE_SURFACES, id)) {
    const { color, ...rest } = overrides;
    return applyMaterialOverrides(
      createSourceMaterial(id as SourceSurface | 'rubber', color ?? 0xffffff),
      id === 'rubber' ? overrides : rest,
    ) as unknown as T;
  }
  throw new Error(
    `Unknown material '${id}'. Add it to NATIVE_MATERIALS in src/game/material-presets.ts`,
  );
}
