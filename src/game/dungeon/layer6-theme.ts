/**
 * Layer 6 — Theming
 *
 * Reads: Noise field + surviving geometry from self + neighbors
 * Assigns: Visual identity (crypt, sewer, cave, castle) based on noise
 */

import { type DungeonCell, type ThemeType, getCell, neighborsAtLayer } from './cells';

const THEME_RANGES: Array<{ min: number; max: number; theme: ThemeType }> = [
  { min: 0, max: 0.35, theme: 'cave' },
  { min: 0.35, max: 0.5, theme: 'sewer' },
  { min: 0.5, max: 0.7, theme: 'crypt' },
  { min: 0.7, max: 1.0, theme: 'castle' },
];

export function generateLayer6(cell: DungeonCell, layerNum: number = 5): void {
  if (cell.layer >= layerNum) return;
  if (cell.layer < layerNum - 1) return;
  if (!neighborsAtLayer(cell.cx, cell.cz, layerNum - 1)) return;

  // Base theme from noise
  let theme: ThemeType = 'crypt';
  for (const range of THEME_RANGES) {
    if (cell.noise >= range.min && cell.noise < range.max) {
      theme = range.theme;
      break;
    }
  }

  // Neighbor influence — if most neighbors have a different theme,
  // blend toward it (prevents isolated single-cell theme patches)
  const neighborThemes = new Map<ThemeType, number>();
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    const neighbor = getCell(cell.cx + dx, cell.cz + dz);
    if (neighbor && neighbor.layer >= layerNum) {
      neighborThemes.set(neighbor.theme, (neighborThemes.get(neighbor.theme) ?? 0) + 1);
    }
  }

  // If 3+ neighbors share a theme and it's different from ours, adopt it
  for (const [nTheme, count] of neighborThemes) {
    if (count >= 3 && nTheme !== theme) {
      theme = nTheme;
      break;
    }
  }

  cell.theme = theme;
  cell.layer = layerNum;
}
