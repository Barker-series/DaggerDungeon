/**
 * Layer 1 — Spine Path
 *
 * Reads: Layer 0 noise + waypoints from Layer 0.5
 * Adds: Guaranteed navigable path visiting all waypoints in order
 *
 * The spine is SACRED. No later layer can break it.
 * Routes: spawn → wp1 → wp2 → ... → exit via A* segments.
 */

import { type DungeonCell, getCell, neighborsAtLayer } from './cells';
import { getRandomBlock } from './blocks';
import { cellSeed, mulberry32 } from './rng';

export function generateLayer1(cell: DungeonCell, worldSeed: number, layerNum: number = 1): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  const rng = mulberry32(cellSeed(cell.cx, cell.cz, worldSeed, 100));
  cell.spineBlocks = [];

  if (!cell.active) {
    cell.layer = layerNum;
    return;
  }

  // Spine marking is done externally. If marked, place a block.
  if (cell.isSpine) {
    // Waypoints get rooms, regular spine cells get corridors
    if (cell.isWaypoint) {
      const def = cell.waypointRole === 'major' || cell.waypointRole === 'spawn' || cell.waypointRole === 'exit'
        ? getRandomBlock('room', rng)
        : getRandomBlock('room', rng);
      cell.spineBlocks.push({ def, gridX: 0, gridZ: 0, rotation: 0 });
    } else {
      const def = getRandomBlock('corridor', rng);
      cell.spineBlocks.push({ def, gridX: 0, gridZ: 0, rotation: 0 });
    }
  }

  cell.layer = 1;
}

/**
 * Compute spine path that visits waypoints in order.
 * Uses a wandering walk between each waypoint pair — NOT A*.
 * A* always finds the shortest path which produces boring straight lines.
 * The wandering walk meanders, creating an interesting journey.
 */
export function computeSpineThroughWaypoints(
  waypointKeys: string[],
  gridSize: number,
  worldSeed: number,
): Set<string> {
  const spineSet = new Set<string>();
  const rng = mulberry32(cellSeed(0, 0, worldSeed, 150));

  for (let i = 0; i < waypointKeys.length - 1; i++) {
    const [fromCx, fromCz] = waypointKeys[i]!.split(',').map(Number) as [number, number];
    const [toCx, toCz] = waypointKeys[i + 1]!.split(',').map(Number) as [number, number];

    const segment = wanderPath(fromCx, fromCz, toCx, toCz, gridSize, rng);
    for (const key of segment) {
      spineSet.add(key);
    }
  }

  return spineSet;
}

/**
 * Wandering walk from A to B. Each step:
 * - 60% chance: move toward destination (on whichever axis is farther)
 * - 25% chance: move perpendicular (creates winding)
 * - 15% chance: move toward destination on the shorter axis
 * Stays within grid bounds. Avoids revisiting cells.
 * Guaranteed to reach destination (falls back to direct if stuck).
 */
function wanderPath(
  x1: number, z1: number, x2: number, z2: number,
  gridSize: number, rng: () => number,
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let x = x1, z = z1;
  const maxSteps = gridSize * 3; // safety limit

  for (let step = 0; step < maxSteps; step++) {
    const key = `${x},${z}`;
    if (!visited.has(key)) {
      path.push(key);
      visited.add(key);
    }

    if (x === x2 && z === z2) break;

    const dx = x2 - x;
    const dz = z2 - z;
    const absDx = Math.abs(dx);
    const absDz = Math.abs(dz);

    // If very close to destination, go direct
    if (absDx + absDz <= 2) {
      if (absDx > 0) x += Math.sign(dx);
      else z += Math.sign(dz);
      continue;
    }

    const roll = rng();
    let nx = x, nz = z;

    if (roll < 0.6) {
      // Move toward destination on the longer axis
      if (absDx >= absDz) nx += Math.sign(dx);
      else nz += Math.sign(dz);
    } else if (roll < 0.85) {
      // Move perpendicular — this is what creates the winding
      if (absDx >= absDz) {
        nz += rng() < 0.5 ? 1 : -1;
      } else {
        nx += rng() < 0.5 ? 1 : -1;
      }
    } else {
      // Move toward destination on the shorter axis
      if (absDx < absDz && absDx > 0) nx += Math.sign(dx);
      else if (absDz > 0) nz += Math.sign(dz);
      else nx += Math.sign(dx);
    }

    // Bounds check
    if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;

    // Prefer active cells — skip inactive unless no choice
    const targetCell = getCell(nx, nz);
    if (!targetCell?.active && rng() < 0.7) continue;

    // Avoid revisiting unless stuck
    if (visited.has(`${nx},${nz}`) && rng() < 0.8) continue;

    x = nx;
    z = nz;
  }

  // Make sure we actually reached the destination
  if (x !== x2 || z !== z2) {
    // Direct walk to finish
    while (x !== x2) {
      x += Math.sign(x2 - x);
      path.push(`${x},${z}`);
    }
    while (z !== z2) {
      z += Math.sign(z2 - z);
      path.push(`${x},${z}`);
    }
  }

  return path;
}
