# The Megastructure Plan

*Living plan — July 27 2026. This is the working plan of record: pick it up on any
machine, read top to bottom, and continue. Companion reference:
`docs/world-reference.html` (visual doc of every layer, biome, structure, and
constant, with a live seed-driven field viewer).*

## The Dream

This is no longer a fantasy dungeon generator. It is an endless, brutalist
megastructure inspired by the manga **BLAME!** — exploration and horror, beauty
and wonder. Tight corridors and vent shafts. Grand canyons of arches designed by
the noise of insane machines that build without end. Residential strata
compressed like the Kowloon Walled City. Pipe structures flowing through it like
a vast sewer. Elevators that take weeks to complete their climb. Abandoned
subway tunnels where a few trains still function.

The core rhythm to protect in every change: **inside → outside** — cramped
places that suddenly open onto grand vistas, again and again. Contrast IS the
feel.

## Non-Negotiable Discipline

Every generation feature is a **pure function of `(seed, cellX, cellZ)` plus a
bounded neighbor radius**. No global scans, no grid bounds, negative coordinates
first-class. A bounded world is a window over the infinite functions — this is
what makes the endless world possible and it is now literal in the code.

The **column model** (`src/game/dungeon/columns.ts`) is the single source of
truth: per-(x,z) sorted AIR spans. Renderer faces, physics, and agents all
derive from span differences. If it isn't in the columns, it doesn't exist.

## Done (the foundation — all pushed to master)

| Milestone | What shipped | Key commits |
|---|---|---|
| Pillar kebabs v1–v2 | Coarse pillar layer (1 pillar cell = 4×4 dungeon cells = 56 tiles), authored chunk stacks, spiral face-ramps continuous by construction, bridges with degree guarantee | (earlier history) |
| Real stairs | Fixed 0.6 rise per tread (engine STEP_UP 0.65), flat corner landings are load-bearing for the spiral handoff | `e909e5a` |
| Field-derived biomes | 3-octave fbm + domain warp + elevation coupling; thresholds are district palettes | `a6bd150` |
| Up AND down | Kebabs extend below grade (deep clearances punch the foundation), wells (crown plinth only, spiral descending), shaft chunk (h 13.8 = stairs with no stops), descendability invariant | `f8079b9` |
| **M1 Regions** | `region-layer.ts`: city / machine / canyon / frontier districts (~336 wu tracts, warped borders) dictate biome palettes. Growing the world = adding region types, never touching the biome selector | `01ff1c6` |
| **M2 Slab broken** | Heavy-tailed district-weighted budgets: ~4% supertowers (to ~3×, city-biased; observed ~195), ~5% deep wells (machine-biased; observed ~−65); per-pillar foundation bottom; render clips derived from what was built | `01ff1c6` |
| **M4 Blame! vocabulary** | Kowloon residential chunk (city-biased), vent chunks, pipe crossings (35% of chance bridges), subway bores (y=−10), canyon arch forests, district-weighted chunk composition | `01ff1c6`, `700290d` |
| **Machines that function** | `src/engine/Movers.ts`: ridable glacial elevators (0.35 u/s, ~50% of tall pillars, east face) + trains in ~25% of subway bores (not ridable — dodge them). Deterministic per seed | `700290d` |
| **M3 Endless world v1** | `generateWorld({originPcx, originPcz})` windows the infinite plane; engine `recenterWindow()` re-centers as the player walks; DDSNAP carries `opx/opz`; seam invariant ≥90% overlap-column identity (measured 94–97.7%) | `cd2ecc4`, `5cc083a` |

**Verification:** `npx tsx tools/verify-world.ts` — 16 seeds × (climbability BFS,
descendability, bridge walkability, spawn→exit route, seam agreement, crack
pairs, column invariants). All green at head. `tools/debug-view.ts` renders any
DDSNAP repro string headlessly (F8 in game copies one).

## Now / Next (in order)

### 1. Perfect the seams (M3 part 3)
The 3–6% of overlap columns that differ between shifted windows are the
per-window passes. Convert each to bounded-radius so the world never morphs
behind the player:
- **Marriage fixpoint** → bound to per-pillar-footprint radius
- **capField roofline BFS** → bound to room neighborhoods
- **Island connectivity + hallways** → per-cell-pair local corridor guarantees
- **Spawn/exit + golden path** → rethink for endless play (see item 3)

### 2. Kill the re-center hitch
v1 rebuilds the whole window on crossing (~150–250 ms). Move to incremental
chunk streaming: per-pillar-cell mesh groups, generate/evict at the edges,
corner-field consistency via 1-cell overlap. The generation side is already
window-pure; this is renderer/engine work.

### 3. Purpose in the endless world
Spawn/exit + golden path assume a bounded map. Decide the endless-play loop:
landmark navigation (visible supertowers as goals), region-gated progression,
or expedition objectives placed on pillar sockets. The old exit-stairs → next
stack loop still works but fights the endless framing.

### 4. Deepen the vocabulary (M4 wave 2)
- Buried gallery halls + plazas below grade (deepPickable currently plain/shaft only)
- Mega-elevator SHAFTS through pillar cores (current elevators ride exterior faces)
- Subway STATIONS where bores meet pillar galleries; trains that stop
- Arch variety (angled struts, double-deck), residential balconies/interiors
- Vertical strata: region type varying with altitude bands, not just plan-view

### 5. The editor
`docs/world-reference.html` already runs a bit-exact JS port of the field math.
Phase 1: generate its constants from source (JSON dump) instead of hand-copy.
Phase 2: sliders → live re-render. Phase 3: chunk cards become editable specs.

## Known Rough Edges (fix on encounter)
- Canyon arches verify-blind spot fixed via ring-scoped climb target (14..41);
  arch end tiles sit at ring+1 by design.
- Trench mouths of down-spirals: the tread-marry pass only sees a column's
  lowest span — trench-lip seams are the likeliest visual jank. DDSNAP any.
- Straddler crowns flatten their flight (sheltered landing); interior pillars
  keep attics; fully-outside pillars open to sky. If a stair "ends in a wall",
  suspect a new interaction with this three-way rule.
- Movers phase uses elapsed session time — deterministic placement, not
  deterministic mid-ride position across sessions (fine; revisit if multiplayer).

## Working Agreements
- Playtest loop: user plays, F8-marks geometry, sends DDSNAP strings;
  `tools/debug-view.ts '<snap>' out.png` reproduces the exact view headlessly.
- Never ship with `verify-world` red. Add an invariant with every new guarantee.
- Seam doctrine, stair/slab rules, and chamfer rules are documented in
  `world-reference.html` and as code comments at the relevant sites — read
  before touching renderer sealing.
