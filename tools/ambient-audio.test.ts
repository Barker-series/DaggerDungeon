import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('engine and existing settings screen wire the audio lifecycle and persistent controls', () => {
  const source = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
  const engine = source('engine/GameEngine.ts'),
    screen = source('ui/GameScreen.tsx'),
    menu = source('ui/SettingsMenu.tsx');
  for (const hook of [
    'this.ambientAudio.attach(canvas)',
    'this.ambientAudio.dispose()',
    'this.ambientAudio.setPaused(paused)',
    'this.ambientAudio.tick(timestamp / 1000)',
    'setAmbientVolume',
  ])
    assert.ok(engine.includes(hook), hook);
  for (const hook of [
    'loadAudioSettings',
    'AUDIO_SETTINGS_KEY',
    'setAmbientVolume(audioSettings.volume, audioSettings.muted)',
    'onAudioVolumeChange=',
    'onAudioMutedChange=',
  ])
    assert.ok(screen.includes(hook), hook);
  assert.ok(menu.includes('aria-label="Ambient volume"'));
  assert.ok(menu.includes('aria-label="Mute ambience"'));
});
import assert from 'node:assert/strict';
import * as audio from '../src/engine/AmbientAudio';

test('spatial ambience samples bounded columns and survives recentering', () => {
  assert.equal(typeof audio.sampleAmbientLocation, 'function');
  const make = (originPcx: number, closed: boolean) => ({
    originPcx,
    originPcz: 0,
    levels: [{ width: 224, height: 224 }],
    columns: new Proxy([], {
      get: () => (closed ? [{ floor: 0, ceil: 12 }] : [{ floor: 0, ceil: 10000 }]),
    }),
  });
  const a = audio.sampleAmbientLocation(make(0, true) as any, 42, 5, 42, 123);
  const b = audio.sampleAmbientLocation(make(-1, true) as any, 210, 5, 42, 123);
  assert.deepEqual(a, b);
  const outside = audio.sampleAmbientLocation(make(0, false) as any, 42, 5, 42, 123);
  assert.ok(a.rumble > outside.rumble);
  assert.ok(a.pipe > outside.pipe);
  assert.ok(outside.air > a.air);
});

