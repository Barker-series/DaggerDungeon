/**
 * Milestone B bit-identity harness — the legacy window pipeline and the
 * chunked per-layer pipeline must produce IDENTICAL WorldData for the
 * same (seed, stack, origin). Any divergence is a migration bug: a
 * padding smaller than an effect distance, an iteration-order
 * dependency, or a frame-translation mistake.
 *
 *   npx tsx tools/verify-migration.ts [seed ...]
 *
 * Exercises several origins per seed INCLUDING repeat visits, so the
 * chunk cache path (warm chunks reused across windows) is proven
 * identical too, not just the cold path.
 */

/* eslint-disable no-console */
import { generateWorld } from '../src/game/DungeonGenerator';
import { generateWorldChunked, chunkedStateSize } from '../src/game/gen/assemble';
import type { WorldData } from '../src/game/types';

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SEEDS = seeds.length > 0 ? seeds : [1, 42, 1234, 1785958682363];
const ORIGINS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0], [-2, 3]];

function canon(w: WorldData): string {
  // JSON with stable key order per object shape; Maps serialized as
  // sorted entries. Sets/Maps inside WorldData: pillars is a Map.
  return JSON.stringify(w, (key, value: unknown) => {
    if (value instanceof Map) {
      return [...(value as Map<string, unknown>).entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
    }
    if (value instanceof Set) return [...(value as Set<unknown>)];
    return value;
  });
}

function firstDiff(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `at char ${i}: …${a.slice(Math.max(0, i - 120), i + 80)}… vs …${b.slice(Math.max(0, i - 120), i + 80)}…`;
    }
  }
  return `length ${a.length} vs ${b.length}`;
}

let failures = 0;
for (const seed of SEEDS) {
  for (const [opx, opz] of ORIGINS) {
    const t0 = performance.now();
    const legacy = generateWorld({ seed, stack: 1, originPcx: opx, originPcz: opz });
    const t1 = performance.now();
    const chunked = generateWorldChunked({ seed, stack: 1, originPcx: opx, originPcz: opz });
    const t2 = performance.now();
    const a = canon(legacy);
    const b = canon(chunked);
    const ok = a === b;
    if (!ok) failures++;
    console.log(
      `seed ${seed} origin (${opx},${opz}): ${ok ? 'IDENTICAL' : 'DIFF'} `
      + `legacy=${(t1 - t0).toFixed(0)}ms chunked=${(t2 - t1).toFixed(0)}ms `
      + `chunks=${chunkedStateSize()}`,
    );
    if (!ok) {
      console.log('  ' + firstDiff(a, b));
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} DIVERGENT windows`);
  process.exit(1);
}
console.log('\nALL WINDOWS BIT-IDENTICAL');
