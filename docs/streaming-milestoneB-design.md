# Streaming Phase 2, Milestone B — true per-chunk generation

Designed against `docs/layerprocgen/PRINCIPLES.md` (the checklist at the
bottom of this doc is filled in per layer). Goal: retire the monolithic
padded-window generation — the last structural violation of rules 1/2/4
(layer/chunk pairs, chunk lifetime, declared dependencies) — while the
100% seam gate and a bit-identity harness make every step mechanically
safe.

## What we have vs what the rules demand

Today `generateWorld` runs ~20 sequential passes over one padded window
(core + PAD_PC guard ring, ~2.25× area), in a stateless worker, from
scratch on every recenter. The *content* of most passes is already
LayerProcGen-shaped:

- Biomes, regions, crests, pillar specs, road field: pure functions of
  absolute coordinates. Effect distance 0.
- Transit: per-pillar-cell owned, clipped to its own 56×56 bounds,
  border sockets pure. The docs' owned-within-bounds pattern.
- Bridges/arches: owned pairs planned from a pillar field padded 2
  cells — padding ≥ effect distance, done by hand.
- Smoothing/sweeps/decks/arches: all bounded (≤16 tiles).

What violates the rules is the *compute shape*: no chunk lifetime, no
declared dependencies, whole-window context, full rebuild per recenter
(the hitch), and 2.25× cost paid for every pass on every window.

## Target architecture

A minimal LayerProcGen runtime in TS (`src/game/gen/`):

- `ChunkedLayer<TChunk>`: rolling grid of chunks keyed by ABSOLUTE
  chunk coords; `ensure(bounds)` generates missing chunks (recursively
  ensuring declared dependencies first); `release(bounds)` recycles.
- Declared dependencies: each layer lists `{layer, padTiles}` in its
  constructor. A data request that finds a missing provider chunk is a
  LOUD error, never a silent fallback (rule 4).
- Chunk size is per-layer. All tile-scale layers here use one pillar
  cell (56×56 tiles) — it matches render chunks, transit ownership,
  and bridge pairs. Coarser layers stay pure functions (no storage).
- The worker becomes STATEFUL: the layer grids persist across
  requests. A window request = `ensure(window bounds + consumers'
  padding)` + assemble. Recenter only generates chunks not already
  cached — that is the hitch win and the 2.25× win (the guard ring of
  window N is the core of window N+1).

### The window facade (transitional)

The engine, physics, bot, and renderer keep consuming `WorldData`
(window-local arrays) unchanged. A window assembler reads chunk cores
and concatenates them into the same WorldData the legacy path produces.
Retiring the facade (engine reads chunks directly) is milestone C, out
of scope here.

