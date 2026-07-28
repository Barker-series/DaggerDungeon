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
| **Transit prototype corrected** | Removed decorative slow platforms and oscillating subway cubes. Rare pillar cells now become purpose-built internal elevator shafts with bottom/ground/crown stops, safe near-full-width cars, practical travel speed, and call boxes at every stop. | local |
| **M3 Endless world v1** | `generateWorld({originPcx, originPcz})` windows the infinite plane; engine `recenterWindow()` re-centers as the player walks; DDSNAP carries `opx/opz`; seam invariant ≥90% overlap-column identity (measured 94–97.7%) | `cd2ecc4`, `5cc083a` |
| **Permanent navigation** | Removed temporary whole-window island repair, exit, and golden path. Absolute pillar cells now own stable hubs, pair-owned sockets, bounded routes, and local component attachments; the compass points north | `38346df` |
| **Smooth streamed handoff** | Dual world workers, direction-aware urgent prefetch, bounded caches, incremental geometry preparation, atomic prepared-world install, and movement-input preservation eliminate ordinary recenter stalls | `8ec5040` |
| **Concrete + render lab** | RGB-blended brutalist concrete, live Visual Lab, validated bloom/finishing, solid/wireframe/normals inspection, copyable presets, DDSNAP clipboard feedback, and Blender-scale reference assets | `93e394a`, `18da04c` |

**Verification:** `npx tsx tools/verify-world.ts` — 16 seeds × (climbability BFS,
descendability, bridge walkability, permanent-network reachability, seam agreement, crack
pairs, column invariants). All green at head. `tools/debug-view.ts` renders any
DDSNAP repro string headlessly (F8 in game copies one).

## Now / Next (in order)

### 1. Finish the front-face geometry contract

Completed locally after the Visual Lab audit:

- Structural concrete, stairs, and all debug materials render `FrontSide`.
- Sprites remain intentionally `DoubleSide`.
- Floors and ceilings now wind in the same direction as their authored normals.
- Wall, skirt, chamfer, and transom quads orient each triangle independently;
  non-planar height-field quads can no longer leave one triangle reversed.
- Zero-area triangles are omitted.
- Development builds audit every emitted triangle and report reversed or
  degenerate geometry. Two generated worlds plus lit/solid/normals inspection
  completed without new audit errors.

This is prerequisite work for trustworthy normal-dependent lighting. Do not
reintroduce `DoubleSide` on structural materials to hide a hole: capture a
DDSNAP and fix the emitting geometry.

Next rendering steps:

1. Playtest front-face mode across pits, open-sky cliffs, stairs, chamfers,
   bridges, crowns, wells, and window handoffs.
2. Add material normal/roughness maps only after tangent/UV behavior is
   validated on the procedural meshes.
3. Re-evaluate ambient occlusion only after the front-face contract survives
   broad playtesting. Screen-space GTAO was removed because the old
   double-sided normal/depth buffer produced shadows through surfaces.

### 2. Perfect the remaining seams (M3)
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

Production slice shipped:
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
- Shifted-window column agreement is 99.4% on the seam seed. The remaining
  differences are confined to the entering/leaving pillar-cell rows: the
  retained shared core is 100% identical. The verifier now enforces that exact
  core agreement and classifies edge drift by tiles, heights, pillars, and
  column-only changes.

### 3. Streaming v2: edge chunks instead of prepared whole windows

The visible hitch is solved for ordinary travel: workers prepare neighboring
world data, geometry is built in small animation-frame slices, direction-aware
urgent prefetch follows the player, and a ready group installs atomically.
Movement input is sampled by held-key state, so a world handoff no longer
requires releasing and pressing W again.

The next architectural step is true edge streaming:

- Per-pillar-cell render groups instead of prepared whole-window groups.
- Add/evict only entering and leaving rows.
- Generate each entering cell with dependency padding, publish only its owned
  56×56-tile interior, and never expose the padded outer result. Current seam
  diagnostics prove the retained core is already bit-identical; the remaining
  0.6% is exclusively temporary edge padding.
- Share corner-field ownership across the one-cell overlap.
- Preserve the current bounded caches and permanent-navigation identity.
- Keep the synchronous fallback only for initial load and impossible cache
  misses; ordinary movement should never enter it.

