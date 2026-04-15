import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

/** Weapon swing overlay, damage vignette, and floating damage numbers */
export function CombatFeedback() {
  const attackSwing = useGameStore((s) => s.attackSwing);
  const damageTaken = useGameStore((s) => s.damageTaken);
  const damagePopups = useGameStore((s) => s.damagePopups);
  const cleanPopups = useGameStore((s) => s.cleanPopups);

  // Clean stale popups periodically
  useEffect(() => {
    const interval = setInterval(cleanPopups, 500);
    return () => clearInterval(interval);
  }, [cleanPopups]);

  const now = Date.now();
  const showSwing = attackSwing > 0 && now - attackSwing < 200;
  const showDamage = damageTaken > 0 && now - damageTaken < 300;

  return (
    <>
      {/* Weapon swing slash */}
      {showSwing && <div className="swing-overlay" key={attackSwing} />}

      {/* Red vignette when taking damage */}
      {showDamage && <div className="damage-vignette" key={damageTaken} />}

      {/* Floating damage numbers */}
      {damagePopups.map((popup) => {
        const age = now - popup.time;
        const opacity = Math.max(0, 1 - age / 1200);
        const yOffset = age * 0.03; // float upward
        return (
          <div
            key={popup.id}
            className="damage-popup"
            style={{
              left: `${popup.x}%`,
              top: `${popup.y - yOffset}%`,
              color: popup.color,
              opacity,
            }}
          >
            {popup.text}
          </div>
        );
      })}
    </>
  );
}
