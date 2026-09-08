import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

assert.ok(
  existsSync(new URL('../src/engine/ServiceLadders.ts', import.meta.url)),
  'service ladder controller must exist',
);
const { ServiceLadders } = await import('../src/engine/ServiceLadders');
const ladder = {
  id: 'service:-2,-1:3',
  x: -238.5,
  z: -98.25,
  bottom: 18.5,
  top: 27.5,
  nx: 0,
  nz: 1,
  exitX: -238.5,
  exitZ: -100.5,
};
const controller = new ServiceLadders();
controller.adopt([ladder]);
const pos = { x: ladder.x, y: ladder.bottom, z: ladder.z + 1 };
assert.equal(
  controller.interact(pos, () => true),
  true,
  'F mounts a reachable ladder',
);
assert.equal(controller.active?.id, ladder.id);
assert.equal(pos.z, ladder.z);
console.log('service ladders: reachable F mount passed');
assert.equal(
  controller.interact(pos, () => true),
  true,
  'F detaches without reattaching',
);
assert.equal(controller.active, null, 'F releases grip');
controller.interact(pos, () => true);
controller.step(pos, 1, false, 0.1, () => true);
assert.ok(pos.y > ladder.bottom, 'W ascends');
const raised = pos.y;
controller.step(pos, -1, false, 0.05, () => true);
assert.ok(pos.y < raised, 'S descends');
controller.step(pos, 0, true, 0.1, () => true);
assert.equal(controller.active, null, 'Space releases grip');
controller.interact(pos, () => true);
for (let i = 0; i < 100 && controller.active; i++) controller.step(pos, 1, false, 0.1, () => true);
assert.equal(controller.active, null, 'ascending completes top dismount');
assert.equal(pos.y, ladder.top);
assert.equal(pos.z, ladder.exitZ);
assert.equal(
  controller.interact(pos, () => true),
  true,
  'mount from upper shelf',
);
for (let i = 0; i < 100 && controller.active; i++) controller.step(pos, -1, false, 0.1, () => true);
assert.equal(pos.y, ladder.bottom);
assert.equal(controller.active, null, 'bottom dismount');
controller.interact(pos, () => true);
controller.adopt([{ ...ladder }]);
assert.equal(controller.active?.id, ladder.id, 'adoption retains stable absolute ID');
controller.adopt([]);
assert.equal(controller.active, null, 'missing ladder releases grip');
controller.adopt([ladder]);
controller.interact(pos, () => true);
controller.reset();
assert.equal(controller.active, null, 'lifecycle reset releases grip');
console.log('service ladders: controls, both landings, adoption and reset passed');

Object.assign(pos, { x: ladder.x, y: ladder.bottom, z: ladder.z + 1 });
assert.equal(
  controller.interact(pos, () => false),
  false,
  'blocked mount target',
);
assert.equal(
  controller.interact(pos, (p) => Math.abs(p.z - (ladder.z + 0.5)) > 0.15),
  false,
  'mount sweep cannot cross a wall',
);
assert.equal(pos.z, ladder.z + 1, 'blocked mount is atomic');
controller.interact(pos, () => true);
controller.step(pos, 1, false, 5, (p) => !(p.y > 20 && p.y < 21));
assert.ok(pos.y <= 20, 'large dt cannot tunnel through overhead slab');
controller.reset();
Object.assign(pos, { x: ladder.x, y: ladder.top, z: ladder.z });
controller.interact(pos, () => true);
controller.step(pos, 1, false, 0.1, () => true);
controller.step(pos, 1, false, 5, (p) => Math.abs(p.z - (ladder.z - 1)) > 0.2);
assert.ok(pos.z > ladder.z - 1, 'dismount sweep cannot tunnel through wall');
console.log('service ladders: blocked target, mount sweep, climb sweep and dismount sweep passed');

const module = await import('../src/engine/ServiceLadders');
assert.equal(
  typeof module.serviceBodyClear,
  'function',
  'explicit-feet column body clearance is required',
);
const { serviceBodyClear } = module;
assert.equal(
  serviceBodyClear({ x: 1.5, y: 2, z: 1.5 }, () => [{ floor: 0, ceil: 3.7 }]),
  false,
  'standing head cannot enter ceiling',
);
assert.equal(
  serviceBodyClear({ x: 2.8, y: 0, z: 1.5 }, (x: number) =>
    x === 0 ? [{ floor: 0, ceil: 10 }] : [],
  ),
  false,
  'body radius blocks adjacent wall',
);
assert.equal(
  serviceBodyClear({ x: 1.5, y: 0, z: 1.5 }, () => undefined),
  false,
  'unloaded columns are solid',
);
const { createFramePlan, createFrameSpec, frameBuildingAir } =
  await import('../src/game/dungeon/frame-building');
