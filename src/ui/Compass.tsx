import { useGameStore } from '../store/gameStore';

export function Compass() {
  const playerYaw = useGameStore((s) => s.playerYaw);

  // Camera yaw 0 faces world north (-Z). Rotate the fixed north needle
  // against the player's heading so it always indicates absolute north.
  const rotationDeg = (playerYaw * 180) / Math.PI;

  return (
    <div className="compass" title="North">
      <svg
        className="compass-arrow"
        viewBox="0 0 24 24"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        <path d="M12 2 L18 20 L12 15.5 L6 20 Z" fill="#3dd68c" />
      </svg>
    </div>
  );
}
