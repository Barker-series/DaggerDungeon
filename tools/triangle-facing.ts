/** Facing is a property of triangle winding. Smooth shading normals can point
 * away at a silhouette even when the geometric facet faces the viewer. */
export function triangleFacingNormal(t: readonly number[]): [number, number, number] {
  const ax = t[3]! - t[0]!,
    ay = t[4]! - t[1]!,
    az = t[5]! - t[2]!;
  const bx = t[6]! - t[0]!,
    by = t[7]! - t[1]!,
    bz = t[8]! - t[2]!;
  const x = ay * bz - az * by,
    y = az * bx - ax * bz,
    z = ax * by - ay * bx;
  const length = Math.hypot(x, y, z);
  return length > 0 ? [x / length, y / length, z / length] : [0, 0, 0];
}