class Param {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(v: number) {
    this.value = v;
    this.targets.push(v);
  }
}
class NodeDouble {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  buffer: any;
  loop = false;
  type = '';
  stopped = false;
  disconnected = false;
  connect(n: any) {
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
  start() {}
  stop() {
    this.stopped = true;
  }
}
class ContextDouble {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new NodeDouble();
  nodes: NodeDouble[] = [];
  buffers: Float32Array[] = [];
  resumes = 0;
  suspends = 0;
  closes = 0;
  node() {
    const n = new NodeDouble();
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.node();
  }
  createBiquadFilter() {
    return this.node();
  }
  createBufferSource() {
    return this.node();
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    this.buffers.push(data);
    return { getChannelData: () => data };
  }
  async resume() {
    this.resumes++;
    this.state = 'running';
  }
  async suspend() {
    this.suspends++;
    this.state = 'suspended';
  }
  async close() {
    this.closes++;
    this.state = 'closed';
  }
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
test('persistent audio graph is gesture-gated, bounded, quiet and disposed', async () => {
  assert.equal(typeof audio.AmbientAudio, 'function');
  const ctx = new ContextDouble();
  let factories = 0,
    samples = 0;
  const a = new audio.AmbientAudio(
    () => {
      samples++;
      return { rumble: 0.08, air: 0.05, pipe: 0.02, character: 0.5 };
    },
    () => {
      factories++;
      return ctx as any;
    },
  );
  a.tick(0);
  assert.equal(factories, 0);
  a.unlock();
  await flush();
  assert.equal(ctx.resumes, 1);
  a.tick(0);
  const count = ctx.nodes.length;
  for (let i = 1; i < 1000; i++) a.tick(i / 60);
  assert.ok(samples <= 34);
  assert.equal(ctx.nodes.length, count);
  assert.ok(count <= 16);
  assert.equal(ctx.buffers.length, 2);
  for (const data of ctx.buffers) {
    let peak = 0,
      sum = 0,
      energy = 0;
    for (const v of data) {
      peak = Math.max(peak, Math.abs(v));
      sum += v;
      energy += v * v;
    }
    assert.ok(peak <= 1);
    assert.ok(Math.abs(sum / data.length) < 0.01);
    assert.ok(energy > 0);
    assert.equal(data[0], 0);
    assert.equal(data[data.length - 1], 0);
  }
  a.setVolume(0, false);
  assert.equal(ctx.nodes[0].gain.value, 0);
  a.setPaused(true);
  await flush();
  assert.equal(ctx.state, 'suspended');
  a.setPaused(false);
  await flush();
  assert.equal(ctx.state, 'suspended');
  a.unlock();
  await flush();
  assert.equal(ctx.state, 'running');
  a.setHidden(true);
  await flush();
  assert.equal(ctx.state, 'suspended');
  a.setHidden(false);
  await flush();
  assert.equal(ctx.state, 'suspended');
  a.dispose();
  a.dispose();
  await flush();
  assert.equal(ctx.closes, 1);
  assert.ok(ctx.nodes.every((n) => n.disconnected));
  a.unlock();
  assert.equal(factories, 1);
});

test('browser binding accepts only trusted gameplay input and removes every listener', async () => {
  const ctx = new ContextDouble();
  const a = new audio.AmbientAudio(
    () => ({ rumble: 0, air: 0, pipe: 0, character: 0 }),
    () => ctx as any,
  );
  const listeners = new Map<string, Function>();
  let removed = 0;
  const target = (prefix: string) => ({
    hidden: false,
    addEventListener: (key: string, fn: Function) => listeners.set(prefix + key, fn),
    removeEventListener: (key: string) => {
      listeners.delete(prefix + key);
      removed++;
    },
  });
  const canvas = target('c'),
    doc = target('d'),
    win = target('w');
  assert.equal(typeof a.attach, 'function');
  a.attach(canvas as any, doc as any, win as any);
  listeners.get('wkeydown')!({ isTrusted: true, code: 'KeyW', target: { closest: () => ({}) } });
  listeners.get('wkeydown')!({ isTrusted: false, code: 'KeyW' });
  listeners.get('wkeydown')!({ isTrusted: true, code: 'Escape' });
  assert.equal(ctx.resumes, 0);
  listeners.get('cpointerdown')!({ isTrusted: true });
  await flush();
  assert.equal(ctx.resumes, 1);
  doc.hidden = true;
  listeners.get('dvisibilitychange')!();
  await flush();
  assert.equal(ctx.state, 'suspended');
  a.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(removed, 3);
});

test('unsupported/denied audio is harmless and late resume cannot revive disposed or paused sound', async () => {
  const sample = () => ({ rumble: 0.1, air: 0.1, pipe: 0.02, character: 0.5 });
  const unsupported = new audio.AmbientAudio(sample, () => null);
  unsupported.unlock();
  unsupported.tick(0);
  unsupported.dispose();
  const denied = new ContextDouble();
  denied.resume = async () => {
    throw Error('denied');
  };
  const d = new audio.AmbientAudio(sample, () => denied as any);
  d.unlock();
  await flush();
  d.tick(0);
  d.dispose();
  for (const dispose of [true, false]) {
    const ctx = new ContextDouble();
    let finish!: () => void;
    ctx.resume = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          ctx.state = 'running';
          resolve();
        };
      });
    const a = new audio.AmbientAudio(sample, () => ctx as any);
    a.unlock();
    if (dispose) a.dispose();
    else a.setPaused(true);
    finish();
    await flush();
    assert.equal(ctx.state, dispose ? 'closed' : 'suspended');
    a.dispose();
  }
});

test('audio settings preserve explicit silence and reject invalid storage', () => {
  assert.equal(typeof audio.loadAudioSettings, 'function');
  const store = (value: string | null) => ({ getItem: () => value });
  assert.deepEqual(audio.loadAudioSettings(store('{"volume":0,"muted":true}')), {
    volume: 0,
    muted: true,
  });
  assert.deepEqual(audio.loadAudioSettings(store(null)), audio.DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(audio.loadAudioSettings(store('broken')), audio.DEFAULT_AUDIO_SETTINGS);
  assert.deepEqual(
    audio.loadAudioSettings({
      getItem: () => {
        throw Error();
      },
    }),
    audio.DEFAULT_AUDIO_SETTINGS,
  );
  assert.equal(audio.loadAudioSettings(store('{"volume":2}')).volume, 1);
});
