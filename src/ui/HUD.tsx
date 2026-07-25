import { useGameStore } from '../store/gameStore';
import { tileBiome } from '../game/dungeon/cells';

export function HUD() {
  const floor = useGameStore((s) => s.currentFloor);
  const level = useGameStore((s) => s.currentLevel);
  const seed = useGameStore((s) => s.seed);
  const dungeon = useGameStore((s) => s.dungeon);
  const playerPos = useGameStore((s) => s.playerPos);

  // Absolute depth into the megastructure, counting every level of every stack
  const depth = floor + (level ?? 0);

  // Live debug: the biome of the tile under the player (null = carved
  // tunnel between active cells)
  const biome = dungeon && playerPos
    ? tileBiome(dungeon.cellBiomes, playerPos.x, playerPos.y) ?? 'tunnel'
    : '—';

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-stats">
          <span>Depth {depth}</span>
          <span>Seed {seed}</span>
          <span>{biome}</span>
        </div>
      </div>
      <div className="hud-crosshair">+</div>
    </div>
  );
}
