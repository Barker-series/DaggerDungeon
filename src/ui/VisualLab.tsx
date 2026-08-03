import { useState } from 'react';
import {
  DEFAULT_VISUAL_SETTINGS,
  type RenderDebugMode,
  type VisualSettings,
} from '../engine/PostProcessing';
import { copyText } from '../utils/copyText';

interface VisualLabProps {
  settings: VisualSettings;
  onChange: (settings: VisualSettings) => void;
  onClose: () => void;
}

interface RangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Range({ label, value, min, max, step, onChange }: RangeProps) {
  const precision = step < 0.01 ? 3 : 2;
  return (
    <label className="visual-control">
      <span><span>{label}</span><output>{value.toFixed(precision)}</output></span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function VisualLab({ settings, onChange, onClose }: VisualLabProps) {
  const [copyLabel, setCopyLabel] = useState('Copy preset');
  const patch = <K extends keyof VisualSettings>(key: K, value: VisualSettings[K]) =>
    onChange({ ...settings, [key]: value });
  const selectRenderMode = (renderMode: RenderDebugMode) => {
    const inspectionMode = renderMode === 'solid' || renderMode === 'normals';
    onChange({
      ...settings,
      renderMode,
      postEnabled: !inspectionMode,
    });
  };

  const copyPreset = async () => {
    const text = JSON.stringify(settings, null, 2);
    const copied = await copyText(text);
    setCopyLabel(copied ? 'Copied' : 'Copy failed');
    window.setTimeout(() => setCopyLabel('Copy preset'), 1600);
  };

  return (
    <div className="visual-lab" role="dialog" aria-label="Visual Lab">
      <header>
        <div>
          <div className="visual-kicker">LIVE RENDER TUNING</div>
          <h2>VISUAL LAB</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Visual Lab">×</button>
      </header>

      <section>
        <h3>Render inspection</h3>
        <div className="visual-segmented">
          {(['lit', 'solid', 'wireframe', 'normals'] as RenderDebugMode[]).map((mode) => (
            <button
              type="button"
              key={mode}
              className={settings.renderMode === mode ? 'active' : ''}
              onClick={() => selectRenderMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label className="visual-toggle">
          <span>Post processing</span>
          <input
            type="checkbox"
            checked={settings.postEnabled}
            onChange={(event) => patch('postEnabled', event.currentTarget.checked)}
          />
        </label>
        <label className="visual-toggle">
          <span>Bloom</span>
          <input
            type="checkbox"
            checked={settings.bloomEnabled}
            onChange={(event) => patch('bloomEnabled', event.currentTarget.checked)}
          />
        </label>
        <Range label="Bloom strength" value={settings.bloomStrength} min={0} max={1} step={0.01}
          onChange={(value) => patch('bloomStrength', value)} />
        <Range label="Bloom radius" value={settings.bloomRadius} min={0} max={1} step={0.01}
          onChange={(value) => patch('bloomRadius', value)} />
        <Range label="Bloom cutoff" value={settings.bloomThreshold} min={0} max={0.25} step={0.005}
          onChange={(value) => patch('bloomThreshold', value)} />
        <div className="visual-control-note">
          Cutoff 0 blooms everything; higher values isolate highlights.
        </div>
      </section>

      <section>
        <h3>Ambient occlusion</h3>
        <label className="visual-toggle">
          <span>SSAO (GTAO)</span>
          <input
            type="checkbox"
            checked={settings.aoEnabled}
            onChange={(event) => patch('aoEnabled', event.currentTarget.checked)}
          />
        </label>
        <Range label="AO intensity" value={settings.aoIntensity} min={0} max={1} step={0.01}
          onChange={(value) => patch('aoIntensity', value)} />
        <Range label="AO radius" value={settings.aoRadius} min={0.3} max={2} step={0.05}
          onChange={(value) => patch('aoRadius', value)} />
        <div className="visual-control-note">
          Depth-based crevice shading. Radius is in world units.
        </div>
      </section>

      <section>
        <h3>Finish</h3>
        <Range label="Contrast" value={settings.contrast} min={0.8} max={1.2} step={0.01}
          onChange={(value) => patch('contrast', value)} />
        <Range label="Saturation" value={settings.saturation} min={0} max={1.5} step={0.01}
          onChange={(value) => patch('saturation', value)} />
        <Range label="Vignette" value={settings.vignette} min={0} max={0.5} step={0.01}
          onChange={(value) => patch('vignette', value)} />
      </section>

      <footer>
        <button type="button" onClick={() => onChange({ ...DEFAULT_VISUAL_SETTINGS })}>
          Reset
        </button>
        <button type="button" className="visual-copy" onClick={() => void copyPreset()}>
          {copyLabel}
        </button>
      </footer>
      <div className="visual-hint">Press V to close · changes are saved locally</div>
    </div>
  );
}
