# Dagger Dungeon

A first-person BLAME!-inspired megastructure exploration game built with Three.js and React on the RUN.game platform. One endless vertical world: authored buildings, ground strata, permanent transit, bridges and physical infrastructure cooperate through deterministic layers and one authoritative column model.

## The Purpose

**The generator is the product; the game is the proof.** The goal of this project is the best *lightweight* megastructure generation ever constructed: every feature is a pure function of `(seed, coordinates)` plus a bounded neighbor radius — no baked data, no training sets, no WFC, no Minecraft-style chunk tricks. The entire runtime state of an endless world is a seed and a window position.

The end state is to **demystify the build** so this baseline can be used the way a standard terrain generator is used in mainline game engines. The concepts that make it work — the column model, layered generation, deterministic ownership, the seam doctrine — are documented in [`docs/`](docs/) and enforced by invariants (`tools/verify-world.ts`), because a generator you can't verify or explain isn't a baseline, it's a demo.

## Building Architecture

Verticality is authored structure inside the LayerProcGen hierarchy, not a stack
of unrelated maps. The historical `pillar` names describe the coarse ownership
grid, not a requirement that every building be a box wrapped in stairs.

- On a **coarse grid** (one pillar cell = 4×4 dungeon cells = 56×56 tiles), a
  deterministic region-aware field chooses empty space or a building.
- **Framed buildings** are the non-elevator default in city and machine regions:
  internal switchback cores, occupied wings around tall atria, unequal wing
  heights, supported roof terraces, thick floor/beam bands and continuous piers.
  They do not generate the exterior spiral. Other regions mix both families.
- **Legacy kebabs**, inspired by **Lorne's Lure**, retain their winding exterior
  route and authored room vocabulary. They are one building family, not the
  organizing rule for the whole megastructure.
- Rare **elevator shafts** connect bottom, ground and crown stops. Press F beside
  a red call box to summon the car, then F aboard to depart.
- **Bridges** connect actual neighboring building portals at compatible heights.
  Framed buildings publish selected transfer levels rather than a socket on
  every floor. The existing local connectivity guarantee remains.
- The authoritative columns own every room, stair, slab and opening. Small
  mounted landing lights make internal routes visible using the fixed light pool.

Each building remains a **pure function of (seed, absolute cell)**. Planning,
circulation and proportions: [framed buildings](docs/framed-buildings.md).

## Dungeon Generation — LayerProcGen

