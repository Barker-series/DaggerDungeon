# Dagger Dungeon

A first-person megastructure exploration game built with Three.js and React on the RUN.game platform. One vast vertical world: massive climbable pillars rising out of a procedurally sculpted dungeon floor, connected by high bridges over bottomless pits.

## The Pillar Kebab System

The core world idea, inspired by the brilliant procgen in **Lorne's Lure**: instead of forcing a 2D generator to fake verticality with stacked levels (we tried — endless edge cases), verticality is *content*, not generation.

- The world has ONE ground-level procedural floor.
- On a **coarse grid** (one pillar cell = 4×4 dungeon cells = 168×168 world units), each cell may hold a **pillar**: a massive monument built as a vertical **kebab of authored chunks** — plain shaft segments, terrace plazas, hollow galleries, a crown — skewered bottom to top.
- Every chunk carries a **winding ramp** up one face, and the ramp face advances a quarter-turn per chunk, so a continuous spiral staircase wraps each pillar from grade to crown — climbability is guaranteed *by construction*, never verified.
- **Bridges** connect neighboring pillars where their sockets (plaza edges, gallery doorways) align in height — a pure neighbor-pair computation, with a local degree guarantee so no pillar is ever unreachable by air.
- Terrace plazas omit their slab over the arriving stairs (open-air climbs) and grow corbel brackets under their cantilevered edges.

Every pillar is a **pure function of (seed, cellX, cellZ)** and bridges read only a 1-cell neighbor radius — the endgame is an infinite streamed world, and the bounded map is just a window over the same functions.

## Dungeon Generation — LayerProcGen

