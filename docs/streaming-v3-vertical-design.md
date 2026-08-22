# Streaming v3 — Vertical Bands (design, Aug 2026)

*Status: PROPOSED — not signed off. Companion to
`docs/streaming-milestoneB-design.md` (horizontal chunk streaming,
shipped) and `docs/layerprocgen/PRINCIPLES.md`.*

## The flaw being fixed

The world streams horizontally (render chunks per pillar cell, chunk
lifetimes driven by a focus dependency) but is MONOLITHIC vertically:
a chunk meshes every face of its columns from abyss to crest, and any
generation pass that scans a column pays for the column's full height.
Consequences:

- Tall/deep content is rationed by cost, not by design intent. The
  fold-structure biome (fold-structure.ts) wants hundreds of units of
  vertical city; pillar kebabs were always meant to be climbs through
  *loaded layers*, not fully-materialized towers.
- The player's altitude buys nothing: standing at grade you carry the
  crown geometry 700 units up and the abyss walls 300 down.

The goal: travel up and down through vertically streamed content the
same way we travel north and south — while keeping every invariant
that makes this codebase verifiable.

## THIS IS NOT A VOXEL ENGINE (read this before anything else)

DaggerDungeon has no voxel grid. The world is the COLUMN MODEL
(`src/game/dungeon/columns.ts`): per (x,z) tile, a short sorted list of
continuous AIR SPANS — "air from y=1.0 to 28.0, solid elsewhere." A
column is a few dozen bytes at ANY height; heights are floats (0.5 by
convention, not by storage); there is no per-cell material grid.
Vertical extent is nearly free in DATA and expensive only in MESHING
and generation scans. Minecraft/voxel citations below are used ONLY
because their render-sectioning and vertical-dependency lessons
transfer structurally — do not import voxel assumptions (chunk cell
storage, per-block materials, 3D data chunking, greedy meshing) into
this codebase. If a plan starts sounding like Minecraft, it has left
the rails.

## What the research says (why the obvious design is wrong)

