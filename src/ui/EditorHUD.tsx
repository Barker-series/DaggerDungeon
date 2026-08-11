/**
 * DaggerKit E1 — editor-mode HUD. Live seed/coordinate readout in every
 * frame the maps and DDSNAP strings use, teleport-by-DDSNAP, and
 * localStorage camera bookmarks. Mounted only while editor mode is on
 * (F6, dev builds / ?editor=1).
 */

import { useEffect, useRef, useState } from 'react';
import { Pane } from 'tweakpane';
import { useGameStore } from '../store/gameStore';
import { tileBiome, tileCrest, CELL_TILE_SIZE } from '../game/dungeon/cells';
import { TILE_SIZE } from '../game/types';
import { copyText } from '../utils/copyText';
import { TUNABLES, TUNABLE_DEFS, tunablesSnapshot, resetTunables, type Tunables } from '../game/dungeon/tunables';

const PC_TILES = 56;

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  padding: '8px 10px',
  background: 'rgba(8, 12, 16, 0.82)',
  border: '1px solid rgba(0, 229, 255, 0.35)',
  borderRadius: 4,
  color: '#cde',
  font: '11px/1.5 monospace',
  pointerEvents: 'auto',
  maxWidth: 300,
  zIndex: 30,
};

interface Bookmark {
  name: string;
  snap: string;
}

const BOOKMARKS_KEY = 'ddkit.bookmarks.v1';

function loadBookmarks(): Bookmark[] {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '[]') as Bookmark[];
  } catch {
    return [];
  }
}

export function EditorHUD({ getSnap, getReturnSnap }: {
  getSnap: () => string;
  getReturnSnap: () => string | null;
}) {
  const editorActive = useGameStore((s) => s.editorActive);
  const editorSpeed = useGameStore((s) => s.editorSpeed);
  const requestTeleport = useGameStore((s) => s.requestEditorTeleport);
  const seed = useGameStore((s) => s.seed);
  const stack = useGameStore((s) => s.currentFloor);
  const world = useGameStore((s) => s.world);
  const dungeon = useGameStore((s) => s.dungeon);
  const playerPos = useGameStore((s) => s.playerPos);
  const playerY = useGameStore((s) => s.playerY);
  const [pasteText, setPasteText] = useState('');
  const [showTunables, setShowTunables] = useState(false);
  const regenTimer = useRef<number | null>(null);
  const paneHost = useRef<HTMLDivElement>(null);
  const requestTunables = useGameStore((s) => s.requestEditorTunables);
  const regenerating = useGameStore((s) => s.editorRegenerating);

  // Tweakpane over the live TUNABLES object: draggable value fields
  // (drag = coarse, click+type = exact), folders per group. Changes
  // debounce into a regen request.
  useEffect(() => {
    if (!editorActive || !paneHost.current) return;
    const params: Tunables = tunablesSnapshot();
    const pane = new Pane({ container: paneHost.current });
    const schedule = (): void => {
      if (regenTimer.current !== null) window.clearTimeout(regenTimer.current);
      regenTimer.current = window.setTimeout(() => {
        requestTunables({ ...params });
      }, 250);
    };
    const groups = [...new Set(TUNABLE_DEFS.map((d) => d.group))];
    for (const g of groups) {
      const folder = pane.addFolder({ title: g, expanded: g === 'crest' });
      for (const def of TUNABLE_DEFS.filter((d) => d.group === g)) {
        folder.addBinding(params, def.key, {
          label: def.label, min: def.min, max: def.max, step: def.step,
        }).on('change', schedule);
      }
    }
    pane.addButton({ title: 'reset defaults' }).on('click', () => {
      resetTunables();
      Object.assign(params, tunablesSnapshot());
      pane.refresh();
      requestTunables({ ...params });
    });
    pane.addButton({ title: 'copy values' }).on('click', () => {
      void copyText(JSON.stringify(TUNABLES, null, 2));
    });
    return () => pane.dispose();
  }, [editorActive, requestTunables]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadBookmarks);
  const selection = useGameStore((s) => s.editorSelection);

  if (!editorActive || !world || !dungeon) return null;

  const opx = world.originPcx;
  const opz = world.originPcz;
  const tx = playerPos.x;
  const tz = playerPos.y;
  const absTx = opx * PC_TILES + tx;
  const absTz = opz * PC_TILES + tz;
  const absCx = Math.floor(absTx / CELL_TILE_SIZE);
  const absCz = Math.floor(absTz / CELL_TILE_SIZE);
  const absPcx = Math.floor(absTx / PC_TILES);
  const absPcz = Math.floor(absTz / PC_TILES);
  const biome = tileBiome(dungeon.cellBiomes, tx, tz) ?? 'tunnel';
  const crest = tileCrest(dungeon.cellCrests, tx, tz);

  const saveBookmarks = (list: Bookmark[]): void => {
    setBookmarks(list);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  };

  return (
    <div style={panel}>
      <div style={{ color: '#0ef', marginBottom: 4 }}>
        DAGGERKIT — editor
        <span style={{ color: '#789', float: 'right' }}>{editorSpeed} u/s</span>
      </div>
      <div>seed {seed} · stack {stack} · window ({opx},{opz})</div>
      <div>world ({(tx * TILE_SIZE + 1.5).toFixed(0)}, {playerY.toFixed(1)}, {(tz * TILE_SIZE + 1.5).toFixed(0)})</div>
      <div>abs tile ({absTx},{absTz}) · cell ({absCx},{absCz}) · chunk ({absPcx},{absPcz})</div>
      <div>biome {biome} · crest {crest}</div>

      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <button
          onClick={() => {
            void copyText(getSnap());
          }}
        >
          Copy DDSNAP
        </button>
        <button
          onClick={() => {
            const back = getReturnSnap();
            if (back) requestTeleport(back);
          }}
        >
          Return
        </button>
      </div>

      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <input
          style={{ flex: 1, font: 'inherit', background: '#123', color: '#cde', border: '1px solid #345' }}
          placeholder="paste DDSNAP…"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          onClick={() => {
            if (pasteText.trim()) {
              requestTeleport(pasteText);
              setPasteText('');
            }
          }}
        >
          Go
        </button>
      </div>

      <div style={{ marginTop: 6 }}>
        <button
          onClick={() => {
            const name = window.prompt('Bookmark name?', `${biome} (${absCx},${absCz})`);
            if (name) saveBookmarks([...bookmarks, { name, snap: getSnap() }]);
          }}
        >
          + Bookmark
        </button>
        {bookmarks.map((b, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <button style={{ flex: 1, textAlign: 'left' }} onClick={() => requestTeleport(b.snap)}>
              {b.name}
            </button>
            <button onClick={() => saveBookmarks(bookmarks.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        <button onClick={() => setShowTunables(!showTunables)}>
          {showTunables ? '▾' : '▸'} gen tunables{regenerating ? ' — regenerating…' : ''}
        </button>
        <div ref={paneHost} style={{ marginTop: 4, display: showTunables ? 'block' : 'none' }} />
      </div>
      {selection && (
        <div style={{ marginTop: 6, borderTop: '1px solid #345', paddingTop: 4 }}>
          <div style={{ color: '#0ef' }}>
            SELECTION
            <button
              style={{ float: 'right' }}
              onClick={() => {
                void copyText(selection.report);
              }}
            >
              Copy report
            </button>
          </div>
          {selection.summary.map((line, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 6, color: '#678' }}>
        WASD fly · Space/C rise/sink · Shift sprint · wheel speed · G grid · F8 snap · F6 exit
        <br />
        LMB select geo · Shift+LMB add to selection · RMB clear
      </div>
    </div>
  );
}