The generator uses a **LayerProcGen** architecture — layered procedural generation where each layer reads the output of previous layers; information flows downward, never upward. Inspired by [Rune Skovbo Johansen's LayerProcGen framework](https://runevision.github.io/LayerProcGen/) ([EPC 2024 talk](https://youtu.be/GJWuVwZO98s)). The pillar layer is a true *coarse* layer in this hierarchy: the fine dungeon layers read its footprints the way LayerProcGen fine layers read coarse ones.

### Layer Stack

| Layer | Name | What it does |
|-------|------|-------------|
| Pillar | **Coarse pillar layer** | One kebab per pillar cell — pure function of (seed, px, pz). Footprints become walls the rest routes around. |
| 0 | **Noise** | Noise field defines which dungeon cells are active. Deterministic seeding via FNV-1a + mulberry32. |
| 1 | **Tile Grid + Fine Noise** | Active cells become floor; organic biomes get noise-sculpted edges. |
| 2 | **Biome** | Per-cell biome assignment: dungeon, crypt, cave, ember, outside. |
| 3 | **Spawn/Exit** | Far-apart spawn and exit rooms, never inside a pillar footprint. Exit stairs regenerate the next stack. |
| 4 | **Connectivity** | Batch-per-pass island bridging: every disconnected floor component is carved toward the spawn network. |
| 5 | **Golden Path** | Guaranteed spawn→exit route, penalized away from unstable ground; pit crossings become flat causeways. |
| 6 | **Height Fields** | Rolling walkable terrain, bottomless pits, biome-clearance ceilings. Terrain flows *under* pillar footprints; foundations dominate the shared corner field so man-made surfaces stay flat and the ground banks against them. |
| Columns | **Column model** | The single authority on solid vs air: per-(x,z) air spans, built last. Pillar air spans and bridge carves replace/split columns. Renderer, physics, and agents all derive from it — leaks are unrepresentable, not patched. |

### Design Principles

1. **The column model is the seam** — all vertical faces derive from span differences between adjacent columns; a face exists exactly where air meets solid.
2. **The guaranteed path is sacred** — spawn to exit is always navigable; pillar spirals are continuous by construction.
3. **Junctions interpenetrate, never abut** — face tops overshoot into solid, caps overlap neighbors; shared-edge geometry leaks rasterization hairlines, overlapping geometry cannot.
4. **Infinite-world discipline** — every generation feature is a pure function of (seed, cell) plus a bounded neighbor radius. No global scans in new code.

Design documents: [`docs/dungeon-layer-design.md`](docs/dungeon-layer-design.md), [`docs/layerprocgen-findings.md`](docs/layerprocgen-findings.md)

## Debug Tooling — the DDSNAP loop

Seen bugs become reproducible bugs:

- **F8** in-game copies a `DDSNAP1{...}` string (seed, position, view direction, and any click-marked points) to the clipboard.
- **Left-click** marks the surface under the crosshair with a red beacon; **right-click** unmarks. Marks travel inside the snapshot.
- `npx tsx tools/debug-view.ts 'DDSNAP1{...}' out.png` regenerates that exact world, software-raycasts the exact camera view over the real renderer geometry (marked geometry tinted red, holes rendered magenta), and prints the column spans, biome, and pillar chunk stack under the player and every mark.

## Game Features

- **Megastructure traversal** — climb spiral stairs around monuments, cross high bridges, drop into rolling caves, emerge into open-sky canyons
- **Five biomes** — dungeon halls, crypts, caves, ember fields, and the outside — with per-biome terrain, ceilings, and pit behavior
- **Bottomless pits** — the floor is failing; the golden path bridges the void (R respawns)
- **Auto-play bot** — press P to watch the AI navigate (A* over the world graph)
- **Elevation-slice maps** — minimap and debug map show what's accessible *at your current height*: pillar plazas, ramps, and bridges appear at their own elevation
- **Debug map** — backtick for full-map views: elevation slice, tiles, biomes, noise, content, pillars
- **Seed control** — reproducible worlds from the main menu
- **Mobile support** — touch controls, responsive UI

## Controls

| Action | Key |
|--------|-----|
| Move | WASD |
| Look | Mouse (click to capture) |
| Jump | Space |
| Crouch | Ctrl |
| Sprint | Shift |
| Interact | F |
| Respawn | R |
| Auto-play | P |
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
pnpm install
pnpm run dev
```

## Project Structure

```
src/
  engine/                  # Three.js game engine (vanilla)
    GameEngine.ts          # Main loop, movement/physics from the column model, DDSNAP capture
    DungeonRenderer.ts     # Column model → geometry: floors/ceilings/caps + one XOR wall pass
    Camera.ts              # Free-look FPS camera
    InputManager.ts        # Keyboard + mouse input
    SpriteManager.ts       # Billboard sprites
    LightingSystem.ts      # Nearest-K room lighting

  game/
    DungeonGenerator.ts    # Orchestrator: pillar field → layers → column model → bridges
    types.ts               # DungeonData, WorldData, ColumnSpan
    mapslice.ts            # Elevation-slice classifier (shared by both maps)
    pathfinding.ts         # World A* (bot, compass)
    dungeon/
      pillar-layer.ts      # Coarse pillar layer — the kebab assembler (pure function)
      pillar-chunks.ts     # Chunk contract + graybox chunk library
      pillar-geometry.ts   # Chunks → footprints + per-tile air spans (ramps, plazas, corbels)
      pillar-bridges.ts    # Neighbor-pair bridge planning + column carving
      columns.ts           # The column model builder + validation
      layer0..layer6*.ts   # The dungeon floor layer stack
      heightfield.ts       # Corner fields: physics walks exactly what is drawn
      organiccontour.ts    # Marching-squares walls: render and collision share one line
      cells.ts, rng.ts, noise.ts

  store/gameStore.ts       # Zustand runtime state
  ui/                      # React overlay: HUD (live biome), Minimap, DebugMap, menus
  bot/DungeonBot.ts        # Auto-play state machine

tools/
  debug-view.ts            # DDSNAP viewer: exact-view software raycast + world data dump

docs/                      # Generation design notes
```

## License

See LICENSE.txt
