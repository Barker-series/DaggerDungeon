# Roads facilities and surface infrastructure

## What this adds

Roads districts now build facilities from the existing flat foundation shapes,
not from a second set of unrelated tower positions. Contiguous plinth tiles at
the same visible height define candidate footprints; hidden road-potential IDs
must not split what reads as one foundation.

- Bounded 24-tile parcels fit inset building footprints to those shapes.
- Street-level entry passages connect the street to the interior. Streets and
  the low open courts are preserved; unusable slivers or inaccessible parcels
  keep their original plinths.
- Broad footprints can fit compact internal service stairs around an open well,
  with upper workshop floors and an accessible roof. Smaller facilities provide
  one tall ground hall; they do not promise an authored stair to every roof.
- Facade openings, structural posts and varied roof heights distinguish the
  buildings from the empty foundations. Post repetition works at negative as
  well as positive world coordinates.
- Existing pair-owned bridge corridors are reserved before facilities are fit,
  rather than allowing later bridge carving to destroy a new stair core.

This is a first roads-building vocabulary, not a finished city kit or physics-
driven destruction system. The surrounding plinth/street shapes remain the
starting point for future extensions.

## Pipes, cables and wires

`src/engine/StructureUtilities.ts` derives surface utility runs from complete
road-facility plans and framed-building piers:

- Larger vertical risers, smaller parallel service pipes, rounded return bends,
  repeating collars and support fittings.
- Short hanging cable/wire bundles on facade banks, plus longer spans across
  framed atria between real inner piers of the same building.
- Fixed pipe/fitting dimensions act as scale references while run lengths and
  repetition communicate the size of the surrounding architecture.

These utilities are **decorative surface infrastructure**, not collision,
climbable pipe bores, cable physics, or a simulation of a factory's services.
They are mounted on walls or over voids/high spaces, out of ordinary walking
routes. The separate [endless infrastructure network](infrastructure-network.md)
now supplies physical trunks, enterable bores, cables and maintenance access;
it does not derive its topology from these decorative facade banks. Dedicated
circular pit stairways remain separate structural work.

## Layer and rendering contracts

`RoadBuildingLayer` has its own parcel grid and lifetime. It reads TileBase and
Transit with a two-tile local context margin, plus bounded pure pillar-pair
planning for bridge reservations. It writes only a parcel-owned plan. The
Column layer consumes those plans and materializes their air spans; rendering,
collision, maps and navigation then read the ordinary authoritative columns.

The legacy window path invokes the same planner and compiler. Its guard accounts
for the complete neighbouring Transit chunk and that chunk's TileBase context.
Road-plan caches release with the other generation layers and invalidate with
upstream transit changes.

`WorldData.roadBuildings` contains complete absolute-coordinate plans overlapping
the window. `roadBuildingTiles` distinguishes facility columns from the original
plinth contour system. Inset rims preserve the original foundation outlines;
entry canopies and building volumes use their own span-derived faces.

Utilities do not decide existence from whichever neighbours happen to be loaded.
They stay with one road parcel or framed building. Half-open absolute strip
midpoints own the mesh pieces in both full and streamed builds. Straight chords
are at most three world units; the projected reach beyond an owning build bound
is under 2.2 units. Rounded bends and sag curves retain their own samples.

The renderer batches pipes, fittings and cables into three materials per chunk,
not one object/draw call per fitting. Geometry follows normal chunk disposal;
weak plan caches follow WorldData lifetime. Parallel-transport tube frames avoid
orientation flips on vertical elbows.

The DDSNAP auditor now separates **geometric facing normals** from smooth shading
normals. Using the first smooth vertex normal misclassified correctly wound
pipes at grazing angles. The focused audit test still detects reversed winding.

## Verification

- `tools/verify-road-buildings.ts`: the reported foreground foundation, original
  plinth containment, street entry, standing-room/upper-floor access and roof
  access for stair-equipped facilities.
- `tools/verify-road-reservations.ts`: reserved crossings, negative-coordinate
  support patterns and legacy dependency coverage.
- `tools/verify-road-seams.ts`: cold X/Z/diagonal overlaps, whole-plan identity,
  utility-plan identity, eviction/revisit and actual solid anchor contacts.
- `tools/verify-structure-utilities.ts`: pipe hierarchy, anchors, sag, bounded
  geometry, exact full/quarter ownership, front winding, batching and disposal.
- `tools/verify-ray-facing.ts`: grazing smooth-normal false positives versus
  genuinely reversed triangle winding.
- Full world, migration, build and existing regression gates remain required.
  The main world verifier calls `road-building-audit.ts` for complete facilities;
  the focused roads test recenters edge parcels so every reported plan is checked.

## Playtest locations

The user's original roads overview:

```text
DDSNAP1{"seed":1788647085001,"stack":1,"opx":-5,"opz":1,"x":350.01,"y":26.09,"z":365.02,"yaw":4.104,"pitch":-0.57}
```

Nearby workshop street entrance (the entry passage turns right around its core):

```text
DDSNAP1{"seed":1788647085001,"stack":1,"opx":-5,"opz":1,"x":358.5,"y":0.5,"z":430.5,"yaw":-1.5707963267948966,"pitch":0}
```

Close view of the workshop risers from its plinth:

```text
DDSNAP1{"seed":1788647085001,"stack":1,"opx":-5,"opz":1,"x":362.02,"y":3,"z":419.5,"yaw":-2.0344439357957027,"pitch":0.85}
```

## Reference notes to revisit

Framed-atrium cable view:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":232.5,"y":18.5,"z":250.5,"yaw":-1.5707963267948966,"pitch":0.6}
```

- [Stefaaan06 — How I make my environments](https://www.patreon.com/stefaaan/posts/how-i-make-my-142122868): nearby recognizable services extending into large spaces, repeated supports, composition through lighting/geometry, and believable visible connections without unnecessary simulation.
- [Stefaaan06 — The VIBES of Mik?](https://www.patreon.com/stefaaan/posts/vibes-of-mik-141060523): scale and maintenance infrastructure make the megastructure convincing. Borrow those lessons, not an isolation-only/no-NPC gameplay premise; this project's eventual characters and combat remain part of the goal.
- [Critical Giants — How To Create EPIC Scale In Art](https://www.youtube.com/watch?v=cFXO-82Eodo): size contrast, camera/composition, consistent relative proportions, repetition, detail and atmospheric depth. The transcript was reviewed; these are reference principles, not a mandate to change the camera or add effects indiscriminately.
- User-supplied BLAME! images: massive vertical pipe trunks with smaller attached services, repeated collars, wires spanning voids, and stairs/landings woven around a round open shaft. The round shaft is a dedicated future traversal opportunity, not a revival of the universal exterior spiral.

All external images/posts/video are inspiration only. No third-party art or
source code from them is included in the game.
