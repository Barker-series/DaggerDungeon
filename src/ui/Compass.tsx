import { useGameStore } from '../store/gameStore';

export function Compass() {
  const playerYaw = useGameStore((s) => s.playerYaw);

  // HEADING needle on a north-up dial — the same convention as the
  // minimap's player arrow (yaw 0 = north/-Z; yaw +90° = west/-X, so the
  // needle swings LEFT). The old sign rotated the needle the other way,
  // which read as east/west swapped against the minimap.
  const rotationDeg = (-playerYaw * 180) / Math.PI;

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
