/**
 * DaggerKit E3 — live generation tunables. The high-value generation
 * constants, gathered into ONE mutable registry the gen code reads at
 * sample time. Defaults are the shipped values (bit-identical output
 * when untouched — verify-migration proves it).
 *
 * DISCIPLINE: tunables are global generation CONFIG, not world state —
 * the same values must reach every module instance that generates
 * (main thread's legacy fallback AND the worker's chunked layers), and
 * any change must reset the worker's persistent chunk grids, or mixed-
 * config chunks would sit side by side (a seam machine). The engine's
 * setGenTunables handles both. Nothing here is ever persisted.
 *
 * This registry is also quietly the first slice of the F1 form
 * registry: named, typed, documented values with UI metadata.
 */

export interface TunableDef {
  key: keyof typeof TUNABLES;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  /** Shallowest generation layer this value dirties — regen resets it
   *  and downstream only (layers above stay cached = fast updates) */
  dirties: 'tileBase' | 'transit' | 'height' | 'column';
}

/** The live values. Gen code reads these INSIDE loops/functions (never
 *  captured at module load). */
export const TUNABLES = {
  // ── Crest field (skyline) ──
  crestBaseScale: 10,
  crestTallScale: 4,
  crestTallThreshold: 0.7,
  crestTallBoost: 4200,
  // ── Terrain ──
  floorSwellScale: 9,
  // User-tuned via DaggerKit E3 (Aug 11 2026): bigger pit features,
  // slightly wider/lower cave mouths, much airier cave carving
  pitScale: 20,
  mouthRange: 5,
  mouthRise: 13,
  // ── Cave sculpting ──
  fineThreshold: 0.19,
  // ── Transit route shaping ──
  transitNoiseWeight: 2.5,
  transitTurnPenalty: 2.0,
  transitReuseDiscount: 0.3,
  // ── Fold structures (canyon districts) ──
  /** -1 = preset per district (fold-structure DISTRICT_PRESET); 0-3 =
   *  global override: 0 city (#5), 1 girders (#6), 2 interior (#7),
   *  3 rodrigues */
  foldPreset: -1,
  foldTop: 60,
  foldDeep: -60,
};

export type Tunables = typeof TUNABLES;

export const TUNABLE_DEFS: TunableDef[] = [
  { key: 'crestBaseScale', label: 'wall height ×', group: 'crest', min: 1, max: 20, step: 0.5, dirties: 'height' },
  { key: 'crestTallScale', label: 'tall district size', group: 'crest', min: 1, max: 12, step: 0.5, dirties: 'height' },
  { key: 'crestTallThreshold', label: 'tall coverage', group: 'crest', min: 0.3, max: 0.95, step: 0.01, dirties: 'height' },
  { key: 'crestTallBoost', label: 'tall boost', group: 'crest', min: 0, max: 5000, step: 60, dirties: 'height' },
  { key: 'floorSwellScale', label: 'terrain feature size', group: 'terrain', min: 3, max: 30, step: 1, dirties: 'height' },
  { key: 'pitScale', label: 'pit feature size', group: 'terrain', min: 4, max: 40, step: 1, dirties: 'height' },
  { key: 'mouthRange', label: 'cave-mouth reach', group: 'terrain', min: 0, max: 12, step: 1, dirties: 'height' },
  { key: 'mouthRise', label: 'cave-mouth rise', group: 'terrain', min: 0, max: 48, step: 1, dirties: 'height' },
  { key: 'fineThreshold', label: 'cave carve threshold', group: 'caves', min: 0.1, max: 0.6, step: 0.01, dirties: 'tileBase' },
  { key: 'transitNoiseWeight', label: 'route wander', group: 'transit', min: 0, max: 8, step: 0.1, dirties: 'transit' },
  { key: 'transitTurnPenalty', label: 'route straightness', group: 'transit', min: 0, max: 8, step: 0.1, dirties: 'transit' },
  { key: 'transitReuseDiscount', label: 'tunnel merging', group: 'transit', min: 0.05, max: 1, step: 0.05, dirties: 'transit' },
  { key: 'foldPreset', label: 'preset (-1 per district, 0 city 1 girders 2 interior 3 rodrigues)', group: 'fold', min: -1, max: 3, step: 1, dirties: 'column' },
  { key: 'foldTop', label: 'top (y)', group: 'fold', min: 10, max: 300, step: 5, dirties: 'column' },
  { key: 'foldDeep', label: 'deep (y)', group: 'fold', min: -300, max: 0, step: 5, dirties: 'column' },
];

/** Shallowest dirty layer for a set of changed keys. */
export function dirtyLevelFor(keys: (keyof Tunables)[]): 'all' | 'tileBase' | 'transit' | 'height' | 'column' {
  const rank = { tileBase: 0, transit: 1, height: 2, column: 3 } as const;
  let level: 'tileBase' | 'transit' | 'height' | 'column' | null = null;
  for (const k of keys) {
    const def = TUNABLE_DEFS.find((d) => d.key === k);
    if (!def) return 'all';
    if (level === null || rank[def.dirties] < rank[level]) level = def.dirties;
  }
  return level ?? 'all';
}

const DEFAULTS: Tunables = { ...TUNABLES };

/** Overwrite live values (partial). Returns true if anything changed. */
export function applyTunables(values: Partial<Tunables>): boolean {
  let changed = false;
  for (const k of Object.keys(values) as (keyof Tunables)[]) {
    const v = values[k];
    if (typeof v === 'number' && Number.isFinite(v) && TUNABLES[k] !== v) {
      TUNABLES[k] = v;
      changed = true;
    }
  }
  return changed;
}

export function resetTunables(): void {
  Object.assign(TUNABLES, DEFAULTS);
}

export function tunablesSnapshot(): Tunables {
  return { ...TUNABLES };
}
