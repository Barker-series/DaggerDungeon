import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { CLASS_DEFS, calcMaxHp, calcMaxMana } from '../game/ClassData';
const CLASSES = Object.values(CLASS_DEFS).filter((c) => c.unlocked);

export function ClassSelect() {
  const [selected, setSelected] = useState(0);
  const startRun = useGameStore((s) => s.startRun);

  const cls = CLASSES[selected]!;
  const hp = calcMaxHp(cls.stats.end);
  const mana = calcMaxMana(cls.stats.int);

  const handleStart = () => {
    startRun(
      cls.name,
      cls.stats,
      hp,
      mana,
      cls.startingWeapon,
      cls.startingItems,
    );
  };

  return (
    <div className="class-screen">
      <div className="class-content">
        <h1 className="class-title">CHOOSE YOUR PATH</h1>

        <div className="class-tabs">
          {CLASSES.map((c, i) => (
            <button
              key={c.name}
              className={`class-tab ${i === selected ? 'class-tab-active' : ''}`}
              onClick={() => setSelected(i)}
            >
              {c.displayName}
            </button>
          ))}
        </div>

        <div className="class-card">
          <h2 className="class-card-name">{cls.displayName}</h2>
          <p className="class-card-desc">{cls.description}</p>

          <div className="class-stats-grid">
            <StatBar label="STR" value={cls.stats.str} />
            <StatBar label="AGI" value={cls.stats.agi} />
            <StatBar label="INT" value={cls.stats.int} />
            <StatBar label="END" value={cls.stats.end} />
            <StatBar label="SPD" value={cls.stats.spd} />
            <StatBar label="LCK" value={cls.stats.lck} />
          </div>

          <div className="class-derived">
            <span>HP: {hp}</span>
            <span>Mana: {mana}</span>
            <span>Weapon: {cls.startingWeapon.name}</span>
          </div>

          <div className="class-passive">
            <span className="class-passive-name">{cls.passive}</span>
            <span className="class-passive-desc">{cls.passiveDesc}</span>
          </div>
        </div>

        <button className="menu-btn menu-btn-primary" onClick={handleStart}>
          Enter the Dungeon
        </button>
      </div>
    </div>
  );
}

function StatBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, (value / 25) * 100);
  return (
    <div className="stat-bar-row">
      <span className="stat-bar-label">{label}</span>
      <div className="stat-bar-track">
        <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="stat-bar-value">{value}</span>
    </div>
  );
}
