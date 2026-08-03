# LayerProcGen Principles — DaggerDungeon Compliance Checklist

This is the distilled rulebook from the official LayerProcGen documentation
(the `.md` files in this directory are verbatim copies from
github.com/runevision/LayerProcGen, MPL-2.0). **Every generation or
streaming change to this project must be checked against this list before
implementation.** When this file and intuition disagree, this file wins;
when this file and the verbatim docs disagree, the verbatim docs win.

## The three promises

LayerProcGen exists to deliver all three at once — dropping any one of
them is drift:

1. **Infinite** — the world extends without bounds (pseudo-infinite,
   32-bit integer coords). Nothing may assume a finite map or a global
   origin-dependent pass.
2. **Deterministic** — the same chunk always generates the same result,
   *regardless of the order chunks are generated in* and regardless of
   where the player entered the world.
3. **Contextual** — output is continuous and seamless, *as if the entire
   infinite plane had been generated at once*. Rune calls this
   **integrity**.

## The mechanics (the rules that make the promises true)

1. **Layer/chunk pairs.** Each layer is a rolling grid of uniform
   rectangular chunks. Chunk size is per-layer and is an implementation
   detail — different layers can have wildly different chunk sizes
   (RegionLayer chunks can be orders of magnitude larger than render
   chunks; that's how top-down planning works at infinite scale).

2. **Chunks have a lifetime.** A chunk is generated when something
   depends on it and destroyed/recycled when nothing does. All
   generation code lives in the chunk's `Create(level, destroy)`
   equivalent. There is no "generate the whole window" step anywhere.

3. **Strict input/output separation.** A chunk may read data from lower
   layers (any chunk of them, within declared bounds) and writes only its
   own output. No layer ever mutates another layer's data — "modifying"
   data means writing the modified copy into your own layer. Dependencies
   form a DAG; information flows one way.

4. **Dependencies are declared up front, with world-space padding.**
   Each layer declares, in one place, which layers it depends on and how
   much padding. The framework (ours too) must generate all provider
   chunks *before* a user chunk starts generating — recursively. A data
   request that finds missing provider chunks is a loud runtime error,
   never a silent fallback.

5. **Padding ≥ effect distance.** The effect distance is how far input
   can influence output (blur radius, relaxation distance × iterations,
   pathfinding corridor width). Iterated algorithms sum their per-iteration
   effect distances. Where an effect distance can't be derived, *choose*
   one and enforce it (e.g. clamp pathfinding to a corridor around the
   start–goal segment).

6. **No edge cases.** "If you are handling edges specially, you're likely
   doing something wrong." Input bounds are always larger than output
   bounds, so no data is ever missing. Special-casing a map border,
   window border, or seam is a red flag for a padding bug — patch the
   padding, not the edge.

7. **Top layer dependencies drive everything.** Generation starts from
   one or more (focus point, size) requirements — usually centered on the
   player. Moving the focus moves the generated region; chunks that fall
   out of all dependencies get destroyed. Streaming is not a feature you
   add — it *is* this rule. Fast travel = temporary top dependency at the
   destination. A map view can be its own top dependency on cheaper
   layers.

8. **Overlapping-bounds vs owned-within-bounds.** Two request patterns:
   for seamless *deformation* (every chunk touching a road flattens
   terrain under it) use all-data-overlapping-bounds; for one-time
   *ownership* (place the lamp posts exactly once) use
   owned-within-bounds via a deterministic anchor point (e.g. bounds
   center). Choosing the wrong one gives either seams or duplicates.

9. **Internal layer levels** (optional pattern): one chunk class,
   multiple levels sharing the same grid. A level may read (never write)
   its own and *immediate neighbors'* lower-level data — so the effect
   distance per level must be ≤ one chunk size. External layers can
   depend on a specific level.

10. **Fixed-point world coordinates + floating origin.** Generation math
    happens in integer/fixed-point world space; conversion to engine
    float space subtracts a floating origin. No generation math on
    float scene coordinates.

## Pre-implementation checklist for any gen/streaming change

- [ ] Which layer/chunk does this live in? What is its chunk size?
- [ ] What lower-layer data does it read, and with what padding?
- [ ] What is the effect distance of the algorithm, and is padding ≥ it
      (× iterations)?
- [ ] Is the output deterministic per chunk regardless of generation
      order and player approach direction?
- [ ] Does it write only to its own layer?
- [ ] Overlapping-bounds or owned-within-bounds — and why?
- [ ] Any edge/border special-casing? (If yes, stop — find the padding
      bug.)
- [ ] Do chunks build ahead of visibility (generation radius > fog/view
      radius) so nothing pops?

## Current codebase status (honest, August 2026)

The project is LayerProcGen-**style**, not yet LayerProcGen-**correct**:

- ✅ Generation is layered with one-way data flow (skeleton → tiles →
  biomes → sculpting → connectivity → golden path) and is deterministic
  from seed.
- ✅ Region layer plans above biomes at a larger abstraction scale
  (rule 1's multi-scale planning, in spirit).
- ✅ (Aug 2026) **Rendering streams via chunk lifetimes** (rule 7): one
  render chunk per absolute pillar cell, created/evicted by a focus
  disc, built ahead of fog range, surviving window recenters.
- ✅ (Aug 2026) **Windows are rim-exact** (rules 5, 6 in effect):
  generation runs on a guard-ring padded window (PAD_PC in
  DungeonGenerator.ts) and only the core ships, so rim special-casing
  lands in discarded padding. tools/verify-world.ts enforces 100%
  overlap agreement on X/Z/diagonal shifts as a hard gate.
- ❌ Layers still run as sequential passes over one (padded) window, not
  as independent chunk grids with per-chunk `Create` (rules 1, 2) —
  correctness is now right, the compute shape isn't: each window pays
  ~2.25× generation for the guard ring, and context is still
  "whole window in memory" rather than declared per-pass dependencies
  (rule 4).

Remaining migration (Phase 2 milestone B): restructure passes into
per-chunk `Create` with per-pass effect-distance padding. The 100% seam
gate makes that refactor mechanically safe — any drift fails the gate.
