# Dungeon Generation — Design & Intent

> **Audience:** This document is written for an AI assistant picking up this project in a fresh session. Read this BEFORE touching the dungeon generator code. It explains what we're building, why, and the hard-won lessons from failed attempts.

---

## What This Project Is

DaggerDungeon is a Daggerfall-inspired first-person roguelite dungeon crawler. The dungeon generator is the heart of the game. It needs to produce dungeons that feel **designed** — like a Doom or Quake level from the 90s — not random noise.

## What We Tried and Why It Failed

We went through 4+ iterations of a standard procedural generator (ROT.js Digger, TinyKeep-style scatter+MST, custom A* corridor carving). Every iteration produced flat, boring, disconnected rooms connected by featureless corridors. The core problems:

1. **Generating raw tile grids from scratch** produces random noise, not designed spaces
2. **Single-pass generation** can't make contextual decisions — each step is blind to the big picture
3. **Flat 2D grids** with variable ceiling heights are not real 3D spaces
4. **No guaranteed connectivity** — rooms were frequently unreachable

Every attempt was essentially the same algorithm with different variable names. We need a fundamentally different approach.

## What We're Building Instead

Three ideas combined:

| Idea | Source | Role |
|------|--------|------|
| **LayerProcGen** | [runevision](https://runevision.github.io/LayerProcGen/), [EPC 2024 talk](https://youtu.be/GJWuVwZO98s), [runGame Blame](/run/media/system/4TBDrive/Chris/series/runGame%20Blame/src/game/procgen.ts) | The architecture — build in layers where each layer sees everything below it |
| **Daggerfall block assembly** | [Analysis video](https://youtu.be/35a2fEKIvSI), [Recipes article](https://www.gamedeveloper.com/design/bake-your-own-3d-dungeons-with-procedural-recipes) | The content — assemble pre-authored blocks, don't generate geometry from scratch |
| **Additive/subtractive sculpting** | Conversation with user, 2026-04-14 | The method — layers can add structure or remove it, like sculpting |

---

## The Two Systems

### The Layer System (the grammar)

Decides the **plan** — what goes where, how things connect, what themes apply, where to add and where to subtract. Each layer reads the full output of all previous layers and makes contextual decisions.

**Critical:** This is NOT "run functions in sequence on the same data." The key mechanism from LayerProcGen is that each layer can read **neighboring cells' previous layer output**. This enables contextual decisions across spatial boundaries. Read the [LayerProcGen findings doc](./layerprocgen-findings.md) and the [runGame Blame source](/run/media/system/4TBDrive/Chris/series/runGame%20Blame/src/game/procgen.ts) to understand why this matters.

### The Block Library (the vocabulary)

A library of pre-authored dungeon blocks with standardized connection points. The layer system picks blocks and arranges them. The dungeon feels designed because parts of it literally were designed — just not the arrangement.

For our game (billboard sprites + tile geometry), blocks are small tile patterns — a 5x5 room with pillars, a 3x8 corridor with alcoves, an L-shaped junction, a stairwell. Each block defines its own geometry, ceiling height, connection points, and supported themes.

### CryptJS as Block Content ([github.com/DhrBaksteen/CryptJS](https://github.com/DhrBaksteen/CryptJS))

CryptJS is NOT a dungeon generator — it generates one room. That's exactly what a block is.

CryptJS provides the **interior content** of blocks: 7 pre-authored wall prefabs stored as JSON geometry data, plus a style system for texture variation. These prefabs define what the inside of a room looks like — the architectural detail that makes a space feel designed rather than a flat box.

**The 7 prefab types:**

| Prefab | What it is | Use in blocks |
|--------|-----------|---------------|
| `wall` | Simple flat wall (2 triangles) | Basic corridor walls, small rooms |
| `floor_ceiling` | Floor + ceiling pair | Every block's base |
| `wall_beam` | Wall with protruding wooden beam/pilaster | Corridor blocks, structural feel |
| `wall_round_out` | Convex curved wall section | Round room corners, tower interiors |
| `wall_round_in` | Concave curved wall with floor/ceiling caps | Alcoves, recessed areas |
| `wall_arch` | Gothic arch doorway (37 faces, complex) | Doorways between rooms, grand corridors |
| `wall_inset` | Recessed wall panel | Display alcoves, torch holders, decoration |
| `wall_pillar` | Wall with detailed column + base + capital (113 faces) | Large rooms, throne rooms, temples |

**The style system:**
- Each style defines which prefabs to use for walls, variations, and floors
- Material groups map to texture sets with randomization — one room gets stone variant A, the next gets variant B
- This is how the theming layer (Layer 6) works at the block level — it picks a CryptJS style that matches the noise-driven theme

**What needs porting:** CryptJS uses Three.js r69-era APIs (Geometry, Face3, MeshFaceMaterial — all removed in modern Three.js). The prefab JSON data format is clean and portable. The geometry construction needs rewriting for BufferGeometry. The OBJ-to-JSON converter tool can be reused to add new prefabs.

**How it fits the architecture:**
- The **layer system** decides which block goes where (the grammar)
- **CryptJS prefabs** define what's inside each block (the vocabulary)
- A "medium room" block uses arch walls and pillar prefabs
- A "corridor" block uses beam walls
- The style system selects textures per region based on the theming layer
- New prefabs can be authored in any 3D tool, exported as OBJ, converted to JSON with CryptJS's tool

---

## Block Library

### Block Types

| Type | Size | Connections | Description |
|------|------|-------------|-------------|
| Room — Small | 4x4 to 6x6 | 1-2 exits | Guard room, storage, cell |
| Room — Medium | 7x7 to 10x10 | 2-3 exits | Combat arena, barracks, shrine |
| Room — Large | 11x11 to 14x14 | 3-4 exits | Grand hall, throne room, boss chamber |
| Corridor — Straight | 1x6 to 1x12 | 2 exits (ends) | Narrow hallway |
| Corridor — L-bend | 1-wide L shape | 2 exits | Corner turn |
| Corridor — T-junction | 1-wide T shape | 3 exits | Branch point |
| Corridor — Cross | 1-wide + shape | 4 exits | Intersection |
| Special — Stairwell | 4x4 | 1-2 exits + vertical | Connects two levels, landing at top and bottom |
| Special — Ladder shaft | 2x2 | 1 exit + vertical | Tight vertical connector, faster but exposed |
| Special — Elevator | 3x3 | 1 exit + vertical | Mechanical lift, slow but safe |
| Special — Dead end | 3x3 to 5x5 | 1 exit | Treasure alcove, trap room, loot closet |
| Special — Balcony | varies | 1-2 exits | Overlooks an open space on the level below |
| Special — Bridge | 1x6 to 1x10 | 2 exits | Spans an open shaft or tall room below |
| Special — Open shaft | varies | 0 floor exits | Vertical void — connects visually between levels |
| Border — Seal | varies | 0 exits (seals an opening) | Closes unused connection points |

### Connection Points
Each block edge has standardized connection points at fixed positions. When two blocks are placed adjacent, their connection points align — this is how Daggerfall does it.

### Block Internals
Each block defines:
- Tile pattern (floor, wall, pillar, alcove positions)
- Ceiling height
- Which themes it supports (a pillar room works for crypt or castle, not sewer)
- Difficulty tier (some rooms are inherently harder to fight in)
- Decoration slots (where props can be placed by a later layer)

---

## Layer Stack

### Layer 0 — Boundary + Noise
**Adds:** A noise field over the dungeon area. Defines where dungeon exists vs void. Controls density and overall shape.

No blocks yet. Just the raw shape of the megastructure.

### Layer 1 — Spine Path
**Adds:** Spawn point and exit point. A guaranteed navigable path between them, laid out as a sequence of corridor and room blocks.

**This path is sacred. No later layer can break it.**

The path reads the noise field and follows it — winding through dense areas, avoiding void. The path IS a sequence of blocks: corridor → room → corridor → junction → corridor → room → ... → exit.

Walking the spine from spawn to exit should feel like a complete journey.

### Layer 2 — Branch Growth
**Reads:** Layer 1 spine path, Layer 0 boundary
**Adds:** Side branches growing outward from the spine.

At junctions and room exits along the spine, new branches grow outward. Branches are also sequences of blocks. They can branch further (creating a tree). Branch depth and density are controlled by the noise field.

Branches that would extend into void stop or get sealed with border blocks.

### Layer 3 — Loop Connections
**Reads:** Layer 2 branch structure
**Adds:** Connections between branches to create loops.

A pure tree is boring — every path is a dead end. This layer reads the full branch structure and identifies branch tips that are spatially close. It connects some with corridor blocks, creating loops.

Few loops = linear with side branches (Daggerfall style). Many loops = interconnected web (Dark Souls style).

### Layer 4 — Subtraction
**Reads:** Everything below
**Removes:** Sections of the dungeon.

Collapsed tunnels. Flooded rooms. Chasms. Cave-ins. Reads the spine path and preserves it, but can delete branches, shorten dead ends, or punch holes.

This is what makes the dungeon feel old and lived-in. The noise field influences what gets subtracted.

### Layer 5 — Correction (the grout)
**Reads:** Everything below — the full block layout with all its imperfections
**Fixes:** Gaps, misalignments, disconnections, dead space

Blocks do 80% of the heavy lifting but won't always fit perfectly. This layer fills the gaps with procedural tile generation:

- **Gaps between blocks** — fill with small procedural rooms or corridor segments
- **Disconnected blocks** — bridge with A* corridors
- **Height transitions** — smooth where different ceiling heights meet
- **Spine repair** — if block placement broke the guaranteed path, fix it
- **Edge sealing** — close accidental openings into void

This is the hybrid. Blocks give you the designed feel. The correction layer gives you flexibility. You don't need a perfect block for every situation.

### Layer 6 — Theming
**Reads:** Noise field + surviving geometry
**Assigns:** Visual identity to each block.

The noise field defines regions — crypt, sewer, cave, castle. Transitions are gradual because noise is continuous. No hard room-type boundaries.

### Layer 7 — Detail + Architecture
**Reads:** Themed blocks + surviving geometry
**Adds:** Architectural details within blocks.

Pillars, alcoves, torch sconces, barrels, rubble. Reads block type, theme, and surrounding context. Dead ends get treasure indicators. Spine rooms get grander decoration. Subtracted-adjacent rooms get rubble.

### Layer 8 — Entities
**Reads:** Everything below
**Places:** Enemies, loot, traps, interactive objects.

- Harder enemies deeper along the spine path
- Loot in dead ends and subtracted branch stubs
- Traps near valuable loot and near the exit
- Boss in the largest room furthest from spawn
- Themed enemies match the region (undead in crypt, rats in sewer)

---

## Vertical Dimension — The Ant Farm

The dungeon is not a flat 2D grid. It's a **vertical stack** — multiple levels layered on top of each other, physically connected by stairs, ladders, and elevators.

### How levels relate to each other

Each level's floor plan is generated with full awareness of the level below:

- **Tall rooms below = open air above.** A large room on Level 1 with a high ceiling is a void on Level 2 — you look down from a balcony into the room below.
- **Solid ceiling below = buildable above.** Normal rooms on Level 1 support rooms on Level 2.
- **Connections carry through.** A stairwell on Level 1 requires a matching landing at the same position on Level 2.

### Vertical blocks

- **Stairwell** — walkable staircase connecting two levels
- **Ladder shaft** — tight vertical connector, fast but exposed
- **Elevator** — mechanical lift, slow but safe
- **Balcony** — overlooks open space below, cross-level combat possible
- **Bridge** — spans a vertical void between areas on the same level
- **Open shaft** — pure vertical void, visual connection between levels

### Level generation as a layer dependency

Level N reads Level N-1's complete output as context. It knows where it can build, where voids exist, and where vertical connections are. This is a natural LayerProcGen dependency.

### The infinite ant farm

Once the system generates two connected levels, it generates any number. The dungeon grows as deep as needed. Each level runs the same layer stack with the additional context of the level below.

The player walks down stairs and arrives on the next level seamlessly. No loading screen needed (though we keep a level transition door as a design choice). The dungeon is one continuous 3D space.

---

## Non-Negotiable Constraints

1. **The spine path from spawn to exit must always be navigable.** No exceptions. If any layer breaks it, the correction layer (Layer 5) repairs it.

2. **Do NOT generate raw tile grids from scratch.** Use the block library. Procedural tile generation is ONLY for the correction layer filling gaps between blocks.

3. **Every layer must read context from previous layers.** If a layer ignores what came before, it's wrong. Theming must see the corridor graph. Entities must see the themes. This is the whole point of LayerProcGen.

4. **The dungeon is 3D, not a flat grid.** Multiple levels, height variation, vertical connections. If it looks like a flat maze with colored walls, it's wrong.

5. **Noise drives organic variation.** One continuous noise field influences boundary shape, branch density, subtraction, theming. Don't assign room types randomly.

---

## Key Principles

1. **Blocks are the vocabulary, layers are the grammar.** Arrange pre-authored blocks. Don't generate geometry from scratch.

2. **Blocks do 80%, procedural fills the gaps.** The correction layer patches what blocks can't handle.

3. **Guaranteed path is the anchor.** Sacred. Inviolable. Every layer respects it.

4. **Additive, subtractive, AND corrective.** Layers 1-3 add. Layer 4 removes. Layer 5 fixes. The interplay creates coherent results.

5. **Each layer reacts to full context.** Not generating blind — responding to what previous layers built.

6. **Noise provides organic variation.** One noise field drives coherent variation across the entire dungeon.

7. **Later layers cannot violate earlier guarantees.** The spine is sacred. Everything downstream honors it.

8. **The dungeon feels designed because parts of it are.** Block interiors are authored. The arrangement is procedural. Best of both worlds.

9. **Vertical is just another layer dependency.** Level N reads Level N-1. The same system that builds one floor builds ten.

---

## Reference Code & Research

| Resource | What it teaches |
|----------|----------------|
| [runGame Blame procgen.ts](/run/media/system/4TBDrive/Chris/series/runGame%20Blame/src/game/procgen.ts) | Production LayerProcGen in TypeScript — cell management, layer progression, neighbor dependencies, deterministic seeding |
| [runGame Blame biome.ts](/run/media/system/4TBDrive/Chris/series/runGame%20Blame/src/game/biome.ts) | Layer 4 example — how a layer reads context from all previous layers across a spatial neighborhood |
| [LayerProcGen docs](https://runevision.github.io/LayerProcGen/) | The framework — why layers break circular dependencies, padding mechanism, contextual generation |
| [EPC 2024 talk](https://youtu.be/GJWuVwZO98s) | Video explanation of LayerProcGen by the creator |
| [Daggerfall dungeon analysis](https://youtu.be/35a2fEKIvSI) | How Daggerfall assembles dungeons from modular 3D blocks |
| [Bake Your Own 3D Dungeons](https://www.gamedeveloper.com/design/bake-your-own-3d-dungeons-with-procedural-recipes) | Pseudocode for modular block assembly with connection points and tag-based rules |
| [jongallant/DungeonGenerator](https://github.com/jongallant/DungeonGenerator) | TinyKeep-style: room scatter + physics separation + Delaunay/MST + secondary room discovery |
| [redsled84/mstdungeon](https://github.com/redsled84/mstdungeon) | MST + A* corridor carving on tile grid + pepper tiles for clean corners |
| [DhrBaksteen/CryptJS](https://github.com/DhrBaksteen/CryptJS) | 7 wall prefab types as JSON geometry + style/texture system — this is the block interior content, not a dungeon generator |
| [LayerProcGen findings](./layerprocgen-findings.md) | Our detailed research notes on how LayerProcGen works and why |
