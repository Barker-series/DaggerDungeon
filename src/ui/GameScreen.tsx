import { useEffect, useRef, useCallback, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { useGameStore } from '../store/gameStore';
import { HUD } from './HUD';
import { Compass } from './Compass';
import { Minimap } from './Minimap';
import { MobileControls } from './MobileControls';
import { AutoPlayPanel } from './AutoPlayPanel';
import { DebugMap } from './DebugMap';
import type { InputAction } from '../engine/InputManager';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [pointerLocked, setPointerLocked] = useState(false);

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

  const handleMobileAction = useCallback((action: string) => {
    engineRef.current?.pushAction(action as InputAction);
  }, []);

  const screen = useGameStore((s) => s.screen);
  if (screen !== 'playing') return null;

  return (
    <div className="game-screen">
      <canvas ref={canvasRef} className="game-canvas" />

      {/* Click-to-play overlay when pointer not locked */}
      {!pointerLocked && (
        <div
          className="pointer-lock-overlay"
          onClick={() => canvasRef.current?.requestPointerLock()}
        >
          <div className="pointer-lock-prompt">Click to Play</div>
          <div className="pointer-lock-hint">Escape to release mouse</div>
        </div>
      )}

      <HUD />
      <Compass />
      <Minimap />
      <MobileControls onAction={handleMobileAction} />
      <AutoPlayPanel />
      <DebugMap />
      <div className="controls-hint">
        WASD move | Space jump | Ctrl crouch | Shift sprint | F interact | R respawn | P auto | ` debug map
      </div>
    </div>
  );
}
