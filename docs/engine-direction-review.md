# Engine direction review — Creation Kit lessons, three.js frameworks, Godot (Aug 2026)

Research pass requested after milestone B shipped. Three questions:
learn from Bethesda's Creation Engine/Kit, consider adopting a three.js
game framework, reconsider Godot. Full agent reports summarized here;
recommendations at the end.

## 1. Creation Engine / Creation Kit — what actually makes it work

**The one big idea: everything is a form in one flat, queryable
database.** Weapons (WEAP), NPCs (NPC_), cells (CELL), quests (QUST),
dialogue (DIAL/INFO), keywords (KYWD) — all typed records with a 32-bit
FormID (top byte = owning plugin, low 24 bits = local ID) plus a
human-readable EditorID. The Creation Kit is "just" a browser + editor
over that database; xEdit proves the database outlives the editor.

**The base/reference split.** One "10mm pistol" form; thousands of
placed references = (base form, transform, per-instance overrides).
Content authoring and content *placement* are fully separate concerns.

**Override semantics.** Plugins ship records with the same FormID to
override masters — last loaded wins. Mods, patches, and DLC are all
diffs against the shared database. This is how hand-authored content
coexists with everything else without forking anything.

**Composition machinery.** Keywords as the universal tag/query layer
(perks, crafting, radiant quest selection all query them); leveled
lists for loot/encounters; quest ALIASES filled at runtime by
condition-driven search ("nearest uncleared LocTypeRaider location") —
the radiant system is authored quest logic over procedurally selected
targets, which is natively compatible with a procedural world.

**Console culture.** Every entity addressable by ID from the in-game
console: `coc <cell>` teleport, `prid`/`moveto`, `tcl`, `help <name>`
searches the form DB live. Debug loop = teleport → inspect → tweak.

**The FO4 feel, mechanically:** landmark-driven wandering (long-range
LOD makes silhouettes readable from kilometers), POI density tuned to
~30-60s walking intervals, each POI carrying a cheap hand-placed
micro-story built from ordinary prop references, scrap economy making
all clutter meaningful, radiant errands over alias-selected locations,
persistent world state (cleared flags, dropped items) making the world
feel owned.

**Cautionary tales:** binary plugin blobs → version-control misery
(our registry must be text/JSON); streaming radius baked into saves
(uGrids save-breaking) → keep streaming params out of persistent
state; FO4 settlements making everything persistent → save bloat.

### What transfers to a seed-based world

1. **A form registry.** Authored archetypes (materials, props,
   structure archetypes, future gear/items) as typed records with
   stable IDs and keyword tags, in JSON, separate from all placement.
   The parked `blocks.ts` / `prefabs.ts` vocabulary is where this
   naturally lands when it wakes up.
2. **Deterministic reference IDs.** Anything the generator places gets
   an ID derived from (layer, absolute cell, local index) — FormIDs
   for procedural content. Enables saves, cross-references, console
   addressing, and DDSNAP-grade repro for entities, all
   regeneration-stable. Our absolute-coords discipline makes this
   nearly free.
3. **A patch layer.** Hand-authored overrides keyed by those IDs /
   absolute cells, applied after generation: set-pieces, micro-story
   prop arrangements, fixed landmarks inside the infinite world —
   the Fallout density trick without forking the generator. This is
   LayerProcGen-legal: a pure (sparse) top layer the assembler reads.
4. **Console commands.** `coc`-style teleport to absolute pillar cell
   (we have the machinery: temp top dependency = generate there,
   move focus), free camera, entity-by-ID inspection, in-game registry
   search. Extends the DDSNAP/F8 debug culture we already live by.
5. **Radiant-style selection.** When objectives exist: authored logic +
   condition queries over keyword-tagged generated locations. Never
   hardcoded placement.

## 2. Three.js frameworks — verdict: stay vanilla

The 2026 landscape: R3F/drei (dominant, but React owns the scene graph
— hostile to worker-driven chunk churn; streaming-game users drop back
to imperative escape hatches), Threlte (same + Svelte), Babylon and
PlayCanvas (full renderer swaps, only sensible greenfield), Needle
(Unity/Blender export pipeline — we have no DCC content), Rogue Engine
(closest to a Unity-over-three editor, but solo-maintainer bus-factor).
No mature Creation-Kit-like editor exists over custom three.js games,
and all scene editors assume *authored static scenes* — a generated
world gives them nothing to edit. Shipped streaming/procedural web
games are overwhelmingly vanilla three.js + custom systems; R3F
dominates websites, not games.

