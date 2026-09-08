# Endless physical infrastructure

## Scope

This replaces the rejected building-local pipe-bank approach. Pipes belong to an
endless infrastructure network above individual building recipes. A framed atrium
is one possible place to encounter that network, not its owner or boundary.

The network has shared coarse nodes, long trunks, smaller return circuits,
vertical risers, collars, junction housings, maintenance walk-beams, suspended
cables and local access stations. Primary pipes have open, connected interiors.
Pipe walls, return lines, collars, supports, ladder fittings and cables are real
solids; they are not a renderer-only prop layer.

The same run can cross open space above roads/facilities, enter a mass of rock as
an enclosed service gallery, and emerge again. This is the project's protected
inside/outside rhythm applied to infrastructure.

## LayerProcGen contract

### InfrastructurePlanLayer — 112-tile coarse grid

`infrastructure-network.ts` selects shared absolute nodes using the seed, region
field and stable alley lanes. Every coarse cell owns its east and south links;
each ends at the exact node used by the next owner. The connected lattice extends
without a world/window boundary. Connections span roughly 336 world units, rather
than ending at the edge of one building.

Region context controls node strata and trunk dimensions. The planner reads a
bounded neighborhood of upstream building sockets to clear existing bridge
openings. Nodes/junctions own their incident diameters. Rows and columns agree on
lanes; vertical changes produce real risers rather than disconnected pipe ends.

Road facilities publish a maximum roof envelope derived from their foundation
and storey rules. If any region cell within a coarse infrastructure cell can
contain road facilities, its node reserves clearance above that envelope for
the trunk, lower return and maintenance-gallery bottom. This remains a pure
upper-layer decision; it does not depend on which parcels a window has loaded.

### InfrastructureLayer — 56-tile physical chunks

The materialization layer depends on the existing ColumnLayer with zero padding
and InfrastructurePlanLayer with one coarse cell of padding. It copies its own
base columns, reads complete plans for all owners that can affect the core, and
writes only its own chunk. No renderer state or temporary window bounds choose
which links exist.

- Hollow trunks excavate service galleries around their physical shells. In
  pre-existing open air the same operation leaves an exposed crossing.
- Circulation publishes junction floors and internal riser ladders. Side ports
  and short ladders connect main bores to supported exterior walk-beams.
- Node access reads complete upstream columns and chooses among service ports
  with real finite lower floors. Building footprints and road-facility columns
  reserve their existing architecture. Access shafts and platforms use ordinary
  solid/air columns; their footpads join the structural ground field.
- Hangers terminate in actual pipe walls and beam mass. Cables attach to physical
  standoffs/piers, with service-station wires routed below occupied walking paths.
- Existing framed shelves retain their ladders, now with physical fittings. The
  rejected local `ServiceFixtures` pipe-bank pass is no longer rendered.

The legacy world builder invokes the same per-owner compiler. Both generation
paths publish identical data, and the new layers participate in cache reset,
release and eviction. The worker transports plain records, not runtime objects.

## One physical model, not an unrelated mesh and collider

`infrastructure-solid.ts` defines convex octagonal prisms and their planes.
Horizontal pipes have flat inner floors and sloping octagonal corners. Bores are
open through elbows, T-junctions and terminal service ports.

The solid field is:

```text
(union of pipe/collar envelopes minus union of pipe bores)
union physical supports, decks and cables
```

Fixtures inside a bore therefore remain physical. A bore must not erase its own
ladder or landing.

`infrastructureBaseColumns` stores the excavated architectural base;
`world.columns` is the final tile-center projection for navigation/maps.
`infrastructureColumnAt` resolves the exact continuous air spans at a point from
that base plus the published prism field. This is a column refinement, analogous
to the existing terrain corner fields, not collision inferred from mesh data.

The renderer draws the base architecture plus exact CSG boundary facets, omitting
the projected pipe boxes. Its full and streamed paths share the same cached base
world. Contours are prepared from that same base. The engine uses exact spans for
floor/ceiling queries and the same CSG boundary for body collision, including thin
cables that a tile-center-only check would miss. Body checks conservatively use
the capsule's enclosing box; diagonal contacts can stop slightly early, never
allow passage through a thin solid.

Landing and head clearance also clip those same boundary facets across the
whole player footprint. A wire between the center/perimeter sample points must
still catch a falling player or stop an upward jump.

