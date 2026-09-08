import assert from 'node:assert/strict';
import { Vector3 } from 'three';

// Exercise the registered DOM listeners, real update/action/movement lifecycle
// and generated columns. Only browser/GPU/streaming presentation is suppressed.
const events = new EventTarget();
(globalThis as any).window = events;
(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    set src(_: string) {},
  }),
};
const { GameEngine } = await import('../src/engine/GameEngine');
const { KeyboardInput } = await import('../src/engine/InputManager');
const { ServiceLadders } = await import('../src/engine/ServiceLadders');
const { generateWorld } = await import('../src/game/DungeonGenerator');
const { collectServiceLadders } = await import('../src/game/dungeon/frame-services');
const { useGameStore } = await import('../src/store/gameStore');
const world = generateWorld({ seed: 72, stack: 0, originPcx: -3, originPcz: -2 });
const ladders = collectServiceLadders(world);
assert.ok(ladders.length);
const input = new KeyboardInput();
const engine: any = Object.create(GameEngine.prototype);
const position = new Vector3();
let moverCalls = 0;
Object.assign(engine, {
  world,
  originPcx: -3,
  originPcz: -2,
  input,
  serviceLadders: new ServiceLadders(),
  editorMode: false,
  gridCamera: {
    position,
    yaw: 0,
    update() {},
    getIsPointerLocked: () => false,
    getForward: (out: Vector3) => out.set(-ladders[0]!.nx, 0, -ladders[0]!.nz),
    getRight: (out: Vector3) => out.set(ladders[0]!.nz, 0, -ladders[0]!.nx),
  },
  movers: {
    update() {},
    groundAt: () => -Infinity,
    collidesAt: () => false,
    carryVelocity: () => 0,
    interact() {
      moverCalls++;
    },
  },
  sprites: { update() {} },
  dungeonRenderer: { update() {}, updateChunks() {} },
  lighting: { update() {} },
  threeCamera: { position: new Vector3() },
  bot: { update() {}, reset() {} },
  onNotice() {},
  contours: [],
  roadsContour: null,
  pitContour: null,
  foldContour: null,
  cornerFloors: [],
  playerSpeedMultiplier: 1,
  smoothFeetY: 0,
});
for (const method of [
  'recenterWindow',
  'prefetchApproachingWindow',
  'syncGridPos',
  'updateAreaFog',
  'consumeEditorTeleport',
  'consumeEditorTunables',
  'processEditorMovement',
])
  engine[method] = () => {};
const { prepareWindow } = await import('../src/game/dungeon/window-prep');
Object.assign(engine, prepareWindow(world));
engine.serviceLadders.adopt(ladders);
useGameStore.setState({ autoPlay: false });
function key(code: string, type = 'keydown', repeat = false): void {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat });
  events.dispatchEvent(event);
}
function place(l = ladders[0]!, distance = 0): void {
  for (const code of ['KeyW', 'KeyS', 'KeyF', 'Space']) key(code, 'keyup');
  engine.serviceLadders.reset();
  position.set(l.x + 504 + l.nx * distance, l.bottom, l.z + 336 + l.nz * distance);
  Object.assign(engine, {
    velX: 0,
    velZ: 0,
    vy: 0,
    mantle: null,
    mantleCooldown: 0,
    crouchAmount: 0,
    isGrounded: true,
  });
}
for (const l of ladders) {
  place(l);
  key('KeyF');
  engine.update(1 / 60);
  key('KeyF', 'keyup');
  assert.equal(engine.serviceLadders.active?.id, l.id, 'DOM F reaches ladder through real update');
  key('KeyW');
  for (let i = 0; i < 1000 && engine.serviceLadders.active; i++) engine.update(1 / 60);
  assert.equal(engine.serviceLadders.active, null, 'real update completes ascent');
  assert.equal(position.y, l.top);
  assert.equal(position.x, l.exitX + 504);
  assert.equal(position.z, l.exitZ + 336);
  key('KeyW', 'keyup');
  key('KeyF');
  engine.update(1 / 60);
  key('KeyF', 'keyup');
  assert.ok(engine.serviceLadders.active, 'DOM F mounts from upper landing');
  key('KeyS');
  for (let i = 0; i < 1000 && engine.serviceLadders.active; i++) engine.update(1 / 60);
  assert.equal(engine.serviceLadders.active, null);
  assert.equal(position.y, l.bottom);
}
assert.equal(moverCalls, 0);
console.log(
  `ladder input: ${ladders.length} generated-world DOM F/W/S ascents and descents passed (pointer unlocked)`,
);
place();
engine.editorMode = true;
key('KeyF');
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null);
assert.equal(input.consumeAction(), null, 'editor deliberately drains F');
engine.editorMode = false;
console.log('ladder input: editor F drained, no stale action on exit');
place(ladders[0]!, 2);
key('KeyW');
for (let i = 0; i < 60 && !engine.serviceLadders.active; i++) engine.update(1 / 60);
assert.ok(
  engine.serviceLadders.active,
  'walking toward a reachable ladder with W must engage climbing',
);
assert.ok(position.y > ladders[0]!.bottom, 'W approach climbs, not merely attaches');
console.log('ladder input: real W approach attaches and climbs');
key('KeyF');
engine.update(1 / 60);
key('KeyF', 'keyup');
assert.equal(engine.serviceLadders.active, null, 'F releases while W remains held');
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null, 'held W must not immediately undo F release');
console.log('ladder input: F release survives held W');
place();
engine.update(1 / 60);
key('KeyW');
key('KeyF');
engine.update(1 / 60);
assert.ok(
  engine.serviceLadders.active,
  'simultaneous W and F mounts once, not auto-mount then F-detach',
);
console.log('ladder input: simultaneous W/F mounts once');
key('KeyF', 'keyup');
key('Space');
engine.update(1 / 60);
key('Space', 'keyup');
assert.equal(engine.serviceLadders.active, null, 'Space releases');
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null, 'held W must not immediately undo Space release');
console.log('ladder input: Space release survives held W');
place();
engine.update(1 / 60);
const typing = new Event('keydown', { cancelable: true });
Object.assign(typing, { code: 'KeyF', repeat: false });
Object.defineProperty(typing, 'target', { value: { tagName: 'INPUT' } });
events.dispatchEvent(typing);
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null, 'typing F in a focused input must not interact');
assert.equal(typing.defaultPrevented, false, 'typing must not be prevented');
console.log('ladder input: focused text input does not consume F');
place();
engine.update(1 / 60);
useGameStore.setState({ autoPlay: true });
key('KeyW');
key('KeyF');
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null, 'auto-play skips ladders even with physical W/F');
assert.equal(moverCalls, 1, 'auto-play F retains elevator fallback');
useGameStore.setState({ autoPlay: false });
place();
input.setMovementOverride(1, 0);
engine.update(1 / 60);
assert.equal(engine.serviceLadders.active, null, 'virtual bot movement never acquires ladder');
input.clearMovementOverride();
place();
engine.update(1 / 60);
key('KeyF');
engine.update(1 / 60);
key('KeyF', 'keydown', true);
engine.update(1 / 60);
assert.ok(engine.serviceLadders.active, 'F key repeat must not toggle off');
assert.equal(input.consumeAction(), null, 'normal update drains all dispatched F actions');
console.log('ladder input: bot exclusion, elevator fallback and F repeat passed');
input.dispose();
