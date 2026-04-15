import { useGameStore } from '../store/gameStore';
import type { WeaponItem, ConsumableItem } from '../game/types';

export function Hotbar() {
  const weapon = useGameStore((s) => s.weapon) as WeaponItem | null;
  const hotbar = useGameStore((s) => s.hotbar);
  const heal = useGameStore((s) => s.heal);
  const removeFromHotbar = useGameStore((s) => s.removeFromHotbar);

  const useItem = (slot: number) => {
    const item = hotbar[slot] as ConsumableItem | null;
    if (!item) return;

    if (item.type === 'health_potion') {
      heal(item.effect);
      removeFromHotbar(slot);
    } else if (item.type === 'mana_potion') {
      removeFromHotbar(slot);
    }
  };

  return (
    <div className="hotbar">
      {/* Weapon */}
      <div className="hotbar-slot hotbar-weapon">
        <span className="hotbar-label">LMB</span>
        {weapon && <span className="hotbar-item-name">{weapon.name}</span>}
        {!weapon && <span className="hotbar-empty">fists</span>}
      </div>

      {/* Item slots: 1, 2, 3 */}
      {([1, 2, 3] as const).map((num) => {
        const idx = num - 1;
        const item = hotbar[idx];
        return (
          <button
            key={num}
            className="hotbar-slot"
            onClick={() => useItem(idx)}
            disabled={!item}
          >
            <span className="hotbar-label">{num}</span>
            {item && <span className="hotbar-item-name">{item.name}</span>}
          </button>
        );
      })}
    </div>
  );
}
