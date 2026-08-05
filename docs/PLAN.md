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

## Next Up (Streaming v2 — Phases 1 and 2A SHIPPED, milestone B remains)

**Phase 1 — SHIPPED (Aug 2026): render chunks.** One chunk per ABSOLUTE
pillar cell (56 tiles / 168wu), created inside a 210wu build disc, built
in quarter-cell jobs under an 8ms frame budget, in the scene only when
COMPLETE, evicted past 260wu. Streaming = chunk lifetimes driven by a
focus dependency (`docs/layerprocgen/PRINCIPLES.md`, rule 7). Measured:
~11 chunks live while traveling (vs a whole window + 4 cached prepared
windows before), crossings adopt in 37–73ms with no scene teardown.
Post-ship playtesting found two chunk-survival bugs (walk-through
phantom walls), both fixed: mid-build chunks are dropped at window
adoption (stale job bounds), and border chunks background-rebuild with
their old geometry displayed until the swap (their baked window-edge
sealing is only valid for the window that built it).

**Phase 2, milestone A — SHIPPED: guard-ring padded generation.** The
pipeline generates a 6×6-pillar-cell window and crops the center 4×4:
every rim-special-casing pass still runs, but its damage lands in the
discarded padding ("input bounds always exceed output bounds" applied to
the window as a whole). Windows are now RIM-EXACT — the seam test is a
hard 100% gate on X, Z, and diagonal shifts (was 90%/core-only) — and
render chunks survive recenters unconditionally: each chunk is built
once, ever. Cost: ~2.25× generation time (320–560 ms, worker-side).

**Phase 2, milestone B (later): true per-cell generation.** Restructure
the passes into per-chunk `Create` with per-pass effect-distance padding
instead of the whole-window guard ring — wins back the 2.25× and retires
windows, recenter, and the grounded-handoff repair entirely. The 100%
seam gate makes this refactor safe: any behavioral drift fails the gate.

## Ideas

Future directions — none of these are commitments, and the rail one is
explicitly a guess until the day it's real work.

- **The subway (plan-8 rail, design sketch — user + design conversation,
  Aug 3 2026).** Endless point-to-point tunnels, done the LayerProcGen way:
  not one infinite path (nothing holds global knowledge) but an endless
  chain of LOCALLY-planned segments, each bounded, each derivable by any
  window that overlaps it. Four layers:
  1. **Stations** — a coarse layer at region scale, pure function of
     `(seed, cell)` → zero/one station with an absolute position. Any
     window can ask "what stations are near me" without generating
     anything.
  2. **Connections** — each station links to neighbors read from a padded
     radius, owned-within-bounds so every edge is planned exactly once,
     identically from either end (the pillar-bridge degree-guarantee
     trick at region scale).
  3. **Routes** — per owned connection, path the tunnel with the
     pathfinding CLAMPED to a corridor around the station-to-station
     line. The clamp is the docs' effect-distance move: choose the
     effect distance, enforce it, and the padding is known and finite.
     Routes wander organically inside the corridor.
  4. **Carving** — window generation queries "route splines overlapping
     my bounds + padding" (overlapping-bounds, same as roads) and bores
     them into the column model. The 100% seam gate then enforces
     cross-window identity automatically.
  The payoff is The Cluster's road-sign trick underground: a platform
  sign can say "NEXT STATION 2.3km EAST" about a place that has never
  been generated, because names/positions/topology are pure upper-layer
  functions. The 2D precedent already ships: the road-field layer
  (districts/sites/veins) is exactly this pattern; the subway is the
  same idea underground plus stations and carving. NOT a revival of the
  old cell-pair subway bores (`planOwnedSubways`, deliberately unwired —
  they were unreachable scaffolding, not routed rail).
  Hard parts to design when it becomes real work: station placement
  rules that make lines feel intentional (not nearest-neighbor
  spaghetti); depth handling (fixed bore level vs ramping between
  levels); and, if the PLAN's "few functioning trains" ever run, train
  positions derived from absolute time + line topology (deterministic
  schedules so all windows agree where the train is).

- **Light pop while traveling (LIKELY RESOLVED Aug 5 2026 — confirm in
  play).** The reported pop coincided with the synchronous window
  fallback (~1.5s frozen frame), removed by deferred adoption
  (0cb917f). The light pool itself hands off cleanly: clear+setup run
  in the same frame, fixtures are seam-exact across windows, and the
  forced re-cull reassigns before the next render. If a pop is still
  visible after playing on 0cb917f+, reopen with a note about WHERE
  (crossing line vs mid-cell).

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
- Corner-wedge patchwork RESOLVED (2afdd9f): the corner-ceiling field and
  all its seal classes are deleted; one shared rule (capMax — max real
  ceiling of a wall tile's 3x3 walkable neighbors) drives smooth wall
  tops, flush caps, and cap transoms, so junctions knit by shared number.
  Ceilings are flat per tile everywhere; trim/octagonal profiles gate to
  bore-scale spans; suppression is level-0-only.
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
- Post-process controls: bloom, neutral contrast/saturation, vignette, and
  (since Aug 2026) SSAO via GTAOPass — user-validated defaults intensity
  0.50 / radius 1.0, radius floored at 0.3 to dodge the self-occlusion
  degenerate zone, sprites excluded from the AO prepass. Homemade film
  grain stays removed. New effects require researched parameter semantics,
  neutral defaults, useful bounded ranges, and in-game min/default/max
  testing before they appear in the Visual Lab.

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
