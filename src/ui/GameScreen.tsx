import { useEffect, useRef, useCallback, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { useGameStore } from '../store/gameStore';
import { HUD } from './HUD';
import { Compass } from './Compass';
import { Minimap } from './Minimap';
import { MobileControls } from './MobileControls';
import { AutoPlayPanel } from './AutoPlayPanel';
import { DebugMap } from './DebugMap';
import { SettingsMenu } from './SettingsMenu';
import type { InputAction } from '../engine/InputManager';

const BRIGHTNESS_KEY = 'dagger-dungeon-brightness';
const SENSITIVITY_KEY = 'dagger-dungeon-mouse-sensitivity';
const PLAYER_SPEED_KEY = 'dagger-dungeon-player-speed';
const DEFAULT_BRIGHTNESS = 1.2;
const DEFAULT_MOUSE_SENSITIVITY = 1;
const DEFAULT_PLAYER_SPEED = 1;

function loadSetting(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockUnavailable, setPointerLockUnavailable] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brightness, setBrightness] = useState(() => loadSetting(BRIGHTNESS_KEY, DEFAULT_BRIGHTNESS));
  const [mouseSensitivity, setMouseSensitivity] = useState(() =>
    loadSetting(SENSITIVITY_KEY, DEFAULT_MOUSE_SENSITIVITY),
  );
  const [playerSpeed, setPlayerSpeed] = useState(() =>
    loadSetting(PLAYER_SPEED_KEY, DEFAULT_PLAYER_SPEED),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas);
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
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrightness(brightness);
    localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
  }, [brightness]);

  useEffect(() => {
    engineRef.current?.setMouseSensitivity(mouseSensitivity);
    localStorage.setItem(SENSITIVITY_KEY, String(mouseSensitivity));
  }, [mouseSensitivity]);

  useEffect(() => {
    engineRef.current?.setPlayerSpeed(playerSpeed);
    localStorage.setItem(PLAYER_SPEED_KEY, String(playerSpeed));
  }, [playerSpeed]);

  const setPaused = useCallback((paused: boolean) => {
    setSettingsOpen(paused);
    engineRef.current?.setPaused(paused);
    if (paused && document.pointerLockElement) document.exitPointerLock();
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.repeat) return;
      event.preventDefault();
      setSettingsOpen((open) => {
        const next = !open;
        engineRef.current?.setPaused(next);
        if (next && document.pointerLockElement) document.exitPointerLock();
        return next;
      });
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

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
    localStorage.setItem(BRIGHTNESS_KEY, String(DEFAULT_BRIGHTNESS));
    localStorage.setItem(SENSITIVITY_KEY, String(DEFAULT_MOUSE_SENSITIVITY));
    localStorage.setItem(PLAYER_SPEED_KEY, String(DEFAULT_PLAYER_SPEED));
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
      {!settingsOpen && !pointerLocked && !pointerLockUnavailable && (
        <div
          className="pointer-lock-overlay"
          onClick={handlePlayClick}
        >
          <div className="pointer-lock-prompt">Click to Play</div>
          <div className="pointer-lock-hint">Escape to release mouse</div>
        </div>
      )}
      {!settingsOpen && pointerLockUnavailable && (
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
      {settingsOpen && (
        <SettingsMenu
          brightness={brightness}
          mouseSensitivity={mouseSensitivity}
          playerSpeed={playerSpeed}
          onBrightnessChange={handleBrightnessChange}
          onMouseSensitivityChange={setMouseSensitivity}
          onPlayerSpeedChange={setPlayerSpeed}
          onRestoreDefaults={handleRestoreDefaults}
          onResume={handleResume}
        />
      )}
      <div className="controls-hint">
        WASD move | Space jump | Ctrl crouch | Shift sprint | F interact | R respawn | P auto | Esc settings | ` debug map | F8 snapshot | LMB mark bug / RMB unmark
      </div>
    </div>
  );
}
