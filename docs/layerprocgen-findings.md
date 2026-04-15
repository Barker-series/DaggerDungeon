# LayerProcGen — Research Findings

Research from the EPC 2024 talk (https://youtu.be/GJWuVwZO98s), the official docs (https://runevision.github.io/LayerProcGen/), and the production reference implementation in runGame Blame (`/run/media/system/4TBDrive/Chris/series/runGame Blame/src/game/procgen.ts`).

---

## The Problem It Solves

Procedural generation faces a false dichotomy: **determinism** (same input = same output) vs **context-sensitivity** (output depends on surroundings). You seemingly can't have both in chunk-based generation because chunks would circularly depend on each other.

## The Core Insight: Layers Break Circular Dependencies

Information only flows **downward** through layers. A chunk at Layer N can freely read any chunk's Layer N-1 output (including neighbors, even distant chunks) because those lower layers are already computed and immutable. No circular dependency is possible because the dependency graph is a **directed acyclic graph (DAG)**.

This is NOT "run 5 functions in sequence on the same data." The critical difference: **each layer can read the previous layer's output on NEIGHBORING cells**, not just the same cell.

## Why Neighbors Matter (from runGame Blame)

- **Layer 1 (Relaxation):** Pushes points away from ALL neighboring cells' points. Without this, points cluster at cell boundaries — visible grid artifact.
- **Layer 2 (Icons/Secondary points):** Needs neighbors' relaxed positions to safely place secondary point spreads without intersection across boundaries.
- **Layer 3 (Connections):** Collects secondary points from a 3×3 cell neighborhood to route connections smoothly across boundaries. Also checks neighbor connections to prevent duplicates.
- **Layer 4 (Biome):** Samples biome influence from a 7×7 cell neighborhood for smooth biome transitions.

**What breaks without neighbor checking:** boundary clusters, fragmented connections, duplicate edges, hard biome seams. The cell grid becomes visible.

## The Wave Pattern

Generation propagates in **concentric rings**:
- Layer 0: widest ring (outer buffer)
- Layer 1: slightly tighter
- Layer 2: tighter
- Layer N: innermost (player-visible area)

Each ring waits for neighbors at the previous layer before advancing. This creates a "shockwave" moving inward from the edges toward the player.

## Three Approaches to Procgen (from Rune's talks)

1. **Functional:** Pure noise. Each point independent. No coherence guarantees.
2. **Simulation:** Natural processes (erosion). Realistic but hard to chunk.
3. **Planning:** Intentional structure (paths exist, locks have keys). LayerProcGen makes planning work at infinite scale.

## How runGame Blame Implements It

```
cellMap: Map<string, CellData>  // key = "cx,cz"

CellData {
  layer: -1 through 4    // tracks progression
  points[]               // Layer 0 output
  secondaryPoints[]      // Layer 2 output
  connections[]           // Layer 3 output
  biome                   // Layer 4 output
}

Each layer function:
1. Guard: if (cell.layer >= N) return
2. Check: all 8 neighbors must be at layer N-1
3. Read: gather data from neighbors' previous layer output
4. Compute: generate this layer's output using that context
5. Advance: cell.layer = N
```

## Applying to DaggerDungeon

A dungeon floor is finite, but the layered architecture still provides value through spatial cells with neighbor dependencies:

### Proposed layer stack

| Layer | What it does | What it reads from neighbors |
|-------|-------------|------------------------------|
| 0 — Skeleton | Place room anchor points in each cell | Nothing (seed only) |
| 1 — Relaxation | Push room anchors apart across cell boundaries | Neighbor Layer 0 anchor positions |
| 2 — Room carving | Size and carve rooms around relaxed anchors, classify main vs secondary | Neighbor Layer 1 positions (to avoid boundary overlap) |
| 3 — Corridors | Connect rooms across cells using Delaunay/MST, carve hallways | Neighbor Layer 2 room positions + carved tiles |
| 4 — Theming | Assign room types, place entrance/exit, height variation | Neighbor Layer 3 corridor graph (so themes flow across cells) |
| 5 — Entities | Place enemies, loot, props based on room type + context | Neighbor Layer 4 themes (so adjacent rooms have coherent difficulty) |

### Why cells matter for a finite dungeon

Dividing the dungeon into a grid of cells (e.g., 4x4 cells of 20x20 tiles each on an 80x80 grid) means:

- Room placement in one cell respects rooms in neighboring cells (relaxation across boundaries)
- Corridors connect rooms across cell boundaries smoothly (Layer 3 reads neighbor Layer 2)
- Theming flows naturally — a crypt section doesn't abruptly become a library at a cell edge
- The generation is parallelizable by ring (outer cells compute lower layers while inner cells advance)

### The key insight

**Don't generate the final tile grid in one shot.** Divide the floor into spatial cells. Build each cell through layers where each layer reads neighbor context from the previous layer. The result is a dungeon that feels designed — rooms connect coherently, themes flow naturally, difficulty ramps intentionally — because each decision was made with full awareness of the surrounding context.

---

## Reference sources

- Video: https://youtu.be/GJWuVwZO98s (EPC 2024 talk by Rune Skovbo Johansen)
- Docs: https://runevision.github.io/LayerProcGen/
- GitHub: https://github.com/runevision/LayerProcGen
- Reference implementation: `/run/media/system/4TBDrive/Chris/series/runGame Blame/src/game/procgen.ts` (618 lines)
- Reference biome layer: `/run/media/system/4TBDrive/Chris/series/runGame Blame/src/game/biome.ts` (368 lines)
- Dungeon algorithms: https://github.com/jongallant/DungeonGenerator (TinyKeep-style), https://github.com/redsled84/mstdungeon (MST + A* corridors)
