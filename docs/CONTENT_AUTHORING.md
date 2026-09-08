# Content authoring: start here

This is an endless **BLAME!-inspired megastructure**, not a collection of dungeon
rooms with decorative pillars. The goal of this guide is to make an edit local:
find its owner, change its plan, run the relevant checks, inspect the same view.
[PLAN.md](PLAN.md) owns the design direction; this guide owns the working route
through the source. Historical design notes are references, not competing specs.

## Commands you can use without remembering tool filenames

Run from the repository root, with the existing installed dependencies:

Local requirements are the project's Node dependencies and ImageMagick
(`magick` or `convert`) for preview conversion/decoding, including the workflow's
image-validity unit test. The optional shader group additionally needs Python
and Mesa. The commands never install or download missing tools automatically.

```sh
npm run content -- list
npm run content -- check authoring
npm run content -- check structures
npm run content -- check world
npm run content -- preview core-switchback
```

- `list` shows the actual check catalogue and each saved view's purpose and source.
- `check authoring` is the cheap kit/workflow test loop, not a full world rebuild.
- `check structures` checks integrated frames, doorways, fixtures and service routes.
- `check infrastructure` exercises network, exact solids, access, seams and input.
- `check roads` covers facilities, reserved crossings and road seams.
- `check performance` checks headless infrastructure geometry/streaming budgets,
  not actual gameplay FPS; run it without other heavy jobs competing for the CPU.
- `check materials` checks roles, UVs and shader hooks; it is not a GPU appearance test.
- `check world` runs the full default world seeds, migration comparison and build.
- `check all` deduplicates the normal listed groups; it does not imply every
  historical script in `tools/`. Inspect `list` for the current exact membership.
- `check shaders` is an explicit environment-dependent shader compilation check;
  it is excluded from `all` and requires the existing Python/Mesa setup.
- `preview NAME` reproduces one catalogue camera; `preview all` is the slower
  full saved-view sweep. Pick a name from `list`, not a new random seed each time.

For the migrated building core, start with `preview core-switchback`,
`preview frame-atrium` and `preview frame-ladder`. For physical infrastructure,
use `preview service-crossing`, `preview service-walkbeam` or `preview main-pipe`.
To save another reproduction, add its descriptive ID, feature, purpose, source
document and **literal** snapshot to `tools/content-views.json`; copy the same
snapshot into that source document. The catalogue test checks that provenance.

Commands print the underlying invocation and save diagnostic logs under
`artifacts/content/`. Generated images and the workflow's build output also stay
there, outside source/assets. Missing dependencies produce an error rather than
an installation or a new server. Preserve failed logs instead of rerunning until
a different seed happens to pass.

## The normal edit loop

1. Choose the smallest content owner from the table below. Write down the intended
   visible/traversal change and what must remain unchanged.
2. Add a focused failing test for the new guarantee. For a refactor, capture the
   old output first: migration alone cannot catch a mistake shared by both paths.
3. Edit the plan or owning function, not the renderer to hide incorrect structure.
4. Run the focused checks, then reproduce the same camera view. A valid column
   does not by itself prove that a room is reachable or that a face is present.
5. Run the world and migration gates for any structural change. Use Chris's
   **existing** `npm run dev` session for final appearance, movement feel and FPS;
   do not start a replacement server to work around missing context.

Do not mix a content edit with a global formatter run, a material retune or a
streaming rewrite. Preserve a known-good view so a regression has a short route
back to its cause.

## Where to edit

All paths below are relative to the repository root.

