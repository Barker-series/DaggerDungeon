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
