# ptah-electron-e2e

[Back to Main](../../CLAUDE.md)

## Purpose

Playwright end-to-end tests for the built Electron app. Launches the actual `dist/apps/ptah-electron/main.mjs` via Playwright's `_electron.launch()` and exercises real IPC/RPC.

## Entry Points

- `playwright.config.ts` — `testDir: './src/specs'`. Workers fixed at 1, `fullyParallel: false`, 60s timeout, 30s expect timeout. `globalSetup: './src/support/build-precheck.ts` verifies the Electron dist exists before any spec runs.
- `src/support/fixtures.ts`, `electron-launcher.ts`, `rpc-bridge.ts` — per-test `ElectronApplication` instance with a typed RPC bridge.

## Specs

`src/specs/*.spec.ts` covers: auto-updater, clipboard, electron browser capabilities, git watcher, license watcher, pty manager, rpc, setup wizard, smoke, startup config, state.

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
