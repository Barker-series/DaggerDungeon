import { useGameStore } from '../store/gameStore';
import { tileBiome } from '../game/dungeon/cells';
import { PILLAR_FACTOR } from '../game/dungeon/pillar-layer';
import { regionAtCell } from '../game/dungeon/region-layer';

const CELL_TILE_SIZE = 14;

export function HUD() {
  const floor = useGameStore((s) => s.currentFloor);
  const level = useGameStore((s) => s.currentLevel);
  const seed = useGameStore((s) => s.seed);
  const dungeon = useGameStore((s) => s.dungeon);
  const world = useGameStore((s) => s.world);
  const playerPos = useGameStore((s) => s.playerPos);

  // Absolute depth into the megastructure, counting every level of every stack
  const depth = floor + (level ?? 0);

  // Live debug: the biome of the tile under the player (null = carved
  // tunnel between active cells)
  const biome = dungeon && playerPos
    ? tileBiome(dungeon.cellBiomes, playerPos.x, playerPos.y) ?? 'tunnel'
    : '—';
  const region = world && playerPos
    ? regionAtCell(
      world.seed + world.stack * 100000,
      world.originPcx * PILLAR_FACTOR + Math.floor(playerPos.x / CELL_TILE_SIZE),
      world.originPcz * PILLAR_FACTOR + Math.floor(playerPos.y / CELL_TILE_SIZE),
    )
    : '—';

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-stats">
          <span>Depth {depth}</span>
          <span>Seed {seed}</span>
          <span>Biome {biome}</span>
          <span>Region {region}</span>
        </div>
      </div>
      <div className="hud-crosshair">+</div>
    </div>
  );
}
