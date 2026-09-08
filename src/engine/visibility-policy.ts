/** Atmosphere must hide the far clip without expanding streamed geometry.
 * The four-cell window retains at least 168wu to its edge at recenter;
 * camera reach stays 160wu (build/evict budgets remain 210/260wu).
 * THREE.Fog uses smoothstep: 55..155 leaves 57.475% detail at 100wu. */
export const CAMERA_FAR = 160;
export const FOG_NEAR = 55;
export const FOG_FAR = 155;
export const FOG_DEFAULT = 0x30383b;
export const FOG_ROADS = 0x424c52;
export const FOG_EMBER = 0x49362e;
