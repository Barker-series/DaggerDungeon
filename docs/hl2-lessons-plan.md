# HL2 / Portal commentary lessons → DaggerDungeon plan (Aug 2026)

The Valve commentary tracks as a vibe + systems reference. Research
distilled; user's notes from part 1 folded in. Character design note
(user): appealing, non-distracting characters when characters happen —
design in service of immersion.

## The lessons that matter most for an exploration-first procgen game

1. **Environmental readability is a MATERIAL SYSTEM (Portal).** Valve
   encodes rules in surface language: portal-able surfaces read at a
   distance by reflectivity/noise; points of interest are round in a
   square world. Procgen can't hand-fix a confusing room, so the rule
   vocabulary must be systemic: climbable vs not, traversable vs void,
   powered vs dead — carried by texture/emissive contrast. This is the
   highest-leverage lesson for us and mostly a materials/keywords task
   (F1 registry: readability keywords on archetypes).

2. **Attention funneling without NPCs ("the player will end up staring
   at a tire").** Light contrast, motion (dust/sparks/fans), geometry
   that forces sightlines (Lost Coast's ascending paths pre-frame the
   vista — our stairwells/mouths can do the same), and CABLES.

3. **Cables/wires are wayfinding AND dressing.** In Valve worlds energy
   lines literally trace switch→door. For us: a cable layer that
   routes catenary spans between anchors (wall brackets, pillar
   sockets, transit portals), preferentially ALONG routes the
   generator knows are meaningful (transit corridors, sockets, golden
   path). Static cables are pure rendering — catenary curves as
   Line2/tube geometry, zero physics — a per-chunk deterministic pass
   like every other layer. BLAME!-correct dressing that quietly points
   the way. HIGH VALUE / LOW COST — strong candidate for the next
   world-gen feature.

4. **Scale-check workflow (orange map + beauty cell).** Valve: graybox
   playtested first, art later; scale verified against the player
   camera, not the editor. Ours: our whole world IS currently graybox
   (honest position!), and DaggerKit E4 (GLB reference import) is the
   beautiful-corner tool — fly to a bookmark, drop reference models,
   dress ONE cell per biome to target quality, keep it as the art
   target. The bot doubles as Valve's playtest culture: it can
   screenshot-audit graybox cells at eye height and log where it
   stalls/faces walls (instrumented playtesting for free).

5. **Teach traversal with the grub pattern.** Introduce in safety →
   confirm → vary; gate the first instance so it can't be stumbled
   past; RE-TEACH at biome transitions (Portal 2's escape re-trains
   surface rules when the style changes — our biome borders are
   exactly that moment).

6. **Physics props are ambient TEXTURE, not simulation (Stelly:
   believability over depth).** Sound + behavior of a small prop set
   beats a huge simulated inventory. Depth over breadth.

7. **Elevators are pacing beats, not puzzles.** Playtesters expect
   elevators to obey convention (Valve cut a physics-elevator puzzle).
   Ours should stay simple and become compression chambers between
   biomes: mood, scale reveal, a breath.

## The physics plan (verified against 2026 landscape)

**Engine: Rapier (`@dimforge/rapier3d-compat`, ~500 KB gzipped), main
thread, as a subsystem BESIDE the existing controller.** Jolt is
3-4× the wasm with C++-style manual memory; cannon-es can't stack;
ammo is dead. Worker physics buys nothing here (grab latency, COOP/
COEP on the portal) — 100-500 sleeping cuboid props is <1-2 ms/step
on the main thread.

Architecture decisions (the load-bearing ones):

- **The span model stays authoritative for the PLAYER.** Rapier never
  owns player movement. Props live in Rapier; the player pushes props
  via impulses at contact (shape-cast the player AABB against
  dynamics each move) and stands on them via Rapier scene queries
  feeding the existing ground test.
- **World colliders come free from the column model**: one fixed body
  per render chunk, compound of cuboids derived from the solid
  intervals (merge adjacent spans into fat cuboids first — collider
  count matters). Built from data the gen worker already produces;
  removed with the chunk. Rapier's 2025 broad-phase rework handles
  exactly this add/remove pattern.
- **Carry is a velocity servo, not a joint** (the Source pattern):
  per step, held body's linvel = (holdPoint − pos) × k clamped, damp
  angvel, keep it DYNAMIC (it still collides, walls still block it),
  drop when the error exceeds a threshold (wedged). Throw =
  setLinvel along camera.
- **Breakables are pre-fractured swaps** (Source pattern): fracture
  bottle/crate meshes offline or lazily via three-pinata (maintained,
  MIT), pool shard bodies, spawn 8-20 with inherited+impact velocity,
  ~3 s later drop colliders, fade, free. Global shard cap ~100.
- Transfer learnings: only sync transforms of awake bodies,
  matrixAutoUpdate=false while sleeping, contact skin > 0,
  interpolate between fixed steps.

**Phase P1 — the physics playground.** A DaggerKit-adjacent dev scene
(editor command: "spawn prop set at crosshair"): Rapier world mirroring
the current window, a crate + bottle + canister archetype each with
carry/throw/break, stacking, standing-on. Goal: feel, sound hooks, and
perf numbers before any of it touches the real game loop. The prop
archetypes enter through the F1 registry from day one (props are the
first real registry content — keywords: carryable, breakable,
respawn policy).

**P2 — props in the world**: sparse deterministic placement layer
(debris near transit, canisters in machine districts), persistence via
the delta model (moved/broken props are exactly the tombstone/
addition records of docs/persistence-design.md; the crate-respawn-in-
window trick from HL2 = "must-exist" policy on quest-critical items).

**P3 — cables layer** (independent of physics, can ship before P1):
catenary spans between generated anchors along meaningful routes.
Static = pure geometry. Later: a handful of DYNAMIC hanging cables
near the player via Rapier rope joints if the vibe demands swaying.

## Order of attack (proposal)

1. **Cables layer** — highest vibe-per-effort, pure world-gen, no new
   dependencies, immediately BLAME!.
2. **P1 physics playground** — Rapier spike behind the editor.
3. **Readability material vocabulary** — with the F1 registry when it
   lands (keywords driving surface language).
4. E3/E4 (DaggerKit live params + reference import) interleaved — E4
   enables the beauty-cell workflow that everything art-side wants.

Portal-lesson debts recorded for later phases: mandatory-gate the
first ladder/mantle teach; re-teach at biome borders; bot stall
telemetry as playtest data.