| Intended edit | Owner / entry point | Context it reads → output consumed downstream |
|---|---|---|
| Where building families occur, regional frequency, target height/depth | `src/game/dungeon/pillar-layer.ts` → `assemblePillar` | Seed + absolute pillar cell + region → complete building plan, footprint and sockets |
| Framed building wings, atrium, setbacks, transfer floors | `src/game/dungeon/frame-building.ts` | Complete local frame plan → air spans and room/bridge sockets; `pillar-geometry.ts` compiles them |
| Framed stair flights, landings, core opening and shared entry anchors | `src/game/dungeon/frame-core-plan.ts` | Small validated local recipes → solids and named sockets, consumed by the real `frame-building.ts` path |
| Framed service shelves, approaches and ladder anchors | `src/game/dungeon/frame-services.ts` | Complete local frame plan → structural solids and absolute ladder records; infrastructure adds physical fittings |
| Legacy building-family vocabulary and selection weights | `src/game/dungeon/pillar-chunks.ts`, `pillar-layer.ts` | Seeded family selection → chunks; `pillar-geometry.ts` realizes legacy geometry |
| Legacy crossing-hall / service-gallery interiors | `src/game/dungeon/crossing-hall.ts`, `service-gallery.ts` | Local room coordinates → air and access targets; legacy pillar compiler integrates them |
| Bridges and crossing housings | `src/game/dungeon/pillar-bridges.ts` | Bounded neighboring building plans and real portals → pair-owned crossings; not a local building recipe's neighbor mutation |
| Road facility shape, storeys, entrances and roof access | `src/game/dungeon/road-buildings.ts` | Existing road/plinth field, upstream tiles and reserved bridge corridors → absolute parcel plans and columns |
| World-scale pipe layout and service hierarchy | `src/game/dungeon/infrastructure-network.ts` | Seed, absolute coarse owner, region and upstream envelopes → shared nodes and owned long connections |
| Pipe side ports, walk-beams, risers, access stations | `src/game/dungeon/infrastructure-circulation.ts`, `infrastructure-access.ts` | Complete network plans / owning base columns → physical primitives and ladder records |
| Physical pipe cross-section or collision refinement | `src/game/dungeon/infrastructure-solid.ts`, `infrastructure-columns.ts` | Shared analytic primitives + excavated columns → exact solid/air field for renderer and physics |
| Terrain, pits and ordinary chamber clearance | `src/game/dungeon/layer6-heights.ts`, `clearance.ts` | Region/biome, terrain fields and permanent transit → floors/ceilings; downstream structures must preserve routes |
| Wall/floor/ceiling material roles | `src/engine/SourceMaterials.ts` | Explicit surface role → shared material; keep [quiet-material-roles.md](quiet-material-roles.md) authoritative |
| Pipe coatings | `src/game/dungeon/infrastructure-finishes.ts` | Existing service role, region and construction owner → stable finish RGB; never random per mesh |
| Pipe UVs / decorative mounted utility meshes | `src/engine/surface-uv.ts`, `StructureUtilities.ts` | Complete primitive/building owner → metric UVs / batched nonstructural utility geometry |
| Runtime climbing rather than ladder placement | `src/engine/ServiceLadders.ts`, `GameEngine.ts` | Published physical ladder data and input → movement; does not author new world geometry |
| Ambient sound | `src/engine/AmbientAudio.ts` | Bounded local enclosure + region → audio weights; keep graph/lifecycle tests green |

**Do not choose a file merely because its name matches the visual symptom.**
A pipe going through a doorway is usually an upstream reservation/route problem;
a correct column with a missing face is a renderer problem; a shifted texture
on recenter is a coordinate/UV problem. `DungeonRenderer.ts` is not the default
place to implement new architecture.

## Editing building pieces instead of geometry plumbing

`src/game/dungeon/structure-kit.ts` is the small shared compiler.
`src/game/dungeon/frame-core-plan.ts` is its first **shipping** user, not a demo:
the frame core's flights, ordinary/arrival landings, wall opening and entry
anchors are authored there. Building selection, whole-building massing, roof
termination, bridges, service shelves and world-scale pipes retain their owners.
There is no second scene, renderer or independent collision representation.

### The vocabulary

| Record | Meaning |
|---|---|
| `bounds`, `rect` | **Inclusive** integer local tile coordinates `x0`, `x1`, `z0`, `z1` |
| `slab`, `landing` | Rectangular mass ending at `y`, extending down by `thickness` |
| `flight` | Stepped slab: `axis`, `direction`, zero-rise coordinate `start`, `maxSteps`, `rise`, starting `y`, and `thickness` |
| `solid` | Solid vertical interval `[lo, hi]` within its rectangle |
| `opening` | Subtracts `[lo, hi]` from this recipe's solid pieces in its rectangle; does not erase pre-existing world mass by itself |
| `sockets` | Named tile anchors with local `y` and a role: `entry`, `room`, `door`, `bridge`, `utility` or `vertical` |

`compileStructurePlan(plan)` validates and indexes the recipe once. The returned
`appendSolids(x, z, baseY, out)` adds its intervals to an existing solid list;
`sockets` contains copied, frozen named anchors. X/Z remain local tile indices,
and only `baseY` shifts the vertical placement. Rotation and absolute ownership
remain at the existing building integration boundary.

For repeated storeys, `appendLevels(x, z, first, last, pitch, floorOffset, out)`
uses inclusive integer level bounds and evaluates each base as
`level * pitch + floorOffset`. It avoids repeating the tile lookup per floor
while retaining the same level/piece order as individual `appendSolids` calls.
The frame integration uses this path; no per-seed or per-world recipe cache is
needed.

Flight height follows `baseY + y + min(maxSteps, steps) * rise`, with `steps`
measured from `start` along the signed axis. The order of those floating-point
operations is intentional. Do not combine offsets differently during a refactor:
an apparently equivalent expression can change exact serialized column output.

