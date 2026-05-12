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

- `nx run ptah-electron-e2e:e2e` — `dependsOn` `ptah-electron:build-dev` and `ptah-electron:copy-renderer`, then `npx playwright test`.
- `nx run ptah-electron-e2e:e2e:nightly` — same prep, filtered by `@nightly` tag.
- `implicitDependencies: ['ptah-electron']` in `project.json`.

## Guidelines

- Tests must remain serial — the Electron app owns global state (DI container, file handles, sockets).
- HTML report and traces emit under `dist/apps/ptah-electron-e2e/`; traces only retained on failure under CI.
- Add new launch helpers to `src/support/` rather than inlining `_electron.launch` calls in specs.
