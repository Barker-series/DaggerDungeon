# Sheltered bridge crossings

An architectural extension to existing neighbor-pair bridges, not a new
connectivity system. Ordinary open bridges and pipe crossings remain.

## Profiles

- **Gatehouse:** short roofed, solid-sided sections near both ends; an exposed
  central span between them.
- **Service:** a longer near-side enclosure, real side openings between solid
  sills/lintels, an exposed middle, and a short far-side enclosure.
- Machine and city regions favor service housings; other regions favor
  gatehouses. Neither style is region-exclusive. Some natural open bridges
  remain plain, and forced connectivity bridges remain plain by contract.
- The surrounding world still matters: a crossing inside rock remains a
  tunnel, and a housing cannot promise an open vista where none exists.

All use the existing three-tile-wide deck and fixed 3.5-unit walk clearance.
The added walls sit one tile outside each deck edge. Roofs overlap adjacent
sloped sections; their thickness accounts for the per-tile height change.
No renderer-only walls, invisible colliders, or new mesh emission path.

## Ownership and integration

- Owner: the existing west/north pillar-cell pair.
- Style selection reads the owner's region and uses an independent seed stream
  keyed by absolute owner coordinates, direction, and socket heights. It does
  not consume the existing connection-selection RNG.
- The original `bridgeTiles` API is unchanged: its three-wide walking tiles
  also feed renderer chamfers and world verification.
- Housing extent is within the existing gap along the connection and local
  cross-axis tiles 26..30. Owner radius remains one pillar cell.
- Housing eligibility reads the five-tile cross-section (maximum four tiles
  from an emitted side tile), inside the existing 14-tile Column-layer pad.
  These cross-sections never straddle a pillar-cell boundary in that axis.
- Each section yields entirely if it would obstruct an existing floor or
  reduce underneath clearance below player height. No new wall is placed
  across a terrain-height route; the original bridge is the fallback.
- Housings insert solid intervals before deck carving. Guaranteed walking
  clearance gets the final say. Existing top-down bridge ordering remains.

## Verification

- `npx tsx tools/verify-bridge-housing.ts`: both profiles and orientations,
  level/rising/falling decks, continuous headroom, actual side openings,
  terrain protection, negative frame translation, cropped output agreement,
  and non-exclusive regional selection.
- `npx tsx tools/verify-world.ts`: shipping column/navigation/seam invariants.
- `npx tsx tools/verify-migration.ts`: chunked and legacy pipelines agree.

Live inspection example (seed 1, service crossing at absolute pillar pair
`(-7,-4)` east). Enter via F6's DDSNAP field, then F6 again to walk:

```text
DDSNAP1{"seed":1,"stack":1,"opx":-8,"opz":-5,"x":298.5,"y":28.392857142857142,"z":253.5,"yaw":-1.5707963267948966,"pitch":0}
```

## Separate existing renderer seam found during inspection

The following sloped passage has missing/wrong-side geometry farther along
its route. An A/B headless reproduction with ONLY the housing application
omitted produced the identical 5 missed pixels and 116 wrong-side pixels,
with identical leak-entry tiles. This is not fixed by the housing addition.
The first reported entries are local tiles `(110,82)` and `(110,86)`.

```text
DDSNAP1{"seed":1,"stack":1,"opx":4,"opz":-6,"x":298.5,"y":16.714285714285715,"z":253.5,"yaw":-1.5707963267948966,"pitch":0}
```

Reproduce with `tools/debug-view.ts` before changing renderer sealing. The
comparison used temporary compiled diagnostic bundles, not working-tree edits.

A second gatehouse inspection at seed 1, window `(6,-2)`, position
`(253.5,6.5,298.5)`, yaw `pi`, pitch `0`, retained two isolated wrong-side
pixels at tiles `(86,107)` and `(83,107)`. Both hotspots also occur with the
housing application disabled. The exposed service example above reported
zero missed rays and zero wrong-side pixels in its checked entrance view.
