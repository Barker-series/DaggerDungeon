import { useGameStore } from '../store/gameStore';

export function MainMenu() {
  const setScreen = useGameStore((s) => s.setScreen);
  const seed = useGameStore((s) => s.seed);
  const setSeed = useGameStore((s) => s.setSeed);

  const randomize = () => setSeed(Math.floor(Math.random() * 999999));

  return (
    <div className="menu-screen">
      <div className="menu-content">
        <h1 className="menu-title">DAGGER DUNGEON</h1>
        <p className="menu-subtitle">A Daggerfall-Inspired Roguelite</p>
        <div className="menu-buttons">
          <button
            className="menu-btn menu-btn-primary"
            onClick={() => setScreen('classSelect')}
          >
            New Run
          </button>
        </div>
        <div className="seed-input">
          <label className="seed-label">Seed</label>
          <input
            className="seed-field"
            type="number"
            value={seed}
            onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
          />
          <button className="seed-random" onClick={randomize}>
            Randomize
          </button>
        </div>
        <div className="menu-footer">
          <span>LMB attack | WASD move | E interact | P auto-play</span>
        </div>
      </div>
    </div>
  );
}
