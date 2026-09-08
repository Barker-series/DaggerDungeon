import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAMERA_FAR, FOG_DEFAULT, FOG_ROADS, FOG_EMBER } from '../src/engine/visibility-policy';
import * as lighting from '../src/engine/LightingSystem';
import { generateWorldChunked } from '../src/game/gen/assemble';
import { infrastructureColumnAt } from '../src/game/dungeon/infrastructure-columns';
import { SKY_CEIL, TILE_SIZE } from '../src/game/types';

assert.ok(
  'collectInfrastructureFixtures' in lighting,
  'long primary pipe bores need mounted lights',
);
const collect = (
  lighting as typeof lighting & {
    collectInfrastructureFixtures: (
      world: ReturnType<typeof generateWorldChunked>,
    ) => lighting.FrameFixture[];
  }
).collectInfrastructureFixtures;
const world = generateWorldChunked({ seed: 1234, stack: 1 });
const before = JSON.stringify([world.columns, world.infrastructure]);
const fixtures = collect(world);
assert.ok(fixtures.length > 0, 'real generated primary bores receive lights');
assert.deepEqual(collect(world), fixtures, 'repeat collection is deterministic');
assert.equal(new Set(fixtures.map((f) => `${f.x},${f.z},${f.ceilingY}`)).size, fixtures.length);
for (const f of fixtures) {
  assert.ok(
    f.x >= 0 &&
      f.z >= 0 &&
      f.x < world.levels[0]!.width * TILE_SIZE &&
      f.z < world.levels[0]!.height * TILE_SIZE,
  );
  assert.ok(
    infrastructureColumnAt(world, f.x, f.z)?.some((s) => s.floor < f.y && s.ceil === f.ceilingY),
  );
  assert.ok(f.ceilingY < SKY_CEIL && Math.abs(f.y - (f.ceilingY - 0.28)) < 1e-8);
  assert.ok(
    world.infrastructure!.primitives.some((p) => {
      const dx = p.b[0] - p.a[0],
        dz = p.b[2] - p.a[2];
      const length = Math.hypot(dx, dz);
      if (p.kind !== 'pipe' || !p.innerRadius || p.radius < 3 || p.a[1] !== p.b[1] || length < 100)
        return false;
      const ax = f.x + world.originPcx * 168,
        az = f.z + world.originPcz * 168;
      const d = ((ax - p.a[0]) * dx + (az - p.a[2]) * dz) / length;
      return (
        d >= 18 &&
        d < length &&
        Math.abs((d - 18) / 36 - Math.round((d - 18) / 36)) < 1e-8 &&
        Math.hypot(ax - p.a[0] - (d * dx) / length, az - p.a[2] - (d * dz) / length) < 1e-8 &&
        f.rotation === (Math.abs(dx) > Math.abs(dz) ? 1 : 0)
      );
    }),
    'each fixture comes from a complete primary run at d=18+36n',
  );
}
assert.deepEqual(
  collect({ ...world, infrastructure: undefined }),
  [],
  'legacy worlds add no fixtures',
);
assert.deepEqual(
  collect({
    ...world,
    infrastructure: {
      ...world.infrastructure!,
      primitives: [...world.infrastructure!.primitives, ...world.infrastructure!.primitives],
    },
  }),
  fixtures,
  'overlapping primitives share actual mounts',
);
assert.equal(
  JSON.stringify([world.columns, world.infrastructure]),
  before,
  'decoration never changes collision geometry',
);
// Canvas shim only: the real THREE scene, lights, matrices and setup run in Node.
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        fillStyle: '',
      }),
    }),
  },
});
const scene = new THREE.Scene();
let pointAdds = 0;
scene.addEventListener('childadded', (event) => {
  if (event.child instanceof THREE.PointLight) pointAdds++;
});
const system = new lighting.LightingSystem(scene);
system.setup(world);
const frames = lighting.collectFrameFixtures(world);
const mounts = scene.children.filter(
  (o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh,
);
assert.equal(mounts.length, 1, 'all ceiling bars share exactly one instanced batch');
assert.equal(
  mounts[0]!.count,
  frames.length + fixtures.length,
  'pipe bars join existing landing batch',
);
assert.equal(
  (mounts[0]!.material as THREE.MeshBasicMaterial).color.getHex(),
  0xffd5a3,
  'existing bar color contract',
);
const matrix = new THREE.Matrix4();
for (const [i, f] of [...frames, ...fixtures].entries()) {
  mounts[0]!.getMatrixAt(i, matrix);
  const position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  matrix.decompose(position, rotation, scale);
  assert.ok(Math.abs(position.y + 0.06 - f.ceilingY) < 1e-4, 'bar top touches real ceiling');
  assert.ok(position.distanceTo(new THREE.Vector3(f.x, f.ceilingY - 0.06, f.z)) < 1e-4);
  assert.ok(scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-5, 'no stretched bars');
}
const ambient = scene.children.find(
  (o): o is THREE.AmbientLight => o instanceof THREE.AmbientLight,
)!;
const hemi = scene.children.find(
  (o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight,
)!;
assert.equal(ambient.color.getHex(), 0xdedbd2);
assert.equal(ambient.intensity, 0.4);
assert.equal(hemi.color.getHex(), 0xb7c8ce);
assert.equal(hemi.groundColor.getHex(), 0x51473a);
assert.equal(hemi.intensity, 0.42);
assert.ok(
  scene.fog instanceof THREE.Fog,
  'gradual linear fog keeps paid-for middle distance visible',
);
const fog = scene.fog as THREE.Fog;
assert.equal(fog.near, 55);
assert.equal(fog.far, 155);
assert.equal(fog.color.getHex(), 0x30383b);
assert.equal((scene.background as THREE.Color).getHex(), fog.color.getHex());
// THREE linear fog uses smoothstep, not a linear opacity interpolation.
const transmission = (d: number) => 1 - THREE.MathUtils.smoothstep(d, fog.near, fog.far);
assert.equal(transmission(55), 1);
assert.ok(transmission(100) > 0.57 && transmission(100) < 0.6);
assert.ok(transmission(130) > 0.15);
assert.equal(transmission(155), 0);
assert.equal(CAMERA_FAR, 160, 'no additional render reach');
assert.ok(
  fog.far < CAMERA_FAR && CAMERA_FAR < 168,
  'fog hides far clip inside unchanged streaming edge margin',
);
assert.deepEqual([FOG_DEFAULT, FOG_ROADS, FOG_EMBER], [0x30383b, 0x424c52, 0x49362e]);
const engineSource = readFileSync('src/engine/GameEngine.ts', 'utf8');
assert.match(engineSource, /new THREE\.PerspectiveCamera\(75, 1, 0\.1, CAMERA_FAR\)/);
assert.match(
  engineSource,
  /if \(fog\) fog\.color\.copy\(this\.fogColor\)/,
  'area fade supports both Fog and FogExp2',
);
console.log(
  'fog transmission at 100wu: old',
  Math.exp(-Math.pow(100 * 0.0132, 2)),
  'new',
  transmission(100),
);
const pool = scene.children.filter((o): o is THREE.PointLight => o instanceof THREE.PointLight);
assert.equal(pool.length, 16);
for (const f of fixtures) {
  system.update(f.x, f.y, f.z);
  assert.ok(
    pool.some(
      (p) =>
        p.position.distanceTo(new THREE.Vector3(f.x, f.y, f.z)) < 1e-6 &&
        p.color.getHex() === 0xd5e4dc &&
        p.intensity === 2.5 &&
        p.distance === 30,
    ),
    'mounted cool source receives a pooled light',
  );
  assert.ok(
    pool.every((p) => p.visible && !p.castShadow),
    'fixed visible shadowless pool',
  );
}
for (let i = 0; i < 3; i++) {
  system.clear();
  assert.equal(scene.children.filter((o) => o instanceof THREE.PointLight).length, 16);
  assert.equal(scene.children.filter((o) => o instanceof THREE.InstancedMesh).length, 0);
  system.setup(world);
  assert.equal(scene.children.filter((o) => o instanceof THREE.InstancedMesh).length, 1);
  assert.ok(
    pool.every((p) => scene.children.includes(p)),
    'streaming retains identical light objects',
  );
}
assert.equal(pointAdds, 16, 'no new point lights on streaming rebuild');
system.clear();
const collectRoomLights = (
  system as unknown as {
    collectFixtures: (
      level: (typeof world.levels)[number],
    ) => { color: number; intensity: number }[];
  }
).collectFixtures.bind(system);
for (const [biome, color, intensity] of [
  ['dungeon', 0xffd6a0, 2.5],
  ['cave', 0xe6c79e, 2.1],
  ['crypt', 0xc0d2c3, 2.4],
  ['ember', 0xff9452, 3.1],
  ['outside', 0xd0deea, 2.8],
] as const) {
  const level = world.levels[0]!;
  const lights = collectRoomLights({
    ...level,
    rooms: level.rooms.map((room) => ({ ...room, doors: [room.center] })),
    cellBiomes: level.cellBiomes.map((row) => row.map(() => biome)),
  });
  assert.ok(
    lights.some((f) => f.color === color && f.intensity === intensity),
    `${biome} uses restrained industrial palette`,
  );
  assert.ok(
    lights.some((f) => f.color === 0xd4dbc6 && f.intensity === 1.7),
    'corridors use desaturated utility light',
  );
}
assert.ok(
  world.levels.flatMap(collectRoomLights).some((f) => f.color === 0xd5e4dc && f.intensity === 2.6),
  'threshold palette remains a cool wayfinding light',
);
assert.equal(JSON.stringify([world.columns, world.infrastructure]), before);
const negativeWorld = generateWorldChunked({ seed: 1234, stack: 1, originPcx: -1, originPcz: -1 });
const shiftedWorld = generateWorldChunked({ seed: 1234, stack: 1, originPcx: 0, originPcz: -1 });
function sharedAbsolute(w: typeof world): string[] {
  return collect(w)
    .map((f) => ({ ...f, x: f.x + w.originPcx * 168, z: f.z + w.originPcz * 168 }))
    .filter((f) => f.x >= 0 && f.x < 504 && f.z >= -168 && f.z < 504)
    .map((f) => JSON.stringify(f))
    .sort();
}
const shared = sharedAbsolute(negativeWorld);
assert.ok(shared.length > 0, 'negative-origin overlap actually contains mounts');
assert.deepEqual(
  sharedAbsolute(shiftedWorld),
  shared,
  'streaming preserves full absolute mount identity',
);
// Structural trim and service hardware are not primary bore lamps.
const noCeilings = {
  ...world,
  columns: world.columns.map(() => [{ floor: -1000, ceil: SKY_CEIL, owner: -1, ceilOwner: -1 }]),
  infrastructureBaseColumns: undefined,
  infrastructure: {
    ...world.infrastructure!,
    primitives: world.infrastructure!.primitives.map((p) => ({ ...p, kind: 'deck' as const })),
  },
};
assert.deepEqual(collect(noCeilings), [], 'non-pipe primitives never receive bore mounts');
console.log(
  `source lighting streaming: ${shared.length} identical mounts in overlapping negative-origin windows`,
);
console.log(
  `source lighting setup: ${frames.length + fixtures.length} bars in one batch; ${pointAdds} permanent shadowless lights across four setups; industrial ambient, hemisphere, pipe palette and fog passed`,
);
console.log(
  `source lighting collector: ${fixtures.length} real bore mounts; deterministic spacing, ceiling contact, deduplication, no-infrastructure and immutable geometry passed`,
);
