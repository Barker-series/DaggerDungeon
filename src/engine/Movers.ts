/**
 * Runtime elevator cars.
 *
 * An elevator is a rare pillar replacement with a real central hoistway. It
 * waits at a stop until the player presses F, then travels at a practical
 * freight-elevator speed. The civilization-scale journey comes from future
 * shafts spanning enormous vertical distances—not from making the car crawl.
 *
 * The old oscillating subway cubes were removed. Long-distance rail needs a
 * persistent routed track layer, stations, and underground/elevated segments;
 * a box shuttling across one pillar gap was not a train system.
 */

import * as THREE from 'three';
import type { WorldData } from '../game/types';

const PILLAR_WU = 168; // 56 tiles * 3
const CAR_SPEED = 14; // world units/second: fast industrial transit
/** Hoistway is 12×12. A 0.3-unit edge gap is narrower than the player's
 * collision radius, so the car cannot become a death slot at a stop. */
const CAR_SIZE = 11.4;
const CAR_THICK = 0.6;
const CAR_INTERACT_RADIUS = 5.7;
const CALL_RADIUS = 4;
const STOP_EPSILON = 0.03;

interface CallStation {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  stopY: number;
  name: 'bottom' | 'ground' | 'top';
}

interface Elevator {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  stops: readonly [bottom: number, ground: number, top: number];
  currentY: number;
  targetY: number;
  velocity: number;
  callStations: CallStation[];
  /** Ground alternates between an upward and downward expedition. */
  nextExtreme: 'top' | 'bottom';
}

export class Movers {
  private elevators: Elevator[] = [];
  private group = new THREE.Group();

  constructor(world: WorldData, scene: THREE.Scene) {
    scene.add(this.group);
    const carMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8578,
      roughness: 0.55,
      metalness: 0.45,
    });
    const callMaterial = new THREE.MeshStandardMaterial({
      color: 0xb53022,
      roughness: 0.35,
      metalness: 0.55,
      emissive: 0x481008,
      emissiveIntensity: 1.2,
    });

    for (const spec of world.pillars.values()) {
      if (!spec.elevator) continue;
      const x = spec.cx * PILLAR_WU + PILLAR_WU / 2;
      const z = spec.cz * PILLAR_WU + PILLAR_WU / 2;
      const stops = [spec.baseDepth + 0.5, 0.5, spec.totalHeight] as const;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(CAR_SIZE, CAR_THICK, CAR_SIZE),
        carMaterial,
      );
      mesh.position.set(x, stops[1] - CAR_THICK / 2, z);
      this.group.add(mesh);
      const stopNames = ['bottom', 'ground', 'top'] as const;
      const callStations = stops.map((stopY, index): CallStation => {
        // Large freestanding call box on the south side of the west lobby,
        // close enough to reach without approaching the open shaft edge.
        const stationX = x - 7;
        const stationZ = z + 2.6;
        const stationMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 2.5, 0.8),
          callMaterial,
        );
        stationMesh.position.set(stationX, stopY + 1.25, stationZ);
        this.group.add(stationMesh);
        return {
          mesh: stationMesh,
          x: stationX,
          z: stationZ,
          stopY,
          name: stopNames[index]!,
        };
      });
      this.elevators.push({
        mesh,
        x,
        z,
        stops,
        currentY: stops[1],
        targetY: stops[1],
        velocity: 0,
        callStations,
        nextExtreme: 'top',
      });
    }
  }

  update(dt: number): void {
    for (const elevator of this.elevators) {
      const delta = elevator.targetY - elevator.currentY;
      if (Math.abs(delta) <= STOP_EPSILON) {
        elevator.currentY = elevator.targetY;
        elevator.velocity = 0;
      } else {
        elevator.velocity = Math.sign(delta) * CAR_SPEED;
        const travel = elevator.velocity * dt;
        elevator.currentY = Math.abs(travel) >= Math.abs(delta)
          ? elevator.targetY
          : elevator.currentY + travel;
      }
      elevator.mesh.position.set(
        elevator.x,
        elevator.currentY - CAR_THICK / 2,
        elevator.z,
      );
    }
  }

  /**
   * Operate the nearby car. From ground it alternates top and bottom trips;
   * either extreme returns to ground. This keeps the first interaction model
   * simple while exposing all three meaningful shaft destinations.
   */
  interact(x: number, z: number, feetY: number): string | null {
    // Call boxes work whether the car is present, elsewhere, or already
    // moving. The most recent floor call becomes the current destination.
    for (const elevator of this.elevators) {
      for (const station of elevator.callStations) {
        if (Math.hypot(x - station.x, z - station.z) > CALL_RADIUS) continue;
        if (Math.abs(feetY - station.stopY) > 2.5) continue;
        if (Math.abs(elevator.currentY - station.stopY) <= STOP_EPSILON
          && elevator.velocity === 0) {
          return `Elevator ready at ${station.name}`;
        }
        elevator.targetY = station.stopY;
        return `Elevator called to ${station.name}`;
      }
    }

    let nearest: Elevator | null = null;
    let nearestDistance = Infinity;
    for (const elevator of this.elevators) {
      const distance = Math.hypot(x - elevator.x, z - elevator.z);
      if (distance > CAR_INTERACT_RADIUS || distance >= nearestDistance) continue;
      if (Math.abs(feetY - elevator.currentY) > 2.5) continue;
      nearest = elevator;
      nearestDistance = distance;
    }
    if (!nearest) return null;
    if (nearest.velocity !== 0) return 'Elevator already moving';

    const [bottom, ground, top] = nearest.stops;
    if (Math.abs(nearest.currentY - ground) <= STOP_EPSILON) {
      nearest.targetY = nearest.nextExtreme === 'top' ? top : bottom;
      const destination = nearest.nextExtreme;
      nearest.nextExtreme = nearest.nextExtreme === 'top' ? 'bottom' : 'top';
      return `Elevator departing for ${destination}`;
    }
    nearest.targetY = ground;
    return 'Elevator returning to ground';
  }

  /** Platform ground under (x,z), if the car top is at or below limitY. */
  groundAt(x: number, z: number, limitY: number): number | null {
    let best: number | null = null;
    for (const elevator of this.elevators) {
      if (Math.abs(x - elevator.x) > CAR_SIZE / 2
        || Math.abs(z - elevator.z) > CAR_SIZE / 2) continue;
      const top = elevator.currentY;
      if (top <= limitY + 0.6 && (best === null || top > best)) best = top;
    }
    return best;
  }

  /** Vertical velocity of the car under a standing player. */
  carryVelocity(x: number, z: number, feetY: number): number {
    for (const elevator of this.elevators) {
      if (Math.abs(x - elevator.x) > CAR_SIZE / 2
        || Math.abs(z - elevator.z) > CAR_SIZE / 2) continue;
      if (Math.abs(feetY - elevator.currentY) > 0.5) continue;
      return elevator.velocity;
    }
    return 0;
  }

  dispose(scene: THREE.Scene): void {
    for (const elevator of this.elevators) elevator.mesh.geometry.dispose();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => materials.add(material));
      }
    });
    materials.forEach((material) => material.dispose());
    scene.remove(this.group);
    this.group.clear();
  }
}
