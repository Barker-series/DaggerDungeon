/**
 * A machine/service gallery with a deliberately indirect route. A low
 * dogleg enters a taller room around two equipment bays. Overhead trunks
 * connect the bays to the walls; two east-side doors share an exterior
 * service ledge so exploration can leave the room and come back in.
 *
 * Pure local AIR plan, 12 units high. Interior footprint 17..38, with a
 * two-tile-wide ledge at x39..40,z25..34 (still inside the pillar cell).
 * Undefined means unowned; [] means solid. Everything feeds the columns.
 */
export const SERVICE_GALLERY_HEIGHT = 12;

export function serviceGalleryAir(x: number, z: number): [number, number][] | undefined {
  if (x >= 39 && x <= 40 && z >= 25 && z <= 34) return [[0.5, 11]];
  if (x < 17 || x > 38 || z < 17 || z > 38) return undefined;
  if (z <= 24) {
    const entry = x <= 22 && z >= 19 && z <= 20;
    const turn = x >= 21 && x <= 22 && z >= 19;
    return entry || turn ? [[0.5, 3.5]] : [];
  }
  if (x === 17) return z === 27 || z === 28 || z === 32 || z === 33 ? [[1.75, 3.75]] : [];
  if (x === 38) return z === 25 || z === 26 || z === 33 || z === 34 ? [[0.5, 4.5]] : [];
  if (z === 38) return x >= 29 && x <= 34 ? [[1.75, 5.75]] : [];

  let air: [number, number][] = [[0.5, 11]];
  const solid = (lo: number, hi: number): void => {
    const next: [number, number][] = [];
    for (const [f, c] of air) {
      if (hi <= f || lo >= c) {
        next.push([f, c]);
        continue;
      }
      if (lo > f) next.push([f, lo]);
      if (hi < c) next.push([hi, c]);
    }
    air = next;
  };
  // Equipment housings stand on shallow plinths; clear lanes remain around
  // their sides. They are solid volumes, not props placed in walkable air.
  if (x >= 23 && x <= 29 && z <= 30) solid(0.5, 1);
  if (x >= 24 && x <= 28 && z <= 29) solid(0.5, 8);
  if (x >= 30 && x <= 33 && z >= 31 && z <= 34) solid(0.5, 6.5);
  // Rectangular service trunks, with wider collars and a branch into a bay.
  if (x === 19 || x === 20 || x === 35 || x === 36) solid(7.5, 9);
  if ((z === 27 || z === 33) && (x <= 21 || x >= 34)) solid(7, 9.5);
  if (z === 29 && x >= 21 && x <= 28) solid(7.5, 9);
  return air.filter(([f, c]) => c - f >= 1.5);
}

export const SERVICE_GALLERY_SOCKETS = [
  { x: 16, z: 16, y: 0, role: 'entry' },
  { x: 16, z: 19, y: 0.5, role: 'room' },
  { x: 19, z: 19, y: 0.5, role: 'room' },
  { x: 22, z: 28, y: 0.5, role: 'room' },
  { x: 29, z: 35, y: 0.5, role: 'room' },
  { x: 38, z: 25, y: 0.5, role: 'room' },
  { x: 40, z: 30, y: 0.5, role: 'room' },
  { x: 38, z: 34, y: 0.5, role: 'room' },
] as const;