Minecraft's Cubic Chunks mod is the canonical attempt at fully 3D
chunking, and its decade of pain is documented: skylight computation
"seemed impossible to solve" because light needs the column above,
heightmaps stop existing, and every system that assumed a known world
height broke in unpredictable ways
([mod wiki](https://github.com/OpenCubicChunks/CubicChunks/wiki/About-the-mod),
[forum thread](https://www.minecraftforum.net/forums/mapping-and-modding-java-edition/minecraft-mods/wip-mods/2792887-cubic-chunks-mod-almost-infinite-world-height-and)).
Vanilla Minecraft's shipped answer is the instructive one: world DATA
stays in full-height columns, while RENDERING uses 16³ sections with a
section-connectivity visibility graph for culling
([Advanced Cave Culling Algorithm](https://tomcc.github.io/2014/08/31/visibility-1.html)).

Our analogues of "skylight" — the crest authority, the sky-clip roof
plane, cap plates (capMax), pending-ceiling derivation in
buildColumns, pit bands to worldBottom — are all full-column,
top-down computations. Banding the DATA would re-fight Cubic Chunks'
war against them. Banding only MESHING (and lazily extending
generation of the columns themselves) dodges it entirely.

## Design principle: band the renderer, never the truth

The COLUMN MODEL stays the single, full-height authority. Columns are
run-length span lists — a 400-unit city column is ~tens of numbers, so
full-height data is cheap. Physics, the bot, seals ("leaks are
unrepresentable"), verify-world, and the DDSNAP loop keep exactly
their current semantics: physics can never fall through an unloaded
band because the data is never unloaded, only the triangles are.

What becomes banded:

1. **Meshing** — the expensive, altitude-relevant cost.
2. **Expensive vertical generation** — fold scans and future deep/tall
   content, generated per band on demand. Pure-function discipline
   makes this safe: a band materialized next week emits the identical
   spans it would have emitted today.

What stays full-height / 2D:

- Column span lists (truth), buildColumns, all physics queries.
- Terrain, biomes, transit, pillar/bridge planning — 2D decisions.
- Crest authority and sky-clip: computed from full columns as today.

## Slice 1 — Y-banded meshes inside existing render chunks

No chunk-key change, no generation change, no worker change.

- Chunk build emits geometry into BAND GROUPS: `[k*BAND, (k+1)*BAND)`
  world-Y slabs, BAND = 64 initially (tunable). Every emitter
  (columns pass, level surfaces, walls, pit rims, caps) already knows
  each primitive's Y extent; banding is a bucket choice at append
  time, not new geometry math.
- Faces SPANNING a band plane are SPLIT at the plane (exact same
  Y for both halves — shared plane, no T-junction, no seam by
  construction). Splitting is data-exact clipping of quads at
  y = k*BAND; the junction-interpenetration doctrine is unnecessary
  here because both halves come from the same source primitive.
- Band visibility: a band group is IN the scene when it intersects
  [playerY - R_DOWN, playerY + R_UP] (start ~192 down / ~256 up —
  generous, then tighten with measurements). Never evict the band
  containing the terrain surface of a chunk that is horizontally
  live — the ground is always there when you look down a shaft.
- Cheap first version: bands are THREE.Group visibility toggles (all
  geometry still resident). Second version: distant bands release
  their GPU buffers and rebuild from the retained column data when
  approached (same quarter-cell job machinery as chunk builds).

Measurable win: triangle count and draw calls near grade drop by
whatever fraction of geometry lives outside the altitude window —
today that is all crown mass (y > ~100) and all abyss walls
(y < -50) in every live chunk.

## Slice 2 — banded lazy generation (POINTWISE-PURE PASSES ONLY — see
## critical-research rule 2)

- applyFoldStructures gains a band parameter: the Column layer stores,
  per chunk, which Y bands have been fold-populated; a band's spans
  are inserted on first request. The core band [FOLD_DEEP, skyline]
  stays eager until this ships.
- Requesting = the same focus dependency as slice 1's visibility,
  plus one band of margin.
- Invariant: fold evaluation is pointwise in (seed, absolute x, y, z),
  so late-materialized bands are bit-identical to eager generation.
  The migration harness extends: verify a fully-eager world equals a
  band-by-band-materialized world, span for span.
- Physics interaction: a band's spans must exist before the player can
  REACH it. Same rule as horizontal: generation radius > render
  radius > player. Vertical velocity is bounded (terminal fall speed,
  elevator speed), so prefetch-by-velocity has hard latency bounds —
  compute worst case, size R_DOWN margin to it.

## Slice 3 — the payoff features

- Fold city ranges extend to ~[-250, +200] in canyon districts (or
  per-preset), at unchanged near-grade cost.
- Pillar kebabs stream by segment: "which authored chunks intersect
  this band" is a filter over the kebab list — the original intent of
  the kebab design. Crowns and deep foundations stop being resident
  at grade.
- Elevators/long climbs become the stress test and the showcase:
  vertical direction-aware prefetch mirrors the horizontal
  direction-aware prefetch that already exists.

## Critical research pass (Aug 2026 — looking for trouble, not support)

Findings that CUT AGAINST this design, and what they change:

1. **The industry mostly does NOT do vertical streaming cells.**
   Unreal's World Partition — the most-used general streaming system —
   is a deliberately 2D grid; tall UE maps are handled with data
   layers, manual streaming volumes, and HLOD/impostors instead
   ([UE docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine)).
   No shipped precedent was found for span-column worlds with
   vertically lifecycle-managed meshes. Closest real precedent is
   Minecraft's render sections + visibility graph — voxel-side but
   render-only, like our Slice 1. CONSEQUENCE: Slice 1 is on-trail
   (data resident, rendering sectioned); Slices 2-3 are off-trail and
   must prove themselves with measurements, not analogies. An HONEST
   ALTERNATIVE to evaluate first: keep full-height meshing and add
   distance/altitude LOD or a raymarched fold impostor for far bands —
   industry-standard shape, far less machinery.
2. **Vertical effect distance is the generation killer.** Cubic
   Chunks' deepest problem wasn't storage: generation needing vertical
   CONTEXT (their caves went from a 17×17 column check to 17³ cubes)
   exploded cost, and their workaround was generating whole columns
   and splitting after
   ([forum](https://www.minecraftforum.net/forums/minecraft-java-edition/suggestions/77631-cubic-chunks-reduced-lag-infinite-height-and-more)).
   CONSEQUENCE — new HARD RULE for Slice 2: banded lazy generation is
   permitted ONLY for passes that are pointwise-pure in (seed, x, y, z)
   (the fold qualifies). Any future pass with vertical effect distance
   (floors linked by stairs, connected interiors, anything reading
   above/below) must either stay eager full-column or declare vertical
   padding the way horizontal passes declare theirs — no exceptions,
   no "it looks fine."
3. **Draw-call multiplication is the practical Slice 1 risk.** The
   chunk-sizing literature is unanimous: smaller sections cull better
   but multiply draws
   ([voxel engine notes](https://sites.google.com/site/letsmakeavoxelengine/home/chunks)),
   and three.js is draw-call-sensitive with no GPU-driven path. Our
   chunks already split meshes per region/material; × bands could
   double-triple draws. CONSEQUENCE: empty-band skipping and
   sparse-band merging are Slice 1 REQUIREMENTS, not optimizations,
   and the ship gate includes a draw-call count, not just triangles.
4. **Bands are NOT LayerProcGen chunks.** The framework is explicitly
   2D planar; pretending bands are layer chunks would fork the
   doctrine this project is built on. CONSEQUENCE: bands stay a
   render/detail concept INSIDE the existing 2D chunk system; data
   layer keys never grow a Y. (Chunk-boundary determinism practice —
   position-hashed seeds, strict layer input/output separation — we
   already follow;
   [LayerProcGen](https://github.com/unitycoder/LayerProcGen) is the
   reference.)

## Risks and their answers

- **Band-plane seams** (visual only): split-at-plane sharing exact Y
  kills geometric cracks; residual risk is material/UV continuity
  across the split — verify with DDSNAPs at band planes.
- **Draw call growth**: bands multiply mesh count. Mitigate by BAND
  size tuning and merging empty/sparse bands (most bands over open
  terrain contain nothing — skip empty groups entirely).
- **Skylight-analogue bugs**: none by construction — crest/caps/sky
  computed from full columns exactly as today (the research lesson).
- **Eviction thrash on vertical oscillation** (bunnyhopping at a band
  edge): hysteresis on band lifetimes (build eagerly, evict lazily),
  same as horizontal 210/260wu split.
- **Fall-through**: impossible for physics (data always resident);
  visual pop-in is the actual failure mode, bounded by prefetch
  margins.

## The vertical endgame: STACKED WORLDS, not unbounded Y (user
## direction, Aug 20 2026)

One seed does NOT need infinite height. Each world is one LayerProcGen
plane with a CEILING and a BASEMENT; passing through the roof loads
the NEXT world entered from its basement (and down through the floor,
the previous world's roof). The feeling of going on forever comes from
the CHAIN of worlds, not from one coordinate stretching forever.

Why this beats unbounded Y:
- The `stack` parameter and `stackSeed = seed + stack*100000` already
  exist in generateWorld — vertical world segments are plumbed.
- Every grade-anchored system (sky-clip, crest authority, terrain,
  spawn, transit) stays valid PER WORLD. No cosmology rework.
- The column model stays the full-height truth of a BOUNDED-tall
  world. No banded physics, no infinite span lists.
- Float precision: "when the numbers get too big we dump this place
  for another" — a fresh origin per stratum is both the standard
  engineering fix and the fiction itself (strata of an endless
  megastructure).
- Per-stratum identity: each stack level can shift region weights and
  fold presets (deeper = more machine, higher = more sky) — the stack
  tells a story.

Transitions are LOAD BOUNDARIES dressed as thresholds (shaft, airlock,
the elevator that takes weeks — the diegetic loading screen). No
geometric continuity between strata is required, only a believable
door. This section supersedes any notion of a "Phase 4: unbounded Y";
vertical bands (Slice 1) remain valuable WITHIN a stratum so tall
worlds render by altitude.

STATUS: direction only — stacked transitions were BUILT ONCE BEFORE
and deleted for messiness (the `stack` param's "legacy save
compatibility" note is that attempt's stump). Nothing here gets wired
until the base game is solid and the user calls for it. This doc
records the destination so nobody re-derives (or re-attempts) it
prematurely.

## Sequencing and gates

1. Slice 1 behind measurements: ship only with before/after triangle
   and frame-time numbers at grade, mid-climb, and crown.
2. Slice 2 gated on the eager-vs-lazy bit-identity harness.
3. Slice 3 (range extension, kebab banding) only after 1+2 soak in
   playtesting.

Each slice is independently shippable and independently revertible;
none touches column semantics, so verify-world/scan-holes remain the
regression gates throughout.

## PRINCIPLES checklist

- Infinite (rule 1): band index is absolute (floor(y/BAND)) — no
  global height assumption anywhere; range limits are per-feature
  content decisions, not architecture.
- Deterministic (rule 2): banded generation is pointwise-pure;
  eager == lazy verified mechanically.
- Contextual (rule 3): meshing bands read only the (full) columns of
  their own chunk + the same neighbor data current meshing reads.
- Declared dependencies (rule 4): the fold band store lives in the
  Column layer; no new cross-layer reads.
- Focus dependency (rule 7): band lifetimes hang off the existing
  player-focus dependency, extended with an altitude window.
