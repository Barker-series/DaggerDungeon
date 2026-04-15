# H5 Game Development Rules

---

## Living Documents

Two documents must be kept up to date as you work. Read them before starting any task. Update them when your changes affect their content.

### 1. Game Design Document (`docs/GAME-DESIGN.md`)

This is the source of truth for what the game is. Update it when:

- A new feature, mechanic, or system is added or removed
- Game balance values change (currencies, timers, costs, drop rates)
- Progression systems are modified (levels, unlocks, gating)
- New screens or flows are introduced
- Monetization or ad placement changes

### 2. Technical Architecture Document (`docs/TECHNICAL-ARCHITECTURE.md`)

This is the source of truth for how the game is built. Update it when:

- New services, stores, managers, or major classes are added
- Data models or save data schema changes
- New venus-sdk APIs are integrated
- State management patterns change
- Build or deploy configuration changes
- New third-party libraries are added

### How to Update

- Keep entries factual and concise — describe what exists, not why
- Match the existing format and heading structure
- Remove outdated entries rather than commenting them out
- If a section no longer applies, delete it

---

## Code Quality

### DRY — Don't Repeat Yourself

- Extract shared logic into utility functions or shared modules
- Reuse existing components before creating new ones
- If you copy-paste a block of code, it should be a function instead

### Single Responsibility

- Each file, class, or function does one thing
- Stores manage state. Services call APIs. Components render UI. Keep them separate.
- Game logic does not belong in UI components

### Keep It Simple

- Prefer readable code over clever code
- Avoid premature abstraction — wait until you have 3+ use cases
- Minimize inheritance chains; prefer composition

### Type Safety

- Use TypeScript strictly — no `any` types unless interfacing with untyped externals
- Define interfaces for all data models, API responses, and store shapes
- Use discriminated unions for state machines and variant types

---

## Webview Memory Optimization

H5 games run in a mobile webview with constrained memory. Treat memory as a scarce resource.

### Asset Management

- Lazy-load assets — only load what the current scene needs
- Unload/destroy assets when leaving a scene (textures, audio, spritesheets)
- Compress images before bundling; prefer WebP over PNG where supported
- Use texture atlases instead of individual sprite files
- Keep total bundle size under control — large bundles cause slow loads and OOM on low-end devices

### DOM and Rendering

- Avoid mounting hundreds of DOM nodes at once — virtualize long lists
- Remove event listeners and timers when components unmount
- Cancel pending animations and tweens on scene exit
- Pool frequently created/destroyed objects (particles, projectiles, UI elements)

### State

- Don't store large blobs (base64 images, full API responses) in Zustand stores
- Clean up derived/temporary state when it's no longer needed
- Avoid deep object cloning in hot paths — use immutable update patterns

### Monitoring

- Watch for memory leaks during development using browser DevTools heap snapshots
- If the webview crashes on low-end Android, the game is using too much memory — profile and fix before shipping

---

## Venus SDK / RPC Bridge

The native RPC bridge connects H5 game code to Venus platform APIs. It is the most common source of silent failures.

### Storage (H5_APP_STORAGE)

**The #1 production issue: RPC timeouts on storage writes.**

The native storage handler can become unresponsive or blocked, causing `H5_APP_STORAGE_SET_ITEM` calls to time out at the 30-second limit. When this happens, player progress is silently lost.

**Rules:**

- Never fire-and-forget storage writes. Always `await` and handle errors.
- Implement retry with exponential backoff for failed saves (max 3 attempts).
- Keep save data payloads small. Serialize only what changed if possible.
- Debounce saves — don't write on every state change. Batch saves on meaningful events (level complete, purchase, scene exit).
- Log save failures as high-severity analytics events so they can be monitored.
- Handle total failure gracefully — don't silently swallow it.

```typescript
// BAD — fire and forget, no error handling
RundotGameAPI.storage.setAppData('playerData', data);

// GOOD — awaited with retry and error handling
async function saveWithRetry(key: string, data: unknown, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await RundotGameAPI.storage.setAppData(key, data);
      return;
    } catch (err) {
      if (attempt === maxRetries) {
        RundotGameAPI.analytics.recordCustomEvent('save_failed', {
          key,
          error: String(err),
          attempts: attempt,
        });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
```

### General RPC Rules

- All RPC calls can timeout or fail. Never assume they succeed.
- Wrap every SDK call in try/catch. Handle the error path explicitly.
- Don't make RPC calls in tight loops or on every frame.
- Batch related RPC calls when possible rather than making many small calls.
- If an RPC call is not critical (e.g., analytics), catch and log the error silently. If it is critical (e.g., save, purchase), surface the failure.

### Ads

- Always check `RundotGameAPI.ads.isRewardedAdReady()` before showing
- Handle all three outcomes: completed (grant reward), skipped (no reward), errored (no reward, show message)
- Don't block the game while waiting for ad load

### Analytics

- Use consistent event naming: `snake_case`, verb-first (`level_completed`, `item_purchased`)
- Include context: level ID, currency amount, duration, etc.
- Don't send analytics on every frame or every state change — batch on meaningful events

---

## Performance

### Rendering

- Target 60fps on mid-range devices; degrade gracefully to 30fps on low-end
- Use `requestAnimationFrame` — never `setInterval` for game loops
- Avoid layout thrashing — batch DOM reads and writes separately
- For canvas games (Phaser, Three.js): watch draw calls, keep them under budget

### Loading

- Show a loading screen while assets load — never a blank white screen
- Preload critical assets, lazy-load the rest
- Use the venus-sdk preloader API to report loading progress to the native shell

### Network

- Don't assume connectivity. Handle offline gracefully.
- Cache API responses where appropriate
- Timeout network requests explicitly — don't rely on browser defaults

---

## Error Handling

- All async functions must have error handling — no unhandled promise rejections
- Unhandled rejections crash webviews on some Android versions. This is not optional.
- Log errors to analytics with enough context to debug (screen, action, error message)
- For player-facing errors, show a retry option when possible rather than a dead end

---

## Testing

- Test on real Android devices, not just Chrome DevTools — webview behavior differs
- Test with slow network and airplane mode
- Test with the app backgrounded and resumed mid-gameplay
- Test save/load roundtrip after every schema change
