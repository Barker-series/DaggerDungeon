# Segment-Extruded Walls (One Wall System v2) — implementation design

**Goal (user's Blender demo, Aug 3 2026):** diagonal wall boundaries must
render as ONE flat 45° plane per run (right model) — not per-tile square
steps (left model, current), not per-corner bevels (center model, what
every prior attempt produced).

## Why every prior attempt produced bevels

All wall emission is per TILE BOUNDARY (span-XOR face pass). The chamfer
system replaces at most the corner HALF of a boundary face with a
half-tile diagonal, gated by mutual-agreement (`o0/o1`, `openHalf`) —
on a 1:1 staircase each solid's tangent is the next step's wall, so
halves alternate open/closed → ribbed bevels. Caves have the same
sawtooth, masked by organic noise. The per-boundary architecture CANNOT
express a plane spanning multiple tiles.

## The mechanism (global, biome-opt-in)

Two decoupled halves:
1. **Wall-line source** — marching-squares contour (organiccontour.ts),
   already shared with collision. On a 1:1 staircase its segments chain
   COLINEARLY → the flat diagonal line already exists as data. Smooth
   participation = `isSmoothTile` (organic biomes + `isTransitFloorIn`
   transit floors; roads excluded until slice 2).
2. **The extruder (new)** — for smooth boundaries, emit wall quads along
   CONTOUR SEGMENTS (vertical band lo..hi from the adjacent walkable
   columns) instead of per-boundary faces. Colinear segments → coplanar
   quads → one flat wall. Collision already IS these segments (soft
   walls) → see-square = hit-square preserved by construction.

Future wall-line sources (path-offset splines for roads/rail curves)
reuse the same extruder — ContourSegment is already an arbitrary line.

## Key discovery: the octagonal tunnel path

`DungeonRenderer.buildWalls` already has `emitOctagonal` (~line 1361):
null-biome corridor walls get a 3-surface profile (shortened flat band +
floor diagonal + ceiling diagonal + end caps + topOverride band) emitted
PER BOUNDARY — this per-boundary emission is exactly what makes the
staircase ribbing. The extruder should reuse this profile logic but run
it ALONG SEGMENTS.

## Implementation steps

1. `organiccontour.ts`: contour already built over smooth tiles (done —
   `isSmoothTile`, `isTransitFloorIn` exported, group gate + softWalls
   use it). Consider tagging each segment with its OPEN side (which of
   the group's tiles are walkable) for extrusion normals.
2. New renderer pass `buildSegmentWalls(world, contour, target, bounds)`:
   - Iterate `contour.segments`, ownership by group anchor (gx,gz) in
     bounds (chunk dedupe, like pipe chamfers' center rule).
   - Band per segment: from the walkable-side columns of its 2x2 group —
     group-wide max ceil / min floor for organic; for transit floors the
     bore band (0..3.5-style). Skip pit sentinels (lo<=-100, hi>=100).
   - Emit the octagonal-style profile (flat band + top/bottom diagonals)
     or a plain quad (start plain, profile later) with normal toward the
     walkable side. Caps above (enclosed spaces) come from the existing
     cap plates (soft walls keep caps — cap rule `!anyNonTunnel && !soft`
     already in).
3. Suppress replaced per-boundary emission: in the face pass, for a
   boundary whose solid side is a SOFT wall and air side is a smooth
   tile, skip flat/chamfer/octagonal emission for the sub-range covered
   by the contour band (cross-band sub-ranges above/below stay square).
   The transom logic likely becomes unnecessary for these (segment wall
   is continuous); verify with DDSNAP.
4. Validation: fresh tsx cache ALWAYS (`rm -rf ~/.cache/tsx`).
   - /tmp/find-diag.ts locates diagonal runs; render along them: expect
     ONE flat plane (right model). Baseline broken render: ribbed
     pilasters (flat-diag.png, seed 660855 x520.5 z433.5 yaw -2.356).
   - Seal check: seed 1785780499703 opx-1 opz3 x293 z343 — bore stays
     sealed (pale blue = CEILING in debug palette, not sky!).
   - verify-world 16 seeds: cracks=0, unreachable=0, seams 100%.
   - Cave view spot-check (organic walls change too — they get FLATTER,
     intended, but check no slits at transitions).

## Current tree state (uncommitted, on top of c9534d4)

- organiccontour: isSmoothTile participation + isTransitFloorIn export.
- DungeonRenderer: org() includes transit floors; cap rule
  `!anyNonTunnel && !soft`.
- layer4-connect: 8-direction weighted A* restored (diagonal runs, angle
  -graded turn penalty) — diagonal corridors carve 1:1 staircases for
  the extruder to flatten.
- All gates green on this state; visuals are center-model bevels until
  the extruder lands.

## RESOLVED (d5cf516): corner-wedge leak class — ember leak, canyon,
## corridor-mouth slits. Root cause: a corner-cut diagonal makes the
## wall tile's corner render-air, exposing boundary-plane strips above
## the air span that were buried solid pre-v2. Fix: cap transoms on
## suppressed halves (air-span top -> cap corner-field edge, facing the
## wedge), triangulated (not bilinear) corner-surface sampling for
## segment wall tops/bottoms, and segCap edge-seal triangles. Debug
## tool: --ray=px,py single-ray microscope. Sections below kept for
## history.

## EMBER LEAK — instrumented state (historical)

debug-view now has LEAK-ENTRY clustering (bad rays report where they
first cross data-air → data-solid) and --faces[=x,z] quad dumps.
Findings for the ember repro (seed 1785798090972 @ 369.82,0.5,369.87):
- The leak ENTERS at tile (124,126) [world 373.5,379.5], ~3 tiles from
  the camera — NOT at the distant wrong-side hotspot tiles.
- Pre-v2 (c9534d4) renders this snap CLEAN; v2 leaks 1318px.
- Wall faces at the z=378 boundary are PRESENT and rise to ~15-16
  (segment pieces x 369..373.5 + corner diagonal to 374.25,378.75).
- Two experiments left the count invariant-or-worse and are REVERTED
  (flat-max caps, rise-to-cap wall tops): the leak is NOT a wall-band
  or cap-height issue on that boundary.
- NEXT: dump the remaining faces of tile (124,126) — the x≈375 plane
  n(±1,0,0), the continuation past the corner diagonal at
  (374.25,378.75), and the tile's cap/ceiling quads — one of those is
  missing/misplaced vs pre-v2 (diff against the c9534d4 worktree dump,
  /tmp/faces-prev.txt technique). Suspect: the boundary continuation
  where the corner diagonal hands off to the next boundary segment
  (the diagonal ends mid-tile; what seals from (374.25,378.75)
  onward?) — likely the true END-SEAL instance.

## Remaining feature: END-SEALS (open — all remaining defects are this)

Wherever a segment chain terminates (against hard walls, sky-failing
groups, or band changes), its open vertical edge is unsealed. Repros:
- ember slit: seed 1785798090972 (0,0) @ (369.82,0.5,369.87) yaw 9.926 pitch 0.42
- canyon cliff: seed 1785800352604 (0,-2) @ (341.67,0.5,286.86) yaw 20.048 pitch 0.548
- crypt junction needle: seed 1785800352604 (2,2) @ (346.7,0,376.87) yaw 3.318 pitch 0.406 mark (185.55,10.3,6)
- z-fight + ceiling gap: seed 1785803164598 (1,1) @ (418.05,0,355.14) yaw 7.012 pitch 0.296 mark (416.31,2.4,353.19)
Build the face-dump instrument FIRST (debug-view --faces x,z: list every
emitted quad crossing a world column with emitting pass + bounds), then
place seal geometry exactly. No more blind junction patches.

## Older notes: soft/hard junction wedge (superseded by end-seals)

Repro: seed 1785798090972, origin (0,0), stand (369.82, 0.5, 369.87)
yaw 9.926 pitch 0.42 — a ~half-tile vertical magenta slit between a
segment wall and a square wall (cave, near ember transit passage at
tiles ~(140,149..155)). NOT a band-height gap (neighborhood band
extension left it byte-identical). Hypothesis: where a segment chain
terminates against HARD geometry, the displaced contour plane and the
tile-boundary square plane leave a vertical sliver — the exact wedge
the old per-boundary system's mutual-agreement (o0/o1 openHalf)
prevented. Needed: segment END-SEALS — at each segment endpoint not
continued by another EMITTING segment, a sealing quad from the
endpoint edge to the square system's plane (endpoints lie on tile
boundary lines, so the seal connects endpoint edge to the adjacent
grid corner). Investigate with a wireframe/top-down dump of segments +
emitted faces around tile (140,152) before coding.

## Traps learned today (do not repeat)

- tsx caches stale modules: clear `~/.cache/tsx` before every
  debug-view/script run in A/B work.
- Debug-view palette: pale blue = downward-facing surface (ceilings),
  NOT sky. Verify with a pitch-up render before crying "hole".
- Seed discipline: scripts hardcode seeds — double-check the seed
  matches the snap being investigated.
- Never edit the live working tree while the user plays (vite reloads
  them); use a git worktree for A/B.
- Additive-only and reclassification approaches both dead-end at the
  center model; only segment extrusion reaches the right model.

## SLICE 2 (roads) — attempted Aug 4 2026, REVERTED; findings

Flipping roads into `isSmoothTile` + height-banded collision is NOT the
slice. Three structural mismatches surfaced (A/B-verified against
baseline, which has only 23 backface px in the test district;
the naive slice produced ~43k):

1. RISERS: plinth-to-plinth steps are wall|wall in the tile grid —
   marching squares draws no line there, so any suppression around them
   is suppress-without-emit. Stairs of blocks are the roads look;
   they need a wall-line source over COLUMN TOPS, not tile walkability.
2. RIDGES: a 1-tile plinth wall between two streets needs BOTH side
   walls to agree on the tile's top exactly; per-group nearest-tile
   band selection lets the two sides disagree and exposes backfaces.
3. BORDERS: groups mixing roads tiles with outside terrain have
   walkable space on both sides at wildly different heights — segment
   orientation is ambiguous. (Border exclusion alone fixed almost
   nothing; the damage is interior, items 1-2.)

The real design (matches the original doc note "path-offset splines /
future wall-line sources"): a roads-specific wall-line pass extruding
per-BLOCK outlines from the road-vein field (blocks are Voronoi cells
of `roadVeinsAt` — their outlines are already smooth curves in field
space), banded per block top, with collision height-banding
(GameEngine plinth skip — that part of the attempt was sound and can
be reused). Renderer-side only over span tops; the tile-grid contour
is the wrong substrate for this district.

## RESOLVED (004eedf): border face bottoms — the actual cause was the
## octagonal band bottoms (corner-refined) vs flat trim floors; fixed
## by corner-field trim floors. The refine-owner theory below was a
## red herring (single level, owner 0, refine returned correct values
## when instrumented). Kept for history.

Repro: seed 1785957788208 @ (292.84,0.38,195.22) yaw 5.524 pitch
-0.236 — magenta floor-level triangle at a court/street corner,
1909 miss px. Byte-identical at 66a71a4 (pre-slice-2), so this
predates roads smoothing entirely.

Diagnosis (single-ray + face dump, Aug 5 2026): the face at z=192,
x 294..297 (air (98,64) span 0..14 | solid sp0 (98,63)) IS emitted
(m12) but its bottom edge sits at 1.2/0.6 while the DRAWN level-0
floor corners there are 0.6/0.0 — the strip 0..1.2 is open. `refine`
(DungeonRenderer ~line 940) resolves face bottoms via
`cornerFloors[span.owner]`; the span's owner level here is not the
level whose corner field drew the visible floor, so the face floats
above it. Fix direction: refine must clamp/fall back to the corner
field of the level that actually renders the floor at that corner
(or take min across candidate owners). Instrument first: print
span.owner and both fields' corner values at (98,64).

## RESOLVED — THE CREST AUTHORITY (crown unification, Aug 2026):
## One pure per-cell crest function (`cellCrest` in layer6-heights,
## snapshotted as DungeonData.cellCrests) is now the single source of
## every crown height. Render side, `crestTopOf` in buildWalls gives
## every solid-topped column ONE crown: its cell crest, lifted only by
## real structure (interior span ceilings, a wall's capMax, a pillar's
## totalHeight). Mechanism: the XOR face pass treats everything above
## a column's crown as VIRTUAL AIR — wall faces stop exactly at the
## crest, CLOSURE FACES between adjacent differing crests fall out of
## the same sweep for free, and the roof pass seals every solid column
## at its crown (the old constant sky-clip roof plane at 600 is gone;
## the skyline IS the watertight top surface now). capMax's crown
## rule: a wall facing outside crests at its OWN cell's crest — never
## at the 3x3 mix of neighbor-cell crest ceilings (that mix was the
## staggered-crown bug). Segment wall tops (hiFor -> capMax), cap
## plates, cap transoms, flat faces, and roofs all read the same
## number. Verified: tower repro (1785973922535 opx -1 opz -2) 0 leak
## entries, backfaces 1px; slot canyon (1785958682363) backfaces
## 3008 -> 90 (residual = pre-existing ground-level apron hairlines,
## different family); three-crown corner (1785957788208 opx 4 opz 3)
## crowns aligned. verify-world 16 seeds ALL PASS, window seams 100%
## identical, scan-holes escape count byte-identical to pre-change.
## debug-view's leak classifier now knows the crown rule and skips
## chamfer-wedge grazes (data-solid, render-air by design).

(Resolved repro, kept for regression checks) Seed 1785958682363
opx -1 opz -2, camera (210.15,1,170) yaw 3.312 pitch 0.55 (or
(232,1,165) yaw 2.7 pitch 0.35): magenta slit at the crown gap
between staggered parallel slabs. Cause: segment walls topped at
capMax while suppressing the XOR faces, leaving the band from crest
to the 600 sky clip undrawn; adjacent wall tiles mixed neighbor-cell
crests. Both killed by the crest authority above.

## RESOLVED (2e0756c + absolute outside crests): solid-to-sky crowns
## stepped because skyTop was per-window (tallest pillar present) —
## adjacent chunks clipped sky-facing geometry at different heights.
## Constant sky clip + per-cell quantized absolute outside crests.
## Original notes:

Repro: seed 1785957788208 opx 4 opz 3 @ (347.59,0.6,180.59) yaw 9.338
pitch 1.09, marks at (341.71,82.43,214.21) / (339.43,80.03,214.07) /
(339.98,76.12,213.52) — three crown heights on one tower corner.
The towers are SOLID-TO-SKY columns (empty span lists, pillarWall=0,
neighbors air 1..sky). Their wall crowns do NOT come from the layer6
outside ceiling field (quantizing it — e033325 + the absolute-crest
follow-up — left this render byte-identical). The tops come from the
sky-clip / capMax-fallback path for walls whose neighbors are all
sky-open (cornerCeil/capMax exclude >=100 → fallback heights vary
per piece). Fix direction: give solid-to-sky wall crowns the same
structural treatment — a per-cell quantized crest module — inside
whatever emits their top band (likely the segment-wall hiFor fallback
+ face-pass topOverride for sky-adjacent boundaries). Instrument
first: face-dump the crown at (341,80,214) and identify the emitters.

## RESOLVED (with the crest authority work): bore-mouth crown gap.
## Root cause was NOT the !airIsSky guard: the mouth wall column
## carries a FLYING PIPE span (33.2..36) far above the corridor cap,
## and all three "column carries spans -> no cap" guards (topOverride,
## cap plates, segGroupBasic) read ANY span as "bridge-carved wall,
## no cap" — skipping the override AND the transom, opening the wedge
## band above the mouth chamfer. The guards now test spans AT OR
## BELOW the cap junction (floor <= cap + 1.0); spans overhead leave
## the cap intact. Repro (seed 1785977436059 opx 0 opz -2) renders
## 0 miss / 0 backface pixels. Original notes:

## OLD NOTES: bore-mouth crown gap under open sky

Repro: seed 1785977436059 opx 0 opz -2 @ (421.61,0,465.92) yaw 10.086
pitch 0.05 — cyan triangle above the mouth frame (1950 backface px,
entry tile (141,156)): through it you see the BACK of the corridor's
3.5 interior ceiling. The exterior band above the mouth opening
(3.5..frame crest) is unsealed when the mouth exits toward SKY-OPEN
air: topOverride has an `!airIsSky` guard (the band was the sky
clip's job pre-smoothing), and the cap-transom path only covers
suppressed halves. Fix direction: sky-open boundaries whose SOLID
side is a real wall should still seal hi -> the wall's own crest
(capMax already excludes >=100 fillers; wire the transom or the
override to fire for airIsSky when capMax is finite). Single-ray:
pixel (240,25) from the repro camera lands on the ceiling back at
(423.2,3.5,468.0).
