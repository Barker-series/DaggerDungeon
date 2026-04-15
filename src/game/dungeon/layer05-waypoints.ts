/**
 * Layer 0.5 — Waypoints (Intent Layer)
 *
 * Reads: Layer 0 noise from all cells
 * Places: Points of interest between spawn and exit
 *
 * Waypoints are the dungeon's DNA — they declare "these are the important places."
 * Every later layer reads them:
 *   - Spine visits them in order
 *   - Branches grow toward nearby waypoints
 *   - Subtraction protects areas near waypoints
 *   - Theming radiates from waypoints
 *   - Entities populate waypoints with meaningful encounters
 */

import { getAllCells, getCell } from './cells';

interface WaypointCandidate {
  cx: number;
  cz: number;
  noise: number;
}

/**
 * Scatter waypoints in high-noise active cells between spawn and exit.
 * Returns ordered list of cell keys: spawn → wp1 → wp2 → ... → exit
 */
export function generateWaypoints(
  _worldSeed: number,
  spawnCx: number, spawnCz: number,
  exitCx: number, exitCz: number,
  count: number,
): string[] {
  // Gather all active cells as candidates, excluding spawn/exit
  const candidates: WaypointCandidate[] = [];
  for (const cell of getAllCells()) {
    if (!cell.active) continue;
    if (cell.cx === spawnCx && cell.cz === spawnCz) continue;
    if (cell.cx === exitCx && cell.cz === exitCz) continue;
    candidates.push({ cx: cell.cx, cz: cell.cz, noise: cell.noise });
  }

  // Sort by noise descending — highest noise cells are the best waypoint locations
  candidates.sort((a, b) => b.noise - a.noise);

  // Pick waypoints that are spread out (not clustered)
  const MIN_WP_DISTANCE = 2; // minimum manhattan distance between waypoints
  const picked: WaypointCandidate[] = [];

  for (const c of candidates) {
    if (picked.length >= count) break;

    // Check distance from all already-picked waypoints
    const tooClose = picked.some(
      (p) => Math.abs(p.cx - c.cx) + Math.abs(p.cz - c.cz) < MIN_WP_DISTANCE,
    );
    if (tooClose) continue;

    // Also check not too close to spawn or exit
    const distSpawn = Math.abs(c.cx - spawnCx) + Math.abs(c.cz - spawnCz);
    const distExit = Math.abs(c.cx - exitCx) + Math.abs(c.cz - exitCz);
    if (distSpawn < 2 || distExit < 2) continue;

    picked.push(c);
  }

  // Order waypoints to create a winding path from spawn to exit.
  // Greedy nearest-neighbor starting from spawn, ending at exit.
  const ordered: WaypointCandidate[] = [];
  const remaining = [...picked];
  let curX = spawnCx;
  let curZ = spawnCz;

  while (remaining.length > 0) {
    // Find the nearest remaining waypoint, but bias toward the general
    // direction of the exit to prevent backtracking
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const wp = remaining[i]!;
      const distFromCur = Math.abs(wp.cx - curX) + Math.abs(wp.cz - curZ);
      const distToExit = Math.abs(wp.cx - exitCx) + Math.abs(wp.cz - exitCz);
      // Score: close to current position + makes progress toward exit
      const score = distFromCur * 1.5 + distToExit * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const next = remaining.splice(bestIdx, 1)[0]!;
    ordered.push(next);
    curX = next.cx;
    curZ = next.cz;
  }

  // Mark cells
  const spawnCell = getCell(spawnCx, spawnCz);
  if (spawnCell) {
    spawnCell.isWaypoint = true;
    spawnCell.waypointOrder = 0;
    spawnCell.waypointRole = 'spawn';
  }

  for (let i = 0; i < ordered.length; i++) {
    const wp = ordered[i]!;
    const cell = getCell(wp.cx, wp.cz);
    if (cell) {
      cell.isWaypoint = true;
      cell.waypointOrder = i + 1;
      // Major waypoints get rooms, minor get smaller features
      cell.waypointRole = wp.noise > 0.6 ? 'major' : 'minor';
    }
  }

  const exitCell = getCell(exitCx, exitCz);
  if (exitCell) {
    exitCell.isWaypoint = true;
    exitCell.waypointOrder = ordered.length + 1;
    exitCell.waypointRole = 'exit';
  }

  // Build ordered key list: spawn → waypoints → exit
  const path: string[] = [`${spawnCx},${spawnCz}`];
  for (const wp of ordered) {
    path.push(`${wp.cx},${wp.cz}`);
  }
  path.push(`${exitCx},${exitCz}`);

  return path;
}
