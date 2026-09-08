/** Software material-role proof, not an in-engine lighting screenshot. */
import { spawnSync } from 'node:child_process';
import { quietSlabFactor, metalTextureValue } from '../src/engine/SourceMaterials';
const width = 480,
  height = 360;
const factors = Array.from({ length: height }, (_, y) =>
  Array.from({ length: width }, (_, x) =>
    quietSlabFactor(((x + 0.5) * 12) / width - 6, ((y + 0.5) * 12) / height - 6, 12 / height),
  ),
);
const metal = Object.fromEntries(
  (['painted-metal', 'rusted-metal'] as const).map((role) => [
    role,
    Array.from({ length: 4097 }, (_, i) => metalTextureValue(role, i / 4096)),
  ]),
);
const result = spawnSync('python', ['tools/preview-quiet-materials.py'], {
  input: JSON.stringify({ factors, metal }),
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
console.log(result.stdout);
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
