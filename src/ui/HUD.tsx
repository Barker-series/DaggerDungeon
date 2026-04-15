import { useGameStore } from '../store/gameStore';

export function HUD() {
  const hp = useGameStore((s) => s.playerHp);
  const maxHp = useGameStore((s) => s.playerMaxHp);
  const mana = useGameStore((s) => s.playerMana);
  const maxMana = useGameStore((s) => s.playerMaxMana);
  const floor = useGameStore((s) => s.currentFloor);
  const kills = useGameStore((s) => s.killCount);
  const gold = useGameStore((s) => s.gold);

  const hpPct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  const manaPct = maxMana > 0 ? (mana / maxMana) * 100 : 0;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-bars">
          <div className="hud-bar">
            <div className="hud-bar-fill hud-bar-hp" style={{ width: `${hpPct}%` }} />
            <span className="hud-bar-text">{hp}/{maxHp}</span>
          </div>
          {maxMana > 0 && (
            <div className="hud-bar">
              <div className="hud-bar-fill hud-bar-mana" style={{ width: `${manaPct}%` }} />
              <span className="hud-bar-text">{mana}/{maxMana}</span>
            </div>
          )}
        </div>
        <div className="hud-stats">
          <span>Floor {floor}</span>
          <span>Kills {kills}</span>
          <span>Gold {gold}</span>
        </div>
      </div>
      <div className="hud-crosshair">+</div>
    </div>
  );
}
