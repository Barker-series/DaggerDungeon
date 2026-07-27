import { generateWorld } from './DungeonGenerator';

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
  const world = generateWorld(request);
  self.postMessage({
    key: request.key,
    world,
    generationMs: performance.now() - started,
  });
};
