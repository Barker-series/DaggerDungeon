# Framed megastructure buildings

## Direction

Buildings are composed around mass, occupied wings, circulation and structural
support. Ease of assembling an exterior spiral is not an architectural brief.
The frame family replaces the spiral-kebab default in city and machine regions;
elsewhere a deterministic mix retains the older structures and their room kits.
Elevator shafts remain a separate building type.

## Construction and spaces

- A flat podium organizes the ground-floor entries. Surrounding terrain banks
  into its fixed surface instead of rising through occupied rooms.
- A tall internal switchback core connects basement landings, occupied storeys,
  transfer levels and the roof. No exterior spiral is generated for this family.
- Occupied wings surround a tall atrium. The south wing ends lower; the upper
  north wing retreats to make supported roof terraces rather than projecting
  another thin platform into empty space.
- Floor slabs are 1.5 world units thick, with 2.5-unit downstand/transfer beams.
  Corner buttresses and repeated piers connect to the foundation. Facades are
  open/recessed structural bays, not a uniform thick wall full of tiny punches.
- Fixed-size room doors open from circulation galleries into occupied bays.
  The ordinary family has closer floor spacing; machine buildings skip wing
  floors to form double-height spaces while retaining every internal landing.
- Selected transfer levels carry cross-atrium links and actual bridge portals.
  Every published portal meets the existing three-wide neighbor bridge contract.
- Ceiling-mounted landing strips identify the internal route. Mounts are one
  instanced batch; illumination uses the existing fixed point-light pool.

This is structural graybox architecture, not finished facade assets. It does not
simulate structural engineering, add combat, or complete vertical streaming.

## Layer contract

`frame-building.ts` is pure local planning and air-span generation. Its serialized
plan contains only numeric/boolean configuration; the absolute pillar-cell owner
selects it after region/height/depth planning. Rotation applies to the whole
building, never advances around each storey.

The maximum footprint stays inside local tiles 14..41. The existing pillar field
reserves it upstream; `pillar-geometry.ts` compiles its air into authoritative
columns. Deep air is explicitly excavated. `pillar-marry.ts` banks the ground
against the podium and retains existing sky/straddler roof policy. A closed roof
stops the last stair flight at the occupied landing below it.

Renderer, collision, maps and navigation consume those same columns. This is not
a second mesh-only world. Legacy chunk metadata remains for inspection; framed
buildings do not invoke the old winding-ramp emitter.

## Verification

- `npx tsx tools/verify-frame-buildings.ts`: both families, rotations and basement
  cases; bottom-to-roof ascent, room targets, supported slab thickness, atrium,
  unequal wings/setbacks, bridge portals and integrated podium grounding.
- `npx tsx tools/verify-frame-fixtures.ts`: deterministic unique landing fixtures,
  actual ceiling attachment, no roofless mounts, no legacy fixture changes.
- Existing world/migration, room, bridge and foundation regression suites remain
  mandatory. The frames publish room targets into the shipping world suite.

## Playtest views

Seed 1234, building at absolute pillar cell `(1,0)`, atrium transfer level:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":232.5,"y":12.5,"z":250.5,"yaw":-1.5707963267948966,"pitch":0.2}
```

Internal switchback, facing the ascending flight:

```text
DDSNAP1{"seed":1234,"stack":1,"opx":0,"opz":-1,"x":280.5,"y":12.5,"z":277.5,"yaw":0,"pitch":0.1}
```
