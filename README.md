# Dagger Dungeon

A Daggerfall-inspired first-person roguelite dungeon crawler built with Three.js and React on the RUN.game platform.

## Dungeon Generation — LayerProcGen

The dungeon generator uses a **LayerProcGen** architecture — a layered procedural generation system where each layer reads the output of all previous layers before making decisions. Information flows downward through layers, never upward. Each layer adds to or modifies the shared tile grid, building the dungeon through additive and subtractive sculpting.

This is inspired by [Rune Skovbo Johansen's LayerProcGen framework](https://runevision.github.io/LayerProcGen/) ([EPC 2024 talk](https://youtu.be/GJWuVwZO98s)) and our own production implementation in [runGame Blame](https://github.com/Barker-series).

### Layer Stack

| Layer | Name | What it does |
|-------|------|-------------|
| 0 | **Noise** | Perlin noise field defines the dungeon boundary — which cells are active (dungeon) vs void. Deterministic seeding via FNV-1a + mulberry32 PRNG. |
| 1 | **Tile Grid** | Reads Layer 0. Active cells become floor tiles. Adjacent active cells merge seamlessly. Void stays wall. |
| 2 | **Spawn/Exit** | Reads Layer 1. Finds the two farthest-apart active cells. Picks spawn and exit positions. |
| 3 | **Spawn Rooms** | Reads Layer 2. If spawn or exit is in void, carves a dedicated room and connects it to the nearest dungeon floor. If already in active space, tags the existing room. |
| 4 | **Connectivity** | Reads Layer 3. Flood fills from spawn. Finds disconnected floor islands. Bridges them with hallway corridors at the narrowest gaps. Repeats until all floor is reachable. |

The layer system IS the system. Nothing happens outside it. No "stamping phase," no post-processing hacks. Each layer reads and writes the shared tile grid directly.

### Design Principles

1. **Layers are additive and subtractive** — they sculpt the dungeon like clay. Add structure, carve away, add detail.
2. **The guaranteed path is sacred** — spawn to exit is always navigable. No layer can break it.
3. **Noise drives organic variation** — one continuous noise field shapes boundary, density, and theming.
4. **No raw tile generation from scratch** — the block library (planned) provides pre-authored room templates. Procedural generation only fills gaps between blocks.

Full design document: [`docs/dungeon-layer-design.md`](docs/dungeon-layer-design.md)

### Research & References

- [LayerProcGen](https://runevision.github.io/LayerProcGen/) — the framework architecture
- [Daggerfall dungeon analysis](https://youtu.be/35a2fEKIvSI) — modular block assembly
- [Bake Your Own 3D Dungeons](https://www.gamedeveloper.com/design/bake-your-own-3d-dungeons-with-procedural-recipes) — block connection system
- [CryptJS](https://github.com/DhrBaksteen/CryptJS) — prefab wall geometry (arches, pillars, beams)
- [jongallant/DungeonGenerator](https://github.com/jongallant/DungeonGenerator) — TinyKeep-style room scatter + Delaunay/MST
- [redsled84/mstdungeon](https://github.com/redsled84/mstdungeon) — MST + A* corridor carving

## Tech Stack

| Component | Technology |
|-----------|-----------|
| 3D Rendering | Three.js 0.183.2 (vanilla, not R3F) |
| UI | React 18 |
| State | Zustand 5.0.3 |
| Build | Vite 6 + TypeScript 5 |
| Platform | RUN.game SDK (Three.js, React, Zustand are embedded — zero bundle cost) |
| Dungeon Gen | ROT.js (A* pathfinding for bot/AI), Delaunator (available), custom LayerProcGen |

## Game Features

- **First-person combat** — LMB attack, RMB block, raycast-based targeting
- **Enemy AI** — perception system (vision cone + hearing), combat movement (circle/strafe/backstep), attack telegraphing, battle circle coordination
- **5 enemy types** — Rat, Skeleton, Bat, Imp (ranged), Orc
- **Loot system** — Daggerfall material tiers (Iron through Daedric), weapons, potions
- **3 classes** — Warrior, Rogue, Sorcerer (3 more unlockable)
- **Auto-play bot** — press P to watch the AI play. Uses A* pathfinding and state machine (explore/fight/loot/heal)
- **Debug map** — press backtick (`) for tile-level dungeon view with spawn/exit markers
- **Seed control** — set dungeon seed from main menu for reproducible layouts
- **Mobile support** — touch D-pad controls, responsive UI

## Controls

| Action | Key |
|--------|-----|
| Move | WASD |
| Look | Mouse (click to capture) |
| Attack | Left Mouse Button |
| Block | Right Mouse Button |
| Jump | Space |
| Interact | E |
| Quick Heal | Q |
| Hotbar | 1, 2, 3 |
| Auto-play | P |
| Debug Map | ` (backtick) |
| Cycle Debug Mode | Tab (while debug open) |

## Getting Started

```bash
pnpm install
pnpm run dev
```

## Project Structure

```
src/
  engine/              # Three.js game engine (vanilla)
    GameEngine.ts      # Main loop, player movement, combat orchestration
    DungeonRenderer.ts # Tile grid → 3D geometry (walls, floors, ceilings)
    Camera.ts          # Free-look FPS camera
    InputManager.ts    # Keyboard + mouse input (Skyrim-style)
    SpriteManager.ts   # Billboard sprites for enemies/items
    ProjectileManager.ts
    LightingSystem.ts

  game/                # Game logic
    DungeonGenerator.ts    # LayerProcGen orchestrator
    dungeon/
      cells.ts             # Cell grid + layer progression
      rng.ts               # FNV-1a seeding + mulberry32 PRNG
      noise.ts             # Seeded Perlin noise
      layer0-noise.ts      # Layer 0: boundary shape
      layer1-tilegrid.ts   # Layer 1: active cells → floor tiles
      layer2-spawnexit.ts  # Layer 2: spawn/exit placement
      layer3-spawnrooms.ts # Layer 3: spawn/exit rooms + connections
      layer4-connect.ts    # Layer 4: island bridging
      blocks.ts            # Block library (pre-authored room templates)
      prefabs.ts           # CryptJS prefab geometry (ported to BufferGeometry)
    EnemyAI.ts         # Perception, combat movement, attack state machine
    EntityManager.ts   # Enemy spawning
    CombatSystem.ts    # Damage formulas
    BattleCircle.ts    # Group attack coordination
    EnemyData.ts       # Enemy definitions
    LootTable.ts       # Drop tables
    ClassData.ts       # Player classes

  store/               # Zustand state
    gameStore.ts       # Runtime game state

  ui/                  # React overlay components
    GameScreen.tsx     # Canvas + HUD
    DebugMap.tsx       # Tile-level debug overlay
    HUD.tsx, Hotbar.tsx, Minimap.tsx, etc.

  bot/
    DungeonBot.ts      # Auto-play state machine

docs/
  dungeon-layer-design.md   # Full dungeon generation design document
  layerprocgen-findings.md  # LayerProcGen research notes
```

## License

See LICENSE.txt
