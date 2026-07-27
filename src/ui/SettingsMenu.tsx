interface SettingsMenuProps {
  brightness: number;
  mouseSensitivity: number;
  playerSpeed: number;
  onBrightnessChange: (value: number) => void;
  onMouseSensitivityChange: (value: number) => void;
  onPlayerSpeedChange: (value: number) => void;
  onRestoreDefaults: () => void;
  onResume: () => void;
}

export function SettingsMenu({
  brightness,
  mouseSensitivity,
  playerSpeed,
  onBrightnessChange,
  onMouseSensitivityChange,
  onPlayerSpeedChange,
  onRestoreDefaults,
  onResume,
}: SettingsMenuProps) {
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="settings-panel">
        <div className="settings-kicker">GAME PAUSED</div>
        <h2 id="settings-title" className="settings-title">SETTINGS</h2>

        <label className="settings-control">
          <span className="settings-control-row">
            <span>Brightness</span>
            <output>{brightness.toFixed(2)}×</output>
          </span>
          <input
            aria-label="Brightness"
            type="range"
            min="0.5"
            max="4"
            step="0.05"
            value={brightness}
            onInput={(event) => onBrightnessChange(Number(event.currentTarget.value))}
          />
        </label>

        <label className="settings-control">
          <span className="settings-control-row">
            <span>Mouse sensitivity</span>
            <output>{mouseSensitivity.toFixed(2)}×</output>
          </span>
          <input
            aria-label="Mouse sensitivity"
            type="range"
            min="0.25"
            max="5"
            step="0.05"
            value={mouseSensitivity}
            onInput={(event) => onMouseSensitivityChange(Number(event.currentTarget.value))}
          />
        </label>

        <label className="settings-control">
          <span className="settings-control-row">
            <span>Player speed</span>
            <output>{playerSpeed.toFixed(2)}×</output>
          </span>
          <input
            aria-label="Player speed"
            type="range"
            min="1"
            max="10"
            step="0.05"
            value={playerSpeed}
            onInput={(event) => onPlayerSpeedChange(Number(event.currentTarget.value))}
          />
        </label>

        <div className="settings-actions">
          <button className="settings-defaults" type="button" onClick={onRestoreDefaults}>
            Restore Defaults
          </button>
          <button className="settings-resume" type="button" onClick={onResume}>
            Resume
          </button>
        </div>
        <div className="settings-hint">Press Escape to close</div>
      </div>
    </div>
  );
}
