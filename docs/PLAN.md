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

Second protected rule: **the human-scale vocabulary never scales.** Doors,
windows, call boxes, strip lights, stair treads — fixed sizes everywhere,
forever. They are the ruler the eye uses to measure the monuments; only
COUNTS of modules grow with a structure, never module size. (Future props,
furniture, and physics objects join this ruler set.)

**The art bar** (July 31 2026): the handcrafted BLAME! corridor at
artstation.com/artwork/KeoDgy — hold onto it as the standard we strive for,
not the standard we demand of every corner. What it demonstrates, decomposed:
Big/Medium/Small executed flawlessly (corridor volume / light coves + panel
divisions / pipes + debris); lighting as BUILT geometry (recessed emissive
coves, not floating points); conduits as the eye-guidance system (pipe runs
converging down the corridor — guide-without-paint in pure geometry);
hatched, pen-work surface language (Nihei's ink, not PBR realism); and
SPARSE floor incident (five objects, not fifty). Shoot for the stars;
land where we land.

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

## Next Up (committed — Streaming v2, redesigned after the July failure)

**Render chunks (Phase 1).** The first disc-streaming attempt (July 2026,
reverted) lazily built window-local slices of the monolith with no
build-ahead guarantee — slices entered view before they were built (black
pop-in) and every recenter threw the whole disc away. The redesign follows
the LayerProcGen rule that streaming = chunk lifetimes driven by a focus
dependency (`docs/layerprocgen/PRINCIPLES.md`, rule 7):

- **Chunk = one pillar cell (56 tiles / 168wu), keyed by ABSOLUTE cell
  coords.** On recenter, chunks in the retained core survive (verify-world
  proves that band 100% identical across window alignments) — only their
  scene offset shifts. Rim chunks rebuild while their old geometry keeps
  displaying until the swap. No full-scene teardown: the recenter hitch and
  recenter pop die together.
- **Disc top-dependency with a hard invariant:** a chunk must be FULLY
  built before it can enter fog range. Build radius = fog plane + margin,
  where the margin is set from MEASURED per-cell build times × max travel
  speed, not hope. Evict radius one cell beyond build.
- Generation stays whole-window in the workers (seam-proven, untouched).
  Expected: ~60% less meshed geometry and GPU memory, non-blocking
  recenters, pop-in eliminated by construction.

**Phase 2 (later, the big surgery): per-cell GENERATION with dependency
padding, retiring windows.** The audit showed every violating pass reads
inputs that are pure fields, so chunks can recompute their own padded input
rings (CA ~4 tiles, heights ~16) without neighbor-chunk data. Ends with
windows, recenter, and the grounded-handoff repair deleted, spawn as a pure
function anchored at world origin, and the seam test tightened from 90% to
exactly 100%.

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
- **A legit canyon + massive vistas** (user, July 31 2026): "we 100% must do
  this, one thing at a time." The roads region is a step toward bigger; a true
  canyon region with vast sightlines hasn't been built yet and is a committed
  future direction.
- **Goal-directed light** (from the Mik devlog review): our world is
  non-linear, so light-as-direction has nowhere to point — yet. If/when a
  future goal location exists on the map, use light direction to pull the
  player toward it. Threshold lighting (below) is the near-term slice.
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
- **Vault stamping (Zorbus prefabs)** — likely a future workhorse: parse the
  CC0 zorbus_vaults ASCII shapes into a stamp library; dungeon/crypt cells
  deterministically pick-and-stamp per cellSeed (clipped to cell bounds,
  respecting pillar footprints and transit tiles). Authored shapes read as
  DESIGNED in a way noise never does. THE KEY ECONOMY: the layer-4 attachment
  pass already connects every local floor component to its cell hub from any
  window — arbitrary stamped shapes are reachable by construction, so the
  classically hard part of prefab dungeons (connectivity) is already shipped.
  Cheap, customizable, and the dormant blocks.ts/prefabs.ts vocabulary was
  always headed here. Possible expansion (user): stamps with ELEVATION — 3D
  vault shapes, not just floor plans. Details later. Recommended reading
  before building: Boris the Brave's Enter the Gungeon dungeon writeup
  (boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon) —
  the best composite-prefab-room-graph reference around; Gungeon composes
  authored rooms on a layout graph, which is this idea's closest shipped
  relative. Failure contract, per
  the marian42 infinite-WFC pattern: if a stamp doesn't fit (footprint,
  transit, pit conflicts), silently keep the plain room carve — a
  guaranteed-correct baseline, never a retry or a propagation.
  (Anderson-style accretion was considered and rejected: sequential
  whole-map growth fights the pure-function discipline at every level.)
