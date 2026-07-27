/**
 * Kinetic movers — the machines that still function.
 *
 * ELEVATORS: open freight platforms crawling up the east face of tall
 * pillars, grade to crown, at a pace that makes a supertower ride feel
 * like the multi-week climbs of the old world. Ridable: the platform
 * top is real ground and carries the player.
 *
 * TRAINS: a few subway bores still run rolling stock — slow blunt cars
 * shuttling end to end through the dark. The bore is crawl-height; you
 * do not ride them, you press against the wall as they pass.
 *
 * Deterministic: existence and phase derive from the world seed, so
 * every visitor to a seed sees the same machines in the same motion
 * modulo local time. Everything else in the world is static column
 * data; movers are the only runtime geometry.
 */

import * as THREE from 'three';
import type { WorldData } from '../game/types';
import { cellSeed, mulberry32 } from '../game/dungeon/rng';

const PILLAR_WU = 168; // 56 tiles * 3
const ELEVATOR_MIN_HEIGHT = 60;
const ELEVATOR_CHANCE = 0.5;
const ELEVATOR_SPEED = 0.35; // wu/s — glacial by design
const ELEVATOR_SIZE = 4.5;
const ELEVATOR_THICK = 0.6;
const TRAIN_CHANCE = 0.25; // "few trains still function"
const TRAIN_SPEED = 4;
const TRAIN_LEN = 9;
const TRAIN_W = 2.4;
const TRAIN_H = 1.6;
const SUBWAY_FLOOR = -10;

interface Elevator {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  lo: number;
  hi: number;
  phase: number; // 0..1 position along a full up+down cycle
}

interface Train {
  mesh: THREE.Mesh;
  axis: 'x' | 'z';
  fixed: number; // the non-travel coordinate (center of bore)
  lo: number;
  hi: number;
  phase: number;
}

export class Movers {
  private elevators: Elevator[] = [];
  private trains: Train[] = [];
  private group = new THREE.Group();
  private time = 0;

  constructor(world: WorldData, scene: THREE.Scene) {
    scene.add(this.group);
    const seed = world.seed + world.stack * 100000;
    const elevMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.6, metalness: 0.3 });
    const trainMat = new THREE.MeshStandardMaterial({ color: 0x5a4f48, roughness: 0.5, metalness: 0.4, emissive: 0x201008 });

    for (const spec of world.pillars.values()) {
      if (spec.totalHeight < ELEVATOR_MIN_HEIGHT) continue;
      const rng = mulberry32(cellSeed(spec.cx, spec.cz, seed, 9191));
      if (rng() > ELEVATOR_CHANCE) continue;
      // East face, center of the pillar — just off the ring edge (tile
      // 42 of the cell), riding open air beside the wall
      const x = spec.cx * PILLAR_WU + 42 * 3 + ELEVATOR_SIZE / 2;
      const z = spec.cz * PILLAR_WU + PILLAR_WU / 2;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(ELEVATOR_SIZE, ELEVATOR_THICK, ELEVATOR_SIZE), elevMat);
      this.group.add(mesh);
      this.elevators.push({
        mesh, x, z, lo: 2, hi: spec.totalHeight + 0.5, phase: rng(),
      });
    }

    world.subways.forEach((sw, i) => {
      const rng = mulberry32(cellSeed(sw.cx, sw.cz, seed, 9292 + i));
      if (rng() > TRAIN_CHANCE) return;
      const axis: 'x' | 'z' = sw.dir === 'east' ? 'x' : 'z';
      // The bore runs across the gap between the two cores (tiles 42..69
      // of the owning cell along the travel axis, rows 27..29 across)
      const a0 = (sw.dir === 'east' ? sw.cx : sw.cz) * PILLAR_WU + 42 * 3;
      const fixed = (sw.dir === 'east' ? sw.cz : sw.cx) * PILLAR_WU + 28.5 * 3;
      const mesh = new THREE.Mesh(
        axis === 'x'
          ? new THREE.BoxGeometry(TRAIN_LEN, TRAIN_H, TRAIN_W)
          : new THREE.BoxGeometry(TRAIN_W, TRAIN_H, TRAIN_LEN), trainMat);
      this.group.add(mesh);
      this.trains.push({
        mesh, axis, fixed,
        lo: a0 + TRAIN_LEN / 2, hi: a0 + 28 * 3 - TRAIN_LEN / 2, phase: rng(),
      });
    });
  }

  /** Triangle wave 0→1→0 over one cycle */
  private static pingpong(t: number): number {
    const u = t % 1;
    return u < 0.5 ? u * 2 : 2 - u * 2;
  }

  update(dt: number): void {
    this.time += dt;
    for (const e of this.elevators) {
      const cycle = (2 * (e.hi - e.lo)) / ELEVATOR_SPEED;
      const y = e.lo + Movers.pingpong(e.phase + this.time / cycle) * (e.hi - e.lo);
      e.mesh.position.set(e.x, y - ELEVATOR_THICK / 2, e.z);
    }
    for (const t of this.trains) {
      const cycle = (2 * (t.hi - t.lo)) / TRAIN_SPEED;
      const a = t.lo + Movers.pingpong(t.phase + this.time / cycle) * (t.hi - t.lo);
      const y = SUBWAY_FLOOR + TRAIN_H / 2;
      if (t.axis === 'x') t.mesh.position.set(a, y, t.fixed);
      else t.mesh.position.set(t.fixed, y, a);
    }
  }

  /** Platform ground under (x,z), if a mover's top is at or below
   *  limitY — lets the physics stand the player on an elevator. */
  groundAt(x: number, z: number, limitY: number): number | null {
    let best: number | null = null;
    for (const e of this.elevators) {
      if (Math.abs(x - e.x) > ELEVATOR_SIZE / 2 || Math.abs(z - e.z) > ELEVATOR_SIZE / 2) continue;
      const top = e.mesh.position.y + ELEVATOR_THICK / 2;
      if (top <= limitY + 0.6 && (best === null || top > best)) best = top;
    }
    return best;
  }

  /** Vertical velocity of the platform under a standing player —
   *  applied so the ride carries you. */
  carryVelocity(x: number, z: number, feetY: number): number {
    for (const e of this.elevators) {
      if (Math.abs(x - e.x) > ELEVATOR_SIZE / 2 || Math.abs(z - e.z) > ELEVATOR_SIZE / 2) continue;
      const top = e.mesh.position.y + ELEVATOR_THICK / 2;
      if (Math.abs(feetY - top) > 0.5) continue;
      const cycle = (2 * (e.hi - e.lo)) / ELEVATOR_SPEED;
      const u = (e.phase + this.time / cycle) % 1;
      return u < 0.5 ? ELEVATOR_SPEED : -ELEVATOR_SPEED;
    }
    return 0;
  }

  dispose(scene: THREE.Scene): void {
    for (const e of this.elevators) e.mesh.geometry.dispose();
    for (const t of this.trains) t.mesh.geometry.dispose();
    scene.remove(this.group);
    this.group.clear();
  }
}
