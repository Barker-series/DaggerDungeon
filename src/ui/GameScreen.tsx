import { useEffect, useRef, useCallback, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { useGameStore } from '../store/gameStore';
import { HUD } from './HUD';
import { Compass } from './Compass';
import { Minimap } from './Minimap';
import { MobileControls } from './MobileControls';
import { AutoPlayPanel } from './AutoPlayPanel';
import { DebugMap } from './DebugMap';
import { EditorHUD } from './EditorHUD';
import { SettingsMenu } from './SettingsMenu';
import { VisualLab } from './VisualLab';
import {
  DEFAULT_VISUAL_SETTINGS,
  type VisualSettings,
} from '../engine/PostProcessing';
import type { InputAction } from '../engine/InputManager';

const BRIGHTNESS_KEY = 'dagger-dungeon-brightness';
const RENDER_SCALE_KEY = 'dagger-dungeon-render-scale';
const SENSITIVITY_KEY = 'dagger-dungeon-mouse-sensitivity';
const PLAYER_SPEED_KEY = 'dagger-dungeon-player-speed';
const FPS_CAP_KEY = 'dagger-dungeon-fps-cap-60';
const VISUAL_SETTINGS_KEY = 'dagger-dungeon-visual-settings-v4';
const DEFAULT_BRIGHTNESS = 1.2;
const DEFAULT_MOUSE_SENSITIVITY = 1;
const DEFAULT_PLAYER_SPEED = 1;

function loadSetting(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampVisual(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function loadVisualSettings(): VisualSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(VISUAL_SETTINGS_KEY) ?? '');
    if (saved.version !== 6) return { ...DEFAULT_VISUAL_SETTINGS };
    return {
      ...DEFAULT_VISUAL_SETTINGS,
      ...saved,
      version: 6,
      bloomStrength: clampVisual(saved.bloomStrength, 0, 1, DEFAULT_VISUAL_SETTINGS.bloomStrength),
      bloomRadius: clampVisual(saved.bloomRadius, 0, 1, DEFAULT_VISUAL_SETTINGS.bloomRadius),
      bloomThreshold: clampVisual(saved.bloomThreshold, 0, 0.25, DEFAULT_VISUAL_SETTINGS.bloomThreshold),
      contrast: clampVisual(saved.contrast, 0.8, 1.2, DEFAULT_VISUAL_SETTINGS.contrast),
      saturation: clampVisual(saved.saturation, 0, 1.5, DEFAULT_VISUAL_SETTINGS.saturation),
      vignette: clampVisual(saved.vignette, 0, 0.5, DEFAULT_VISUAL_SETTINGS.vignette),
      aoEnabled: typeof saved.aoEnabled === 'boolean' ? saved.aoEnabled : DEFAULT_VISUAL_SETTINGS.aoEnabled,
      aoIntensity: clampVisual(saved.aoIntensity, 0, 1, DEFAULT_VISUAL_SETTINGS.aoIntensity),
      aoRadius: clampVisual(saved.aoRadius, 0.3, 2, DEFAULT_VISUAL_SETTINGS.aoRadius),
    };
  } catch {
    return { ...DEFAULT_VISUAL_SETTINGS };
  }
}

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockUnavailable, setPointerLockUnavailable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visualLabOpen, setVisualLabOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef<number | null>(null);
  const [visualSettings, setVisualSettings] = useState(loadVisualSettings);
  const [brightness, setBrightness] = useState(() => loadSetting(BRIGHTNESS_KEY, DEFAULT_BRIGHTNESS));
  const [renderScale, setRenderScale] = useState(() => loadSetting(RENDER_SCALE_KEY, 1));
  const [mouseSensitivity, setMouseSensitivity] = useState(() =>
    loadSetting(SENSITIVITY_KEY, DEFAULT_MOUSE_SENSITIVITY),
  );
  const [playerSpeed, setPlayerSpeed] = useState(() =>
    loadSetting(PLAYER_SPEED_KEY, DEFAULT_PLAYER_SPEED),
  );
  const [fpsCap60, setFpsCap60] = useState(() => localStorage.getItem(FPS_CAP_KEY) === '1');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, (message) => {
      setNotice(message);
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(''), 1800);
    });
    engineRef.current = engine;
    if (import.meta.env.DEV) {
      (window as unknown as { __engine?: GameEngine }).__engine = engine;
    }

    const seed = useGameStore.getState().seed;
    engine.loadStack(1, seed);
    engine.start();

    // Track pointer lock state for the overlay
    const onLockChange = () => {
      setPointerLocked(document.pointerLockElement === canvas);
    };
    document.addEventListener('pointerlockchange', onLockChange);

    return () => {
      engine.stop();
      engineRef.current = null;
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrightness(brightness);
    localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
  }, [brightness]);

  useEffect(() => {
    engineRef.current?.setRenderScale(renderScale);
    localStorage.setItem(RENDER_SCALE_KEY, String(renderScale));
  }, [renderScale]);

  useEffect(() => {
    engineRef.current?.setMouseSensitivity(mouseSensitivity);
    localStorage.setItem(SENSITIVITY_KEY, String(mouseSensitivity));
  }, [mouseSensitivity]);

  useEffect(() => {
    engineRef.current?.setPlayerSpeed(playerSpeed);
    localStorage.setItem(PLAYER_SPEED_KEY, String(playerSpeed));
  }, [playerSpeed]);

  useEffect(() => {
    engineRef.current?.setFpsCap(fpsCap60 ? 60 : 0);
    localStorage.setItem(FPS_CAP_KEY, fpsCap60 ? '1' : '0');
  }, [fpsCap60]);

  useEffect(() => {
    engineRef.current?.setVisualSettings(visualSettings);
    localStorage.setItem(VISUAL_SETTINGS_KEY, JSON.stringify(visualSettings));
  }, [visualSettings]);

  const setPaused = useCallback((paused: boolean) => {
    setSettingsOpen(paused);
    engineRef.current?.setPaused(paused);
    if (paused && document.pointerLockElement) document.exitPointerLock();
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.repeat) return;
      event.preventDefault();
      if (visualLabOpen) {
        setVisualLabOpen(false);
        engineRef.current?.setPaused(false);
        return;
      }
      setSettingsOpen((open) => {
        const next = !open;
        engineRef.current?.setPaused(next);
        if (next && document.pointerLockElement) document.exitPointerLock();
        return next;
      });
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [visualLabOpen]);

  useEffect(() => {
    const onVisualLabKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyV' || event.repeat || settingsOpen) return;
      event.preventDefault();
      setVisualLabOpen((open) => {
        const next = !open;
        engineRef.current?.setPaused(next);
        if (next && document.pointerLockElement) document.exitPointerLock();
        return next;
      });
    };
    window.addEventListener('keydown', onVisualLabKey);
    return () => window.removeEventListener('keydown', onVisualLabKey);
  }, [settingsOpen]);

  const handleMobileAction = useCallback((action: string) => {
    engineRef.current?.pushAction(action as InputAction);
  }, []);

  const handleBrightnessChange = useCallback((value: number) => {
    // Apply directly during the range input event so the paused scene
    // previews the new exposure without waiting for React's next effect.
    engineRef.current?.setBrightness(value);
    setBrightness(value);
    localStorage.setItem(BRIGHTNESS_KEY, String(value));
  }, []);

  const handleRestoreDefaults = useCallback(() => {
    engineRef.current?.setBrightness(DEFAULT_BRIGHTNESS);
    engineRef.current?.setMouseSensitivity(DEFAULT_MOUSE_SENSITIVITY);
    engineRef.current?.setPlayerSpeed(DEFAULT_PLAYER_SPEED);
    setBrightness(DEFAULT_BRIGHTNESS);
    setMouseSensitivity(DEFAULT_MOUSE_SENSITIVITY);
    setPlayerSpeed(DEFAULT_PLAYER_SPEED);
    setFpsCap60(false);
    localStorage.setItem(BRIGHTNESS_KEY, String(DEFAULT_BRIGHTNESS));
    localStorage.setItem(SENSITIVITY_KEY, String(DEFAULT_MOUSE_SENSITIVITY));
    localStorage.setItem(PLAYER_SPEED_KEY, String(DEFAULT_PLAYER_SPEED));
    localStorage.setItem(FPS_CAP_KEY, '0');
  }, []);

  const handlePlayClick = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      await canvas.requestPointerLock();
    } catch {
      // Embedded browsers may reject pointer lock. Do not leave an
      // input-blocking overlay over the game; keyboard controls still work.
      setPointerLockUnavailable(true);
    }
  }, []);

  const handleResume = useCallback(() => {
    setPaused(false);
    if (!pointerLockUnavailable) void handlePlayClick();
  }, [handlePlayClick, pointerLockUnavailable, setPaused]);

  const screen = useGameStore((s) => s.screen);
  if (screen !== 'playing') return null;

  return (
    <div className="game-screen">
      <canvas ref={canvasRef} className="game-canvas" />

      {/* Click-to-play overlay when pointer not locked */}
      {!settingsOpen && !visualLabOpen && !pointerLocked && !pointerLockUnavailable && (
        <div
          className="pointer-lock-overlay"
          onClick={handlePlayClick}
        >
          <div className="pointer-lock-prompt">Click to Play</div>
          <div className="pointer-lock-hint">Escape to release mouse</div>
        </div>
      )}
      {!settingsOpen && !visualLabOpen && pointerLockUnavailable && (
        <div className="pointer-lock-hint pointer-lock-fallback">
          Mouse capture is unavailable here — keyboard controls remain active
        </div>
      )}

      <HUD />
      <Compass />
      <Minimap />
      <MobileControls onAction={handleMobileAction} />
      <AutoPlayPanel />
      <DebugMap />
      <EditorHUD
        getSnap={() => engineRef.current?.currentSnap() ?? ''}
        getReturnSnap={() => engineRef.current?.editorReturn ?? null}
      />
      {!settingsOpen && !visualLabOpen && (
        <button
          className="visual-lab-toggle"
          type="button"
          onClick={() => {
            setVisualLabOpen(true);
            engineRef.current?.setPaused(true);
            if (document.pointerLockElement) document.exitPointerLock();
          }}
        >
          Visual Lab
        </button>
      )}
      {visualLabOpen && (
        <VisualLab
          settings={visualSettings}
          onChange={setVisualSettings}
          onClose={() => {
            setVisualLabOpen(false);
            engineRef.current?.setPaused(false);
          }}
        />
      )}
      {notice && <div className="game-notice" role="status">{notice}</div>}
      {settingsOpen && (
        <SettingsMenu
          brightness={brightness}
          renderScale={renderScale}
          mouseSensitivity={mouseSensitivity}
          playerSpeed={playerSpeed}
          onBrightnessChange={handleBrightnessChange}
          onRenderScaleChange={setRenderScale}
          onMouseSensitivityChange={setMouseSensitivity}
          onPlayerSpeedChange={setPlayerSpeed}
          fpsCap60={fpsCap60}
          onFpsCap60Change={setFpsCap60}
          onRestoreDefaults={handleRestoreDefaults}
          onResume={handleResume}
        />
      )}
      <div className="controls-hint">
        WASD move | Space jump | Ctrl crouch | Shift sprint | F interact | R respawn | P auto | V visual lab | Esc settings | ` debug map | F8 snapshot | LMB mark bug / RMB unmark
      </div>
    </div>
  );
}
