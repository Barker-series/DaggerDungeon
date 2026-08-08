# Persistence design — world staying power without the rot

Bethesda's save system exists for a real reason: what you do to the
world must have staying power. Kill a raider camp, it stays dead (for
a while); drop a sword, it's there tomorrow; build a base, it's yours.
Their change-form model — per-entity diffs against plugin-defined base
state — is the CORRECT SHAPE for this. It rotted because of four
implementation sins, not because the idea was wrong:

1. IDs relative to load order (reorder plugins → corruption).
2. Serializing engine runtime (Papyrus VM, suspended call stacks,
   orphaned script instances) instead of semantic facts.
3. No workable compaction/GC (persistence leaks compound forever).
4. Streaming parameters baked into saves (uGrids).

We must solve the same problem — loot, kills, base building all need
to survive reload — and our deterministic world gives us a cleaner
substrate than they ever had.

## The central idea: THE SAVE IS A PATCH LAYER

A Bethesda save is, morally, a personal ESP: a set of records that
override the masters. They implemented it as an engine snapshot; we
implement it as what it morally is. The F4 patch layer (hand-authored
overrides applied over generation, keyed by stable IDs) and the save
system are THE SAME MECHANISM with different authors:

    generated baseline (pure fn of seed + generator version)
      ← dev patch layer     (authored at dev time — set-pieces)
      ← save delta layer    (authored at run time — by playing)

Both are sparse top layers the assembler/spawner reads per cell. One
pipeline, one override semantics, one debugging story (the DaggerKit
editor inspects both). Base building is literally "the player authors
patch records at runtime."

## The delta record model

Deltas are stored PER ABSOLUTE CELL (pillar cell — same key as
everything else), each stamped with the generator version that
produced its baseline. Three record kinds only:

- **Tombstones** — "generated ref X is gone" (killed enemy, harvested
  node, taken loot item). A RefID plus an optional EXPIRY (game-clock
  time). Bytes each.
- **State overrides** — "generated ref X is in state S" (door open,
  container inventory after looting, switch thrown, boss defeated
  flag). RefID → small typed struct. Facts, never behavior.
- **Additions** — new entities that don't exist in the baseline:
  player-dropped items, placed structures, base building. Each is
  (saveRefID, archetypeID from the F1 registry, world transform,
  params). Save-owned IDs come from a monotonic counter in the save —
  a namespace fully separate from generated RefIDs, so they can never
  collide and never depend on generation.

What is NEVER stored: script/AI execution state, anything
window-local, anything derived (render state, pathfields), any
streaming parameter. AI and behavior re-derive from facts on load —
a dead raider is a tombstone plus optionally a corpse-prop addition,
not a serialized actor.

## Staying power is a POLICY, evaluated lazily

Bethesda's cell-reset timer (~30 in-game days) is the right idea:
staying power with eventual renewal, tuned per thing. Ours is data on
the delta and the archetype, not engine machinery:

- Permanent kills / story flags: tombstone with no expiry.
- Respawning enemies / restocking loot: tombstone with expiry;
  archetypes declare their policy via registry keywords
  (`respawn:30d`, `restock:7d`, `permanent`).
- Dropped items: additions, permanent by default (see SAFE STORAGE).

## SAFE STORAGE — player intent is inviolable

Bethesda trained players to fear the world: most containers respawn on
the cell-reset timer and EAT anything stored in them; only specific
"safe" containers (player homes) keep your stuff, and nothing in-game
tells you which is which. Wiki-checking whether a barrel will delete
your inventory is a trust failure we will not reproduce.

THE RULE: the system never removes anything the player deliberately
placed. Only the player (or another agent acting visibly in-world —
never a timer, never a reset, never a generator upgrade eating it
silently) removes player property. Concretely:

- **Player taint suspends world policy.** The moment a player deposits
  an item into ANY generated container, that container's state
  override gains a `playerOwned` flag: its restock/reset policy is
  suspended entirely — the container itself is now exempt from expiry,
  and so is everything in it, world-stock included. Every container in
  the world is a safe container the moment you use it as one.
