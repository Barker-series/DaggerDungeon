/**
 * The COLUMN MODEL — the single authority on solid vs air.
 *
 * Every (x,z) column of the world is described as a short sorted list of
 * AIR spans in world-space Y; everything outside the spans is solid.
 * It is built ONCE, after every generation mutation has committed, and
 * from then on the renderer, the physics, and the agents are readers of
 * this one structure. There is no "between the levels": a gap is either
 * an air span (and therefore has floors, faces and collision derived for
 * it) or it is solid (and therefore unenterable and sealed by derived
 * faces). Leaks are unrepresentable, not patched.
 *
 * Derivation per column, walking levels top → bottom:
 * - Wall tile           → its whole band is solid. A shaft falling onto
 *                         it lands on the band top: flat structural rock.
 * - Floor tile          → air from its floor surface to its ceiling.
 *                         With open space pending from a hole above, the
 *                         span's ceiling is the topmost hole's ceiling —
 *                         the slab between the bands does not exist.
 * - Hole tile           → no floor; the band's air joins downward and is
 *                         capped by this level's own ceiling.
 * - skelVoid tile       → contributes nothing; another level's geometry
 *                         (a stairwell ramp) owns this space.
 * - outside (top level) → ceiling is SKY.
 */

import {
  TileType, LEVEL_HEIGHT, SKY_CEIL, ABYSS_FLOOR,
  type DungeonData, type ColumnSpan,
} from '../types';
import { PIT_LEVEL } from './heightfield';
import { tileBiome } from './cells';

export function buildColumns(levels: DungeonData[]): ColumnSpan[][] {
  const w = levels[0]!.width;
  const h = levels[0]!.height;
  const columns: ColumnSpan[][] = Array.from({ length: w * h }, () => []);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const spans: ColumnSpan[] = [];
      // Open space falling through from above: capped by `ceil`, waiting
      // for a floor (or the abyss)
      let pending: { ceil: number; ceilOwner: number } | null = null;

      for (let li = 0; li < levels.length; li++) {
        const L = levels[li]!;
        const tile = L.tiles[z]![x]!;
        const baseY = L.baseY;

        if (tile === TileType.Wall || L.skelVoid[z]![x]) {
          if (tile === TileType.Wall && pending) {
            // The shaft ends on this band's solid top — structural rock
            spans.push({
              floor: baseY + LEVEL_HEIGHT,
              ceil: pending.ceil,
              owner: -1,
              ceilOwner: pending.ceilOwner,
            });
            pending = null;
          }
          // skelVoid: another grid's geometry fills this space; its span
          // was already contributed by that grid's floor tile
          continue;
        }

        const floorLocal = L.floorHeights[z]![x]!;
        const isSky = li === 0 && tileBiome(L.cellBiomes, x, z) === 'outside';
        const ceilY = isSky ? SKY_CEIL : baseY + L.ceilingHeights[z]![x]!;

        if (floorLocal <= PIT_LEVEL) {
          // Hole — air joins downward, capped by the topmost open ceiling
          if (!pending) pending = { ceil: ceilY, ceilOwner: isSky ? -1 : li };
          continue;
        }

        spans.push({
          floor: baseY + floorLocal,
          ceil: pending ? pending.ceil : ceilY,
          owner: li,
          ceilOwner: pending ? pending.ceilOwner : (isSky ? -1 : li),
        });
        pending = null;
      }

      if (pending) {
        // Open all the way through the bottom — a true bottomless pit
        spans.push({
          floor: ABYSS_FLOOR,
          ceil: pending.ceil,
          owner: -1,
          ceilOwner: pending.ceilOwner,
        });
      }

      // Sort bottom-up for the queries
      spans.reverse();
      columns[z * w + x] = spans;
    }
  }

  return columns;
}

/** The span containing (or directly supporting) a world Y — the highest
 *  span whose floor is at/below y. Null over solid-only columns or below
 *  everything. */
export function spanAt(spans: ColumnSpan[], y: number, slack = 0.05): ColumnSpan | null {
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i]!;
    if (s.floor <= y + slack) return s;
  }
  return null;
}

/** Validate the model's invariants. Returns human-readable violations —
 *  generation should treat any of them as a bug, loudly. */
export function validateColumns(columns: ColumnSpan[][], w: number, h: number): string[] {
  const errs: string[] = [];
  for (let z = 0; z < h && errs.length < 20; z++) {
    for (let x = 0; x < w && errs.length < 20; x++) {
      const spans = columns[z * w + x]!;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i]!;
        if (!Number.isFinite(s.floor) && s.floor !== ABYSS_FLOOR) {
          errs.push(`(${x},${z}) span ${i}: bad floor ${s.floor}`);
        }
        if (s.ceil !== SKY_CEIL && s.ceil - s.floor < 1.5 && s.floor !== ABYSS_FLOOR) {
          errs.push(`(${x},${z}) span ${i}: crushed span ${s.floor}..${s.ceil}`);
        }
        if (i > 0 && spans[i - 1]!.ceil > s.floor + 0.01 && spans[i - 1]!.ceil !== SKY_CEIL) {
          errs.push(`(${x},${z}) spans ${i - 1}/${i} overlap`);
        }
      }
    }
  }
  return errs;
}