The generator uses a **LayerProcGen** architecture — layered procedural generation where each layer reads the output of previous layers; information flows downward, never upward. Inspired by [Rune Skovbo Johansen's LayerProcGen framework](https://runevision.github.io/LayerProcGen/) ([EPC 2024 talk](https://youtu.be/GJWuVwZO98s)). The pillar layer is a true *coarse* layer in this hierarchy: the fine dungeon layers read its footprints the way LayerProcGen fine layers read coarse ones.

### Layer Stack

| Layer | Name | What it does |
|-------|------|-------------|
| Region | **Coarse region layer** | City, machine, canyon, frontier, and roads districts constrain biome palettes, pillar density, height, depth, and chunk vocabulary. |
| Pillar | **Coarse building layer** | Region-weighted occupancy, framed-building plans and legacy kebab composition, pure in absolute pillar-cell coordinates. Empty cells create courts, cuts, and breathing room. |
| Infrastructure plan | **Coarse service network** | Shared regional nodes and pair-owned trunks extend across 112-tile cells, independent of building recipes; upstream socket context protects existing crossings. |
| 0 | **Noise** | Noise field defines which dungeon cells are active. Deterministic seeding via FNV-1a + mulberry32. |
| 1 | **Tile Grid + Fine Noise** | Active cells become floor; organic biomes get noise-sculpted edges. |
| 2 | **Biome** | Per-cell biome assignment: dungeon, crypt, cave, ember, outside. |
| Roads | **Street-vein carve** | In roads districts, an arterial road field (level sets of terrain-coupled potentials, hierarchy gated by an openness field) carves streets at grade and cuts the blocks between them into flat-topped plinths under open sky. |
| 3 | **Spawn marker** | Places the player safely on the permanent network without carving objective-specific terrain. There is currently no exit. |
| 4 | **Permanent Transit** | Every absolute pillar cell owns a stable hub and pair-owned boundary sockets. Bounded local routes create the same infinite navigation network from every overlapping window. |
| 5 | **Reserved legacy layer** | The bounded-map golden path and exit were removed; exploration currently has no objective-authored terrain. |
| 6 | **Height Fields** | Rolling walkable terrain, bottomless pits, biome-clearance ceilings. Terrain flows *under* pillar footprints; foundations dominate the shared corner field so man-made surfaces stay flat and the ground banks against them. |
| Road facilities | **Parcel planning** | Fits street-entry facilities to the existing same-height road foundations, with bounded local plans, internal service stairs where they fit, and reserved bridge corridors. |
| Columns | **Structural column base** | Pillar air, bridge bores, terrain and facilities compile into authoritative per-(x,z) air spans. |
| Infrastructure | **Physical service network** | Materializes galleries, access stations and exact octagonal pipe solids. Shared analytic column refinements drive pipe rendering and collision; tile-center projections serve maps/navigation. |

### Design Principles

1. **The column model is the seam** — structural surfaces follow shared air/solid data: tile-span boundaries plus the same continuous infrastructure refinement for rendering and collision, never an unrelated decorative mesh and collider.
2. **Permanent navigation is sacred** — temporary generation windows never decide whether a route exists; local components attach to stable pillar-cell hubs and sockets.
3. **Junctions interpenetrate, never abut** — face tops overshoot into solid, caps overlap neighbors; shared-edge geometry leaks rasterization hairlines, overlapping geometry cannot.
4. **Infinite-world discipline** — every generation feature is a pure function of (seed, absolute cell) plus a bounded neighbor radius. No global scans in new code.
5. **Front faces are the contract** — structural geometry has consistent triangle winding and renders front-side only. `DoubleSide` is reserved for intentional billboards, never used to conceal missing or reversed faces.

**Editing content? Start with [`docs/CONTENT_AUTHORING.md`](docs/CONTENT_AUTHORING.md)** for owning files, reusable building plans, focused checks and saved-view previews.

Current direction: [`docs/PLAN.md`](docs/PLAN.md). Layer references: [`docs/layerprocgen-findings.md`](docs/layerprocgen-findings.md), [`docs/roads-layer-design.md`](docs/roads-layer-design.md). The older [`docs/dungeon-layer-design.md`](docs/dungeon-layer-design.md) is historical, not the current architecture.

## Debug Tooling — the DDSNAP loop

Seen bugs become reproducible bugs:

- **F8** in-game copies a `DDSNAP1{...}` string (seed, position, view direction, and any click-marked points) to the clipboard.
- **Left-click** marks the surface under the crosshair with a red beacon; **right-click** unmarks. Marks travel inside the snapshot.
- `npx tsx tools/debug-view.ts 'DDSNAP1{...}' out.png` regenerates that exact world, software-raycasts the exact camera view over the real renderer geometry (marked geometry tinted red, holes rendered magenta), and prints the column spans, biome, and pillar chunk stack under the player and every mark.

## Game Features

- **World-scale material hierarchy** — quiet concrete walls/ceilings, slab-like constructed floors, and pipe finishes chosen by service and region; restrained wear, Source-inspired lighting and the existing fixed light pool ([current material rules](docs/quiet-material-roles.md), [asset credits](docs/source-style-pass.md))
- **Industrial ambience** — quiet machinery, air movement, pipe resonance and sparse creaks, crossfaded by local enclosure/region; persistent volume/mute controls and gesture-safe audio lifecycle
- **Megastructure traversal** — internal stair cores, recessed galleries, atrium crossings, roof terraces, legacy exterior climbs, rolling caves and open-sky canyons
- **Taller occupied spaces** — generous framed-storey clearance, taller framed doorways, six-unit ordinary transit, and taller biome chambers; fixed-width openings and deliberately tight ducts retain contrast ([height standards](docs/spatial-scale.md))
- **Vertical transit shafts** — rare elevator pillars replace the exterior-stair kebab and connect bottom, ground, and crown stops
- **Split-level crossing halls** — low service passages open onto raised catwalks, recessed chambers, and observation edges; internal return stairs make both levels explorable, including in deep foundations
- **Service galleries** — dogleg entries, solid machine bays, overhead service trunks, and two-door exterior ledge loops add regional variations without reshuffling tower heights or bridge connections
- **Sheltered bridge crossings** — region-weighted gatehouses and windowed service approaches alternate enclosure with exposed middle spans; plain bridges and ducts remain in the mix ([design and inspection view](docs/bridge-crossings.md))
- **Five regions / five biomes** — city, machine, canyon, frontier, and roads districts restrict dungeon, crypt, cave, ember, and outside terrain into distinct identities
- **Street-vein roads districts** — arterial streets that squeeze to lone tunnels and flood open basins with side streets, flowing with the terrain; the blocks between become courts and plinth building sites at quantized heights
- **Road-front facilities** — inset halls and workshops follow the existing plinth outlines, with street-level entrances and internal roof access where a service core fits
- **Surface infrastructure** — mounted pipe banks, larger risers, elbows, collars, and hanging cable/wire bundles on road facilities and framed buildings; decorative geometry is batched and streamed ([design and reference notes](docs/roads-infrastructure.md))
- **Endless physical infrastructure** — region-scale trunks, return circuits, risers and open pipe interiors cross building boundaries; supported maintenance walkways, side ports, anchored cables and climbable access ladders materialize from the network. Pipe walls and fittings have real collision ([layer contracts, controls and views](docs/infrastructure-network.md))
- **Bottomless pits** — deep voids and open-sky drops break the slab; R respawns
- **Endless streaming** — neighboring worlds generate off-thread, geometry is prepared incrementally, and direction-aware prefetch keeps ordinary boundary crossings smooth
- **Source-style movement** — persistent-velocity physics with ground friction and projected-velocity acceleration: air strafing and bunnyhopping work like CS/GMOD (hold Space to chain hops)
- **Ledge grab & mantle** — jumps that fall just short catch the lip and pull up; low plinths are climbable with a jump toward the ledge
- **Auto-play bot** — press P to travel toward successive forward destinations without an exit objective (drives with exact kinematic movement, unaffected by the player feel-model)
- **Elevation-slice maps** — minimap and debug map show what's accessible *at your current height*: pillar plazas, ramps, and bridges appear at their own elevation
- **Debug map** — backtick for full-map views: elevation slice, tiles, biomes, regions, noise, content, and pillars
- **Visual Lab** — press V for live bloom, color finishing, front-face solid/wireframe/normals inspection, reset, and copyable presets
- **Runtime settings** — Escape opens brightness, mouse sensitivity, and movement-speed controls
- **Seed control** — reproducible worlds from the main menu
- **Mobile support** — touch controls, responsive UI

## Controls

| Action | Key |
|--------|-----|
| Move | WASD |
| Look | Mouse (click to capture) |
| Jump / bunnyhop | Space (hold to chain hops) |
| Crouch | Ctrl |
| Sprint | Shift |
| Interact | F |
| Ladder | W approach attaches; W/S climb; F mounts/releases; Space releases |
| Respawn | R |
| Auto-play | P |
| Visual Lab | V |
| Settings | Escape |
| Debug Map | ` (backtick) |
| Cycle Debug Mode | Tab (while debug open) |
| Debug snapshot | F8 |
| Mark / unmark debug geo | LMB / RMB |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| 3D Rendering | Three.js 0.183.2 (vanilla, not R3F) |
| UI | React 18 |
| State | Zustand 5.0.3 |
| Build | Vite 6 + TypeScript 5 |
| Platform | RUN.game SDK (Three.js, React, Zustand embedded — zero bundle cost) |
| Generation | Custom LayerProcGen + column model; ROT.js A* for carving/bot |

## Getting Started

```bash
npm install
npm run dev
```

Vite prints the local address in the terminal. To test from another computer on
the same network:

```bash
npm run dev -- --host 0.0.0.0
```

Open the printed `Network` address on the other computer. No dedicated GPU or
platform-specific runtime is required for local development.

## Project Structure

```
src/
  engine/                  # Three.js game engine (vanilla)
    GameEngine.ts          # Main loop, movement/physics from the column model, DDSNAP capture
    DungeonRenderer.ts     # Column model → geometry: floors/ceilings/caps + one XOR wall pass
    PostProcessing.ts      # Validated bloom and neutral color-finishing pipeline
    Camera.ts              # Free-look FPS camera
    InputManager.ts        # Keyboard + mouse input
    SpriteManager.ts       # Billboard sprites
    LightingSystem.ts      # Nearest-K room lighting

  game/
    DungeonGenerator.ts    # Reference/DDSNAP pipeline and synchronous runtime fallback
    gen/assemble.ts        # Shipping window facade over cached chunked layers
    gen/layers.ts          # TileBase, Transit, Height, road parcels and Columns
    gen/infrastructure-layers.ts # Coarse network → physical infrastructure chunks
    types.ts               # DungeonData, WorldData, ColumnSpan
    mapslice.ts            # Elevation-slice classifier (shared by both maps)
    pathfinding.ts         # World A* (bot, compass)
    dungeon/
      pillar-layer.ts      # Coarse building selection: frames, legacy kebabs, elevators
      frame-building.ts    # Framed massing, storeys, air and published sockets
      frame-core-plan.ts   # Editable validated stair/landing/opening recipes
      structure-kit.ts     # Shared local recipe compiler, no renderer dependencies
      pillar-chunks.ts     # Chunk contract + graybox chunk library
      pillar-geometry.ts   # Chunks → footprints + per-tile air spans (ramps, plazas, corbels)
      pillar-bridges.ts    # Neighbor-pair bridge planning + column carving
      columns.ts           # The column model builder + validation
      region-layer.ts      # Coarse city/machine/canyon/frontier identity field
      layer4-connect.ts    # Permanent cell hubs, pair-owned sockets, local attachment
      layer0..layer6*.ts   # The dungeon floor layer stack
      heightfield.ts       # Corner fields: physics walks exactly what is drawn
      organiccontour.ts    # Marching-squares walls: render and collision share one line
      cells.ts, rng.ts, noise.ts

  store/gameStore.ts       # Zustand runtime state
  ui/                      # React overlay: HUD, maps, settings, and Visual Lab
  bot/DungeonBot.ts        # Auto-play state machine

tools/
  content-workflow.ts      # Grouped checks + named DDSNAP previews (npm run content)
  content-views.json       # Literal saved views with purpose and source provenance
  debug-view.ts            # DDSNAP viewer: exact-view software raycast + world data dump
  verify-world.ts          # Multi-seed generation and navigation invariants
  export-reference-assets.mjs # Blender-ready scale references for replacement assets

reference-assets/          # Column/stair GLB scale references for Blender handoff
docs/                      # Living plan, generation notes, and asset-handoff guide
```

## License

See LICENSE.txt