- **Placed = permanent.** Player-placed and player-dropped items are
  additions with NO expiry by default. If a discard/decay mechanic is
  ever wanted (trash), it must be an explicit opt-in act (a bin, a
  "destroy" verb), never ambient cleanup of things lying where the
  player left them.
- **Upgrades honor the taint.** The generator-upgrade re-anchor rules
  treat player-owned containers and their contents like additions:
  re-anchor or refund-with-notice, never silent loss. If a generated
  container ref fails validation entirely (the alcove it sat in no
  longer exists), its player-owned contents are preserved and
  delivered back (reclaim chest / spawn at the player), not dropped
  with the tombstones.
- **Cost honesty**: this makes some world containers permanent save
  records. That is exactly the bounded cost we accept — one small LWW
  record per container the player actually used, versus Bethesda's
  everything-persistent settlements. The budget is player attention,
  which is naturally bounded.

Evaluation is LAZY: when a cell's content spawns (cell becomes
active), compare each delta's expiry against the game clock and drop
expired records. No background simulation, no ticking, no cost for
the 10,000 cells you're not standing in. Expired records are also
dropped at compaction, so renewal doubles as garbage collection.

## Bounded growth (the anti-bloat contract)

- Per-cell, last-write-wins by RefID: looting the same container 50
  times is ONE state override. Compaction is trivial by construction.
- Journal between saves for crash-safety (append-only, cheap), folded
  into the per-cell LWW store at save points / visibilitychange.
  Growth is O(modified world), never O(playtime) — the exact inverse
  of Papyrus.
- Additions are data records (archetype + transform + params), not
  engine refs with attached scripts. A 500-piece base is ~tens of KB.
  A per-cell build budget (also good for gameplay/perf) puts a hard
  ceiling on it.
- Nothing in the save can "leak": there are no references FROM the
  save INTO runtime objects, only IDs resolved at spawn time. An
  unresolvable ID is handled (below), never a crash and never a
  zombie record that keeps something alive.

## Generator upgrades (the NMS planet-moved problem)

Deltas outlive their baseline; generation code changes. Rules:

- Every cell-delta is stamped with the generator version. On load
  with a newer generator, each cell runs VALIDATION: does each RefID
  still resolve, and does its archetype still match?
- Tombstones/overrides that fail validation are DROPPED silently —
  worst case an enemy returns or a door re-closes. Annoying, never
  destructive.
- Additions are sacred (player labor). They live in ABSOLUTE WORLD
  COORDINATES, not relative to generated geometry, so they survive
  geometry changes. On validation, re-anchor: still supported →
  keep; floating/buried under new geometry → relocate to nearest
  valid support or refund materials with a notice. NEVER silently
  bury or delete player-built things.
- Per-version migration functions when a change is big enough to
  warrant them (the Minecraft DataVersion pattern). The
  verify-migration harness discipline extends here: a generator
  change that breaks RefID stability for existing cells must be a
  DELIBERATE version bump, caught by a RefID-stability check across
  versions, never an accident.

## Storage (web platform)

OPFS (sync access handles in a worker) for per-cell delta files;
IndexedDB acceptable alternative. navigator.storage.persist() +
estimate() checked; save on visibilitychange (not beforeunload);
a tiny localStorage emergency slot; always offer file export/import —
browser storage is borrowed. Deltas-only saves stay small enough for
platform cloud-save mirroring.

## Dependencies and sequencing

This design consumes: F1 (registry — archetypes + policy keywords),
F2 (deterministic RefIDs — the load-bearing prerequisite), F4 (patch
layer — the application mechanism; the save is its second author).
It should be built AFTER those exist and WHEN gameplay needs it
(loot/enemies/building are not yet in the game). Until then this doc
is the law: any feature that wants to remember something does it as
a delta record against a stable ID, or it doesn't ship.