const { collectServiceLadders } = await import('../src/game/dungeon/frame-services');
let routes = 0;
for (const industrial of [false, true])
  for (const rotation of [0, 1, 2, 3]) {
    const plan = createFramePlan(90, 18, rotation, industrial);
    const spec = createFrameSpec(plan, -2, -1);
    const world = { pillars: new Map([['p', spec]]) } as import('../src/game/types').WorldData;
    const ladders = collectServiceLadders(world);
    const clear = (p: import('../src/engine/ServiceLadders').LadderPosition) =>
      serviceBodyClear(p, (tx: number, tz: number) => {
        let x = tx - spec.acx * 56,
          z = tz - spec.acz * 56;
        for (let i = 0; i < (4 - rotation) % 4; i++) [x, z] = [55 - z, x];
        return frameBuildingAir(plan, x, z).map(([floor, ceil]) => ({ floor, ceil }));
      });
    for (const l of ladders) {
      const c = new ServiceLadders();
      c.adopt(ladders);
      const p = { x: l.x + l.nx * 0.8, y: l.bottom, z: l.z + l.nz * 0.8 };
      assert.ok(
        c.approach(p, { x: -l.nx, z: -l.nz }, true, clear),
        `${l.id}/${rotation}: forward approach mounts`,
      );
      c.reset();
      assert.ok(c.interact(p, clear), `${l.id}/${rotation}: lower mount`);
      for (let i = 0; i < 300 && c.active; i++) c.step(p, 1, false, 0.1, clear);
      assert.equal(c.active, null, `${l.id}/${rotation}: climb/top dismount over real slab`);
      assert.equal(p.y, l.top);
      assert.equal(p.x, l.exitX);
      assert.equal(p.z, l.exitZ);
      assert.ok(c.interact(p, clear), `${l.id}/${rotation}: upper mount`);
      for (let i = 0; i < 300 && c.active; i++) c.step(p, -1, false, 0.1, clear);
      assert.equal(c.active, null);
      assert.equal(p.y, l.bottom);
      routes++;
    }
  }
assert.ok(routes > 0);
console.log(
  `service ladders: ${routes} generated routes, all rotations, both building families, full ascent/descent passed`,
);

// Exercise the real engine methods without constructing a GPU renderer.
(globalThis as any).document = {
  createElementNS: () => ({
    addEventListener() {},
    removeEventListener() {},
    set src(_: string) {},
  }),
};
const { GameEngine } = await import('../src/engine/GameEngine');
const { KeyboardInput } = await import('../src/engine/InputManager');
const { useGameStore } = await import('../src/store/gameStore');
(globalThis as any).window ??= { addEventListener() {}, removeEventListener() {} };
const engine: any = Object.create(GameEngine.prototype);
const input = new KeyboardInput();
let moverCalls = 0;
const originX = -3,
  originZ = -2;
const local = {
  x: ladder.x - originX * 168,
  y: ladder.bottom,
  z: ladder.z - originZ * 168,
  set(x: number, y: number, z: number) {
    Object.assign(this, { x, y, z });
  },
};
Object.assign(engine, {
  world: {
    levels: [{ width: 224 }],
    columns: Array.from({ length: 224 * 224 }, () => [{ floor: 0, ceil: 100 }]),
  },
  originPcx: originX,
  originPcz: originZ,
  serviceLadders: new ServiceLadders(),
  input,
  gridCamera: {
    position: local,
    setPosition: (x: number, y: number, z: number) => local.set(x, y, z),
  },
  movers: {
    interact() {
      moverCalls++;
    },
  },
  onNotice() {},
  velX: 8,
  velZ: 5,
  vy: -5,
  mantle: {},
  mantleCooldown: 0,
  isGrounded: true,
});
engine.serviceLadders.adopt([ladder]);
engine.processAction('interact');
assert.equal(
  engine.serviceLadders.active?.id,
  ladder.id,
  'engine F mounts before mover interaction',
);
assert.equal(moverCalls, 0);
assert.equal(engine.mantle, null);
assert.equal(engine.velX, 0);
assert.equal(engine.vy, 0);
(input as any).keysDown.add('KeyW');
engine.processMovement(0.1);
assert.ok(local.y > ladder.bottom, 'engine W owns movement before mantle/gravity');
const absoluteX = local.x + engine.originPcx * 168;
engine.originPcx++;
local.x -= 168;
engine.serviceLadders.adopt([{ ...ladder }]);
engine.processMovement(0.1);
assert.equal(
  local.x + engine.originPcx * 168,
  absoluteX,
  'recenter preserves absolute climb center',
);
(input as any).keysDown.add('Space');
engine.processMovement(0.1);
assert.equal(engine.serviceLadders.active, null, 'engine Space detaches');
(input as any).keysDown.clear();
engine.processAction('interact');
engine.processAction('interact');
assert.equal(engine.serviceLadders.active, null, 'engine F detaches');
assert.equal(moverCalls, 0, 'detach must not also activate elevator');
useGameStore.setState({ autoPlay: true });
engine.processAction('interact');
assert.equal(engine.serviceLadders.active, null, 'bot skips optional ladders');
assert.equal(moverCalls, 1, 'bot retains elevator interaction');
useGameStore.setState({ autoPlay: false });
engine.processAction('interact');
(globalThis as any).requestAnimationFrame = () => 1;
engine.start();
assert.equal(engine.serviceLadders.active, null, 'start resets ladder state');
engine.processAction('interact');
engine.seed = 72;
engine.consumeEditorTeleport({
  editorTeleport: JSON.stringify({
    x: local.x,
    y: 40,
    z: local.z,
    opx: engine.originPcx,
    opz: engine.originPcz,
  }),
  currentFloor: 0,
  requestEditorTeleport() {},
});
assert.equal(engine.serviceLadders.active, null, 'editor teleport resets ladder state');
input.dispose();
console.log(
  'service ladders: engine F/W/Space, mover priority, bot skip, recenter, start/editor reset passed',
);

