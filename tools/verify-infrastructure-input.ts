import assert from 'node:assert/strict';
import { Vector3 } from 'three';
const events = new EventTarget();
(globalThis as any).window = events;
(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    style: {},
  }),
};
(globalThis as any).self = globalThis;
const { GameEngine } = await import('../src/engine/GameEngine');
const { KeyboardInput } = await import('../src/engine/InputManager');
const { ServiceLadders } = await import('../src/engine/ServiceLadders');
const { generateWorldChunked } = await import('../src/game/gen/assemble');
const { prepareWindow } = await import('../src/game/dungeon/window-prep');
const { useGameStore } = await import('../src/store/gameStore');
const { infrastructureBaseWorld, infrastructureBodyBlocked } =
  await import('../src/game/dungeon/infrastructure-columns');
const { FoldContour } = await import('../src/game/dungeon/fold-contour');
const w = generateWorldChunked({ seed: 1234, stack: 1 });
const e: any = Object.create(GameEngine.prototype),
  input = new KeyboardInput(),
  position = new Vector3();
let hx = 0,
  hz = -1;
Object.assign(e, {
  world: w,
  originPcx: 0,
  originPcz: 0,
  input,
  serviceLadders: new ServiceLadders(),
  editorMode: false,
  gridCamera: {
    position,
    yaw: 0,
    update() {},
    getIsPointerLocked: () => false,
    getForward: (out: Vector3) => out.set(hx, 0, hz),
    getRight: (out: Vector3) => out.set(-hz, 0, hx),
  },
  movers: {
    update() {},
    groundAt: () => -Infinity,
    collidesAt: () => false,
    carryVelocity: () => 0,
    interact() {},
  },
  sprites: { update() {} },
  dungeonRenderer: { update() {}, updateChunks() {} },
  lighting: { update() {} },
  threeCamera: { position: new Vector3() },
  bot: { update() {}, reset() {} },
  onNotice() {},
  playerSpeedMultiplier: 1,
  smoothFeetY: 0,
  ...prepareWindow(w),
  foldContour: new FoldContour(infrastructureBaseWorld(w)),
});
for (const m of [
  'recenterWindow',
  'prefetchApproachingWindow',
  'syncGridPos',
  'updateAreaFog',
  'consumeEditorTeleport',
  'consumeEditorTunables',
  'processEditorMovement',
])
  e[m] = () => {};
