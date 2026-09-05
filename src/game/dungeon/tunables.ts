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
  dirties: 'tileBase' | 'transit' | 'height' | 'column' | 'render';
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
  /** 1 = presets flagged fullHeight get their TOPMOST geometry moved up
   *  to the cell CREST and (in pits) their BOTTOMMOST moved down to the
   *  pit bottom (-300); everything between is untouched */
  foldCrestToAbyss: 1,
  /** Canyon GUEST girders: fraction of canyon pit area that carries
   *  girders (low-frequency noise gate; 1 = every pit, 0 = none) */
  canyonGirderCover: 0.45,
  /** Canyon SKY girders: lattices slung high between the outer walls of
   *  canyon districts — look up and see them. Band [lo, hi] above
   *  grade, coverage gate, max distance (tiles) from an outer wall */
  canyonSkyCover: 1,
  canyonSkyLo: 100,
  canyonSkyHi: 200,
  canyonSkyReach: 0,
  // ── SILOS (the green slot: giant tanks on legs + fallen cylinders) ──
  /** Chance a dungeon cell in a silo district places one silo */
  siloDensity: 0.35,
  /** Tank radius (tiles) */
  siloRadius: 5,
  /** Standing tube height (world units) */
  siloHeight: 90,
  /** Fallen tube length (world units) — a broken segment; kept short so
   *  the whole footprint fits the generation padding (seam-free) */
  siloFallenLength: 45,
  /** Fraction of silos lying on the ground */
  siloFallenFraction: 0.3,
  /** How far a fallen tank sinks into the ground (world units) */
  siloFallenSink: 1.5,
  /** Tube wall thickness (tiles) — silos are HOLLOW concrete tubes */
  siloWall: 1.5,
  // ── Fold wall DETAIL (render-side, material only — no regen) ──
  /** 1 = fold-owned walls carry a 2D kaleidoscopic-fold panel field
   *  (grooves + bevel relief + crease shading) instead of formwork seams */
  detailOn: 1,
  /** Largest panel scale (world units, half-period of the base octave) */
  detailScale: 9,
  detailDecay: 0.5,
  detailOffset: 0.7,
  detailOctaves: 4,
  /** Groove half-width (world units) */
  detailGroove: 0.05,
  /** Bevel width (world units) over which the relief ramps */
  detailBevel: 0.2,
  /** Relief strength (bump height units) */
  detailRelief: 0.35,
  /** Groove darkening (multiplier inside a groove) */
  detailDark: 0.72,
  /** Crease darkening on the recessed side of every panel edge */
  detailCrease: 0.12,
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
  { key: 'foldPreset', label: 'preset (-1 per district, 0 city 1 girders 2 interior 3 silos)', group: 'fold', min: -1, max: 3, step: 1, dirties: 'column' },
  { key: 'foldTop', label: 'top (y)', group: 'fold', min: 10, max: 300, step: 5, dirties: 'column' },
  { key: 'foldDeep', label: 'deep (y)', group: 'fold', min: -300, max: 0, step: 5, dirties: 'column' },
  { key: 'foldCrestToAbyss', label: 'tops→crest, bottoms→pit bottom (city)', group: 'fold', min: 0, max: 1, step: 1, dirties: 'column' },
  { key: 'canyonGirderCover', label: 'canyon PIT girder coverage', group: 'fold', min: 0, max: 1, step: 0.05, dirties: 'column' },
  { key: 'canyonSkyCover', label: 'canyon SKY girder coverage', group: 'fold', min: 0, max: 1, step: 0.05, dirties: 'column' },
  { key: 'canyonSkyLo', label: 'sky girders from (y)', group: 'fold', min: 10, max: 300, step: 5, dirties: 'column' },
  { key: 'canyonSkyHi', label: 'sky girders to (y)', group: 'fold', min: 20, max: 400, step: 5, dirties: 'column' },
  { key: 'canyonSkyReach', label: 'sky girders wall reach (tiles)', group: 'fold', min: 0, max: 20, step: 1, dirties: 'column' },
  { key: 'siloDensity', label: 'silo chance per cell', group: 'silos', min: 0, max: 1, step: 0.05, dirties: 'column' },
  { key: 'siloRadius', label: 'tank radius (tiles)', group: 'silos', min: 2, max: 14, step: 0.5, dirties: 'column' },
  { key: 'siloHeight', label: 'tube height', group: 'silos', min: 20, max: 400, step: 5, dirties: 'column' },
  { key: 'siloFallenLength', label: 'fallen length (context-padded)', group: 'silos', min: 10, max: 120, step: 5, dirties: 'column' },
  { key: 'siloFallenFraction', label: 'fallen fraction', group: 'silos', min: 0, max: 1, step: 0.05, dirties: 'column' },
  { key: 'siloFallenSink', label: 'fallen sink', group: 'silos', min: 0, max: 10, step: 0.5, dirties: 'column' },
  { key: 'siloWall', label: 'tube wall thickness (tiles)', group: 'silos', min: 0.5, max: 6, step: 0.5, dirties: 'column' },
  { key: 'detailOn', label: 'fold wall detail on', group: 'detail', min: 0, max: 1, step: 1, dirties: 'render' },
  { key: 'detailScale', label: 'panel scale', group: 'detail', min: 1, max: 40, step: 0.5, dirties: 'render' },
  { key: 'detailDecay', label: 'octave decay', group: 'detail', min: 0.2, max: 0.9, step: 0.01, dirties: 'render' },
  { key: 'detailOffset', label: 'fold offset', group: 'detail', min: 0.3, max: 1.2, step: 0.01, dirties: 'render' },
  { key: 'detailOctaves', label: 'octaves', group: 'detail', min: 1, max: 8, step: 1, dirties: 'render' },
  { key: 'detailGroove', label: 'groove width', group: 'detail', min: 0, max: 0.3, step: 0.005, dirties: 'render' },
  { key: 'detailBevel', label: 'bevel width', group: 'detail', min: 0.02, max: 1, step: 0.01, dirties: 'render' },
  { key: 'detailRelief', label: 'relief', group: 'detail', min: 0, max: 2, step: 0.05, dirties: 'render' },
  { key: 'detailDark', label: 'groove darkness', group: 'detail', min: 0.3, max: 1, step: 0.01, dirties: 'render' },
  { key: 'detailCrease', label: 'crease shading', group: 'detail', min: 0, max: 0.5, step: 0.01, dirties: 'render' },
];

/** Shallowest dirty layer for a set of changed keys. */
export function dirtyLevelFor(keys: (keyof Tunables)[]): 'all' | 'tileBase' | 'transit' | 'height' | 'column' | 'render' {
  const rank = { tileBase: 0, transit: 1, height: 2, column: 3, render: 4 } as const;
  let level: 'tileBase' | 'transit' | 'height' | 'column' | 'render' | null = null;
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
