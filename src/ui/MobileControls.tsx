import { useCallback } from 'react';

interface MobileControlsProps {
  onAction: (action: string) => void;
}

/**
 * Touch D-pad overlay for mobile play.
 * Renders directional buttons + interact.
 */
export function MobileControls({ onAction }: MobileControlsProps) {
  const btn = useCallback(
    (action: string, label: string, className: string) => (
      <button
        className={`mobile-btn ${className}`}
        onPointerDown={(e) => {
          e.preventDefault();
          onAction(action);
        }}
      >
        {label}
      </button>
    ),
    [onAction],
  );

  return (
    <div className="mobile-controls">
      {/* Left side: movement D-pad */}
      <div className="mobile-dpad">
        <div className="mobile-dpad-row">
          {btn('moveForward', '\u25B2', 'mobile-btn-up')}
        </div>
        <div className="mobile-dpad-row">
          {btn('strafeLeft', '\u25C0', 'mobile-btn-left')}
          {btn('moveBackward', '\u25BC', 'mobile-btn-down')}
          {btn('strafeRight', '\u25B6', 'mobile-btn-right')}
        </div>
      </div>

      {/* Right side: turn + actions */}
      <div className="mobile-actions">
        <div className="mobile-dpad-row">
          {btn('turnLeft', '\u21B6', 'mobile-btn-turn')}
          {btn('turnRight', '\u21B7', 'mobile-btn-turn')}
        </div>
        <div className="mobile-dpad-row">
          {btn('interact', 'F', 'mobile-btn-interact')}
        </div>
      </div>
    </div>
  );
}