The grounded handoff still validates support in the replacement column model
and recovers to a compatible same-height span within 16 tiles. If no bounded
continuation exists, it returns to the entrance rather than dropping the player
into the void.

### 4. Purpose in the endless world
There is intentionally no exit now: spawn in, explore, and use the north
compass to retain orientation. Add purpose later through landmark navigation,
region-gated progression, or expedition objectives placed on pillar sockets;
none of those should author terrain from a temporary window.

### 5. Deepen the vocabulary (M4 wave 2)
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
- Expand elevator shafts beyond the current bottom/ground/crown prototype with
  intermediate strata, doors, explicit destination selection, and truly
  civilization-scale vertical routes. Travel time should come from distance,
  never artificial slowness.
- Replace short subway bore scaffolding with the routed rail layer below.
- Arch variety (angled struts, double-deck), residential balconies/interiors
- Vertical strata: region type varying with altitude bands, not just plan-view

#### Pillar interiors: room modules, not random subtraction

The first replacement slice is now local:

- `pillar-rooms.ts` defines one shared dimensional kit: 3-unit structural
  tiles, 6-unit doors/windows/corridors, 15-unit bays, 4.5-unit residential
  storeys, and standard slab/sill/opening heights.
- Gallery entries moved from the bridge-dependent back wall to the exterior
  stair's flat starting landing. Bridges are optional secondary access.
- Galleries have repeating real window openings on three façades.
- Residential chunks now contain three usable storeys, a continuous central
  corridor, paired room-wing doors, and repeating exterior windows instead of
  four 2-unit-high empty plates.
- The asset-facing contract and next module library are specified in
  `docs/pillar-room-kit.md`.

Next:

1. Add an interior reachability invariant from each chunk's stair-entry socket
   to every published room socket.
2. Select layouts deterministically by absolute pillar cell and chunk index.
3. Add corner apartment, service, double-height machine hall, balcony, and
   stair-transfer lobby modules.
4. Export one correctly scaled GLB graybox per module so authored replacements
   preserve sockets and dimensions.

### 6. Asset replacement pipeline

The graybox-to-authored handoff is documented in
`docs/modular-asset-handoff.md`. `reference-assets/column_reference_3m.glb` and
`reference-assets/stair_reference_3x6.glb` establish the current meter scale,
axis orientation, floor contact, stair rise/run, and replaceable silhouette.

Next:

- Export bridge, plaza, ramp, corbel, pipe, and arch reference pieces.
- Define socket empties and naming conventions in the GLBs.
- Add a loader/instancing path that marries authored modules to deterministic
  LayerProcGen placement without making generation depend on mesh contents.
- Prefer reusable authored/CC0 assets over bespoke modeling where their license,
  scale, and topology are suitable.

### 7. The editor
`docs/world-reference.html` already runs a bit-exact JS port of the field math.
Phase 1: generate its constants from source (JSON dump) instead of hand-copy.
Phase 2: sliders → live re-render. Phase 3: chunk cards become editable specs.

### 8. Long-distance rail

Rail is regional infrastructure, not a mover spawned inside a short
pillar-to-pillar bore.

1. A coarse absolute-cell route layer generates persistent rail lines over
   large distances with bounded neighbor reads.
2. Each route segment chooses underground, surface-cut, or elevated viaduct
   construction from terrain, region, and grade constraints while preserving
   one continuous track identity.
3. Mode transitions are authored portal modules: tunnel mouth, retained cut,
   ramp, viaduct, and station throat.
4. Stations replace or attach to pillar cells and publish entrances into the
   permanent pedestrian network.
5. Only after tracks, transitions, stations, and block occupancy exist do trains
   become runtime agents following the route. They do not ping-pong inside one
   temporary world window.

Required invariants: shifted windows agree on route identity and track geometry;
track grade/curvature remain within train limits; every station reaches the
pedestrian network; elevated endpoints have deterministic piers/abutments; and
trains never depend on a window-local endpoint.

## Known Rough Edges (fix on encounter)
- Short subway bores remain inaccessible visual scaffolding, but their fake
  oscillating train cubes have been removed. Do not spend detail budget on
  these bores; replace them with the routed rail system described below.
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
- Never ship with `verify-world` red. Add an invariant with every new guarantee.
- Seam doctrine, stair/slab rules, and chamfer rules are documented in
  `world-reference.html` and as code comments at the relevant sites — read
  before touching renderer sealing.