// A blocked exit must remain escapable with S, not force F/falling.
controller.reset();
Object.assign(pos, { x: ladder.x, y: ladder.top, z: ladder.z });
controller.interact(pos, () => true);
controller.step(pos, 1, false, 0.1, () => true);
controller.step(pos, 1, false, 0.1, () => true);
for (let i = 0; i < 10; i++) controller.step(pos, -1, false, 0.1, () => true);
assert.ok(pos.y < ladder.top, 'S reverses an in-progress top dismount safely');
console.log('service ladders: reversible top dismount passed');

const { generateWorld } = await import('../src/game/DungeonGenerator');
const generated = generateWorld({ seed: 72, stack: 0, originPcx: -3, originPcz: -2 });
const generatedLadders = collectServiceLadders(generated);
assert.ok(generatedLadders.length > 0, 'integration seed must contain service ladders');
engine.world = generated;
engine.originPcx = -3;
engine.originPcz = -2;
engine.serviceLadders.adopt(generatedLadders);
for (const l of generatedLadders) {
  local.set(l.x + 3 * 168, l.bottom, l.z + 2 * 168);
  engine.processAction('interact');
  assert.equal(engine.serviceLadders.active?.id, l.id, 'full world columns permit mounting');
  (input as any).keysDown.add('KeyW');
  for (let i = 0; i < 300 && engine.serviceLadders.active; i++) engine.processMovement(0.1);
  assert.equal(engine.serviceLadders.active, null, 'full world engine top dismount');
  assert.equal(local.y, l.top);
  assert.equal(local.z, l.exitZ + 2 * 168);
  (input as any).keysDown.clear();
  engine.processAction('interact');
  assert.ok(engine.serviceLadders.active);
  (input as any).keysDown.add('KeyS');
  for (let i = 0; i < 300 && engine.serviceLadders.active; i++) engine.processMovement(0.1);
  assert.equal(engine.serviceLadders.active, null);
  assert.equal(local.y, l.bottom);
  (input as any).keysDown.clear();
}
console.log(
  `service ladders: ${generatedLadders.length} full generated-world engine ascents/descents passed`,
);
// Real teleport/respawn methods, with only world rebuild/rendering suppressed.
engine.cornerFloors = [Array.from({ length: 225 }, () => Array(225).fill(0))];
engine.bot = { reset() {} };
engine.buildWindow = () => {};
engine.processAction('interact');
assert.ok(engine.serviceLadders.active);
engine.respawn();
assert.equal(engine.serviceLadders.active, null, 'respawn resets ladder');
assert.equal(engine.originPcx, 0);
assert.equal(engine.originPcz, 0);
engine.serviceLadders.active = { id: generatedLadders[0]!.id, phase: 'climbing' };
engine.teleport(20, 20, undefined, 0);
assert.equal(engine.serviceLadders.active, null, 'debug teleport resets ladder');
engine.serviceLadders.active = { id: generatedLadders[0]!.id, phase: 'climbing' };
for (const name of ['worldCache', 'prepCache', 'pendingWorlds', 'readyInWorker', 'pendingDeliver'])
  engine[name] = new Map();
engine.gridCamera.setFacingDirection = () => {};
engine.loadStack(0, 72);
assert.equal(engine.serviceLadders.active, null, 'new run resets ladder');
console.log('service ladders: respawn, debug teleport and new-run reset passed');
