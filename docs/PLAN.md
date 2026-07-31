# The Megastructure Plan

*Living plan — trimmed July 31 2026. History lives in git; this doc holds only
the dream, the rules, and what's ahead. Companion reference:
`docs/world-reference.html` (visual doc of every layer, biome, structure, and
constant, with a live seed-driven field viewer). Roads design:
`docs/roads-layer-design.md`. Interiors kit: `docs/pillar-room-kit.md`. Asset
handoff: `docs/modular-asset-handoff.md`.*

## The Dream

This is no longer a fantasy dungeon generator. It is an endless, brutalist
megastructure inspired by the manga **BLAME!** — exploration and horror, beauty
and wonder. Tight corridors and vent shafts. Grand canyons of arches designed by
the noise of insane machines that build without end. Residential strata
compressed like the Kowloon Walled City. Pipe structures flowing through it like
a vast sewer. Elevators that take weeks to complete their climb.

The core rhythm to protect in every change: **inside → outside** — cramped
places that suddenly open onto grand vistas, again and again. Contrast IS the
feel.

## The Purpose

The purpose is for the best **lightweight megastructure generation** ever
constructed to be born here. We are well on our way: what exists is light as
hell — pure functions over coordinates, one column model, no baked data, no
WFC, no Minecraft-style chunk voodoo. A real baseline for endless worlds.

The end state: improve it, then **demystify the build for the common man**, so
this can be used the way a standard terrain generator is used in mainline game
engines. The game is the proof; the generator is the product.

## Non-Negotiable Discipline

Every generation feature is a **pure function of `(seed, cellX, cellZ)` plus a
bounded neighbor radius**. No global scans, no grid bounds, negative coordinates
first-class. A bounded world is a window over the infinite functions — this is
what makes the endless world possible and it is now literal in the code.

The **column model** (`src/game/dungeon/columns.ts`) is the single source of
truth: per-(x,z) sorted AIR spans. Renderer faces, physics, and agents all
derive from span differences. If it isn't in the columns, it doesn't exist.

## Ideas

Future directions — none of these are commitments, and the rail one is
explicitly a guess until the day it's real work.

- **Demystification.** The path from here to "usable like a terrain
  generator": name and document the core concepts in plain language (columns,
  layers, ownership, seam doctrine), grow `world-reference.html` into the
  teaching artifact, and keep the engine-agnostic parts (generation, columns,
  invariants) cleanly separable from the Three.js shell.
- **Emissive maps + low-threshold bloom** (queued from the synthcity review):
  bake lit-slit / stairwell-glow / strip-light emissive masks for the concrete,
  keep emissiveIntensity low (1–2), bloom threshold near 0 with strength held
  brutalist (0.6–1.5). Pairs with the light-fixture pool: wherever a pool light
  lands there should be a visible emissive source. Ship it through the Visual
  Lab validation ritual.
- **Canyon-causeway street district** (user idea, July 30 2026): a roads
  variant that INVERTS pit suppression — the vein network laced with voids to
  the extreme, streets as narrow causeways over the abyss.
- **The editor.** Principle (user, July 31 2026): the best way to build an
  editor is to build a GAME and make the editor for what the game needs — so
  the editor waits for the game. A game will be added here; it isn't started
  yet (movement, climbing, crouching are a hit, but they're just the start).
  When it comes: `docs/world-reference.html` already runs a bit-exact JS port
  of the field math. Phase 1: generate its constants from source (JSON dump)
  instead of hand-copy. Phase 2: sliders → live re-render. Phase 3: chunk cards
  become editable specs.
- **Asset replacement pipeline.** The graybox-to-authored handoff is documented
  in `docs/modular-asset-handoff.md`; `reference-assets/*.glb` establish scale,
  orientation, and silhouette contracts. Ahead: more reference pieces (bridge,
  plaza, ramp, corbel, pipe, arch), socket empties + naming conventions in the
  GLBs, and a loader/instancing path that marries authored modules to
  deterministic placement without generation ever depending on mesh contents.
  Prefer reusable authored/CC0 assets where license, scale, and topology fit.
- **Long-distance rail.** Real regional rail — routes, stations, trains —
  replacing the deleted subway-bore scaffolding someday. Everything beyond that
  sentence is guessing; spec it when it's actually next.
- **fixNoise caution** (for whenever new threshold-driven fields are added):
  noise clusters near 0.5; the synthcity range-remap makes thresholds honest —
  but retrofitting it onto existing fields reshuffles every world. New fields
  only, or retune knowingly.

## Parked references (ideas shelved deliberately — reasons matter)

- **"Ruled by Utopia" (Almeida et al., WCDCC 2025, CC BY 4.0,
  ceur-ws.org/Vol-4156/short1.pdf)** — aesthetic megastructure massing:
  grammar-partitioned towers, filler-height flushing, stacked contracting
  sections, 3D-noise facade module banding. PARKED July 31 2026: the
  massing fights our fixed-footprint climb-by-construction contract; the
  interior-slicing reading contradicts the settled "room modules, not
  random subtraction" doctrine; results are preliminary. Keep only the
  filler-tolerance idea (clustered blocky tops) as possible future crown
  chunk variety within fixed footprints, and noise-banded module choice
  when the facade kit lands.
- **Sceelix** (MIT engine; reviewed July 30 2026) — the live takeaways are the
  junction polygon math and the CGA split arithmetic (facade/floor splitting);
  the full ranked review is in git history and `docs/roads-layer-design.md`
  context. The rest is mined out.

## Known Rough Edges (fix on encounter)
- Short subway bores are REMOVED from generation (July 30 2026): they were
  unreachable scaffolding visible only in wireframe and pit walls. The
  planOwnedSubways machinery stays in pillar-bridges, unwired, until real rail
  gives tunnels identity and access.
- Canyon arches verify-blind spot fixed via ring-scoped climb target (14..41);
  arch end tiles sit at ring+1 by design.
- Trench mouths of down-spirals: the tread-marry pass only sees a column's
  lowest span — trench-lip seams are the likeliest visual jank. DDSNAP any.
- Straddler crowns flatten their flight (sheltered landing); interior pillars
  keep attics; fully-outside pillars open to sky. If a stair "ends in a wall",
  suspect a new interaction with this three-way rule.
- Bloom, neutral contrast/saturation, and vignette are the only retained
  post-process controls. Homemade film grain and GTAO were removed after visual
  validation failed. New effects require researched parameter semantics,
  neutral defaults, useful bounded ranges, and in-game min/default/max testing
  before they appear in the Visual Lab.

## Working Agreements
- Playtest loop: user plays, F8-marks geometry, sends DDSNAP strings;
  `tools/debug-view.ts '<snap>' out.png` reproduces the exact view headlessly.
- Never ship with `verify-world` red: `npx tsx tools/verify-world.ts` runs 16
  seeds × (climbability, descendability, bridge walkability, permanent-network
  reachability, seam agreement, crack pairs, column invariants). Add an
  invariant with every new guarantee.
- Seam doctrine, stair/slab rules, and chamfer rules are documented in
  `world-reference.html` and as code comments at the relevant sites — read
  before touching renderer sealing.
