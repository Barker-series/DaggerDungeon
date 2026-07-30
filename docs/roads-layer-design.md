# Roads Region — LayerProcGen Concept

*Concept draft, July 30 2026. Bridges the Sceelix findings (see PLAN.md §5b)
into our LayerProcGen stack. Nothing here breaks the discipline: every layer is
a pure function of `(seed, coords)` plus a bounded neighbor radius, and every
shared feature has exactly one deterministic owner.*

## Why this fits LayerProcGen

Sceelix's road pipeline is a chain of global passes over one finite mesh.
LayerProcGen's whole point is the alternative: express each pass as a layer
whose chunks depend on a *bounded padding* of the layer below. Every global
algorithm the Sceelix review flagged as a problem has a layer-shaped
replacement, and — the key insight — **with jittered-grid Voronoi, streets,
junctions, and city blocks are all derived from the same site set**, so the
whole Sceelix chain (graph → junctions → strips → block extraction → lots)
becomes five thin layers over one layer of points.

## The layer stack

Granularity note: a **street cell** is the new coarse unit of this stack
(size TBD; likely = 1 pillar cell = 56 tiles so ownership machinery is
shared). All layers below are per-street-cell unless stated.

### R0 — Site layer (no dependencies)
One street *site* per street cell: cell center + deterministic jitter
(`mulberry32(cellSeed(...))`), jitter amplitude from the district personality
(0 = strict Manhattan, large = organic). Before use, the site position is
pushed through the **orientation/warp fields** (continuous functions of world
coords, like `wildnessAt`): rotate by the district grid angle θ, then domain
warp. Because the fields are continuous and the jitter is cell-seeded, any
cell computes any neighbor's site bit-identically.

*This one layer encodes the whole aesthetic:* warp bends the avenues,
θ changes per district give the colliding-grids seams from the reference
image, jitter breaks the metronome.

### R1 — Street-graph layer (reads R0 in a 2-cell radius)
Each cell derives its Voronoi cell by half-plane clipping against the
surrounding 5×5 sites — O(25), local, no Fortune sweep. Voronoi edges *are*
the streets; Voronoi vertices *are* the junctions.

Ownership (the transit-socket pattern generalized):
- An **edge** (street segment) is owned by the lexicographically smaller of
  its two adjacent site cells.
- A **junction** (Voronoi vertex, meeting of 3 cells) is owned by the
  lexicographically smallest of the three.

Both neighbors derive identical geometry from the same bounded site reads, so
ownership is only needed to assign *attributes* once: the owner rolls street
width / hierarchy class (avenue, street, alley, sealed) from its RNG. Every
Nth line widening falls out of a hash of the edge's canonical id.

### R2 — Junction layer (reads R1 in a 1-cell radius)
Per owned junction: gather incident edges, sort by angle, apply the Sceelix
junction construction (per-edge left/right width offsets, four join cases) to
produce the junction polygon **and the three anchor vertices per incident
edge** (left/center/right). Publish those anchors keyed by canonical edge id.

Cleanup here is bounded by construction: junction clustering (merge Voronoi
vertices closer than a road width — happens when jitter makes near-degenerate
cells) only ever merges vertices of adjacent cells, well inside the read
radius. Merge deterministically toward the smallest-owner vertex.

### R3 — Strip layer (reads R2 of both edge endpoints)
Per owned edge: build the road strip quad-chain between the two junctions'
published anchors. Because both ends reuse the junctions' exact vertices, the
network is crack-free by construction — same theorem as our stair/seam
doctrine, applied to streets. Optional Chaikin-style smoothing of long edges
is safe if endpoints stay anchored (they are junction anchors).

### R4 — Block layer (reads R1; same radius)
Free lunch: **each site's Voronoi cell, inset by its bounding streets'
half-widths, is a city block** — no boundary-walk block extraction needed,
ever. The inset uses the shared-inset rule (inset street-facing edges only)
with miter clamping. The block polygon is wholly owned by its site cell.

Within the block: CGA split arithmetic (absolute/relative/flexible/repeat)
subdivides into lots, seeded per block. Lots inherit block attributes
(district, elevation, density) — Sceelix's attributes-flow-with-geometry,
which we get for free since everything is derived from `(seed, cell)`.

### R5 — Realization into the existing stack
- **Rasterization needs no ownership:** any dungeon cell/tile evaluates
  "am I road / junction / block / lot-wall?" by point-testing the R3/R4
  geometry of the bounded neighborhood. Pure function → all windows agree.
  This is the `roadAt(seed, tileX, tileZ)` from PLAN §5b, now backed by the
  graph instead of only the implicit field.
- **Columns:** roads publish AIR spans at street level (sunken slightly, or
  curbed via the heights layer); blocks publish building mass for the pillar
  layer to sculpt. Long-term, pillar kebab footprints in the roads region
  snap to lots instead of the 4×4 lattice.
- **Biome:** `region-layer.ts` gains `'roads'`; `layer2-biome.ts` maps it to
  `outside` at level 0, `cave` below (headroom first, theming later).
- **Fallback connectivity:** permanent transit hubs/sockets stay active in
  the roads region until an invariant proves the street graph alone connects
  every local component. Streets then *become* the preferred attachment
  target for layer4-connect instead of a parallel system.

## Dependency diagram

```
fields (θ, warp, elevation)        [continuous, no deps]
        │
R0 sites ──► R1 street graph ──► R2 junctions ──► R3 strips ─┐
                     │                                        ├─► R5 tiles/columns
                     └──────────► R4 blocks ──► lots ─────────┘
```
Total read radius from a tile to sites: ~3 street cells. Fixed, small, done.

## Invariants (add to verify-world with the first slice)

1. **Seam agreement:** shifted windows produce identical road/junction/block
   tiles on the shared core (extends the existing 100%-core check).
2. **Anchor agreement:** both endpoint cells of every edge derive identical
   strip geometry; both/all-three owners of a shared feature derive identical
   attributes.
3. **Connectivity:** every junction reaches all neighbor junctions via road
   tiles; every block perimeter touches at least one street.
4. **Walkability:** no road band narrower than the walkable minimum
   (guards the warp-pinch failure mode; clamp band width in tile space).

## Build order (each step lands with its invariant)

1. `road-field.ts` + debug-view top-down mask: R0/R1 only, rendered as lines.
   Tune θ/warp/jitter against the reference image. No game integration.
2. `'roads'` region type + biome case; rasterize R1 edges as crude 3-tile-wide
   floor bands directly into the column model. Walk around in it.
3. R2/R3 proper junction polygons and width hierarchy.
4. R4 blocks as solid mass with shared inset; lot splits later, with massing.
5. Retire the transit-socket fallback inside roads regions once invariant 3
   is green.

## What we deliberately did NOT take from Sceelix

Fortune's sweep (global), Clipper (use a JS lib if booleans are ever needed),
its tessellators (earcut), the node-graph runtime, sequential Bridson Poisson
(if we scatter street furniture, use per-cell hash-priority dominance
sampling with a density field — the variable-radius idea survives, the
algorithm doesn't).
