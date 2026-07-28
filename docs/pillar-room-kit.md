# Pillar Room Kit

The pillar kebab is a vertical building assembler, not a solid trunk with random
boxes subtracted from it. Every enterable chunk must be assembled from this
shared room kit and must satisfy the circulation contract below.

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

1. Its primary entry directly meets a flat exterior stair landing.
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

- Three storeys per residential chunk.
- Continuous two-tile north/south corridor.
- Two room wings on each side of the corridor.
- Paired doors from the corridor into the wings.
- Repeating exterior window bays.
- Each storey receives a stair-facing entrance where the exterior flight reaches
  that storey's elevation.

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