### Practical frame-core edit

1. Open `frame-core-plan.ts`. `storey` holds two landings and two flights;
   `FRAME_CORE.arrival` describes only the top arrival platform, not a plate over
   the entire stairwell. `FRAME_CORE.wall` owns the wall and door cut.
2. Follow the named `entry`/`door` anchors instead of copying their coordinates
   into `createFrameSpec`. The landing and opening must continue to agree with
   the navigation target. Leave service and neighbor-network logic alone.
   The current frame navigation publisher uses anchor X/Z at the storey floor;
   its anchors all have `y: 0`. An elevated landing needs an explicit publisher
   change and reachability test, not just an edit to the socket's local Y.
3. Add the intended local behavior to `tools/structure-kit.test.ts` when changing
   the compiler, or a frame integration assertion when changing the recipe.
   Bounds validation catches malformed data; it cannot prove circulation.
4. Run `npm run content -- check authoring`, then `check structures`, and inspect
   a saved frame view. Run `check world` before treating a structural edit as done.

`tools/frame-core-plan.test.ts` compares full-frame outputs against
`tools/fixtures/frame-core-baseline.json`, captured **before** the extraction.
It checks both roof policies, all local tiles and ordered sockets/metadata across
different heights, depths, rotations and service settings. During refactors,
keep these fixtures unchanged: do not regenerate expected output just to get a
green test. A deliberately approved design change needs a reviewed fixture update
alongside explicit new clearance/access expectations and before/after views.

### Adding another local recipe

Use an ordinary typed TypeScript object beside its content owner—not a new parser
or a renderer branch. For example, a supported landing can be described as:

```ts
import { compileStructurePlan, type StructurePlan } from './structure-kit';

const landingPlan = {
  name: 'service-landing',
  bounds: { x0: 0, x1: 2, z0: 0, z1: 3 },
  pieces: [
    { kind: 'landing', rect: { x0: 0, x1: 2, z0: 0, z1: 3 }, y: 0, thickness: 1.5 },
    { kind: 'solid', rect: { x0: 0, x1: 0, z0: 0, z1: 3 }, lo: -6, hi: -1.5 },
  ],
  sockets: [{ name: 'entry', role: 'entry', x: 1, z: 0, y: 0 }],
} satisfies StructurePlan;

const landing = compileStructurePlan(landingPlan);
```

This is a vocabulary example, not automatically placed content. Its owning
building must place it inside the reserved footprint, append its solids into the
existing column compilation, publish the actual reachable entry and verify that
the supporting mass meets real structure. Test every intended rotation and
vertical placement through that integration. Don't add a new arbitrary route to
the permanent network just because a local plan exposes an `entry` socket.

Compile static recipes at module initialization, not inside per-tile loops.
Typed plans are local authoring inputs, not an untrusted JSON import format.
Keep one shared compiler; add a primitive only when real content cannot express
its requirement with the existing vocabulary. Whole networks and organic fields
are deliberately not forced into this rectangular kit.

## The dependency map

Normal streamed generation runs in `src/game/world-worker.ts` through
`src/game/gen/assemble.ts` and cached `ChunkedLayer` instances, not a new
full-window generator on each move:

```text
pure region/building/road fields
  → TileBase → Transit → Height → Column
                  ↘ RoadBuildingLayer ↗
pure InfrastructurePlanLayer ─────→ InfrastructureLayer ← Column
                                      ↓
                              assembled WorldData
                                      ↓
                     renderer / collision / maps / navigation
```

`RoadBuildingLayer` also reads `TileBase`; this sketch is orientation, not an
exhaustive provider graph. The executable dependency declarations are in
`src/game/gen/layers.ts` and `infrastructure-layers.ts`; `chunked.ts` enforces
provider availability. `src/game/DungeonGenerator.ts` remains the legacy reference
pipeline, DDSNAP generator and `GameEngine.ts` synchronous fallback when a cached
window is unavailable. New pass integration must keep both paths identical until
that reference and runtime fallback are deliberately retired.

### Ownership and effect distance

| Feature | Ownership / reach rule |
|---|---|
| Framed building | One absolute pillar cell; current footprint local tiles 14..41; core edits stay inside it |
| Road facility | 24-tile parcel, two-tile provider context; do not flood-fill a loaded whole block |
| Bridge | Neighbor pair with stable ownership and actual compatible building sockets |
| Infrastructure plan | 112-tile coarse cell owns east/south links; shared endpoints are functions of absolute coordinates |
| Infrastructure materialization | 56-tile chunk; complete base-column chunk and one coarse-cell plan padding; writes only its core |

