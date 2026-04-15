import { useGameStore } from '../store/gameStore';

export function DeathScreen() {
  const floor = useGameStore((s) => s.currentFloor);
  const kills = useGameStore((s) => s.killCount);
  const gold = useGameStore((s) => s.gold);
  const shards = useGameStore((s) => s.soulShardsEarned);
  const resetRun = useGameStore((s) => s.resetRun);

  return (
    <div className="death-screen">
      <div className="death-content">
        <h1 className="death-title">YOU HAVE FALLEN</h1>
        <p className="death-subtitle">The dungeon claims another soul...</p>

        <div className="death-stats">
          <div className="death-stat">
            <span className="death-stat-label">Floors Cleared</span>
            <span className="death-stat-value">{floor - 1}</span>
          </div>
          <div className="death-stat">
            <span className="death-stat-label">Enemies Slain</span>
            <span className="death-stat-value">{kills}</span>
          </div>
          <div className="death-stat">
            <span className="death-stat-label">Gold Found</span>
            <span className="death-stat-value">{gold}</span>
          </div>
          <div className="death-stat">
            <span className="death-stat-label">Soul Shards</span>
            <span className="death-stat-value death-shards">+{shards}</span>
          </div>
        </div>

        <button className="menu-btn menu-btn-primary" onClick={resetRun}>
          Return to Surface
        </button>
      </div>
    </div>
  );
}
