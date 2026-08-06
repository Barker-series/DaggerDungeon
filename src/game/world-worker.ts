// The chunked pipeline (milestone B): bit-identical to the legacy
// generateWorld (tools/verify-migration.ts is the proof), but the
// layer grids persist across requests in this worker — a recenter
// only generates the chunks the previous windows didn't cover
// (~3-4x faster warm), and a revisited window is nearly free.
import { generateWorldChunked } from './gen/assemble';

export interface WorldWorkerRequest {
  key: string;
  seed: number;
  stack: number;
  originPcx: number;
  originPcz: number;
}

self.onmessage = (event: MessageEvent<WorldWorkerRequest>) => {
  const request = event.data;
  const started = performance.now();
  const world = generateWorldChunked(request);
  self.postMessage({
    key: request.key,
    world,
    generationMs: performance.now() - started,
  });
};
