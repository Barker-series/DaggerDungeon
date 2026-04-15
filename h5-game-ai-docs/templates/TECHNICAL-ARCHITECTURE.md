# Technical Architecture

> Game: [Game Name]
> Last updated: [Date]
> Stack: [e.g., Vite + React + Zustand / Vite + Phaser 3 / Vite + Three.js]

---

## Project Structure

```
src/
  components/       — UI components
  scenes/           — Game scenes or screens
  stores/           — State management (Zustand stores)
  services/         — Platform integration, API calls
  models/           — Data types and interfaces
  utils/            — Helpers and constants
  assets/           — Sprites, audio, fonts
public/             — Static assets
```

Adjust to match actual structure.

---

## State Management

### Stores

| Store | Purpose | Persisted? |
|-------|---------|-----------|
| | | |

### Save Data Schema

```typescript
interface PlayerSaveData {
  // Define the shape of persisted player data
}
```

Describe what triggers saves and how save/load works.

---

## Venus SDK Integration

### APIs Used

| API | Purpose | Notes |
|-----|---------|-------|
| `RundotGameAPI.storage.setAppData()` | Save player progress | |
| `RundotGameAPI.storage.getAppData()` | Load player progress | |
| `RundotGameAPI.ads.showRewardedAd()` | Rewarded ad placement | |
| `RundotGameAPI.analytics.recordCustomEvent()` | Analytics tracking | |

Add or remove rows based on actual usage.

### RPC Bridge Notes

- Document any known constraints or workarounds for the native bridge
- Note timeout-sensitive operations and how they're handled

---

## Scenes / Screens

| Scene | File | Description |
|-------|------|-------------|
| | | |

---

## Key Systems

### [System Name, e.g., "Combat", "Inventory", "Dialog"]

- What it does
- Key files
- How it interacts with other systems

<!-- Repeat for each major system -->

---

## Data Flow

Describe how data moves through the game at a high level:

1. App loads → SDK context received → save data loaded
2. Player makes choices → state updated in store
3. State changes trigger UI re-render / scene updates
4. Progress saved to platform storage on key events

---

## Build & Deploy

- Build tool: Vite
- Deploy command: `rundot deploy`
- Config file: `game.config.json`
- Environments: dev, staging, production
- CDN / hosting details

---

## Third-Party Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| | | |

---

## Known Constraints

Document platform-specific limitations and how the game handles them:

- Webview memory budget
- RPC bridge timeout behavior
- Asset loading strategy
- Device compatibility notes