Facets are clipped to absolute build rectangles. Temporary chunk boundaries do
not acquire fake pipe caps. Geometry is batched by material and disposed through
normal renderer chunk ownership. Query caches have weak world lifetimes, and
neighborhood-list caching is bounded.

Travel-time meshing is cooperative: each quarter has a resumable infrastructure
job with a two-millisecond work quantum inside the existing frame budget. Spatial
index construction, CSG cutter loops and vertex emission all yield; only complete
primitive boundaries enter the shared cache. Recenter cancellation cannot publish
half-built geometry. Disjoint polygons are rejected before clipping, preventing
interior rungs from needlessly subdividing untouched pipe walls. Bounds-only
queries do not eagerly construct every prism's inner and outer faces.

`tools/profile-infrastructure-travel.ts` records synchronous build cost, actual
cooperative slices and physics query timings. `verify-infrastructure-performance.ts`
guards against redundant tessellation and verifies identical resumed buffers;
`verify-infrastructure-streaming.ts` exercises budgeting, final flush, disposal and
cancellation through the real chunk scheduler. Timing reports exclude GPU work.

## Traversal

In **normal play**, walk toward the front of a ladder with **W** to acquire it.
**W/S** climb up/down; **F** also mounts/releases; **Space** releases. Climbing
checks the complete standing-body sweep, including mounting and stepping through
the upper opening. A blocked dismount can be reversed with S.

Rungs end fully below the landing plane so their physical radius cannot snag the
player's feet. Internal ladders lead through risers to the next trunk floor.
Maintenance-beam ladders lead into actual side ports, and access-station ladders
lead from ground pads to platforms and open branches into the main network.

**F6 toggles editor flight.** Editor flight deliberately bypasses normal
collision and ladder movement; leave it to test traversal. The input tests cover
normal key dispatch separately from this deliberate editor behavior.

The smaller return lines and cables are solid infrastructure, not additional
enterable bores or simulated swinging ropes. The bot still uses its existing
navigation model; ladders are not a new bot movement primitive. Permanent ground
transit and existing building routes remain protected.

## Verification

- `verify-infrastructure-network.ts`: multiple seeds and negative coordinates,
  shared endpoint connectivity, node diameters, long routes, shipping columns.
- `verify-infrastructure-solids.ts`: octagonal facets, hollow junction CSG,
  interior fixtures, physical body checks, clipping, winding, batching/disposal.
- `verify-infrastructure-access.ts`: complete context, alternative service ports,
  finite ground, owner bounds, supported platforms and clear ladder shafts.
- `verify-infrastructure-circulation.ts`: physical node/route floors, riser and
  maintenance links, standing-body sweeps, actual hanger/cable anchor contacts.
- `verify-infrastructure-physics.ts`: GameEngine exact floor/column queries,
  non-voxel cable collision, full access climbs and dismount clearances.
- `verify-infrastructure-input.ts`: registered key events through real engine
  updates; W acquisition, access climbs, walking from platforms through branches,
  main-bore travel, both directions on riser/maintenance ladders, and recentering
  during a climb, plus off-center thin-wire landing/head contact. GPU/presentation
  are omitted, not the movement/collision path.
- `verify-infrastructure-seams.ts`: all physical records touching cold X/Z/diagonal
  overlaps, both column representations, sub-tile queries, links, eviction and
  worker structured-cloning.
- Existing world and migration gates still apply. The old decorative fixture
  verification entry point now runs the replacement physical-model checks.

## Inspected locations

**Exposed crossing above road facilities:**

```text
DDSNAP1{"seed":1788647085001,"stack":1,"opx":-5,"opz":1,"x":514.5,"y":60,"z":329.1,"yaw":-0.3,"pitch":-0.3}
```

**Enclosed maintenance walk-beam and side-port ladder:**

```text
DDSNAP1{"seed":1234,"stack":1,"opx":-1,"opz":-1,"x":348,"y":75,"z":199.5,"yaw":-1.6,"pitch":0.15}
```

**Inside the main pipe:**

```text
DDSNAP1{"seed":1234,"stack":1,"opx":-1,"opz":-1,"x":308,"y":78.9,"z":190.5,"yaw":-1.5707963267948966,"pitch":0}
```

All three inspected views reported zero missing-ray pixels and zero wrong-side
pixels. Reproduce with `npx tsx tools/debug-view.ts '<DDSNAP1...>' out.png`.
The auditor now uses exact infrastructure column queries rather than the
navigation projection when investigating a ray's air/solid transitions.
