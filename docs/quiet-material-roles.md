# Quiet material roles (supersedes the grimy concrete source pass)

- Walls: existing `/textures/concrete-clean-base.png`; single derivative-filtered sample, subtle luminance relief (0.018). Formwork is restrained to vertical walls, 8% joint shading. Fold-specific wall detail remains on fold walls only.
- Constructed floors: existing `/textures/concrete-smooth-precast.png`, relief 0.012. Absolute-world XZ 3 × 6 metre pours, 12 mm half-joints, derivative feathering and subpixel contrast attenuation. Panel interiors differ by no more than 2%; no stochastic concrete mottle, dirt, or per-quad UV reset.
- Ceilings: distinct `concrete-ceiling` role, old clean base and relief 0.006. Floor slabs and fold/formwork effects are disabled even if callers request them.
- Cave/ember ground: `concrete-mineral`, old fine aggregate, no artificial slab grid. Constructed/fold floor roles retain slabs.
- Paint: `vertexColors = true`; infrastructure vertex RGB owns coat color. Translated scratch/height samples remain. Recolouring uses multiplicative luminance gain `0.72 / 0.066`, clamped to 0..1: black scuffs remain black and unsaturated source luminance ratios survive. The old additive grey offset washed out the texture even after its gain was increased. The source mean still maps to the existing 0.72 coat level; clipped highlights mean this is not a promise about the final image average.
- Ladders/fittings: retain the original rusted-iron RGB texture instead of applying the pipe recolouring treatment to bare metal. Aligned tread tops, authored height, corrected UVs and the three infrastructure batches remain unchanged. Worn iron is deliberately darker than the rejected pale-grey substitute.
- Concrete no longer reads rust/dirt packed alpha or adds a second fine-grain texture pass. Linear height for legacy RGB is derived from the same filtered RGB sample; packed metal alpha still supplies metal relief. World-origin projection and pipe UV geometry are untouched.

## World-scale pipe finishes

`infrastructure-finishes.ts` reads the existing coarse network owner, service
role and region field. Primary trunks use restrained neutral construction
finishes (steel blue, weathered green, iron brown and mineral green-grey). Return
circuits use stronger blue-grey/teal, with selected machine-region returns in sage.
Access/service branches use ochre and iron-brown finishes. These classify existing
trunk/return/service records; they do not invent a fluid simulation.

Segments and risers of one owned connection keep the same finish. A region or
construction-owner boundary can introduce another finish at a real junction;
individual render pieces and camera/window positions never choose colours.
Mounted facade utility banks use their building/parcel owner and pipe scale.

Linear RGB is supplied on pipe vertices and retained through material
accumulation and final mesh emission. Explicit finish colours are not overwritten
by generic biome tint. The same three material batches, UV charts, geometry and
collision are retained. `verify-world-finishes.ts` checks service separation,
owner/segment consistency, negative coordinates, rebasing, and actual renderer
colour attributes and accumulation.

## Verification

`tools/verify-metal-readability.ts` checks preserved dark scuffs and luminance
ratios, the pipe source-mean anchor, original ladder/fitting RGB, retained relief
and protected quiet concrete. The software swatch preview uses the exported
paint response and unmodified iron RGB. These tests complement, not replace,
actual textured browser views.

`node_modules/.bin/tsx tools/verify-quiet-materials.ts` checks actual renderer roles, old assets, slab periodicity/negative coordinates/LOD, ceiling isolation, natural-ground exception, neutral vertex paint, and batch count. The initial red run failed on the old wall asset assertion before implementation.

`node_modules/.bin/tsx tools/verify-source-materials.ts` retains texture sharing/filtering/front-face/relief/batch/tread gates, replacing obsolete grime-asset/detail-pass expectations.

`node_modules/.bin/tsx tools/verify-source-shaders.ts` compiles and links nine real expanded Phong programs through Mesa llvmpipe GLES3, including a deliberately misrequested ceiling with wall/fold flags (safely disabled).

`node_modules/.bin/tsx tools/preview-quiet-materials.ts` produces `artifacts/quiet-material-roles.png` from actual repository textures and the exact exported TypeScript slab CPU reference. Visually inspected: flat grey walls/ceilings, subtle rectangular slab joints, quiet ungrouted mineral ground, coat-led blue-grey example paint, neutral rather than orange fitting sides. This is a software flat-light material swatch preview, **not** an in-engine screenshot or lighting approval; metal swatches use filtered direct texture samples rather than the shader's stochastic offsets. Parent supplies the actual service palette.
