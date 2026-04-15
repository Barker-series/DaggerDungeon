import { useGameStore } from '../store/gameStore';

export function AutoPlayPanel() {
  const autoPlay = useGameStore((s) => s.autoPlay);
  const toggleAutoPlay = useGameStore((s) => s.toggleAutoPlay);
  const floor = useGameStore((s) => s.currentFloor);
  const kills = useGameStore((s) => s.killCount);
  const hp = useGameStore((s) => s.playerHp);
  const maxHp = useGameStore((s) => s.playerMaxHp);

  return (
    <div className="autoplay-panel">
      <button
        className={`autoplay-btn ${autoPlay ? 'autoplay-active' : ''}`}
        onClick={toggleAutoPlay}
      >
        {autoPlay ? 'STOP BOT' : 'AUTO'}
      </button>
      {autoPlay && (
        <div className="autoplay-stats">
          <span>F{floor}</span>
          <span>K{kills}</span>
          <span>{hp}/{maxHp}</span>
        </div>
      )}
    </div>
  );
}
