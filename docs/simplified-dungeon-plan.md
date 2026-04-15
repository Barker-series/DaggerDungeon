# Simplified Dungeon Generator — The Actual Plan

Stop overcomplicating this. Six steps.

1. **Flat tile grid** — start with an 80x80 grid of wall tiles. That's it.
2. **Spine path carves floor tiles directly** — wandering walk from spawn to exit through waypoints. Carve floor tiles along the path. No blocks. No cells. Just tiles.
3. **Rooms carved at waypoints** — each waypoint becomes a rectangular room. Just set tiles to floor in a rectangle. Different sizes based on waypoint role.
4. **Corridors connect rooms** — 2-tile wide carved lines between rooms. Simple L-shaped or direct paths.
5. **CryptJS prefab geometry built per room** — for each carved room, build 3D wall geometry using CryptJS prefabs (arches, pillars, beams) based on the room's tile footprint.
6. **Done.** Output DungeonData. No 8 layers. No cell grid. Just carve tiles and build geometry.
