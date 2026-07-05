import { useGameStore } from '../store/gameStore';
import { WORLD_LEVELS } from '../game/types';

export function HUD() {
  const floor = useGameStore((s) => s.currentFloor);
  const level = useGameStore((s) => s.currentLevel);
  const seed = useGameStore((s) => s.seed);

  // Absolute depth into the megastructure, counting every level of every stack
  const depth = (floor - 1) * WORLD_LEVELS + level + 1;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-stats">
          <span>Depth {depth}</span>
          <span>Seed {seed}</span>
        </div>
      </div>
      <div className="hud-crosshair">+</div>
    </div>
  );
}
