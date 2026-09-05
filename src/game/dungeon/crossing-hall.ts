/**
 * Split-level crossing hall: a low service throat opens above a recessed
 * chamber; an offset catwalk reaches a broad, open observation edge. A
 * stair on the opposite side returns to the lower floor.
 *
 * Owned entirely by one pillar chunk (local tiles 17..38, Y 0..12).
 * Reads no neighbors; selection belongs to the region-aware kebab layer.
 * These AIR intervals compile into the same columns as all other rooms.
 * No mesh, window position, or runtime state participates in the plan.
 */
export const CROSSING_HALL_HEIGHT = 12;
export const CROSSING_HALL_DECK = 4.8;

/** Fixed human-scale entry and storey dimensions, not scaled to mass. */
export function crossingHallRampSurface(baseY: number, i: number): number {
  if (i <= 2) return baseY;
  if (i <= 10) return baseY + (i - 2) * 0.6;
  if (i <= 13) return baseY + CROSSING_HALL_DECK;
  return baseY + Math.min(CROSSING_HALL_HEIGHT, CROSSING_HALL_DECK + (i - 13) * 0.6);
}

/** Local air only; everything else inside the chunk envelope is solid. */
export function crossingHallAir(x: number, z: number): [number, number][] {
  if (x < 17 || x > 38 || z < 17 || z > 38) return [];
  const deck = CROSSING_HALL_DECK;
  // The approach is deliberately enclosed even when the hall sits under sky.
  if (z <= 21) return x >= 25 && x <= 26 ? [[deck, deck + 3]] : [];
  // The far opening is a balcony, not another tiny window in a wall.
  if (z === 38) return x >= 19 && x <= 36 ? [[deck, 11]] : [];
  if (x === 17 || x === 38) {
    // Human-scale side windows; the full-height piers between stay structural.
    return z === 26 || z === 27 || z === 31 || z === 32 ? [[deck + 1.25, deck + 3.25]] : [];
  }
  // Repeated internal buttresses make the hall's depth legible from its mouth.
  if ((x === 18 || x === 37) && (z === 24 || z === 29 || z === 34)) return [];
  // A real return stair, two tiles wide. No jump/drop is needed to explore
  // below the crossing and climb back to its observation deck.
  if (x >= 21 && x <= 22 && z >= 27 && z <= 35) {
    const floor = Math.max(0.5, deck - (35 - z) * 0.6);
    return [[floor, 11]];
  }
  const walkway =
    (x >= 25 && x <= 26 && z <= 25) ||
    (x >= 25 && x <= 32 && z >= 24 && z <= 25) ||
    (x >= 31 && x <= 32 && z >= 24 && z <= 35) ||
    z >= 35;
  return walkway
    ? [
        [0.5, deck - 0.5],
        [deck, 11],
      ]
    : [[0.5, 11]];
}

/** Canonical pre-rotation targets, shared by integration and verification. */
export const CROSSING_HALL_SOCKETS = [
  { x: 25, z: 16, y: CROSSING_HALL_DECK, role: 'entry' },
  { x: 25, z: 20, y: CROSSING_HALL_DECK, role: 'room' },
  { x: 31, z: 28, y: CROSSING_HALL_DECK, role: 'room' },
  { x: 30, z: 38, y: CROSSING_HALL_DECK, role: 'room' },
  { x: 28, z: 28, y: 0.5, role: 'room' },
  { x: 31, z: 28, y: 0.5, role: 'room' },
] as const;
