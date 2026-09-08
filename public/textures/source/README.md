# CC0 industrial material set

These texture files are licensed **CC0-1.0**. They are not extracted from Half-Life 2.

| Role | Source | Artist(s) |
|---|---|---|
| Weathered concrete wall | [ambientCG Concrete035](https://ambientcg.com/a/Concrete035) | Lennart Demes |
| Concrete floor | [ambientCG Concrete047A](https://ambientcg.com/a/Concrete047A) | Lennart Demes |
| Worn green painted metal | [Poly Haven green_metal_rust](https://polyhaven.com/a/green_metal_rust) | Rob Tuytel |
| Coarse rusty metal | [Poly Haven rust_coarse_01](https://polyhaven.com/a/rust_coarse_01) | Dimitrios Savva, Rico Cilliers |
| Steel tread plate | [Poly Haven metal_plate](https://polyhaven.com/a/metal_plate) | Rob Tuytel |

Provider license statements: [ambientCG](https://docs.ambientcg.com/license), [Poly Haven](https://polyhaven.com/license).

`manifest.json` records the exact source URLs, original filenames and hashes,
processing steps, output dimensions and output hashes. Color maps are 1024px
sRGB JPEGs; matching displacement-derived height maps are 512px grayscale data,
loaded without sRGB conversion. Original colors are retained. The ten texture
files total 1,598,596 bytes; mipmaps and modest anisotropic filtering are enabled
by the shared material library.

`tools/build-source-textures.py` reproduces these outputs from the downloaded
originals and their `selected.json` metadata cache. It also makes ordinary and
2×2 tiled contact sheets for visual inspection. Source archives stay outside the
repository; only the optimized maps and provenance are shipped.

The renderer now loads five lossless `*-packed.webp` derivatives instead of the
separate JPEG maps: RGB retains the decoded source color and alpha stores linear
height, **not opacity**. This lets varied sampling keep color and relief aligned
without doubling texture fetches. The original JPEGs remain for provenance and
rebuilding. `packed-manifest.json` records the derivatives and their hashes;
`python tools/pack-source-textures.py --check` verifies exact decoded RGB/height.
The packed files trade a larger one-time transfer for fewer resident GPU maps.
