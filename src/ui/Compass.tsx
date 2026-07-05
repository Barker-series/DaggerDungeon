import { useGameStore } from '../store/gameStore';
import { findWorldPathToExit, startLevelFor } from '../game/pathfinding';

/** How many steps ahead along the route to aim at. Pointing a little ahead
 *  guides around corners instead of straight through walls. */
const LOOKAHEAD = 7;

export function Compass() {
  const world = useGameStore((s) => s.world);
  const currentLevel = useGameStore((s) => s.currentLevel);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerY = useGameStore((s) => s.playerY);
  const playerYaw = useGameStore((s) => s.playerYaw);

  if (!world) return null;
  const bottom = world.levels[world.levels.length - 1]!;

  // Fastest walkable route down the whole stack to the bottom stairs
  // (memoized per tile). Mid-ramp, the position belongs to the level that
  // owns the ramp, not the band it passes through.
  const li = startLevelFor(world, playerPos, playerY) ?? currentLevel;
  const path = findWorldPathToExit(world, { level: li, x: playerPos.x, y: playerPos.y });
  const stepsLeft = path.length;
  const onExit =
    stepsLeft === 0 &&
    currentLevel === bottom.level &&
    playerPos.x === bottom.exit.x &&
    playerPos.y === bottom.exit.y;

  // Aim a few steps along the route; fall back to the exit itself if the
  // route is empty (on the exit, or somehow unreachable)
  const target = path[Math.min(LOOKAHEAD - 1, path.length - 1)] ?? bottom.exit;
  const dx = target.x - playerPos.x;
  const dz = target.y - playerPos.y;

  // Camera convention: forward = (-sin(yaw), -cos(yaw)), so the yaw facing
  // the target is atan2(-dx, -dz). Screen-up is the facing direction.
  // With no direction to point (on the exit), keep the arrow upright.
  const targetYaw = onExit || (dx === 0 && dz === 0) ? playerYaw : Math.atan2(-dx, -dz);
  const rotationDeg = (-(targetYaw - playerYaw) * 180) / Math.PI;

  return (
    <div className="compass" title="Fastest route to the stack exit">
      <svg
        className="compass-arrow"
        viewBox="0 0 24 24"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
      >
        <path d="M12 2 L18 20 L12 15.5 L6 20 Z" fill={onExit ? '#66ffaa' : '#3dd68c'} />
      </svg>
      <span className="compass-label">{onExit ? 'EXIT' : `${stepsLeft}`}</span>
    </div>
  );
}
