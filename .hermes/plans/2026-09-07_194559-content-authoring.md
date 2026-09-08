# Content Authoring Implementation Plan

**Goal:** Make ordinary content edits local, discoverable and cheaply verifiable without changing the shipped BLAME!-inspired world.

**Architecture:** Preserve LayerProcGen ownership, bounded dependencies, columns/analytic infrastructure authority and the renderer. Introduce a small typed structural-piece vocabulary and migrate the existing framed stair core as a real production user; pair it with grouped verification and a saved DDSNAP catalogue. This is an incremental authoring improvement, not an alternate generator or a new visual editor.

**Tech stack:** Existing TypeScript, tsx, Node built-ins, Three.js headless DDSNAP renderer; no new dependencies or servers.

## Baseline and scope
- Branch master, baseline commit 72e0b45; only untracked artifacts/ at start. Preserve it.
- Build, 16-seed verify-world and verify-migration passed immediately before this task. Repository-wide formatting has existing drift; format only new/scoped files.
- User explicitly requests plan AND implementation. No further commit or push is requested.
- Read README.md, docs/PLAN.md, AGENTS.md and current layer/code contracts before changes.

## 1. Validated structural pieces, integrated rather than a demo
- Create `src/game/dungeon/structure-kit.ts`: data-only typed rectangles, slabs/landings, stepped flights, openings/solids and named sockets; strict finite/bounds/dimension/role validation and deterministic local sampling.
- Create `src/game/dungeon/frame-core-plan.ts`: move the current framed stair-core layout and entry anchors into a small named plan using that kit.
- Modify `src/game/dungeon/frame-building.ts` to consume the compiled core and shared anchor definitions, retaining exact stair rises, slab thickness, roof-closed behavior, doorway clearances, output order and public APIs.
- Tests: `tools/structure-kit.test.ts`, `tools/frame-core-plan.test.ts`. RED before compiler behavior; characterize/hash current full frame outputs before integrating, then prove exact identity across dimensions, rotations, service settings, and roof closure.
- Validate all recipe dimensions at compilation time, not per-column hot loops. Do not turn every building family into this recipe or generalize world-scale pipes into local props.

## 2. Single verification and preview entry point
- Create `tools/content-workflow.ts`, a testable command catalogue/runner, plus `tools/content-workflow.test.ts`.
- Add package scripts for `content` and the workflow tests. Commands: list available groups/views, run a focused group, run the full safety suite, preview a saved named DDSNAP view, preview all saved views. Show exact underlying commands and preserve child failure statuses.
- Create `tools/content-views.json` with stable descriptive names, feature, purpose and literal DDSNAP1 strings already documented in the repository. Validate names and snapshot schema before any execution; no guessed views, credentials, downloads or browsers.
- Use local tsx via Node (no network npx). Pass argv arrays, not shell strings. Keep all generated output under artifacts/content/ and do not commit artifacts.
- Group existing checks by structures, infrastructure, materials and world; make quick authoring checks distinct from full release gates and expensive shader/environment-dependent checks.
- TDD runner behavior: selection/deduplication, unknown-name errors, malformed snapshots, exact argv, child failures and no unintended execution on import.

## 3. One current content guide
- Create `docs/CONTENT_AUTHORING.md`: start-here commands, source-of-truth ownership table, where to edit each content type, units/rotation/socket conventions, practical recipe edit walkthrough, test selection and DDSNAP troubleshooting loop.
- Link README.md, docs/PLAN.md and AGENTS.md to it; correct misleading layer/source entry descriptions relevant to the authoring path, without unrelated documentation cleanup.
- Explain what the kit currently owns, what remains procedural, how to add another recipe, and how to distinguish structural fixes from render/material fixes.
- No promises that normal-shaded previews validate textures, audio or FPS; preserve Chris's existing dev-server playtest loop.

## 4. Verification and independent review
- Exercise new unit tests and the actual CLI list, focused check, invalid input/failure behavior and named previews.
- Render at least a framed interior and service view with the actual DDSNAP renderer and inspect images. Geometry identity is the primary no-visual-change proof; report any existing auditor findings without suppressing them.
- Run production build, full verify-world (16 seeds), verify-migration, relevant frame/services/input tests and git diff --check. Compare source snapshots rather than relying only on migration (both pipelines share modified functions).
- Independent reviewer inspects new APIs, real integration, tests, runtime allocation cost, unsafe input/paths and documentation accuracy. Fix concrete findings and rerun relevant gates.

## Acceptance criteria
- A contributor can find the owning file and exact focused verification command from one document.
- Existing framed core is authored through the validated kit, not duplicated in a showcase tool.
- Invalid plans fail with actionable diagnostics before generation; geometry and sockets remain identical for protected baseline fixtures.
- One local command lists and runs checks and reproduces saved camera views; failures remain failures.
- Full world/migration/build gates pass; known formatting/artifact state stays clearly distinguished.

## Risks and boundaries
- Float operation order changes can alter generated spans: retain original arithmetic and compare exact outputs.
- Per-tile validation/compilation is too expensive: compile/cache bounded local plans, avoid unbounded seed caches.
- A generic geometry language can become harder than code: keep a small typed vocabulary with one real migrated family and documented escape hatches.
- Saved views can expose pre-existing holes: do not rewrite unrelated geometry to claim this authoring task is clean.
- No renderer/material/FPS parameter changes, no dev server/browser, no Git mutations beyond ordinary working-tree edits.

## Implementation notes

- The kit uses inclusive tile rectangles, typed slabs/landings/flights/solid/opening records and named sockets. Static plans compile once; repeated storeys use `appendLevels` to avoid repeated tile lookup while preserving operation/output order.
- The first migrated production component is the framed core and its navigation entry anchors. Wings, roof policy, shelves, bridges and world-scale infrastructure stay under their existing owners; this is not a claim that every content family has been converted.
- Added `roads` and `performance` check groups as explicit routes to existing safeguards. Generated workflow/build output and local comparison renders are ignored under `artifacts/content/` and `artifacts/content-baseline/`; existing unrelated artifacts remain untouched.
- `AGENTS.md` is protected by tool approval. The attempted link was not approved and was not applied or retried; README.md and docs/PLAN.md are the guide entry points instead.
- No new dependencies, browser/dev-server session, commit or push is part of this implementation.

## Verification outcome

- `npm run content -- check authoring`, `structures`, `roads`, `materials`, `infrastructure`, `performance` and `world` passed. `world` exercised all 16 seeds, 20 identical migration windows and the production build using the new runner. Optional `shaders` was not needed for this non-rendering change.
- 48 original full-frame fingerprints remain identical; independent review reproduced the original hashes directly from the pre-extraction Git source.
- `core-switchback`, `frame-ladder` and `service-walkbeam` were rendered and visually inspected with zero missing-ray/wrong-side pixels. The two framed views' raw pixels exactly match their pre-refactor baselines, including final rerenders after the preview validator fix.
- The local equal-transpilation microbenchmark found no core-sampling regression; this is not a GPU/FPS measurement. Renderer/material parameters were not changed.
- Independent structural review passed. Workflow review found header-only PNG validation could accept a truncated file; a focused RED/GREEN fix now checks complete chunks and actual ImageMagick pixel decoding. Expanded corruption tests and final independent workflow re-review passed.
- Scoped Prettier checks, documentation-link/example checks, source safety scan and `git diff --check` passed. Existing repository-wide formatting drift was not rewritten.
- Logs, images and the final workflow-review JSON remain under ignored `artifacts/content/`; comparison images and the local benchmark are under `artifacts/content-baseline/`.