For any new feature, declare: **owner, seed inputs, bounded read radius, output
extent, published sockets, downstream consumers and enforcing test**. If it
crosses a boundary, it is not safe merely because it worked in the current window.
Negative coordinates, generation order, eviction/revisit and diagonal recentering
must agree. An empty or unsuitable site should preserve the correct baseline,
not retry indefinitely or carve through a protected route.

## Units and anchors: avoid the usual mistakes

- A fine tile is `TILE_SIZE = 3` world units; a dungeon cell is 14 tiles; a pillar
  cell is 56 tiles. X/Z are horizontal, Y is height in world units.
- A tile index and a continuous point rotate differently: on a 56-tile cell,
  index rotation uses `55 - z`; continuous world-point rotation uses `168 - z`.
  Do not reuse one transform for the other. `serviceWorldPoint` is the existing
  continuous-point helper for service ladders.
- Structure selection uses **absolute** cell coordinates, never window-local
  indices. Rendering and engine motion convert at the shell. Published ladder
  IDs and positions must survive recentering unchanged.
- In local rectangular plans, explicitly establish inclusive/exclusive bounds;
  never translate an old `x <= 23` test into an exclusive bound of 23.
- `ColumnSpan` describes **air**, not a solid block: its floor and ceiling are
  physical boundaries. Solid intervals are compiled into that model, not emitted
  as disconnected render meshes.
- Exact infrastructure collision uses the analytic refinement; the tile-center
  projection alone cannot prove thin-wire or sloping-pipe clearance.
- A socket is a promise about an actual reachable surface at a specific height,
  not a suggestive marker. Keep entry/room groups aligned with their opening and
  landing; deduplicate lights by physical mounting point, not navigation group.
- Human-scale rulers stay fixed: existing stair risers, door widths, slab mass,
  ladder dimensions and fixtures are protected. See [spatial-scale.md](spatial-scale.md).

## Debug from the symptom to the owner

| Symptom | First evidence / likely path |
|---|---|
| Room or landing cannot be reached | Check published target and entry group, actual air clearance and staircase continuity; run building/doorway tests |
| Geometry changes when crossing a window | Compare cold overlaps; inspect ownership, provider padding and absolute/local conversion before adding edge patches |
| Pipe blocks architecture | Check coarse socket/roof reservations and full assembly envelope, not only the main trunk radius |
| Ladder attaches but cannot exit | Run real input tests and complete standing-body sweeps; check slab lip, rung radius and upper exit anchor |
| Magenta or wrong-side pixels | Inspect DDSNAP ray/marked columns, actual winding and sealing; never hide with `DoubleSide` |
| Textures jump, stretch or repeat strangely | Preserve metric chart, absolute origin and surface role; don't change structure to fix UVs |
| Frame stalls after a content edit | Compare bounded geometry work and cooperative jobs; don't silently increase frame/render/light budgets |

## DDSNAP is the bug report

In the existing game, F8 copies the seed, generation window and exact camera pose.
Click marks travel with it. A snapshot is enough to rebuild the actual renderer
headlessly; no browser or screenshot request is needed:

```sh
node --import tsx tools/debug-view.ts 'DDSNAP1{...}' artifacts/my-view.png
```

Create the output directory first and use a simple filename with the raw legacy
command. Keep a before and after view, inspect marked columns, and add a focused
invariant for the root cause. Do not edit the reproduction to make a bug disappear.

The auditor reports missing-ray and wrong-side counts and shades geometry by
normal/distance. **Producing a PNG is not a clean-geometry verdict**, and a clean
geometry verdict is not approval of textures, lighting, audio or FPS. Those need
the existing playtest session. A DDSNAP also does not currently capture arbitrary
live tunable settings; record overrides explicitly rather than guessing them.

## References by responsibility

- [framed-buildings.md](framed-buildings.md): building architecture and access contracts.
- [spatial-scale.md](spatial-scale.md): fixed dimensions and intentional compressions.
- [roads-infrastructure.md](roads-infrastructure.md): road facilities and mounted utilities.
- [infrastructure-network.md](infrastructure-network.md): current world-scale pipe ownership and physical model.
- [quiet-material-roles.md](quiet-material-roles.md): current surfaces and finish policy.
- [layerprocgen/PRINCIPLES.md](layerprocgen/PRINCIPLES.md): deterministic layer discipline.
- [streaming-milestoneB-design.md](streaming-milestoneB-design.md): per-chunk migration and padding.

`dungeon-layer-design.md` and the original local pipe-bank sections of
`atrium-maintenance.md` are historical. Do not revive their superseded architecture
because a search found them first.
