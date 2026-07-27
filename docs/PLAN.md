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
descendability, bridge walkability, permanent-network reachability, seam agreement, crack
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
- **Spawn/exit + golden path** → exit removed; spawn is construction-neutral

Completed locally in the current M3 pass:
- **Marriage fixpoint:** exact queue per owned pillar footprint; invariant verifies
  that no eligible tile remains unsettled.
- **capField roofline:** each pillar reads only its one-tile room perimeter and
  propagates caps inside its owned footprint.

#### Permanent navigation contract

`connectIslands()` is a finite-map repair and must be removed. A tunnel created
because two components happen to be disconnected inside one temporary window
has no permanent world identity and may disappear when that window moves.

The endless replacement is a LayerProcGen navigation stack:

1. **Pillar-cell transit layer:** every absolute pillar cell owns a deterministic
   local hub. Every adjacent cell pair has one shared deterministic socket,
   owned by the west/north cell. Local corridors join the hub to its four
   sockets, creating a permanent infinite coarse network.
2. **Local attachment layer:** each pillar cell labels traversable components
   inside its own bounds and joins them to its hub. Routing may read bounded
   padding but publishes tiles only inside the owner cell.
3. **Regional intent layer:** later, region chunks select which connections are
   grand galleries, vents, subways, bridges, or deliberately sealed routes.
   The coarse graph must retain a connectivity guarantee even as vocabulary
   changes.
4. **Render/physics layer:** columns and meshes consume the permanent corridor
   output. A moving window only materializes existing cells; it never decides
   whether a connection exists.

Required invariants:
- Shared sockets agree from both adjacent cells and from shifted windows.
- Every traversable local component reaches its pillar-cell hub.
- Every hub reaches neighboring hubs through permanent owned connections.
- Overlapping windows have identical transit tiles.

First production slice completed locally:
- The whole-window `connectIslands()` repair has been replaced by permanent
  absolute pillar-cell hubs, pair-owned shared sockets, owned A* routes, and
  bounded local component attachment.
- Permanent transit tiles are sacred downstream: decorative pillars and the
  void field cannot overwrite them.
- Verification now checks both sides of every internal socket and proves every
  ordinary terrain tile is in the entrance-connected network.
- Spawn no longer carves a room or reserves terrain. It is a window-scoped
  marker snapped onto safe permanent transit in the streaming-safe center.
- The bounded-map exit, stairs, crystal, beacon, interaction, golden path, and
  live exit route have been removed. The HUD compass now indicates true north.
- Decorative pillars and the void mask contain no objective exceptions.
- Shifted-window column agreement improved from 97.7% to 99.1% on the seam seed.

### 2. Kill the re-center hitch
v1 rebuilds the whole window on crossing (~150–250 ms). Move to incremental
chunk streaming: per-pillar-cell mesh groups, generate/evict at the edges,
corner-field consistency via 1-cell overlap. The generation side is already
window-pure; this is renderer/engine work.

Interim handoff guarantee completed locally: a grounded recenter now validates
support in the replacement column model and recovers to the nearest compatible
same-height span within 16 tiles. If no bounded continuation exists it returns
to the entrance instead of dropping the player into the void. The verifier
checks support availability across the east recenter boundary.

### 3. Purpose in the endless world
There is intentionally no exit now: spawn in, explore, and use the north
compass to retain orientation. Add purpose later through landmark navigation,
region-gated progression, or expedition objectives placed on pillar sockets;
none of those should author terrain from a temporary window.

### 4. Deepen the vocabulary (M4 wave 2)
- **Pillar rhythm pass, slice 1 completed locally:** kebab occupancy now uses
  district-aware local + macro fields instead of one near-always-on threshold.
  City districts cluster around courts, machine districts form broken rows,
  canyons leave broad cuts, and frontiers scatter monuments. Measured
  large-area occupancy is roughly 36–45%, while individual 4×4 play windows
  may range from empty plazas to dense walls. The 56-tile grid remains an
  invisible ownership system, not the visible composition.
- Next: bounded in-cell placement offsets, then rare multi-cell landmarks.
- **Regional identity pass completed locally:** City is restricted to
  dungeon/crypt and grows taller; Machine is cave/ember with shorter,
  deeper kebabs; Canyon is cave/outside with sparse tall remnants; Frontier
  alone retains the full transitional mix. Verification enforces these biome
  vocabularies. Non-cave ceilings are taller, open-sky walls render at least
  300 units high and extend 300 units above the tallest crown, and bottomless
  pit walls render 300 units below the deepest built structure.
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
