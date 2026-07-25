/**
 * Elevation slice — what the world looks like AT a given height.
 *
 * Maps must follow the player through pillar interiors, up spiral
 * ramps, and across bridges. The tile grid can't do that (a pillar
 * footprint is "Wall" even when you're walking its plaza), so the
 * slice classifies every column from the COLUMN MODEL — the single
 * authority on solid vs air — inside a vertical buffer around the
 * query height.
 */

import { ABYSS_FLOOR, type ColumnSpan } from './types';

/** Floors within this of the query height count as walkable "here" —
 *  generous enough to ride ramps and stair steps without flicker */
export const WALK_BUFFER = 4;
/** Floors this far above still show as "accessible above" (a landing
 *  overhead, the next ramp turn) */
export const ABOVE_BUFFER = 10;

export type SliceKind =
  /** No air at this height — solid rock/structure */
  | 'solid'
  /** Walkable surface within the buffer of the query height */
  | 'walk'
  /** Walkable surface a short climb above (visible as a hint) */
  | 'above'
  /** Open air: the ground here is far below — you would drop */
  | 'below'
  /** Open air over a bottomless pit */
  | 'abyss';

export interface SliceCell {
  kind: SliceKind;
  /** Floor height of the relevant span (walk/above/below) */
  floor: number;
}

const SOLID: SliceCell = { kind: 'solid', floor: 0 };

/** Classify one column at height y. Spans are sorted bottom-up. */
export function sliceAt(spans: ColumnSpan[], y: number): SliceCell {
  if (spans.length === 0) return SOLID;

  // The span the player's body would occupy at this height: the highest
  // span whose floor is at/below y + a small step allowance
  let occ: ColumnSpan | null = null;
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i]!;
    if (s.floor <= y + 2) {
      occ = s;
      break;
    }
  }

  // A walkable floor slightly above is worth showing even when the
  // column is otherwise solid at y (the ramp's next turn, a landing)
  const aboveSpan = spans.find((s) => s.floor > y + 2 && s.floor <= y + ABOVE_BUFFER);

  if (!occ || occ.ceil < y - 0.5) {
    // Solid at this height
    if (aboveSpan) return { kind: 'above', floor: aboveSpan.floor };
    return SOLID;
  }

  if (occ.floor <= ABYSS_FLOOR + 1) return { kind: 'abyss', floor: occ.floor };
  if (Math.abs(occ.floor - y) <= WALK_BUFFER) return { kind: 'walk', floor: occ.floor };
  if (occ.floor > y) return { kind: 'above', floor: occ.floor };
  return { kind: 'below', floor: occ.floor };
}
