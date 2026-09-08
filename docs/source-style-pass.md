# Source-inspired material, light and ambience pass

> Current direction: [quiet material roles](quiet-material-roles.md) supersedes
> the universal dirty-concrete treatment described in the initial pass below.
> Walls/ceilings use the earlier clean concrete, constructed floors use subtle
> slab joints, and pipe finish colours follow service and coarse world context.
> The improved pipe UVs, lighting/audio and streaming safeguards remain.

## Direction

The reference is [Half-Life 2's texture language](https://combineoverwiki.net/wiki/Category:Half-Life_2_textures): worn concrete, dull painted steel, localized rust, readable tread and restrained highlights. The world remains the BLAME!-inspired LayerProcGen megastructure. Structural geometry, collision and network routing are unchanged; the added ceiling lights are small instanced fixtures.

This is a Three.js approximation of that material/rendering character, not a port of Source, its shaders, baked lightmaps or dynamic cubemaps. No Valve textures or audio are bundled.

## Materials

- `SourceMaterials.ts` owns five shared CC0 diffuse/height pairs and a dark rubber material. Sources and licenses are in `public/textures/source/README.md` and `manifest.json`.
- Concrete walls and floors use distinct diffuse maps, restrained Phong specular response and low-amplitude height relief. The previous three-albedo grey splat is replaced by a clear primary texture plus close-range fine detail that fades with distance, following the idea of Source's [detail textures](https://developer.valvesoftware.com/wiki/$detail).
- Pipe trunks use worn green paint. Fittings use rusted iron, with tread color/height on upward surfaces in the same material batch. Cables stay dark and low-sheen.
- Strong debug-style fold tints are replaced by subtle mineral/industrial variations. Construction/fold detail remains, anchored to absolute structure positions across recentering.
- Color is sRGB RGB; linear height is packed alpha (never opacity). Textures are cached across materials/windows, mipmapped, and use bounded anisotropic filtering. Infrastructure stays at three material batches; no new mesh subdivision or shadow pass is introduced.
- The material variants are included in shader warm-up to avoid first-use shader compilation during travel.

## Texture repetition and concrete continuity

Pipe UVs use metric charts rather than selecting unrelated world axes by normal
threshold. Infrastructure side faces unwrap by accumulated octagonal edge length
and axial distance; caps use orthonormal planar charts. A diagonal side can no
longer collapse both UV coordinates onto the same world component. Mounted
utility pipes use each meridian's actual path length through bends instead of
the former `(0,0)` UVs. The complete primitive/run owns the chart, so render-job
clipping and window rebasing do not reset texture scale or phase. One deliberate
longitudinal unwrap seam remains, as with a conventional pipe UV layout.

`tools/verify-pipe-uvs.ts` checks nonzero UV area, physical edge lengths and texel
density on straight/angled/clipped prisms, floating-origin invariance, and real
meridian distances on bent utility runs. Geometry and collision are unchanged.

`SourceSampling.ts` uses a triangular partition with **three translated RGBA taps**, normalized fourth-power barycentric weights, and integer vertex hashes. Adjacent triangles share their edge taps/weights, so the field is continuous across positive and negative cell boundaries. No texture rotation or rescaling occurs; directional paint scratches and physical texel density survive. `textureGrad` uses derivatives of the original UV before selecting offsets, avoiding discontinuous hash-based mip LOD. Relief is derived from the already-blended alpha with screen-space derivatives, not a separately randomized height lookup. The diamond tread uses one regular, aligned packed lookup.

Concrete overrides only its own UV varying with a normal-consistent, single-plane projection of `modelMatrix * position + textureWorldOrigin`, divided by `TILE_SIZE` and multiplied by the unchanged material repeat. Thus per-quad UV resets cannot create fractional-repeat seams, and the same absolute point keeps its texture identity when the streaming window recenters. This is not triplanar sampling and does not override pipe or utility charts. Existing construction seams, fold relief, vertex tint and distance-faded fine grain remain.

Runtime budgets: painted/rusted metal **3** packed fetches, fittings **4** (3 iron + 1 aligned tread), concrete **6** (3 primary + 3 retained fine-height detail), standalone tread **1**. No geometry, batch, lighting, worldgen or postprocess changes are part of this sampling work. Five shared 1024 RGBA textures occupy **27,962,020 bytes including mipmaps**, versus 34,952,520 for the former ten RGBA uploads. Lossless packing deliberately trades transfer size for exact decoded source color: **6,130,494 bytes**, versus 1,598,596 original JPEG bytes. Original JPEGs and provenance are retained; no new asset downloads. `packed-manifest.json` records hashes and the linear-alpha derivation.

Reproduce verification from the repository root:

```sh
python tools/pack-source-textures.py --check
npx tsx --test tools/texture-repetition.test.ts
npx tsx tools/verify-source-materials.ts
npx tsx tools/verify-source-shaders.ts
npx tsx tools/preview-texture-repetition.ts
```

The shader check expands the real Three Phong hooks and compiles/links seven variants on local Mesa GLES3/llvmpipe, including both fold variants and tread fittings. It is not a browser/FPS benchmark. The preview uses the same exported CPU tap implementation, bilinear prefiltered linear-light RGB and linear height. Inspected outputs: [albedo](previews/texture-repetition/albedo.png), [height](previews/texture-repetition/height.png), [quad seams](previews/texture-repetition/concrete-quad-seams.png), and [metrics](previews/texture-repetition/metrics.json).

The inspected after panels break the obvious regular wall/rust mottling and repeated paint scratches without introducing hard cell edges; fine source direction and palette remain. Some blend softening is expected: measured standard deviation retains 86–91% of periodic sampling. One-tile correlation drops from 1.0 to 0.016–0.046 across the four stochastic families. The wall reset seam's mean linear-channel jump drops from 0.0541 to 0.000000643 in the paired boundary probe. These are software albedo/height checks, not a guarantee about final in-game lighting or frame rate; that review still requires the user's existing dev session.

## Light and finish

Lighting uses neutral ambient fill, cool upper bounce, warmer lower bounce and tungsten/fluorescent accents rather than saturated fantasy torch colors. Long primary pipe bores receive fixed-size ceiling bars at deterministic run positions. They join the existing instanced mount batch and the same **16-point-light pool**; no extra point lights or shadow maps are allocated.

Reinhard replaces ACES tone mapping. Default bloom isolates bright lights rather
than washing diffuse surfaces. Visual settings version 8 defaults to neutral
contrast and no vignette, migrating old defaults while preserving deliberate
custom settings. Contrast uses hue-preserving luminance scaling around linear
middle grey, not an additive 0.5 pivot: that old operation pushed dim HDR fog
below zero and produced the reported black distance cutoff.

`visibility-policy.ts` shares the camera/fog contract. Gradual linear fog runs
from 55 to 155 world units with neutral haze colours; the camera remains at 160
and the existing build/evict distances remain unchanged. At 100 world units,
the fog retains 57.475% scene contribution rather than the former 17.51%.
`verify-distance-finish.ts` checks actual GLSL float readback, including dark
fog, true black, HDR colours and custom contrast settings. This restores clarity
inside the existing rendered range rather than loading more world geometry.

## Ambient audio

`AmbientAudio.ts` adds original synthesized low machinery rumble, air movement, pipe resonance and sparse creaks. Nine nearby columns and the absolute region field determine enclosure/industrial weights at two updates per second. Loops crossfade rather than restart when the window moves.

The graph uses four persistent filtered-noise voices and two shared buffers; no audio sources are allocated during movement. Audio starts only after trusted gameplay interaction, suspends while paused/hidden, and disconnects/closes on engine teardown. Settings provide persistent ambient volume and mute, including explicit zero volume. These are original procedural sounds, not ripped HL2 recordings.

## Verification

- `verify-source-assets.ts`: all ten files decode at their declared sizes, match recorded hashes/byte counts and fit the asset budget.
- `verify-source-materials.ts`: actual renderer material roles, shared textures, color spaces, filtering, detail/tread shader bindings, and unchanged batch count.
- `verify-source-finish.ts`: restrained defaults, migration and preservation of custom values.
- `verify-source-lighting.ts`: real ceiling attachment, deterministic spacing and streaming identity, one mount batch and a fixed shadowless light pool.
- `ambient-audio.test.ts`: bounded graph/levels, gesture and visibility handling, disposal/resume races, spatial sampling and persistent silence.
- Infrastructure streaming/collision tests and the production build remain required.

The contact sheets validate the texture assets. The normal-shaded DDSNAP auditor does **not** validate textured lighting, postprocessing or audible output. A live visual/audio review must use the user's existing dev-server session; no replacement server is started by this workflow.