e.serviceLadders.adopt(w.infrastructure!.ladders);
useGameStore.setState({ autoPlay: false });
const key = (code: string, type = 'keydown') => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat: false });
  events.dispatchEvent(event);
};
function reset() {
  for (const c of ['KeyW', 'KeyS', 'KeyF', 'Space']) key(c, 'keyup');
  e.serviceLadders.reset();
  Object.assign(e, {
    velX: 0,
    velZ: 0,
    vy: 0,
    mantle: null,
    mantleCooldown: 0,
    crouchAmount: 0,
    isGrounded: true,
  });
}
function walkTo(x: number, z: number, label: string) {
  key('KeyW');
  for (let i = 0; i < 1200 && Math.hypot(x - position.x, z - position.z) > 0.2; i++) {
    const d = Math.hypot(x - position.x, z - position.z);
    hx = (x - position.x) / d;
    hz = (z - position.z) / d;
    e.update(1 / 60);
  }
  key('KeyW', 'keyup');
  e.velX = e.velZ = 0;
  assert.ok(
    Math.hypot(x - position.x, z - position.z) < 0.3,
    `${label}: actual walking blocked at ${position.toArray()} target ${x},${z}`,
  );
}
let count = 0;
for (const site of w.infrastructure!.access) {
  const l = site.ladders[0]!;
  reset();
  position.set(l.x + l.nx, l.bottom, l.z + l.nz);
  hx = -l.nx;
  hz = -l.nz;
  key('KeyW');
  for (let i = 0; i < 60 && !e.serviceLadders.active; i++) e.update(1 / 60);
  assert.equal(e.serviceLadders.active?.id, l.id, 'real W approach must acquire network ladder');
  for (let i = 0; i < 5000 && e.serviceLadders.active; i++) e.update(1 / 60);
  key('KeyW', 'keyup');
  assert.equal(e.serviceLadders.active, null, 'network ladder ascent finishes');
  assert.ok(
    Math.abs(position.y - l.top) < 0.01,
    'network ladder lands at physical platform height',
  );
  const entry = site.primitives.find((p) => p.id.endsWith(':entry'))!;
  const dx = entry.b[0] - entry.a[0],
    dz = entry.b[2] - entry.a[2],
    len = Math.hypot(dx, dz);
  walkTo(entry.b[0] + (dx / len) * 1.5, entry.b[2] + (dz / len) * 1.5, 'platform to pipe mouth');
  walkTo(entry.b[0], entry.b[2], 'enter open pipe mouth');
  walkTo(entry.a[0], entry.a[2], 'follow service branch into network');
  assert.ok(position.y > l.top - 0.7, 'node junction has an actual supporting floor');
  count++;
}
reset();
const p = w.infrastructure!.primitives.find(
  (p) =>
    p.kind === 'pipe' &&
    p.innerRadius &&
    Math.abs(p.b[0] - p.a[0]) > 250 &&
    p.a[0] > 0 &&
    p.a[2] > 0,
)!;
position.set(p.a[0] + 30, p.a[1] - p.innerRadius!, p.a[2]);
walkTo(p.a[0] + 150, p.a[2], 'walk long main bore');
assert.ok(
  Math.abs(position.y - (p.a[1] - p.innerRadius!)) < 0.1,
  'main bore has continuous physical floor',
);
let links = 0;
for (const l of w.infrastructure!.ladders.filter(
  (l) => l.id.startsWith('infra:') && !l.id.includes(':access:'),
)) {
  reset();
  position.set(l.x, l.bottom, l.z);
  hx = -l.nx;
  hz = -l.nz;
  key('KeyF');
  e.update(1 / 60);
  key('KeyF', 'keyup');
  assert.equal(e.serviceLadders.active?.id, l.id, `physical link mount ${l.id}`);
  key('KeyW');
  for (let i = 0; i < 5000 && e.serviceLadders.active; i++) e.update(1 / 60);
  key('KeyW', 'keyup');
  assert.equal(e.serviceLadders.active, null, `physical link ascent ${l.id}`);
  assert.ok(Math.abs(position.y - l.top) < 0.01);
  e.update(1 / 60);
  assert.ok(Math.abs(position.y - l.top) < 0.05, `link has a real upper landing ${l.id}`);
  key('KeyF');
  e.update(1 / 60);
  key('KeyF', 'keyup');
  assert.equal(e.serviceLadders.active?.id, l.id);
  key('KeyS');
  for (let i = 0; i < 5000 && e.serviceLadders.active; i++) e.update(1 / 60);
  key('KeyS', 'keyup');
  assert.equal(e.serviceLadders.active, null, `physical link descent ${l.id}`);
  assert.ok(Math.abs(position.y - l.bottom) < 0.01);
  links++;
}
const l = w.infrastructure!.access[0]!.ladders[0]!;
reset();
position.set(l.x, l.bottom, l.z);
hx = -l.nx;
hz = -l.nz;
key('KeyF');
e.update(1 / 60);
key('KeyF', 'keyup');
key('KeyW');
for (let i = 0; i < 30; i++) e.update(1 / 60);
const abs = position.clone();
const b = generateWorldChunked({ seed: 1234, stack: 1, originPcx: -1, originPcz: -1 });
Object.assign(e, {
  world: b,
  originPcx: -1,
  originPcz: -1,
  ...prepareWindow(b),
  foldContour: new FoldContour(infrastructureBaseWorld(b)),
});
position.set(abs.x + 168, abs.y, abs.z + 168);
e.serviceLadders.adopt(b.infrastructure!.ladders);
assert.equal(
  e.serviceLadders.active?.id,
  l.id,
  'climbing ID survives a real generated-world recenter',
);
for (let i = 0; i < 5000 && e.serviceLadders.active; i++) e.update(1 / 60);
key('KeyW', 'keyup');
assert.equal(e.serviceLadders.active, null);
assert.ok(Math.abs(position.y - l.top) < 0.01);
assert.ok(Math.abs(position.x - (l.exitX + 168)) < 0.01);
assert.ok(Math.abs(position.z - (l.exitZ + 168)) < 0.01);
reset();
Object.assign(e, {
  world: w,
  originPcx: 0,
  originPcz: 0,
  ...prepareWindow(w),
  foldContour: new FoldContour(infrastructureBaseWorld(w)),
});
e.serviceLadders.adopt(w.infrastructure!.ladders);
const beamLadder = w.infrastructure!.ladders.find((l) => l.id.includes(':maintenance:'))!;
position.set(
  beamLadder.x + beamLadder.nx * 0.25,
  beamLadder.bottom,
  beamLadder.z + beamLadder.nz * 0.25,
);
position.y = e.playerGround(position.x, position.z, beamLadder.bottom + 0.1);
hx = -beamLadder.nx;
hz = -beamLadder.nz;
key('KeyW');
for (let i = 0; i < 60 && !e.serviceLadders.active; i++) e.update(1 / 60);
assert.equal(
  e.serviceLadders.active?.id,
  beamLadder.id,
  'W approach from the real walk-beam engages its ladder without F',
);
for (let i = 0; i < 1000 && e.serviceLadders.active; i++) e.update(1 / 60);
key('KeyW', 'keyup');
assert.equal(e.serviceLadders.active, null);
assert.ok(Math.abs(position.y - beamLadder.top) < 0.01);
// Thin solids also need full-footprint vertical contact: center and eight
// perimeter samples can all miss a wire crossing between them.
const wire = w.infrastructure!.primitives.find(
  (p) =>
    p.kind === 'cable' &&
    p.id.includes(':maintenance:') &&
    p.id.endsWith(':3') &&
    p.a[2] === p.b[2] &&
    p.a[0] > 30 &&
    p.a[2] > 0,
)!;
assert.ok(wire);
const wx = (wire.a[0] + wire.b[0]) / 2,
  wz = wire.a[2] + 0.12,
  wy = Math.min(wire.a[1], wire.b[1]);
assert.ok(
  e.playerGround(wx, wz, wy + 2) > wy - 0.1,
  'full player footprint must land on a thin wire between sample points',
);
reset();
position.set(wx, wy - 1.75 - 0.2, wz);
e.isGrounded = false;
e.vy = 5.6;
e.update(0.05);
assert.ok(
  !infrastructureBodyBlocked(w, position.x, position.y, position.z, 1.75, 0.35),
  'jumping must not pass the head through an off-center wire',
);
assert.equal(e.vy, 0, 'wire underside stops upward motion');
input.dispose();
console.log(
  `network input: ${count} actual W climbs, platform approaches and branch entries; ${links} riser/maintenance ladder ascents and descents; 120wu main-bore walk and mid-climb recenter passed`,
);