Frameworks solve asset pipelines, physics, animation graphs — none of
our hard problems (seams, determinism, streaming), all of which are
solved here. Cherry-pick libraries instead, when needed:
**three-mesh-bvh** (raycast perf), **koota/miniplex** (if dynamic
actors multiply), **Rapier** (only if true rigid-body dynamics ever
appear — our column/span collision is faster and more deterministic
for this world than any general-purpose engine).

## 3. Godot — verdict: no, and the reason is the web platform

Godot 2026 is much healthier than the 2025 attempt (4.3+ web export,
Jolt in core, shader baker, reliable `--headless` CLI, matured MCP
servers with runtime bridges). For a *new* modest-scope 3D web game
it's now reasonable. For this project it fails on the constraint that
matters most — we ship to a web platform:

- Payload: empty 3D web builds ~30 MB+ wasm vs our ~1-2 MB. On a
  portal, load time is retention.
- Threading needs COOP/COEP headers on the host; single-threaded
  builds put generation on the render thread — the inverse of our
  worker-lane architecture.
- Browser gets the WebGL2 Compatibility renderer only — no graphics
  win over three.js. C# doesn't export to web; the fast path is C++
  GDExtension→wasm, i.e. rewriting solved TS in C++.
- Runtime collision generation is a documented bottleneck
  (trimesh shape build ~10-20× the visual mesh cost; main-thread
  attachment throttling) — replacing a custom collision model we
  fully control with one we'd fight.
- The 2025 failure mode (editor-centric engine vs fully-procedural
  game) is a workflow mismatch that persists regardless of tooling.

Revisit only if the game ever leaves the web platform.

## 3.5 CORRECTION (user, round 2): the inspection editor

"Scene editors have nothing to edit here" was too broad. What has
nothing to edit is scene AUTHORING. What a procedural world wants — and
what nobody ships — is an INSPECTION editor: free camera detached from
player controls, jump to (seed, coords) with hot regeneration,
click-select generated geometry, import reference models for
look/scale, live-tweak generation values. Two facts make ours BETTER
than a Creation Kit render window, not lesser:

- The world is a pure function: every tweak regenerates the truth
  (milestone B made this warm/fast), where the CK edits a fragile
  baked scene (touch a ref → broken precombines).
- **Provenance selection**: because generation is deterministic and
  layered, a picked triangle can report which layer/pass/emitter
  produced it — a causal chain no baked-world editor can offer. This
  turns selection into an AI-collaboration channel: DDSNAP evolves
  from "reproduce my viewpoint" to "here is the exact artifact and
  its cause."

Research findings (Aug 2026):
- **Picking**: CPU raycast with three-mesh-bvh (v0.9.10, active;
  BVH built in workers, serialized over ArrayBuffer) + a `sourceId`
  vertex attribute tagged at emission, resolved through a per-chunk
  table to {layer, pass, cell, params}. This is the proven CAD/BIM
  pattern (ThatOpen/IFC.js "expressID"). GPU id-buffer picking is the
  fallback for 100k+ instanced props later.
- **Highlight**: overlay mesh of the picked triangle range with
  polygonOffset + Box3Helper — cheaper and more sub-object-precise
  than OutlinePass on merged geometry.
- **Param UI**: Tweakpane v4 (TS-first, imperative, presets via
  export/importState, monitors for gen timing). Regen pattern:
  debounce ~200ms + generation-epoch counter so stale worker results
  are discarded.
- **Reference import**: GLTFLoader drag-drop (steal from
  donmccurdy/three-gltf-viewer), a reference-layer group with
  TransformControls + scale readout; measurement = two picks → Line2 +
  CSS2DRenderer label.
