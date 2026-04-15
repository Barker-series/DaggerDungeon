# Dagger Dungeon - Asset List

First-person dungeon crawler with a retro Daggerfall aesthetic. Dark, moody, 1990s fantasy RPG look. Muted color palette, gritty stone and wood, low-fi but readable.

---

## Dungeon Textures

Seamless tileable textures. 512x512 PNG. These tile across walls, floors, and ceilings — must be seamless in all directions.

| # | Filename | Description | Reference |
|---|----------|-------------|-----------|
| 1 | `wall-stone.png` | Rough-cut stone or brick dungeon wall. Dark grey tones, mortar lines visible. Daggerfall crypt style. | Daggerfall dungeon walls, Dark Souls undead burg walls |
| 2 | `floor-dirt.png` | Dungeon floor — could be flagstone, packed dirt, or cracked stone tiles. Brown/grey tones. | Daggerfall dungeon floors |
| 3 | `ceiling-dark.png` | Dark stone ceiling. Subtle texture, mostly dark with faint stone grain. Not too busy — player looks at this a lot. | |
| 4 | `door-wood.png` | Thick wooden door planks. Dark aged wood with iron banding/nails. | Medieval dungeon doors |
| 5 | `stairs-down.png` | Top-down view of descending stone stairs or a trapdoor. Needs to read clearly as "go here to go deeper." Slight green/teal tint OK for gameplay readability. | |

---

## Enemy Sprites

Transparent PNG on all sides. 512x512. Front-facing, full body, centered in frame. These are billboard sprites — they always face the camera in 3D space, so they only need a front view. Bottom of the character should sit at the bottom of the image. Style should be consistent across all enemies.

| # | Filename | Description | Size in game | Personality |
|---|----------|-------------|-------------|-------------|
| 6 | `enemy-rat.png` | Giant dungeon rat. Mangy, aggressive, teeth bared. Low-slung body posture. Brown/dark fur. | Small (knee height) | Fast swarm attacker |
| 7 | `enemy-skeleton.png` | Skeleton warrior. Yellowed bones, tattered cloth/armor remnants, holding a rusted sword. Standing battle pose. | Human sized | Tactical fighter, circles the player |
| 8 | `enemy-bat.png` | Giant cave bat. Wings fully spread, mid-flight. Dark purple/brown. Fangs visible. | Medium (chest height) | Fast hit-and-run swooper |
| 9 | `enemy-imp.png` | Small red demon/imp. Leathery skin, horns, hands glowing with orange fire magic. Hovering slightly off ground. Malicious grin. | Small-medium | Ranged caster, throws fireballs |
| 10 | `enemy-orc.png` | Large orc brute. Green skin, heavy build, crude plate armor, wielding a massive hammer or axe. Intimidating stance. | Large (taller than player) | Slow heavy hitter, devastating attacks |

---

## Item Drops

Transparent PNG. 128x128. These sit on the dungeon floor as pickups. Need to be readable at a glance from first-person perspective looking down at them.

| # | Filename | Description |
|---|----------|-------------|
| 11 | `item-weapon.png` | A sword or dagger laying on the ground with a faint golden glow. Generic "weapon drop" icon. |
| 12 | `item-potion-health.png` | Red potion in a glass bottle/flask. Classic RPG health potion look. |
| 13 | `item-potion-mana.png` | Blue potion in a glass bottle/flask. Same bottle shape as health but blue liquid. |
| 14 | `item-gold.png` | Small pile of gold coins on the ground. Warm golden tones. |

---

## Projectiles

Transparent PNG. 128x128. These fly through the air in 3D space.

| # | Filename | Description |
|---|----------|-------------|
| 15 | `projectile-fireball.png` | Fireball. Bright orange-red core with trailing flame/embers. Reads clearly against dark dungeon backgrounds. |

---

## Props

Transparent PNG. 256x256. Billboard sprites placed in rooms as decoration. Same front-facing billboard approach as enemies.

| # | Filename | Description | Placement |
|---|----------|-------------|-----------|
| 16 | `prop-torch.png` | Wall-mounted torch with flickering flame. Wooden handle, orange fire at top. | Mounted on walls near room entrances |
| 17 | `prop-chest.png` | Wooden treasure chest with iron bands. Closed. | Treasure room floors |
| 18 | `prop-barrel.png` | Wooden barrel, slightly worn. | Room corners, corridors |
| 19 | `prop-bones.png` | Pile of bones and a skull on the ground. | Scattered in crypt rooms |
| 20 | `prop-pillar.png` | Stone pillar/column, cracked and aged. | Large room centers |

---

## UI

Transparent PNG.

| # | Filename | Size | Description |
|---|----------|------|-------------|
| 21 | `ui-crosshair.png` | 64x64 | Simple crosshair/reticle. Thin lines, subtle. White with slight transparency so it doesn't obscure the view. |
| 22 | `ui-weapon-swing.png` | 512x512 | Diagonal slash effect overlay. White/light arc sweep, used as a screen flash when the player attacks. Fades quickly. |

---

## Style Notes

- **Aesthetic**: The Elder Scrolls II: Daggerfall, early 90s CRPGs. Dark, gritty, not cartoonish.
- **Palette**: Muted and desaturated. Stone greys, earthy browns, aged wood tones. Color accents only on magic (fire orange, mana blue, poison green).
- **Lighting context**: The dungeon is dark with warm orange torchlight and heavy fog. Assets will be lit by point lights, so they should look good under warm directional lighting and NOT be pre-lit with strong highlights baked in.
- **Transparency**: All sprites (enemies, items, props, projectiles) must have clean transparent backgrounds. No white fringing.
- **Consistency**: All enemy sprites should look like they belong in the same world. Same level of detail, same rendering style.

---

## Priority

**Immediate need (game is unplayable with colored squares):**
1-5 (dungeon textures), 6-10 (enemies), 12 (health potion), 15 (fireball)

**Second pass (gameplay complete but looks bare):**
11 (weapon drop), 13-14 (mana potion, gold), 16-20 (props)

**Polish:**
21-22 (UI elements)
