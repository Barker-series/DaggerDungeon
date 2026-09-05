/**
 * The pillar chunk contract — the vocabulary every kebab is spelled in.
 *
 * v2: pillars live on their own COARSE grid (one pillar cell = 4x4
 * dungeon cells = 56 tiles) and are MASSIVE — the landscape organizes
 * around them. Every chunk carries a winding ramp up one face; the
 * assembler advances the ramp face a quarter-turn per chunk, so the
 * climb spirals around the pillar continuously from grade to crown.
 * Chunks differ in what else they offer: terrace plazas (bridge
 * landings), hollow galleries, plain shaft.
 *
 * Everything downstream reads chunks through SOCKETS — where bridges
 * may attach and where you can stand. Sockets are computed at assembly
 * (they depend on the ramp face), not authored per-def.
 *
 * All heights are in world units, local to the chunk's base.
 */

import { CROSSING_HALL_HEIGHT } from './crossing-hall';
import { SERVICE_GALLERY_HEIGHT } from './service-gallery';

export type SocketKind =
  /** A bridge to a neighboring pillar may attach here */
  | 'bridge'
  /** Walkable standing surface on/in the pillar (waypoints, loot) */
  | 'ledge';

export type SocketFace = 'north' | 'east' | 'south' | 'west' | 'interior';

export interface ChunkSocket {
  face: SocketFace;
  /** Height of the walkable surface above the chunk base */
  y: number;
  kind: SocketKind;
}

export interface PillarChunkDef {
  id: string;
  /** Vertical extent in world units */
  height: number;
  /** Selection weight in the kebab assembler */
  weight: number;
  /** Stair profile: 'landings' (default — flat entry/exit landings) or
   *  'continuous' — the flight climbs the whole band without stops */
  ramp?: 'landings' | 'continuous';
}

/**
 * The graybox chunk library. Deliberately small — variety arrives by
 * growing this list, never by changing the assembler.
 *
 * - plain:   core + the winding face-ramp, nothing else
 * - terrace: slim core waisted inside a broad flat plaza ring at the
 *            base — prime bridge real estate on all four faces
 * - gallery: hollow interior hall, doorway on the face opposite the
 *            ramp — bridge entry into the pillar's inside
 * - shaft:   core + a CONTINUOUS flight — the same stairs with no
 *            landings, climbing without stops. The express meat.
 * - residential: Kowloon-compressed living strata — low stacked floors
 *            inside the core, each with a doorway slit onto the spiral
 *            where the flight passes its height. City-district meat.
 * - crown:   solid cap; its top is the rooftop. Every pillar ends in
 *            exactly one (placed explicitly, weight 0).
 */
export const CHUNK_LIBRARY: PillarChunkDef[] = [
  { id: 'plain', height: 8, weight: 3 },
  { id: 'terrace', height: 6, weight: 3 },
  { id: 'gallery', height: 12, weight: 2 },
  // Same-height regional variation, chosen after the kebab is assembled.
  { id: 'service-gallery', height: SERVICE_GALLERY_HEIGHT, weight: 0 },
  // Low entry → split-level hall → offset crossing → open observation edge.
  { id: 'crossing-hall', height: CROSSING_HALL_HEIGHT, weight: 1 },
  // 13.8 = 23 treads at the fixed 0.6 rise — exactly the climb between
  // the two corner squares. The flight fills the whole band: the shared
  // corners are its only flat tiles, so it reads as stairs that never
  // stop. (Corners MUST stay flat: a climbing tread in the shared square
  // gets erased by the neighboring flight's headroom punch.)
  { id: 'shaft', height: 13.8, weight: 2 },
  // Two 4.5-unit storeys plus roof mass, with authored stair landings.
  { id: 'residential', height: 10, weight: 2 },
  // Solid mass threaded by a 2-wide, 2-tall crawl duct at base height,
  // open on two opposite faces — some enterable from an adjacent plaza,
  // some just dark slots glimpsed under the passing stairs
  { id: 'vent', height: 8, weight: 1 },
  { id: 'crown', height: 4, weight: 0 },
];

export const CHUNK_BY_ID: ReadonlyMap<string, PillarChunkDef> = new Map(
  CHUNK_LIBRARY.map((c) => [c.id, c]),
);
