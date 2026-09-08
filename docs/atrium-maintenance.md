# Atrium maintenance routes

> Historical local-route design. Its decorative pipe-bank pass was rejected and
> replaced by the [endless physical infrastructure network](infrastructure-network.md).
> The shelves remain; current pipe ownership, physics, controls and inspected
> locations are documented there. The old pipe/cable rendering scope below is
> not the shipping network's scope.

## Direction

The user-supplied reference shows human-scale ladders and tiny landings against
monumental walls, a projecting crossing, a long supported shelf, massive pipe
banks, and sagging cables spanning the gap. These are relationships between
architecture and access, not a freestanding prop collection or another universal
exterior spiral.

Selected framed buildings now grow an additional maintenance route inside the
atrium. Machine districts favor the feature, with wider spacing between service
levels in other framed buildings. Existing stairs, occupied wings, elevator
buildings, legacy kebabs and pair-owned bridge portals are preserved.

- A three-world-unit-wide shelf runs along the inner edge of the north wing.
  Its slab and downstand corbels are solid column geometry. Upper shelves retreat
  with the building setback rather than floating past the shortened wing.
- A lower projecting approach meets the existing circulation spine and reaches
  a ladder landing. The lower approach is two tiles wide, with a deeper root beam.
- A human-scale ladder climbs outside the upper slab edge, with regularly spaced
  rungs and handrails returning over the shelf. Both ends remain reachable by
  ordinary stairs as well: ladders are shortcuts, not mandatory bot edges.
- A large overhead trunk and smaller parallel return have repeating collars and
  cantilever brackets rooted into the shelf at the supporting pier locations.
- Cable bundles cross to actual piers on the opposite atrium wing, with varied
  sag and slightly unequal attachment heights. They do not attach to whichever
  neighboring chunk happens to be loaded.

**Interaction scope:** shelves and approaches are walkable; ladders are climbable.
Pipes, brackets, rails and cable bundles are batched fittings, not extra column
solids. The overhead pipe banks are not walkable pipes or enterable bores, and
cables do not implement hanging, swinging or tightrope movement. Large traversable
pipe systems remain separate structural work.

## Controls

Near either ladder endpoint, **F** attaches. **W/S** climb up/down; **F** or
**Space** releases. The upper exit moves over the shelf only after the feet have
cleared its slab. Mounting, vertical movement and dismounts check standing-body
clearance rather than teleporting through intervening geometry.

## Layer contract

`pillar-layer.ts` selects `FrameBuildingPlan.serviceRoutes` with a separate
absolute-cell seed salt. This does not consume the height/rotation RNG stream.

`frame-services.ts` owns local deck dimensions, column solids and ladder records.
It reads the complete framed-building plan only, with no neighbor dependency.
The footprint stays inside the existing reserved building envelope; no new
padding or generation layer is required.

`frame-building.ts` combines service solids with the existing architecture before
compiling air spans. It publishes maintenance-room targets into the normal
reachability audit, including both ladder landings and the far end of each shelf.
Renderer, physics, maps and navigation receive those columns through the existing
pillar path, identically in legacy and chunked generation.

Ladder records use stable IDs and absolute world-unit coordinates. Runtime
movement converts at the world/window boundary, so recentering does not move a
ladder. Runtime climb state is separate from deterministic geometry.

`ServiceFixtures.ts` derives visible rungs, rails, pipes and cables from the same
plans. It shares the existing tube tessellator but has its own weak world cache
and material batches. Half-open absolute strip midpoints own geometry, exactly
as in surface utilities. The larger fittings have a tested 3.5wu maximum reach
outside the owning build rectangle. Full and streamed builds use the same pass;
ordinary chunk clear/eviction disposes the meshes.

The elevated shelf inspection also exposed open ends on existing tunnel-mouth
chamfer strips. Each bevel segment now closes its triangular ends, so looking
along a bore from above cannot reveal the back of its trim. This does not change
bore columns, portals, or front-side material policy.

## Verification

- `tools/verify-frame-services.ts`: usable shelf/approach/foot, retained atrium
  void, visible ladder fittings, massive pipe hierarchy and solid mounts across
  both building styles and all rotations.
- `tools/verify-frame-buildings.ts`: normal stairs still reach the existing rooms
  and new service targets, across heights, foundations and roof policies.
- `tools/verify-service-ladders.ts`: executable ladder movement and lifecycle
  regression coverage.
- `tools/verify-service-fixtures.ts`: winding, finite reach, exact full/quarter
  mesh ownership, cold X/Z/diagonal column and ladder identity, solid integrated
  anchors, and eviction/revisit.
- `tools/verify-bore-trim-caps.ts`: the shelf-view ray hits the front of the closed
  tunnel bevel rather than entering its open end.
- Existing world, migration, roads, interiors, bridges, foundation, fixture and
  clearance gates remain relevant; no baseline acceptance criterion is removed.

## Reproducible views

Seed 1234, absolute building cell `(2,0)`, window origin `(0,-1)`.

From the lower maintenance approach, looking toward the ladder and overhead bank:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":421.5,"y":18.5,"z":241.5,"yaw":-0.9,"pitch":0.4}
```

On the upper shelf, looking along the pipes and out across the suspended cables:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":436.5,"y":27.5,"z":235.5,"yaw":-1.9,"pitch":-0.3}
```

At the ladder foot (F attaches):

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":433.5,"y":18.5,"z":238.5,"yaw":0,"pitch":0.35}
```

Render any of these with `npx tsx tools/debug-view.ts '<DDSNAP1...>' out.png`.
The approach and shelf inspection views both report zero escaping rays and zero
wrong-side pixels after the tunnel trim repair.
