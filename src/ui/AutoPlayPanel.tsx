import { useGameStore } from '../store/gameStore';

export function AutoPlayPanel() {
  const autoPlay = useGameStore((s) => s.autoPlay);
  const toggleAutoPlay = useGameStore((s) => s.toggleAutoPlay);
  const floor = useGameStore((s) => s.currentFloor);

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
        </div>
      )}
    </div>
  );
}
