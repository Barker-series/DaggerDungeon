import { RNG } from 'rot-js';
import {
  Direction,
  RoomType,
  TileType,
  TILE_SIZE,
  type DungeonData,
  type EnemyInstance,
  type GridPos,
} from './types';
import { ENEMY_DEFS, getEnemyTypesForFloor, enemiesPerRoom } from './EnemyData';

let nextId = 0;

/**
 * Spawn enemies with world-space positions and full AI state.
 */
export function spawnEnemies(dungeon: DungeonData): EnemyInstance[] {
  const enemies: EnemyInstance[] = [];
  const types = getEnemyTypesForFloor(dungeon.floor);
  if (types.length === 0) return enemies;

  const [minPerRoom, maxPerRoom] = enemiesPerRoom(dungeon.floor);

  for (const room of dungeon.rooms) {
    if (room.type !== RoomType.Combat && room.type !== RoomType.Trap && room.type !== RoomType.Boss) {
      continue;
    }

    const count = minPerRoom + Math.floor(RNG.getUniform() * (maxPerRoom - minPerRoom + 1));

    for (let i = 0; i < count; i++) {
      const enemyType = types[Math.floor(RNG.getUniform() * types.length)]!;
      const def = ENEMY_DEFS[enemyType];

      const gridPos = randomRoomPos(room.left, room.top, room.width, room.height, dungeon);
      if (!gridPos) continue;

      // World position = grid center
      const worldX = gridPos.x * TILE_SIZE + TILE_SIZE / 2;
      const worldZ = gridPos.y * TILE_SIZE + TILE_SIZE / 2;

      const hpScale = 1 + (dungeon.floor - 1) * 0.12;
      const scaledHp = Math.floor(def.hp * hpScale);

      enemies.push({
        id: `enemy_${nextId++}`,
        def: { ...def, hp: scaledHp },
        hp: scaledHp,

        worldX,
        worldZ,
        position: gridPos,

        alertLevel: 'idle',
        suspicion: 0,
        lastKnownPlayerX: worldX,
        lastKnownPlayerZ: worldZ,
        lastSeenTime: 0,

        attackPhase: 'none',
        attackTimer: 0,
        currentAttack: null,
        attackCooldown: 1 + Math.random() * 2, // stagger initial attacks

        combatStyle: 'hold',
        combatStyleTimer: 0,
        preferredStrafeDir: Math.random() < 0.5 ? 1 : -1,

        ambientBehavior: 'idle',
        ambientTimer: Math.random() * 3,
        wanderTargetX: worldX,
        wanderTargetZ: worldZ,
        homeX: worldX,
        homeZ: worldZ,
        chatPartnerId: null,

        state: 'alive',
        facing: Direction.North,
      });
    }
  }

  return enemies;
}

function randomRoomPos(
  left: number, top: number, width: number, height: number,
  dungeon: DungeonData,
): GridPos | null {
  for (let attempt = 0; attempt < 10; attempt++) {
    const x = left + Math.floor(RNG.getUniform() * width);
    const y = top + Math.floor(RNG.getUniform() * height);
    const tile = dungeon.tiles[y]?.[x];
    if (tile === TileType.Floor) {
      return { x, y };
    }
  }
  return null;
}
