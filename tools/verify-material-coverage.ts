/** Prevent new content quietly reopening a separate material/texture pipeline. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const offenders: string[] = [];
function visit(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('MaterialResources.ts')) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (
          /new\s+(?:THREE\.)?(?:\w*Material|TextureLoader|CanvasTexture|DataTexture)\s*\(/.test(
            line,
          )
        )
          offenders.push(`${path}:${i + 1}`);
        if (
          !/(MaterialLibrary|SourceMaterials)\.ts$/.test(path) &&
          /\b(?:createNativeMaterial|createSourceMaterial|createSourceFittingMaterial)\s*\(/.test(
            line,
          )
        )
          offenders.push(`${path}:${i + 1}: use the named public material API`);
      });
    }
  }
}
visit('src');
assert.deepEqual(
  offenders,
  [],
  `Material/texture constructors must use MaterialLibrary: ${offenders.join(', ')}`,
);
console.log(
  'material coverage: every project material constructor and texture loader uses shared resources',
);