- **Warren chunks via constrained growth** (user: "hell yes... a possible
  solution"; July 31 2026): fill the dead interiors of plain kebab chunks
  with generated room layouts using the TU Delft constrained-growth method —
  Lopes, Tutenel, Smelik, de Kraker & Bidarra, "A Constrained Growth Method
  for Procedural Floor Plan Generation" (2010). Paper saved locally:
  `docs/constrained growth method for procedural floor plan generation.pdf`.
  The method: seed rooms on a weighted grid, grow rectangular then L-shaped
  by size ratios, zone hierarchy (public/private), then a door-placement
  pass with architectural privacy rules and a reachability repair step. Why
  it fits: bounded to one footprint and fully seedable (a pure per-chunk
  function), designer intent via adjacency/ratio constraints (NOT the
  rejected random subtraction), L-shaped rooms first-class, connectivity by
  construction. Performance: sub-ms to low-ms on our ~13×13-tile interior
  bays, run inside the world workers — zero frame impact. Guardrails: room
  dimensions obey the pillar-room kit (door widths, minimum sizes) so
  layouts stay dressable by authored assets; entry via a ramp-landing door
  socket (gallery pattern); storeys at the 4.5-unit rhythm using the
  paper's multi-floor duplicate-the-stair-room trick; bounded retries then
  the marian42 keep-the-baseline fallback; verified by the planned interior
  reachability invariant.
- **Hive-style organic layouts, sans GA** (user, July 31 2026): Joel Simon's
  evolved-floorplan AESTHETIC (cellular rooms, curved merging hallways,
  courtyards) without the genetic algorithm — his GA only picks room
  adjacency; the organic look comes from the phenotype pipeline, and we
  already own deterministic equivalents: jittered Voronoi at room scale for
  the chambers, domain-warped fields for the relaxed boundaries, the
  vein/artery hierarchy for the paths. Seeded patterns + path creation
  reproduce the hive; pure functions, window-stable. Pairs naturally with
  vault stamping (stamped set-pieces inside a hive fabric).
- **Curves over altitude** (from Maxence Du Mesnil Du Buisson's Blame-like
  level design doc, July 31 2026): he authors a linear level as explicit
  pacing CURVES — height, brightness, order/chaos, spatial frequency — over
  time, each with a semantic axis (light = the structure's divine face,
  shadow = its vicious face; deep = organic "den of a body", high = orderly
  and brutal; spatial frequency = our inside→outside rhythm, alternating
  gigantism with human-scale rest and ramping toward a climax). Our world is
  non-linear, but ALTITUDE is a monotonic progression axis gravity gives us
  for free — pacing without scripting. Translations, all pure fields over Y:
  luminance-by-altitude (ambient/fog brightening with height, darkening
  below grade — one more input to the existing area-fog lerp);
  order/chaos-by-altitude (chunk + biome vocabulary weights shifting with Y —
  this is what "vertical strata" was always supposed to MEAN); and making the
  inside→outside alternation RATE a tunable field instead of a noise
  accident. A player climbing a supertower gets an authored dramatic arc
  with zero scripted triggers.
- **Seeded wall art & the seed-collection gallery** (user + review of
  marian42/proceduralart, July 31 2026): paintings/posters/signs placed on
  walls by a fixture-style seeded layer — each artwork a small canvas
  generated lazily from a seeded art function, so the piece at a given spot
  is the same for everyone forever. COLLECTING stores only the seed: a
  gallery is a list of numbers, re-rendered on demand — the purpose
  statement applied to loot. Art-direction axes (user): creepy / elegant /
  abstract — NOT planet-toy content; custom generators authored via the
  contact-sheet iteration loop (assistant writes styles, user reacts).
  Opening move: DIEGETIC pieces — framed street maps and contour surveys of
  real places elsewhere in the same seed. Placement/gamification to be
  workshopped. Cheap: lazy 256px canvases, bounded cache, quads.
  Draw technique (joyrok SDF tutorials + IQ's 2D shape library,
  iquilezles.org): 2D SDF composition on the canvas — stroke = abs(d) −
  thickness (a neon tube by construction), glow = the distance falloff
  beyond it (emissive/bloom-ready), shapes combined by min/max booleans —
  crisp at any resolution, pure math, weightless. The toolkit for signs,
  glyphs, and the elegant art register.
  EXPANSION (user): lean into seeded canvases as a general TEXTURE program —
  NEON SIGS built from a seeded glyph/symbol generator (canvas as
  emissiveMap: pairs directly with the queued emissive+bloom pass and the
  light-fixture pool — a sign is a fixture with a picture), plus decals,
  panel variation, stencils, and grime for environmental diversity. If we
  are smart about it, one seeded-canvas system feeds art, signage, and
  surface variety across the whole world.
- **Catacomb / quarry stratum** (user: "we will be making places like this";
  ref: the Odessa catacombs — oneman-onemap.com, July 31 2026): a below-grade
  warren biome with three imported truths. (1) QUARRY LOGIC: Odessa's 2500km
  of catacombs are the negative space of the city built from their limestone —
  ours reads the same field as the built mass above, so dense pillar
  districts sit over dense warrens; the megastructure quarried itself.
  (2) LEGIBILITY WITHDRAWN: no threshold beacons, minimal fixtures,
  repetition instead of landmarks — horror through the absence of affordances
  the player has learned to trust; surfacing delivers the inside→outside
  rhythm at maximum contrast. (3) The dressing list cross-links: partisan-style
  chambers (sleeping quarters, hospital, print room) are vault stamps;
  catacomb wall art is the seeded art system in its creepiest register;
  hand-saw tool marks are a bump story; old-cut rock vs newer reinforcement
  patches give two-material walls; flooded transparent pools and multi-level
  sight-holes for verticality. Depth-strata material banding (see Next Up)
  is this stratum's signature look: the walls show the eras the machines
  cut through.
- **Audio direction** (ref: Von Hohenheim, "Silicon Soul" — a literal BLAME!
  tribute album; CC BY-NC-ND so REFERENCE ONLY as-is, though a separate game
  license is one flattering email away; July 31 2026). Full palette,
  principles, and Suno prompt library: `docs/music-direction.md`. Palette: drone
  ambient, industrial, minimal synth, dark IDM — mechanical resonance and
  decay, sparse and patient. Principles: (1) audio is another FIELD over
  space — ambient beds keyed to region/biome, and the curves-over-altitude
  idea extends to sound (organic drones in the depths, cleaner colder tones
  toward the heights); (2) the structure is the instrument — diegetic
  sources at machines, vents, elevators, pipes (the fixture system already
  knows where they are); (3) silence and sparseness carry it — few sources,
  long loops, huge atmosphere-per-byte. Acquisition paths: source artists in
  this scene, generate via Suno/audio tooling, or license the reference.
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
- **Voronoi distance metrics** (explored July 31 2026, shelved): the street
  Voronoi's metric is an aesthetic knob — Manhattan with axis-aligned
  districts yields rectilinear blocks whose corners chamfer at exactly 45°
  (the same design language as the tunnel chamfers), Chebyshev gives square
  press-stamped cells. Fun, works, but moves nothing forward right now. The
  knob remains in road-field.ts (optional `metric`, default euclidean —
  inert in-game; `--manhattan/--chebyshev` on tools/road-mask.ts) with axis
  metrics auto-aligning their districts. NOTE: the shipped veins mode is
  level-set based and has no distance metric — this applies only to the
  Voronoi machinery (grid mode / future R1 street graph). If a "chamfered
  quarter" district personality is ever wanted, this is it, ready.
- **Infinite WFC (marian42.de/article/infinite-wfc)** — the reference for WHY
  no WFC here: his chunkless attempt hit order-dependence, unbounded
  propagation, and accumulating failures, and his fix reinvented LayerProcGen
  (deterministic coarse base + bounded offset chunks + keep-the-baseline
  fallback) with WFC demoted to a local decorator that still needs a solver.
  He needed LayerProcGen, not WFC — we started there.
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
