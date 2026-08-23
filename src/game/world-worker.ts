// The chunked pipeline (milestone B): bit-identical to the legacy
// generateWorld (tools/verify-migration.ts is the proof), but the
// layer grids persist across requests in this worker — a recenter
// only generates the chunks the previous windows didn't cover
// (~3-4x faster warm), and a revisited window is nearly free.
import { generateWorldChunked, resetGenState, type GenResetLevel } from './gen/assemble';
import { applyTunables, type Tunables } from './dungeon/tunables';
import { prepareWindow } from './dungeon/window-prep';

export interface WorldWorkerRequest {
  key: string;
  seed: number;
  stack: number;
  originPcx: number;
  originPcz: number;
  /** SHIP-ON-DEMAND: generate-only requests park the finished window
   *  in this worker's cache and post a tiny `ready` notice; only
   *  `deliver` requests ship the payload (prep, then world) — the main
   *  thread pays the structured-clone cost (~20-30 ms) for the window
   *  it is actually walking into, not for every prefetched neighbour. */
  deliver?: boolean;
}

/** E3: push new generation tunables; the worker drops every cached
 *  chunk (mixed-config chunks side by side would be a seam machine). */
export interface TunablesMessage {
  type: 'tunables';
  values: Partial<Tunables>;
  /** Shallowest dirty layer — everything above stays cached */
  resetFrom: GenResetLevel;
}

/** Finished windows parked worker-side until delivery is requested */
const READY_MAX = 12;
const ready = new Map<string, { world: ReturnType<typeof generateWorldChunked>; prep: ReturnType<typeof prepareWindow>; generationMs: number }>();

function deliver(key: string): void {
  const entry = ready.get(key);
  if (!entry) return;
  // TWO messages: the main thread deserializes each in its own task
  // (~half the hitch each). Prep FIRST so it is already cached when the
  // world lands (adoption never has to build it synchronously).
  self.postMessage({ key, prep: entry.prep });
  self.postMessage({ key, world: entry.world, generationMs: entry.generationMs });
}

self.onmessage = (event: MessageEvent<WorldWorkerRequest | TunablesMessage>) => {
  if ('type' in event.data && event.data.type === 'tunables') {
    applyTunables(event.data.values);
    resetGenState(event.data.resetFrom);
    ready.clear();
    return;
  }
  const request = event.data as WorldWorkerRequest;
  if (!ready.has(request.key)) {
    const started = performance.now();
    const world = generateWorldChunked(request);
    // Contours/corner fields built here too — the adoption frame on the
    // main thread only adopts
    const prep = prepareWindow(world);
    ready.delete(request.key);
    ready.set(request.key, { world, prep, generationMs: performance.now() - started });
    while (ready.size > READY_MAX) {
      const oldest = ready.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      ready.delete(oldest);
    }
  }
  if (request.deliver) deliver(request.key);
  else self.postMessage({ key: request.key, ready: true, generationMs: ready.get(request.key)!.generationMs });
};
