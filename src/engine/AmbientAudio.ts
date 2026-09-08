import type { WorldData } from '../game/types';
import { TILE_SIZE } from '../game/types';
import { regionAtCell } from '../game/dungeon/region-layer';

export interface AmbientLocation {
  rumble: number;
  air: number;
  pipe: number;
  character: number;
}
/** Nine local tile columns only; no meshes, infrastructure scans or window-owned random seeds. */
export function sampleAmbientLocation(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  seed: number,
): AmbientLocation {
  const level = world.levels[0];
  if (!level) return { rumble: 0, air: 0, pipe: 0, character: 0 };
  const tx = Math.floor(x / TILE_SIZE),
    tz = Math.floor(z / TILE_SIZE);
  let enclosed = 0,
    samples = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const sx = tx + dx,
        sz = tz + dz;
      if (sx < 0 || sz < 0 || sx >= level.width || sz >= level.height) continue;
      const spans = world.columns[sz * level.width + sx];
      // Column spans are sorted: binary search keeps even tall structures bounded.
      let lo = 0,
        hi = spans?.length ?? 0;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spans![mid]!.floor <= y) lo = mid + 1;
        else hi = mid;
      }
      const span = spans?.[lo - 1];
      enclosed += !span || span.ceil < y ? 1 : clamp(1 - (span.ceil - y) / 32);
      samples++;
    }
  enclosed /= samples || 1;
  const ax = world.originPcx * 56 + x / TILE_SIZE,
    az = world.originPcz * 56 + z / TILE_SIZE;
  const region = regionAtCell(seed, Math.floor(ax / 14), Math.floor(az / 14));
  const machinery = region === 'machine' ? 1 : region === 'city' || region === 'roads' ? 0.6 : 0.25;
  const character = (Math.sin(ax / 73 + seed) * Math.cos(az / 91) + 1) / 2;
  const depth = clamp(-y / 180);
  return {
    rumble: 0.025 + machinery * 0.04 + enclosed * 0.045 + depth * 0.02,
    air: 0.035 + (1 - enclosed) * 0.075,
    pipe: enclosed * (0.018 + machinery * 0.018),
    character,
  };
}

/** Native WebAudio only. Four persistent filtered-noise voices, two shared original
 * buffers, no timers/oscillators/convolvers and no sources allocated during play. */
export class AmbientAudio {
  private context: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private filters: BiquadFilterNode[] = [];
  private master: GainNode | null = null;
  private paused = false;
  private hidden = false;
  private disposed = false;
  private resuming = false;
  private needsGesture = true;
  private nextSample = -Infinity;
  private nextCreak = 18;
  private settings = { ...DEFAULT_AUDIO_SETTINGS };
  private detach: (() => void) | null = null;

  constructor(
    private sample: () => AmbientLocation,
    private createContext: () => AudioContext | null = () =>
      typeof globalThis.AudioContext === 'function'
        ? new AudioContext({ latencyHint: 'playback' })
        : null,
  ) {}

