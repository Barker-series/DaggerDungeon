# Modular Asset Handoff

This is the contract for replaceable authored geometry used by the procedural
world. LayerProcGen decides which module exists and where it connects; a GLB
supplies the visible asset.

## Scale and orientation

- 1 Blender meter = 1 game world unit.
- One dungeon tile is 3 m × 3 m.
- Standard floor-to-floor height is 3 m.
- The player eye is 1.6 m above the walking surface.
- +Y is up.
- Asset forward is -Z.
- Apply transforms before export: location 0, rotation 0, scale 1.
- Put the object origin at the center of its bottom footprint unless a module
  specification says otherwise.

## Delivery format

- Send one `.glb` file per replaceable module.
- Keep the editable `.blend` source beside it when possible.
- Use metric units.
- Triangulation on export is acceptable.
- Do not bake world position into the mesh.
- Keep collision proxies as separately named objects beginning with `COL_`.
- Keep sockets as empty nodes beginning with `SOCKET_`.

## Initial module sizes

| Module | Nominal envelope | Required origin/socket |
| --- | --- | --- |
| Straight stair flight | 3 m wide × 6 m long × 3 m rise | origin at lower landing center; `SOCKET_TOP` |
| Structural column | 3 m × 3 m × 3 m segment | bottom-center origin; stackable top face |
| Wall panel | 3 m wide × 3 m high × ≤0.35 m deep | bottom-center origin |
| Floor slab | 3 m × 3 m × 0.3 m | top walking surface at Y=0 |
| Beam | 3 m long × ≤0.6 m square | origin centered; long axis on X |
| Door frame | 3 m wide × 3 m high × ≤0.5 m deep | bottom-center origin |
| Light fixture | ≤0.75 m envelope | `SOCKET_LIGHT` at emission point |

These envelopes are replacement targets, not creative restrictions. Modules
may extend beyond them when that is intentional, but their sockets and walking
surfaces must remain compatible.

## Materials

- Prefer one material per module and reuse material names across a kit.
- Use metallic/roughness PBR.
- Base-color and emissive textures are sRGB.
- Normal, roughness, metallic, and AO textures are non-color data.
- Avoid unique 4K textures for small modules.
- Trim sheets and shared atlases are encouraged.
- Concrete modules should expose clean material groups that the runtime can
  tint or swap by region.

## Naming

Use descriptive stable identifiers:

```text
column_heavy_a.glb
column_heavy_b.glb
stair_straight_3x6.glb
beam_braced_3m.glb
wall_service_panel_3m.glb
light_cage_wall.glb
```

The generator will reference these identifiers through a module catalog, so a
new GLB with the same identifier can replace an asset without changing world
generation.

## Reference-asset workflow

For each new module family, the project should export a plain reference GLB
containing:

1. The exact bounding envelope.
2. A player-height marker.
3. Required socket empties.
4. A simple collision proxy.
5. A placeholder mesh that already works in-game.

Edit or replace the placeholder in Blender without moving the origin or
sockets, export it under the same module identifier, and return the GLB.