- **Prior art** (Minecraft F3/Amidst/Chunkbase, NMS + Far Cry 5 GDC
  tooling talks, Stålberg's live tools): the proven high-value
  features are teleport-to-repro, always-on seed/coords HUD,
  toggleable debug layers (chunk borders, gen-stage visualization),
  and hot param reload. Click-to-inspect provenance is the novel part.
- LayerProcGen-legal by the docs' own rule: an editor/map view is
  simply ANOTHER TOP DEPENDENCY on the same layers (rule 7).

## 3.6 Save doctrine (the Bethesda rot postmortem)

Bethesda saves rot because they serialize ENGINE RUNTIME: change-forms
for every touched object, whole Papyrus VM state (orphaned script
instances persist forever), load-order-relative IDs (load order change
= corruption), and loaded-cell state at the current uGrids radius (a
streaming parameter baked into saves — the cardinal sin). Settlements
bloat because every placed object is a persistent ref + script state.

The spectrum of procedural games: Minecraft bakes visited chunks
(worlds grow forever, chunk corruption, generator updates make border
cliffs, but old terrain is stable + per-chunk DataVersion migration);
NMS saves only deltas/discoveries (tiny saves, but generator updates
moved planets under players' bases — deltas outlived their baseline);
Factorio stamps map-gen versions so old chunks keep old generation.

OUR RULES (design-time law, to be enforced when saves exist):
1. Save FACTS, not runtime: semantic deltas ("ref X removed", "door Y
   opened") keyed by deterministic reference IDs (phase F2). Never
   suspended execution state, never anything window-local or
   streaming-derived.
2. Journal between snapshots, periodically compact to per-chunk
   last-write-wins deltas — growth bounded by O(modified world), not
   O(playtime).
3. Stamp the GENERATOR VERSION on every save; changing generation
   under existing deltas requires an explicit migration or an
   explicit compatibility break. The verify-migration harness pattern
   generalizes: bit-identity per generator version.
4. Web storage: OPFS/IndexedDB with navigator.storage.persist(),
   save on visibilitychange, always offer file export (browser
   storage is borrowed), keep saves small enough for platform
   cloud-save mirroring.

## 3.7 Round 3 — exhaustive adopt/loot sweep (user-mandated second opinion)

A deliberately skeptical re-sweep of the 2024-2026 engine landscape
(Rogue, Needle, Wonderland, Hyperfy, iR/Ethereal, Webaverse, Polygonjs,
Voxelize, Divine Voxel Engine, noa-engine, the 2025-26 one-person
engines) confirms: **no engine migration is defensible** — the credible
ones are editor-products with authored-scene assumptions, GPL
(Hyperfy's in-world editor — study the UX, cannot take the code), or
immature/dead. Verdict unchanged on architecture.

BUT the sweep corrected the editor plan: "build from scratch" becomes
**"assemble from MIT components"** — roughly half the DaggerKit scope
is adoptable, and the fresh-code remainder is small and enumerated.

### Bill of materials (all MIT unless noted)

| Feature | Decision |
|---|---|
| Editor camera + teleport | **camera-controls** (yomotsu, v3.1) + ~100-line WASD fly shim |
| View cube / axes | **three-viewport-gizmo** (v2.2) |
| Picking merged chunks | **three-mesh-bvh** (v0.9.10; worker build via GenerateMeshBVHWorker, serialize over ArrayBuffer, lazy per-chunk near camera, dispose on unload) + fresh ~150-line triangle-range→provenance table |
| Highlight | fresh ~100 lines (overlay mesh / emissive override) |
| Gizmos | **TransformControls** (have it); optional three-pivot-controls |
| Outliner + property pane | **three-inspect** (threlte org, vanilla `createInspector`) — pin version, pre-1.0 |
| Measurement | fresh ~250 lines (CSS2DRenderer pattern; crib ThatOpen `LengthMeasurement` + Clipper source — MIT, take files not framework) |
| Param panel + presets | **Tweakpane v4 + plugin-essentials** (exportState presets, fps/graph monitors) |
| GLB reference import | GLTFLoader wiring cribbed from **three-gltf-viewer** `viewer.js` (~80 lines); **glTF-Transform** offline preprocessing |
| Undo/redo + regen plumbing | fresh ~200 lines on the three.js editor Command pattern (read `editor/js/Viewport.js` selection wiring as reference) |
| Seed map pane | fresh ~400 lines (Chunkbase UI as model; our generator already runs in JS workers) |

License traps found: Theatre.js **studio is AGPL-3.0** (core is
Apache) — do not embed; glTF-Transform-View is Blue Oak — avoid;
Hyperfy is GPL-3.0 — patterns only. Also: try **Needle Inspector**
(Chrome extension, inspects any three.js scene) as an interim tool
before E1 exists — zero-cost partial coverage today.

### rundot_template (LorenzGit) — work-project loot, license fully covered

We are Series/RUN funded — RUN-only source-available terms are cleared
for us; adopt CODE, not just patterns:

- **Dev-mode gating**: `?editor=1`-style query routes + a production
  build verifier that REJECTS dev tooling leaking into shipped builds.
  This is how DaggerKit E1 mounts (and DDSNAP-in-URL boots straight
  into editor mode at a seed+view).
- **`__gameQa`-style contract → `__ddKit`**: dev-only globalThis API
  exposing teleport/select/provenance-dump so the editor is drivable
  by automation (and by the AI agent via browser tooling) — the
  AI-collaboration loop closed from both directions.
- **`save.ts`**: versioned persistence, untrusted-field validation,
  coalesced RUN appStorage writes, non-authoritative local fallback —
  the platform storage layer of docs/persistence-design.md, prewritten
  for RUN's actual APIs.
- **`serverTime.ts`**: trusted time — respawn/expiry policies must
  never trust the user's clock; this is the fix.
- Daily-systems discipline (stable claim IDs, in-flight guards,
  atomic writes, rollback on failure) = our delta-journal write path
  in miniature; deterministic headless simulation + Playwright e2e =
  verify-world philosophy extended into the browser.

### Bonus finds beyond the editor (adopt-candidates, each ~an afternoon spike)

- **recast-navigation-js** (isaac-mason, WASM Recast/Detour +
  three helpers): tiled navmesh + tile cache with dynamic obstacles —
  structurally perfect for per-chunk worker generation; a real upgrade
  path for the auto-play bot when navigation outgrows the column walk.
- **@three.ez/instanced-mesh (InstancedMesh2)**: per-instance frustum
  culling via BVH, fast raycast, LOD, dynamic add/remove — relevant
  the day instanced-asset population starts (and it accelerates
  editor picking of props for free).
- **@takram/three-atmosphere** (three-geospatial): precomputed
  atmospheric scattering, vanilla-usable — a cheap sky upgrade with
  zero coupling to world gen.
- **meshoptimizer v1.0 clustered LOD** (+ three-nanite proof): the
  pattern to study if distant-megastructure LOD ever bottlenecks.

## 4. Decision + adoption plan

**We keep building from scratch on vanilla three.js.** The project's
stated purpose — the generator is the product, demystified — is only
served by owning the stack. What we take from this research is
Bethesda's *data model*, not anyone's engine:

- **Phase F1 — the form registry.** JSON-first typed records
  (archetype, keywords, editorID), a tiny loader, and the discipline
  that new authored content (materials, props, future items) enters
  through it. Text format, diffable, version-controllable — learning
  from the ESP binary-blob mistake.
- **Phase F2 — reference IDs.** Deterministic IDs on generator-placed
  entities; DDSNAP and the debug map learn to address them.
- **Phase F3 — the console.** `coc` (teleport to absolute pillar
  cell), `prid`-style select/inspect, registry search, free camera.
  Small, uses existing machinery, transforms troubleshooting.
- **Phase F4 — the patch layer.** Sparse hand-authored overrides by
  absolute cell/reference ID, read as a top layer at assembly.
  Micro-stories and fixed landmarks inside the endless world — the
  actual Fallout feel lever.

And the editor track (DAGGERKIT), revised after the round-2
correction — an inspection editor over the generated world, built as a
dev MODE of the game itself (a second top dependency, not an external
tool):

- **E1 — editor mode + navigation.** Toggleable dev mode: free-fly
  camera (own controller, not FlyControls momentum), always-on
  seed/coords HUD, teleport to (seed, opx/opz, xyz) — DDSNAP-string
  navigation both directions — camera bookmarks, debug layer toggles
  (chunk borders, cell grid, biome tint, column-model wireframe).
- **E2 — provenance selection.** sourceId vertex tagging at emission +
  three-mesh-bvh picking + overlay-mesh highlight; selection panel
  shows {tile, cell, chunk, layer/pass/emitter, heights, spans};
  "copy report" produces a structured DDSNAP-grade payload for AI
  collaboration. Marked-selection list persists across regens.
- **E3 — live values.** Tweakpane over generation constants with
  debounced epoch-guarded regeneration; presets saved/compared.
  (Constants need a registry pass first — ties into F1.)
- **E4 — reference layer.** GLB drag-drop import, TransformControls +
  scale readout, measurement tool, screenshots-with-annotations.
  Reference placements save to a sidecar file (they are editor data,
  never world data).
- **E5 — placement editing.** When instanced-asset population exists:
  select instance → gizmo edit → writes to the PATCH LAYER (F4) as an
  override delta, live-applied. The editor becomes the authoring
  surface for hand-placed content inside the procedural world.

The sequencing interlock: E2 wants F2's reference IDs; E5 wants F4's
patch layer; E3 wants F1's registry shape for constants. Editor
principle survives in stronger form: the game IS the editor host, and
every editor feature doubles as a debugging weapon for the generator
work that is the project's actual product.
