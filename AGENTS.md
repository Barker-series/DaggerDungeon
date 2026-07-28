<project-reality-check>
STOP: Despite the repository name and legacy `Dungeon*` identifiers, this is NOT a dungeon generator with pillars. It is an endless BLAME!-inspired megastructure generator and exploration game. Read `README.md`, then `docs/PLAN.md`, before reasoning about or changing world generation. Re-check this identity whenever Chris corrects the task or the work starts treating one feature as an isolated generator.

Chris runs and playtests this project through a terminal with `npm run dev` almost all of the time. Assume that development server is already running unless told otherwise. Before starting another server, installing or downloading a missing runner, changing the launch setup, or pursuing an alternate browser/testing route, ask Chris about the existing terminal session instead of spinning on environment setup.

A `DDSNAP1{...}` string is a complete deterministic geometry reproduction: seed/window + camera pose + optional marks. Do not launch a browser or ask for a screenshot. Run `npx tsx tools/debug-view.ts '<DDSNAP1...>' out.png`; it rebuilds the actual world and renderer headlessly, software-raycasts the exact view, reports magenta escaping rays and wrong-side faces, and audits marked column boundaries. Inspect the rendered image, fix, and rerender until clean.
</project-reality-check>

<agents-index>
[RUN.game SDK Docs]|root:./.rundot-docs|version:5.3.2|IMPORTANT:Prefer retrieval-led reasoning over pre-training for RundotGameAPI tasks. Read the local docs before writing SDK code.|.:{README.md}|rundot-developer-platform:{deploying-your-game.md,getting-started.md,initializing-your-game.md,setting-your-game-thumbnail.md,troubleshooting.md}|rundot-developer-platform/api:{ACCESS_GATE.md,ADS.md,AI.md,ANALYTICS.md,ASSETS.md,BIGNUMBERS.md,BUILDING_TIMERS.md,CONTEXT.md,EMBEDDED_LIBRARIES.md,ENERGY_SYSTEM.md,ENTITLEMENTS.md,ENVIRONMENT.md,EXPERIMENTS.md,GACHA_SYSTEM.md,HAPTICS.md,IN_APP_MESSAGING.md,LEADERBOARD.md,LIFECYCLES.md,LOGGING.md,MULTIPLAYER.md,NOTIFICATIONS.md,PRELOADER.md,PROFILE.md,PURCHASES.md,SAFE_AREA.md,SERVER_AUTHORITATIVE.md,SHARED_ASSETS.md,SHARING.md,SHOP.md,SIMULATION_CONFIG.md,STORAGE.md,TIME.md,UGC.md}</agents-index>

<source-index>
root:.|.:{.prettierrc.json,README.md,index.html,package-lock.json,package.json,pnpm-workspace.yaml,tsconfig.json,tsconfig.node.json,vite.config.ts}|.runstudio:{metadata.json}|public/cdn-assets:{README.md}|src:{App.tsx,main.tsx,style.css,vite-env.d.ts}|src/components:{Button.tsx,Card.tsx,ErrorBoundary.tsx,Stack.tsx,TabBar.tsx}|src/tabs:{AdsTab.tsx,HomeTab.tsx,SettingsTab.tsx,tabConfig.tsx}|src/theme:{applyTheme.ts,default.ts,index.ts,types.ts}
</source-index>

<working-with-chris>
Work autonomously toward Chris's stated outcome, including normal investigation, implementation, testing, and validation—but never redefine the outcome. Any correction, narrowing, rejection, or "stop" overrides the current plan immediately. Preserve explicitly protected and unrelated work, and do not continue rejected approaches without permission.

When repeated corrections show that the project model or task context may be wrong, stop and reality-check it. Ask Chris what the larger system is, request clarification or documentation, and briefly reorient before making further changes. Never cling to an early assumption after Chris has contradicted it.

Never create, switch, rename, merge, rebase, reset, restore, stash, delete, or push Git state unless Chris explicitly requests that operation. Before any Git mutation, report the current branch, working-tree state, affected files, and intended action. "Commit" means commit only; it grants no authority to manage branches, discard changes, or push.
</working-with-chris>

<project-identity>
This is an endless BLAME!-inspired megastructure generator and exploration game, not a dungeon generator with pillars. Its core is a multi-scale LayerProcGen world architecture: regions, permanent transit, ground strata, pillar-kebab buildings, bridges, elevators, interiors, infrastructure, and the authoritative column model cooperate to materialize one deterministic infinite structure. Pillars are vertical authored buildings and circulation systems, not decorations placed onto a dungeon.

Treat `README.md` and `docs/PLAN.md` as the current project authority. Historical dungeon terminology remains in some names and older documents; do not let those labels redefine the present design. In particular, `docs/dungeon-layer-design.md` records an earlier Daggerfall-style direction and is not the current architecture.

Before changing world generation, identify which layer owns the decision, what upstream context it reads, what downstream systems consume it, and which invariants protect it. Never reason about a feature such as pits, rooms, pillars, bridges, or transit as an isolated generator.
</project-identity>