Gameplay anchors (spawn entrance selection) are a TOP-LEVEL overlay
computed at assembly time from the window center — they are
player-focus-relative by design (rule 7's top dependency), not world
structure, and stay window-scoped.

## Layer/chunk decomposition (the DAG)

Pure function "layers" (no chunks, no storage — effect distance 0):
region field, elevation field, cell noise, biome, crest, pillar spec,
road site/vein field, socket offsets. These are already absolute; they
are called directly and memoized per chunk where hot.

Chunked layers, all 56×56-tile chunks:

| # | Layer | Create() contents (today's passes) | Reads (padding in tiles) |
|---|-------|-------------------------------------|--------------------------|
| 1 | TransitLayer | connectPermanentTransit for the owned cell: through-routes, socket spokes, component attachment; publishes transit tiles + hallway cells | pure fns; own tile scratch (routes clipped to own cell by construction); neighbor socket offsets (pure) |
| 2 | TileLayer | layer0/1 cell gen, rooms, biome-driven fine-noise sculpt, roads carve, pillar footprints, decorative pillars, transit imprint | TransitLayer (0 — routes are cell-clipped), pure fields (fine noise reads neighbor-cell biome: 1 cell = 14) |
| 3 | HeightLayer | computePitMask (wall buffer 1), suppressRoadPits, computeHeightFields (smooth ×2 = 2, interior mouth sweep 4, cave-mouth sweep 4, border buffer 3+4), flattenRoadStreets, levelPitDecks (reach 4 over span 12 = 16) | TileLayer (**16**), TransitLayer (0: protected tiles are cell-local) |
| 4 | ColumnLayer | buildColumns, pillar air spans + marry (footprint + 1 ring) + roofline BFS (footprint-bounded), cutRoadBlockTops, carvePitArches (12), arches + bridges carve (owned pairs, spec lookups radius 2 pillar cells) | HeightLayer (**14**: arches 12 + marry ring, rounded up), TileLayer (14), pillar field (2 pillar cells = 112, pure) |

Notes:

- Effect distances above are measured from the code, not guessed; each
  becomes a `PAD` constant next to the pass it covers, and the layer
  dependency uses the max of its passes (rule 5).
- Ownership patterns: transit routes and bridge pairs are
  owned-within-bounds (owner cell / west-north owner); heights,
  arches, roads carving are overlapping-bounds (every chunk touching
  them derives them). Already true today — preserved verbatim (rule 8).
- No edge special-casing may survive: a chunk's working arrays are
  (56 + 2·pad)² assembled from provider chunks, output core is 56².
  Any `if (x === 0)` in a migrated pass is a padding bug (rule 6).
- Iteration-order hazards are the real migration risk: any pass whose
  output depends on whole-window scan order (BFS tie-breaks, Map
  insertion order, one-RNG-sequence-per-window) will differ when run
  per chunk. The bit-identity harness exists to catch exactly these;
  where found, the fix is per-cell seeding / deterministic ordering,
  matching what transit v2 already does.

## Verification (the ratchets)

1. **Bit-identity harness** (`tools/verify-migration.ts`): generate
   several (seed, origin) windows through the legacy path and the
   chunked path; deep-hash WorldData; require identical. Runs per
   migration step while both paths exist.
2. **verify-world**: 16 seeds, seam gate 100%, cracks, climbability —
   must stay green at every commit.
3. **Perf probe**: window generation time cold and warm (recenter with
   cached neighbors) — the whole point; measure, don't assume.

## Phases — ALL SHIPPED (Aug 2026, one pass)

B1+B2+B3 landed together: `src/game/gen/chunked.ts` (runtime),
`gen/layers.ts` (TileBase → Transit → Height → Column, per the padding
table), `gen/assemble.ts` (window facade + persistent grids + release
with a 2-chunk keep margin), and the worker flipped to
`generateWorldChunked`. Two shared-code extractions keep the paths
drift-proof: `dungeon/pillar-marry.ts` (applyPillarSpans) and
`carveStructures` in pillar-bridges (with a structure-frame offset).

Measured (tools/verify-migration.ts, 4 seeds × 5 windows including
revisits): **20/20 windows BIT-IDENTICAL** to the legacy path. Cold
window ~1.4-1.9× legacy (per-layer padding overhead); a one-pillar-cell
recenter ~380-610ms vs legacy ~1400-2500ms (≈3-4× faster); a revisited
window 4-23ms (chunks all cached). verify-world: 16 seeds ALL PASS,
seams 100%.

The legacy `generateWorld` stays for now: tools (debug-view,
verify-world, scan-holes) and the harness use it, and the harness runs
whenever a gen pass changes. Milestone C (later): retire the window
facade — engine consumes chunks directly; the entrance overlay and
recenter machinery go away entirely.

### Migration hazards actually encountered

Ordering is observable in three places and the assembler replicates
legacy order exactly: layer1 rooms sorted by (cellZ, cellX); transit
rooms / transit tile keys / hallway cells in per-cell carve order,
concatenated chunk-row-major (nearestPermanentTransit tie-breaks on
first-seen — insertion order is semantics, not style).

## PRINCIPLES.md checklist (filled)

- Layer/chunk pairs, per-layer chunk size: yes — 4 chunked layers at
  56 tiles; coarser planning stays pure-function (chunk size would be
  an implementation detail with no storage to justify).
- Chunk lifetime: ensure/release per bounds; worker grids persist.
- Strict I/O separation: each Create writes only its own chunk; reads
  go through provider requests. Transit's module-level sets
  (`permanentTransitTiles`, `hallwayCells`) move into chunk data.
- Declared dependencies with world-space padding, recursive ensure,
  loud missing-provider errors: framework feature, not convention.
- Padding ≥ effect distance: table above, constants co-located.
- No edge cases: padded working windows; core-only output.
- Top dependencies drive generation: the engine's window request is
  the top dependency (focus = player). True per-chunk top dependency
  (no window at all) is milestone C.
- Overlapping vs owned: preserved per pass as today.
- Fixed-point coords: absolute integer chunk/tile coords everywhere in
  gen; float only in the render/physics shell (already true).
