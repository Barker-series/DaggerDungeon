# Pillar Room Kit

The legacy pillar kebab is a vertical building assembler, not a solid trunk with
random boxes subtracted from it. Its room modules use the kit below. Whole framed
buildings now have their own internal circulation and structural plan; see
`framed-buildings.md`. Exterior ramp access is not a universal building rule.

## Scale

One procedural tile is **3 × 3 world units**.

| Element | Tiles | World size |
|---|---:|---:|
| Structural wall | 1 | 3 units thick |
| Door opening | 2 | 6 units wide |
| Window opening | 2 | 6 units wide |
| Façade/room bay | 5 | 15 units |
| Main corridor | 2 | 6 units wide |
| Stair transfer landing | 6 | 18 units long |
| Residential storey | — | 4.5 units high |
| Floor plate | — | 0.5 units thick |
| Window sill | — | 1.25 units above floor |
| Window opening | — | 2 units high |

These are graybox dimensions. Authored replacements may add frames, columns,
trim, railings, doors, and inset surfaces inside the envelope, but their outer
dimensions and sockets must remain unchanged.

## Circulation contract

An interior is valid only when:

1. Its primary entry directly meets a flat circulation landing (exterior stairs
   for the legacy kit, internal core/gallery for framed buildings).
2. The entry and landing floors differ by no more than the player's step height.
3. Every room connects to the primary corridor through a standard door opening.
4. The corridor never narrows below two tiles.
5. A bridge is an optional second entrance, never the only way into a room.
6. Windows are openings in exterior walls, not dark rectangles drawn on solids.
7. The chunk remains traversable when no neighboring pillar or bridge exists.
8. A terrace holds six flat stair tiles before its exterior flight begins, so
   entering the plaza never requires stepping sideways off a rising tread.

## Initial library

### Gallery hall

- One 20 × 20-tile clear hall.
- Tall ceiling.
- Two-tile doorway in the adjacent west façade bay, reached by a flat apron
  wrapping around from the exterior stair's starting corner.
- Repeating window bays on the other three façades.
- A bridge may share the stair threshold but is not required for access.

### Residential corridor

- Two storeys per residential chunk; additional chunks stack without forcing
  too many door landings into one exterior stair run.
- Continuous two-tile north/south corridor.
- Two room wings on each side of the corridor.
- Paired doors from the corridor into the wings.
- Repeating exterior window bays.
- Each storey receives a stair-facing entrance where the exterior flight reaches
  that storey's elevation.

### Split-level crossing hall

- A two-tile-wide, three-unit-high service passage enters from an authored
  mid-flight landing at local Y 4.8.
- The passage opens into a full-height chamber: lower floor at 0.5, ceiling
  at 11, and an offset two-tile-wide catwalk at 4.8 with space beneath it.
- A broad opening in the far facade gives an observation edge. The neighboring
  world determines the view; this is not a guarantee of open sky or a bridge.
- A two-tile-wide internal stair connects the observation deck to the lower
  chamber. Both levels can be explored and left without jumping or falling.
- Fixed-size side windows and internal buttresses articulate the chamber.
- Favored in machine and canyon kebabs; also selected in deep foundations,
  where explicit air cuts keep the buried rooms open. The bottom landing and
  continuous exterior climb remain intact.
- The local air plan and navigation targets live in
  `src/game/dungeon/crossing-hall.ts`. Geometry, collision, and navigation read
  the same compiled columns; no special rendering path is used.
- `npx tsx tools/verify-crossing-hall.ts` checks the entry, two-level circulation,
  roofline protection, and exterior ascent above/below grade in all rotations
  and mirrors. The published room sockets also enter `verify-world`.

This is an initial traversal module, not the complete canyon-crossing system,
vertical-streaming work, or final architectural dressing.

### Service gallery

- A low west-facing entry turns around a machine bay before opening into
  the taller service chamber. It uses the public gallery's wrapped stair apron.
- Two solid equipment housings stand on the chamber floor, with walking lanes
  around them. Overhead rectangular service trunks have collars and a branch
  into the first housing; they are real solid intervals, not renderer props.
- Two east-facing doors connect to a two-tile-wide outer service ledge. The
  ledge allows an outside detour and re-entry where the surrounding world is
  open; buried versions remain enclosed by their surroundings.
- Most common as a machine-district gallery variation, less common in cities,
  and rarer in other districts. Some deep machine crossing halls use it too.
- All substitutions are 12 units tall and use an independent absolute-cell
  seed stream after kebab composition. Tower heights, rotations, and the
  existing gallery bridge-socket contract stay unchanged.
- `src/game/dungeon/service-gallery.ts` owns its air plan and room targets.
  `npx tsx tools/verify-service-gallery.ts` verifies the loop, overhead solids,
  stair entry, and above/below-grade rotations/mirrors.

Inspection example, just before the service chamber at a canyon/fold boundary:

```text
DDSNAP1{"seed":1,"stack":1,"opx":-8,"opz":-1,"x":232.5,"y":12.5,"z":265.5,"yaw":0,"pitch":0}
```

## Ground-junction regression

`tools/verify-foundation-edges.ts` rebuilds the actual renderer for the reported
ground fin near the service bridge. Flat foundation edges must compare against
the terrain's **drawn corner heights**, not restore its raw tile height when
the two edges meet. Profiles that cross are split and oriented toward their
actual lower side. This keeps the sealing edge without protruding fins.

```text
DDSNAP1{"seed":1,"stack":1,"opx":-8,"opz":-5,"x":292.7,"y":1.31,"z":255.38,"yaw":-15.335,"pitch":-0.604}
```

## Next modules

- Corner apartment with two window façades.
- Service room with pipe and vent sockets.
- Double-height machine hall.
- Balcony room with an exterior ledge socket.
- Stair-transfer lobby for changing between exterior and interior circulation.
- Ruined module variants that remove non-structural walls while preserving the
  guaranteed path.

Procedural generation chooses a room layout by deterministic
`(seed, absolutePillarCell, chunkIndex)`. The selected layout publishes named
door, window, bridge, utility, and dressing sockets. Rendering may instance a
graybox or authored GLB at those sockets; navigation reads the same layout
contract and never infers reachability from visible geometry afterward.
