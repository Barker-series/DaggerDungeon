import assert from 'node:assert/strict';
import * as post from '../src/engine/PostProcessing';
assert.ok(
  post.DEFAULT_VISUAL_SETTINGS.bloomStrength <= 0.05,
  'Source-like finish should not bloom the diffuse surfaces',
);
assert.ok(post.DEFAULT_VISUAL_SETTINGS.bloomThreshold >= 0.15);
assert.ok(post.DEFAULT_VISUAL_SETTINGS.vignette <= 0.1);
assert.equal(
  typeof post.migrateVisualSettings,
  'function',
  'new defaults must migrate without discarding deliberate player settings',
);
const defaults = post.migrateVisualSettings({
  version: 6,
  bloomStrength: 0.1,
  bloomRadius: 0.37,
  bloomThreshold: 0.045,
  contrast: 1,
  saturation: 1,
  vignette: 0.2,
  aoEnabled: true,
  aoIntensity: 0.5,
  aoRadius: 1,
});
assert.equal(defaults.bloomStrength, post.DEFAULT_VISUAL_SETTINGS.bloomStrength);
assert.equal(defaults.version, 8);
assert.equal(defaults.contrast, 1);
assert.equal(defaults.vignette, 0);
assert.equal(post.DEFAULT_VISUAL_SETTINGS.contrast, 1);
assert.equal(post.DEFAULT_VISUAL_SETTINGS.vignette, 0);
const v7 = post.migrateVisualSettings({
  ...post.DEFAULT_VISUAL_SETTINGS,
  version: 7,
  contrast: 1.04,
  vignette: 0.06,
});
assert.equal(v7.contrast, 1);
assert.equal(v7.vignette, 0);
for (const version of [6, 7, 8]) {
  const chosen = post.migrateVisualSettings({
    version,
    contrast: 1.12,
    vignette: 0.13,
    aoEnabled: false,
    postEnabled: false,
  });
  assert.equal(chosen.contrast, 1.12);
  assert.equal(chosen.vignette, 0.13);
  assert.equal(chosen.aoEnabled, false);
  assert.equal(chosen.postEnabled, false);
}
const current = post.migrateVisualSettings({ version: 8, contrast: 1.04, vignette: 0.06 });
assert.equal(current.contrast, 1.04, 'current-version explicit old values remain custom');
assert.equal(current.vignette, 0.06);
assert.deepEqual(post.migrateVisualSettings(v7), v7, 'migration is idempotent');
const custom = post.migrateVisualSettings({
  version: 6,
  bloomStrength: 0.3,
  aoEnabled: false,
  vignette: 0,
  renderMode: 'wireframe',
  contrast: 1.15,
});
assert.equal(custom.bloomStrength, 0.3);
assert.equal(custom.aoEnabled, false);
assert.equal(custom.vignette, 0);
assert.equal(custom.renderMode, 'wireframe');
assert.equal(custom.contrast, 1.15);
const invalid = post.migrateVisualSettings({
  version: 7,
  bloomStrength: NaN,
  bloomThreshold: 100,
  renderMode: 'oops',
});
assert.equal(invalid.bloomStrength, post.DEFAULT_VISUAL_SETTINGS.bloomStrength);
assert.equal(invalid.bloomThreshold, 0.25);
assert.equal(invalid.renderMode, 'lit');
console.log(
  'Source finish: restrained default bloom, version migration, custom AO/mute-like zero values and validation passed',
);
