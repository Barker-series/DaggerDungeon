/**
 * The pillar chunk contract — the vocabulary every kebab is spelled in.
 *
 * A pillar is a vertical stack of CHUNKS ("kebab") occupying one cell.
 * Chunks are authored (graybox-procedural for now, art later); generation
 * only ever composes them. Everything downstream — bridges, geometry,
 * column spans, bot navigation — reads chunks exclusively through their
 * SOCKETS: the places a chunk exposes where something can stand or
 * attach. If it isn't in the socket list, it doesn't exist to the rest
 * of the system.
 *
 * All heights are in world units, local to the chunk's base.
 */

export type SocketKind =
  /** A bridge to a neighboring pillar may attach here */
  | 'bridge'
  /** Walkable standing surface on/in the pillar (bot waypoints, loot) */
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
  /** How much of the cell the chunk fills — slim segments read as the
   *  pillar "waist" between fatter features */
  footprint: 'full' | 'slim';
  /** Selection weight in the kebab assembler */
  weight: number;
  sockets: ChunkSocket[];
}

/** All four cardinal faces at one height */
const ring = (y: number, kind: SocketKind): ChunkSocket[] =>
  (['north', 'east', 'south', 'west'] as const).map((face) => ({ face, y, kind }));

/**
 * The graybox chunk library. Deliberately small — enough vocabulary to
 * prove the assembler, the debug view, and (next) bridges. Real variety
 * arrives by growing this list, never by changing the assembler.
 */
export const CHUNK_LIBRARY: PillarChunkDef[] = [
  {
    // Featureless structural segment — the kebab's connective tissue
    id: 'shaft',
    height: 6,
    footprint: 'slim',
    weight: 4,
    sockets: [],
  },
  {
    // A walkable ring around the pillar; prime bridge real estate
    id: 'ledge-ring',
    height: 4,
    footprint: 'full',
    weight: 3,
    sockets: [...ring(0.5, 'bridge'), ...ring(0.5, 'ledge')],
  },
  {
    // Tall open interior with entries on opposite faces
    id: 'gallery',
    height: 9,
    footprint: 'full',
    weight: 2,
    sockets: [
      { face: 'north', y: 0.5, kind: 'bridge' },
      { face: 'south', y: 0.5, kind: 'bridge' },
      { face: 'interior', y: 0.5, kind: 'ledge' },
    ],
  },
  {
    // Single balcony jutting from one face (assembler rotates via face pick)
    id: 'balcony',
    height: 5,
    footprint: 'slim',
    weight: 3,
    sockets: [
      { face: 'east', y: 2, kind: 'bridge' },
      { face: 'east', y: 2, kind: 'ledge' },
    ],
  },
  {
    // Ruined segment — interior ledges at staggered heights, climbable
    id: 'collapsed',
    height: 8,
    footprint: 'full',
    weight: 2,
    sockets: [
      { face: 'interior', y: 1, kind: 'ledge' },
      { face: 'interior', y: 3.5, kind: 'ledge' },
      { face: 'interior', y: 6, kind: 'ledge' },
      { face: 'west', y: 6, kind: 'bridge' },
    ],
  },
  {
    // Cap chunk — open rooftop; every pillar ends in exactly one
    id: 'crown',
    height: 3,
    footprint: 'full',
    weight: 0, // never picked by weight; the assembler places it explicitly
    sockets: [...ring(3, 'ledge'), { face: 'interior', y: 3, kind: 'ledge' }],
  },
];

export const CHUNK_BY_ID: ReadonlyMap<string, PillarChunkDef> = new Map(
  CHUNK_LIBRARY.map((c) => [c.id, c]),
);