  attach(canvas: HTMLCanvasElement, doc: Document = document, win: Window = window): void {
    if (this.disposed) return;
    this.detach?.();
    const pointer = (e: PointerEvent) => {
      if (e.isTrusted) this.unlock();
    };
    const keyboard = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      )
        return;
      if (/^(Key[WASDFR]|Space|ShiftLeft|ShiftRight)$/.test(e.code)) this.unlock();
    };
    const visibility = () => this.setHidden(doc.hidden);
    canvas.addEventListener('pointerdown', pointer);
    win.addEventListener('keydown', keyboard);
    doc.addEventListener('visibilitychange', visibility);
    visibility();
    this.detach = () => {
      canvas.removeEventListener('pointerdown', pointer);
      win.removeEventListener('keydown', keyboard);
      doc.removeEventListener('visibilitychange', visibility);
    };
  }

  /** Must be called synchronously from a trusted gameplay gesture. */
  unlock(): void {
    if (this.disposed || this.paused || this.hidden || this.resuming) return;
    try {
      if (!this.context) {
        this.context = this.createContext();
        if (this.context) this.build(this.context);
      }
      const ctx = this.context;
      if (!ctx) return;
      this.needsGesture = false;
      this.resuming = true;
      void ctx
        .resume()
        .then(() => {
          if (this.disposed) {
            void ctx.close().catch(() => {});
            return;
          }
          if (this.paused || this.hidden || this.needsGesture) void ctx.suspend().catch(() => {});
        })
        .catch(() => {
          this.needsGesture = true;
        })
        .finally(() => {
          this.resuming = false;
        });
    } catch {
      this.dispose();
    }
  }

  private build(ctx: AudioContext): void {
    const own = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    this.master = own(ctx.createGain());
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    let random = 0x51a7c93;
    const noise = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
    const creak = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    for (const [buffer, transient] of [
      [noise, false],
      [creak, true],
    ] as const) {
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        const t = i / (data.length - 1);
        // Fade ends to exact zero: seamless loop, slow soft metallic swell.
        const edge = Math.min(1, t * 80, (1 - t) * 80);
        data[i] =
          ((random >>> 0) / 2147483648 - 1) * edge * (transient ? Math.sin(Math.PI * t) ** 2 : 1);
      }
      data[0] = data[data.length - 1] = 0;
    }
    const types: BiquadFilterType[] = ['lowpass', 'bandpass', 'bandpass', 'bandpass'];
    const frequencies = [105, 740, 215, 470];
    for (let i = 0; i < 4; i++) {
      const source = own(ctx.createBufferSource()),
        filter = own(ctx.createBiquadFilter()),
        gain = own(ctx.createGain());
      source.buffer = i === 3 ? creak : noise;
      source.loop = true;
      filter.type = types[i]!;
      filter.frequency.value = frequencies[i]!;
      filter.Q.value = i < 2 ? 0.5 : 3;
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start(0, i === 3 ? 0 : i * 1.731);
      this.sources.push(source);
      this.filters.push(filter);
      this.gains.push(gain);
    }
    this.setVolume(this.settings.volume, this.settings.muted);
  }

  tick(seconds: number): void {
    const ctx = this.context;
    if (
      !ctx ||
      this.disposed ||
      this.paused ||
      this.hidden ||
      this.needsGesture ||
      ctx.state !== 'running' ||
      seconds < this.nextSample
    )
      return;
    this.nextSample = seconds + 0.5;
    const location = this.sample(),
      now = ctx.currentTime;
    this.gains[0]!.gain.setTargetAtTime(location.rumble, now, 2);
    this.gains[1]!.gain.setTargetAtTime(location.air * (0.85 + Math.sin(now / 13) * 0.15), now, 3);
    this.gains[2]!.gain.setTargetAtTime(location.pipe, now, 2);
    this.filters[2]!.frequency.setTargetAtTime(165 + location.character * 100, now, 4);
    // One softly gated metallic voice; large silent gaps, no catch-up bursts.
    const creaking = now >= this.nextCreak && now < this.nextCreak + 2;
    this.gains[3]!.gain.setTargetAtTime(
      creaking ? location.pipe * 0.45 : 0,
      now,
      creaking ? 0.5 : 0.8,
    );
    if (now >= this.nextCreak + 2) this.nextCreak = now + 24 + location.character * 27;
  }

  setVolume(volume: number, muted: boolean): void {
    this.settings = {
      volume: Number.isFinite(volume) ? clamp(volume) : DEFAULT_AUDIO_SETTINGS.volume,
      muted,
    };
    // Conservative fixed headroom even with every layer active and volume at 100%.
    this.master?.gain.setTargetAtTime(
      muted ? 0 : this.settings.volume * 0.6,
      this.context!.currentTime,
      0.08,
    );
  }
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.suspend();
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.suspend();
  }
  private suspend(): void {
    this.needsGesture = true;
    if (this.context && !this.disposed) void this.context.suspend().catch(() => {});
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach?.();
    this.detach = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* Already stopped */
      }
      source.buffer = null;
    }
    for (const node of this.nodes) node.disconnect();
    this.sources = [];
    this.nodes = [];
    this.gains = [];
    this.filters = [];
    this.master = null;
    if (this.context) void this.context.close().catch(() => {});
  }
}

export interface AudioSettings {
  volume: number;
  muted: boolean;
}
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { volume: 0.35, muted: false };
export const AUDIO_SETTINGS_KEY = 'dagger-dungeon-ambient-audio-v1';
const clamp = (n: number) => Math.min(1, Math.max(0, n));
export function loadAudioSettings(storage: Pick<Storage, 'getItem'>): AudioSettings {
  try {
    const saved = JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY) ?? 'null');
    return {
      volume:
        typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
          ? clamp(saved.volume)
          : DEFAULT_AUDIO_SETTINGS.volume,
      muted: typeof saved?.muted === 'boolean' ? saved.muted : false,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}
