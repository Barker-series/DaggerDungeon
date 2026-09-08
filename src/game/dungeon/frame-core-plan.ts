/** The shipped frame's local switchback recipe, compiled once at module load.
 * Only this core/its anchors are declarative: wings, piers, service networks,
 * roof policy and absolute-cell selection retain their existing owners. */
import { compileStructurePlan, type StructurePlan } from './structure-kit';

// Shared with frame-building via re-exports; no runtime import back to it.
export const FRAME_PITCH = 9;
export const FRAME_SLAB = 1.5;
export const FRAME_DOOR_HEIGHT = 6;
const interior = Object.freeze({ x0: 18, x1: 23, z0: 18, z1: 29 });
const envelope = Object.freeze({ x0: 17, x1: 24, z0: 17, z1: 30 });
const entry = { name: 'entry', role: 'entry', x: 22, z: 18, y: 0 } as const;
const door = { name: 'door', role: 'door', x: 24, z: entry.z, y: 0 } as const;
const landing = { x0: interior.x0, x1: interior.x1, z0: entry.z, z1: entry.z + 1 };

const storey: StructurePlan = {
  name: 'frame-core-storey',
  bounds: { ...envelope, x1: 25 },
  pieces: [
    { kind: 'landing', rect: landing, y: 0, thickness: FRAME_SLAB },
    { kind: 'landing', rect: { x0: 18, x1: 23, z0: 28, z1: 29 }, y: 4.2, thickness: FRAME_SLAB },
    // Seven outward rises, then a flat final tread meeting the turning landing.
    {
      kind: 'flight',
      rect: { x0: 18, x1: 19, z0: 20, z1: 27 },
      axis: 'z',
      direction: 1,
      start: 19,
      maxSteps: 7,
      rise: 0.6,
      y: 0,
      thickness: FRAME_SLAB,
    },
    {
      kind: 'flight',
      rect: { x0: 22, x1: 23, z0: 20, z1: 27 },
      axis: 'z',
      direction: -1,
      start: 28,
      maxSteps: 8,
      rise: 0.6,
      y: 4.2,
      thickness: FRAME_SLAB,
    },
  ],
  sockets: [
    entry,
    door,
    { name: 'spineNorth', role: 'room', x: 25, z: 20, y: 0 },
    { name: 'spineSouth', role: 'room', x: 25, z: 29, y: 0 },
  ],
};

export const FRAME_CORE = Object.freeze({
  interior,
  envelope,
  storey: compileStructurePlan(storey),
  arrival: compileStructurePlan({
    name: 'frame-core-arrival',
    bounds: interior,
    sockets: [],
    pieces: [
      { kind: 'landing', rect: landing, y: 0, thickness: FRAME_SLAB },
      // Never close the entire well above the last flight.
      { kind: 'landing', rect: { x0: 22, x1: 23, z0: 20, z1: 20 }, y: 0, thickness: FRAME_SLAB },
    ],
  }),
  wall: compileStructurePlan({
    name: 'frame-core-wall',
    bounds: envelope,
    sockets: [door],
    pieces: [
      { kind: 'solid', rect: envelope, lo: 0, hi: FRAME_PITCH },
      { kind: 'opening', rect: interior, lo: 0, hi: FRAME_PITCH },
      {
        kind: 'opening',
        rect: { x0: door.x, x1: door.x, z0: door.z, z1: door.z + 1 },
        lo: door.y,
        hi: door.y + FRAME_DOOR_HEIGHT,
      },
    ],
  }),
});
