/** Three translated samples on a triangular partition; never rotate/scale source detail.
 * Shared RGBA taps mean albedo and relief cannot drift. CPU reference powers previews. */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 1664525) + Math.imul(y, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
export function sourceSampleTaps(u: number, v: number) {
  const x = Math.floor(u),
    y = Math.floor(v),
    f = u - x,
    g = v - y;
  const upper = f + g > 1;
  const corners = upper
    ? [
        [x + 1, y + 1],
        [x, y + 1],
        [x + 1, y],
      ]
    : [
        [x, y],
        [x + 1, y],
        [x, y + 1],
      ];
  const weights = (upper ? [f + g - 1, 1 - f, 1 - g] : [1 - f - g, f, g]).map((w) => w ** 4);
  const sum = weights.reduce((a, b) => a + b, 0);
  return corners.map(([a, b], i) => ({
    offset: [(hash(a!, b!) & 65535) / 65536, (hash(a!, b!) >>> 16) / 65536] as [number, number],
    weight: weights[i]! / sum,
  }));
}
export const SOURCE_SAMPLE_GLSL = `
vec2 sourceOffset(ivec2 p) {
  uint h = uint(p.x) * 1664525u + uint(p.y) * 1013904223u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = h ^ (h >> 13u);
  return vec2(float(h & 65535u), float(h >> 16u)) / 65536.0;
}
vec4 sourceSample(sampler2D tex, vec2 uv) {
  // Derivatives BEFORE cell selection/offsets: stable mip LOD at hash boundaries.
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  ivec2 cell = ivec2(floor(uv));
  vec2 f = fract(uv);
  ivec2 a = cell, b = cell + ivec2(1,0), c = cell + ivec2(0,1);
  vec3 w = vec3(1.0-f.x-f.y, f.x, f.y);
  if (f.x + f.y > 1.0) {
    a = cell + ivec2(1,1); b = cell + ivec2(0,1); c = cell + ivec2(1,0);
    w = vec3(f.x+f.y-1.0, 1.0-f.x, 1.0-f.y);
  }
  w *= w; w *= w; w /= w.x+w.y+w.z;
  return textureGrad(tex, uv + sourceOffset(a), dx, dy) * w.x
       + textureGrad(tex, uv + sourceOffset(b), dx, dy) * w.y
       + textureGrad(tex, uv + sourceOffset(c), dx, dy) * w.z;
}
float sourceHeight = 0.0;
`;
export const SOURCE_MAP_FRAGMENT = `#ifdef USE_MAP
  vec4 sourceTexel = sourceSample(map, vMapUv);
  diffuseColor.rgb *= sourceTexel.rgb;
  #ifdef USE_BUMPMAP
  sourceHeight = sourceTexel.a * bumpScale;
  #endif
#endif
// SOURCE_MAP_END`;
export const SOURCE_NORMAL_FRAGMENT = `#ifdef USE_BUMPMAP
  normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(sourceHeight), dFdy(sourceHeight)), faceDirection);
#else
  #include <normal_fragment_maps>
#endif`;
