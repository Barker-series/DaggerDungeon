import { useGameStore } from '../store/gameStore';

export function HUD() {
  const floor = useGameStore((s) => s.currentFloor);
  const seed = useGameStore((s) => s.seed);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-stats">
          <span>Floor {floor}</span>
          <span>Seed {seed}</span>
        </div>
      </div>
      <div className="hud-crosshair">+</div>
    </div>
  );
}
