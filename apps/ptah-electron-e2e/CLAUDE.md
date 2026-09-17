# ptah-electron-e2e

[Back to Main](../../CLAUDE.md)

## Purpose

Playwright end-to-end tests for the built Electron app. Launches the actual `dist/apps/ptah-electron/main.mjs` via Playwright's `_electron.launch()` and exercises real IPC/RPC.

## Entry Points

- `playwright.config.ts` — `testDir: './src/specs'`. Workers fixed at 1, `fullyParallel: false`, 60s timeout, 30s expect timeout. `globalSetup: './src/support/build-precheck.ts` verifies the Electron dist exists before any spec runs.
- `src/support/fixtures.ts`, `electron-launcher.ts`, `rpc-bridge.ts` — per-test `ElectronApplication` instance with a typed RPC bridge.

## Specs

`src/specs/*.spec.ts` covers: auto-updater, clipboard, electron browser capabilities, git watcher, license watcher, rpc, setup wizard, smoke, startup config, state.

### Perf specs

The tile-open perf mock precomputes the tail and full older-page chain with the shared `selectHistoryPage` contract before serializing resolver data, so measurements follow the backend's whole-turn paging rules.

A budget-gated Playwright perf spec is named `*.perf.spec.ts` and gated behind `PTAH_PERF_SPECS=1` (mirrors the Jest-side convention used in `agent-sdk`, `platform-electron`, and `skill-synthesis-ui`) — e.g. `src/specs/chat/tile-open-longtask-budget.perf.spec.ts`, added for `TASK_2026_437`'s AC-11. Only run these on an idle machine (check that no `jest-worker`/`run-executor` node processes are running first), since the budgets are absolute wall-clock numbers. The AC-11 window starts immediately before the first click, excludes buffered long tasks that began before it, and remains open until canvas-tile mutations have been quiet for 1,000 ms; failure to settle within 10 seconds makes the measurement unusable. After the window closes, the harness verifies that each tile contains its own marker and is within 120 px of the bottom. `PTAH_PERF_PROFILE=1` captures a CDP CPU profile. `PTAH_PERF_TRACE=1` captures and summarizes a renderer-main-thread trace. `PTAH_PERF_RAF_ATTRIBUTION=1` records the top rAF call sites. Trace and rAF attribution are diagnostic-only, and the asserting cold test ignores both. `PTAH_PERF_EVENTS=500|1000|2000` is diagnostic-only; the asserting cold test always uses 2,000 events. `PTAH_PERF_OUT_DIR` selects the diagnostics directory and defaults to `os.tmpdir()/ptah-perf`. All optional flags are used with `PTAH_PERF_SPECS=1`; profiling aids attribution but does not change the pass/fail budgets. Two older Playwright perf specs, `src/specs/perf/startup-tti.spec.ts` and `src/specs/git/perf-m1-diff-redisplay.spec.ts`, predate this convention and use neither the `.perf.` suffix nor an env gate; they are not being retrofitted.

## Build & Run

- `nx run ptah-electron-e2e:e2e` — `dependsOn` `ptah-electron:build-dev` and `ptah-electron:copy-renderer-dev` (development-configured; the plain `copy-renderer` target always resolves production and is used only by `package` — TASK_2026_229), then `npx playwright test`.
- `nx run ptah-electron-e2e:e2e:nightly` — same prep, filtered by `@nightly` tag.
- `implicitDependencies: ['ptah-electron']` in `project.json`.

## Guidelines

- Tests must remain serial — the Electron app owns global state (DI container, file handles, sockets).
- HTML report and traces emit under `dist/apps/ptah-electron-e2e/`; traces only retained on failure under CI.
- Add new launch helpers to `src/support/` rather than inlining `_electron.launch` calls in specs.
- `launchPtah` gives every launch its own SQLite database via `PTAH_DB_PATH` (temp file) and republishes it as `PTAH_E2E_DB_PATH` for the Playwright process. Do not remove it: `--user-data-dir` moves Electron's userData, **not** `os.homedir()`, so without the override a launch opens the developer's real `~/.ptah/state` database and migrates it forward from the working tree (TASK_2026_291). A spec that needs a specific database passes one through `opts.env`.
- The docs-screenshot harness shoots against the isolated database by default, so memory / skills / cron surfaces render empty. `PTAH_DOCS_REAL_DB=1` points it at production — and accepts that the capture migrates it.
