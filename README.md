# Simple React Template

A minimal React + Vite + TypeScript app for Rundot-enabled projects.

## What's Included

- **Tab navigation** — 3 demo tabs (Home, Ads, Settings) with a fixed bottom tab bar
- **Theme system** — Centralized design tokens applied as CSS variables
- **appStorage** — Counter demo with save/load via `RundotGameAPI.appStorage`
- **Ad integration** — Interstitial + rewarded ad buttons
- **Error boundary** — Catches and displays errors gracefully
- **Safe area handling** — Tab bar respects device insets
- **Landscape warning** — CSS-only portrait orientation guard

## Getting Started

```bash
npm install
npm run dev
```

## Project Structure

```
src/
├── components/    # Button, Card, Stack, ErrorBoundary, TabBar
├── tabs/          # HomeTab, AdsTab, SettingsTab, tabConfig
├── theme/         # Design tokens (colors, spacing, fonts)
├── App.tsx        # Minimal shell: tabs + content
├── main.tsx       # Entry point
└── style.css      # Global styles
```

## Customizing

1. **Add tabs** — Edit `src/tabs/tabConfig.tsx` to add/remove tabs
2. **Change theme** — Edit `src/theme/default.ts` to update colors, spacing, etc.
3. **Add components** — Create new components in `src/components/`
