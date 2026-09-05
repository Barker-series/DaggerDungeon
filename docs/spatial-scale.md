# Spatial height standards

The framed buildings were structurally successful but their occupied floors,
like much of the ordinary transit network, felt too low. This pass increases
usable spatial height without thinning the concrete, enlarging stair risers,
or losing deliberate crawl spaces. Framed doorways subsequently received a
height increase too, at the user's request, while retaining their widths.

## Occupied buildings

| Space | Previous | Current |
|---|---:|---:|
| Frame floor-to-floor pitch | 6 | 9 |
| Ordinary frame gallery clear height | 4.5 | 7.5 |
| Clear height beneath frame downstand beams | 3.5 | 6.5 |
| Enclosed frame roof landing clearance | 4 | 6 |
| Framed core and room doorway height | 3.5 | 6 |

Floor slabs remain 1.5 units thick and downstand/transfer beams remain 2.5.
Building height targets are still region-driven; taller storeys generally mean
fewer occupied floors within a similar overall mass, not stretching everything.

The switchback core extends longitudinally, with seven outward rises and eight
return rises at the unchanged 0.6 step. A flat turning landing connects them.
The core remains inside the existing pillar-cell footprint; no new neighbor
padding or steeper player steps are required. Framed core and room doors are
six units high and remain two tiles wide; the lintel/floor band above a normal
storey opening remains three units deep. Closed-roof termination still stops
at the last occupied landing. Compact legacy entrances keep their own profiles.

## Ordinary world circulation

Ground corridors, ordinary bridge passages/housings, and permanent transit
carved through fold mass share a **6-unit** clearance from
`src/game/dungeon/clearance.ts`. Previously each independently used 3.5.
Sharing the value prevents a downstream layer from restoring a low bore.

Explicit pipes keep their 2.6-unit bore. Vents, low service throats and other
intentional compressions retain their authored profiles. The goal is contrast,
not uniformly cavernous rooms.

## Ground-region chambers

These are base biome clearance ranges before local organic detail, doorway/mouth
sweeps and border blending; they are not promises about every final column.

| Biome | Previous | Current |
|---|---:|---:|
| Dungeon | 18–30 | 24–42 |
| Crypt | 12–20 | 18–30 |
| Cave | 10–28 | 16–40 |
| Ember | 24–44 | 30–56 |

Outside crest/data-ceiling rules, floor swell, pit probabilities, permanent
ground-network planning, lighting budgets and doorway widths are unchanged.
Building floor counts/elevations and compatible bridge pairings can change with
the new storey rhythm; older building-view snapshots may need updated heights.

## Verification and playtest

`tools/verify-spatial-clearance.ts` verifies frame clear heights and slab mass,
the extended stair landing, roof clearance, actual ground height-field output,
ordinary bridge carving, preserved pipe bore and ordinary transit through
actual fold-generated mass. `verify-frame-buildings` separately exercises all
height/roof/style/depth/orientation combinations and continuous circulation.
The full world and migration suites remain required.

`tools/verify-frame-doorways.ts` also checks the exact marked doorway, core and
room openings above/below grade, rotations, industrial and closed-roof cases,
with solid jambs and retained lintel mass.

Occupied gallery, seed 1234:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":244.5,"y":18.5,"z":277.5,"yaw":1.5707963267948966,"pitch":0.1}
```

Atrium transfer level:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":232.5,"y":18.5,"z":250.5,"yaw":-1.5707963267948966,"pitch":0.2}
```
