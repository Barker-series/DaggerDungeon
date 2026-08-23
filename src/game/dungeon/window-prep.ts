/**
 * WINDOW PREP — the per-window authorities both physics and rendering
 * consume (corner fields, organic / pit / roads contours). Pure
 * functions of the generated world, so the world worker builds them
 * right after generation and ships them with the window: the adoption
 * frame on the main thread no longer pays ~100 ms of contour building
 * per cell crossing (the travel hitch, Aug 2026). The synchronous
 * fallback (cache miss) builds them on the main thread as before.
 */
import type { WorldData } from '../types';
import { buildCornerField } from './heightfield';
import { buildOrganicContour, type OrganicContour } from './organiccontour';
import { buildPitContour, type PitContour } from './pitcontour';
import { buildRoadsContour, type RoadsContour } from './roadscontour';

export interface WindowPrep {
  cornerFloors: number[][][];
  contours: OrganicContour[];
  pitContour: PitContour;
  roadsContour: RoadsContour;
}

export function prepareWindow(world: WorldData): WindowPrep {
  const cornerFloors = world.levels.map((l) =>
    buildCornerField(l.tiles, l.floorHeights, l.width, l.height, 0, l.pillarGround));
  const contours = world.levels.map((l) => buildOrganicContour(l, world.columns));
  const pitContour = buildPitContour(world.levels[0]!, world.columns);
  const roadsContour = buildRoadsContour(world);
  return { cornerFloors, contours, pitContour, roadsContour };
}
