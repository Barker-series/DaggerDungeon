// The chunked pipeline (milestone B): bit-identical to the legacy
// generateWorld (tools/verify-migration.ts is the proof), but the
// layer grids persist across requests in this worker — a recenter
// only generates the chunks the previous windows didn't cover
// (~3-4x faster warm), and a revisited window is nearly free.
import { generateWorldChunked, resetGenState, type GenResetLevel } from './gen/assemble';
import { applyTunables, type Tunables } from './dungeon/tunables';

export interface WorldWorkerRequest {
  key: string;
  seed: number;
  stack: number;
  originPcx: number;
  originPcz: number;
}

/** E3: push new generation tunables; the worker drops every cached
 *  chunk (mixed-config chunks side by side would be a seam machine). */
export interface TunablesMessage {
  type: 'tunables';
  values: Partial<Tunables>;
  /** Shallowest dirty layer — everything above stays cached */
  resetFrom: GenResetLevel;
}

self.onmessage = (event: MessageEvent<WorldWorkerRequest | TunablesMessage>) => {
  if ('type' in event.data && event.data.type === 'tunables') {
    applyTunables(event.data.values);
    resetGenState(event.data.resetFrom);
    return;
  }
  const request = event.data as WorldWorkerRequest;
  const started = performance.now();
  const world = generateWorldChunked(request);
  self.postMessage({
    key: request.key,
    world,
    generationMs: performance.now() - started,
  });
};
