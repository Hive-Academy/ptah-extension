# ptah-electron-e2e

Playwright-Electron E2E harness for the Ptah desktop app.

## Run locally

```bash
# Build + smoke specs (build chain runs automatically via dependsOn)
npx nx run ptah-electron-e2e:e2e

# CI configuration (list reporter only)
npx nx run ptah-electron-e2e:e2e:ci

# Nightly suite (specs tagged @nightly)
npx nx run ptah-electron-e2e:e2e:nightly
```

The `e2e` target depends on `ptah-electron:build-dev` and
`ptah-electron:copy-renderer-dev`, so you do not need to run the build by
hand. If artifacts are missing for any reason, `globalSetup` fails fast
with the exact command to run.

`copy-renderer-dev` is a separate target from `copy-renderer` (used by
`package`): Nx cannot pin a configuration on a `dependsOn` edge, so a single
target can't serve both the development bundle e2e needs and the production
bundle packaging needs. Do not point e2e-family targets back at bare
`copy-renderer` — it always resolves to production (TASK_2026_229).

## Debug

```bash
# Inspector (steps through with the Playwright UI)
PWDEBUG=1 npx nx run ptah-electron-e2e:e2e

# Interactive UI mode
cd apps/ptah-electron-e2e && npx playwright test --ui
```

The Electron child process inherits `NODE_ENV=test` and `PTAH_E2E=1` so
features that gate on E2E mode can opt in.

### Never run two `e2e` invocations at once

Do not start a second `nx run ptah-electron-e2e:e2e` (or `:ci` / `:nightly`)
while one is still running — not in another terminal, not from another agent
or worktree on the same machine. The suite is serial by design (`workers: 1`):
the app owns global state (DI container, file handles, sockets), and the
per-launch `userDataDir` / `PTAH_DB_PATH` isolation does not stop two runs from
contending for CPU, the single-instance lock and the shared `dist/` output.
Nothing in the harness enforces this; two runs slow each other into timeouts.

### What `PTAH_E2E=1` switches off

Each gate skips work no spec asserts on. A spec that genuinely needs one of
them passes the opt-back-in variable through `launchPtah({ env: { ... } })`.

| Subsystem skipped                                                       | Where                                                     | Opt back in                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| GitHub Releases update check                                            | `ptah-electron/src/services/update/update-manager.ts`     | `PTAH_E2E_ALLOW_UPDATE_CHECK=1` |
| Embedder warmup barrier (30 s wait on a no-workspace boot)              | `ptah-electron/src/activation/boot-coordinator.ts`        | none — no spec needs it         |
| Messaging gateway + chat bridge start (`gateway:*` RPC still answers)   | `ptah-electron/src/activation/start-messaging-gateway.ts` | none — no spec needs it         |
| Membership/licence priming at boot (`license:getStatus` still verifies) | `ptah-electron/src/activation/bootstrap.ts`               | none — no spec needs it         |

Add an opt-back-in variable, mirroring `PTAH_E2E_ALLOW_UPDATE_CHECK`, only
when a spec actually depends on one of these.

## Adding new specs

1. Drop a `*.spec.ts` file under `src/specs/`.
2. Import `test` and `expect` from `../support/fixtures`.
3. Use the `electronApp`, `mainWindow`, or `rpcBridge` fixtures.

```ts
import { test, expect } from '../support/fixtures';

test('opens settings panel', async ({ mainWindow, rpcBridge }) => {
  await mainWindow.waitForLoadState('domcontentloaded');
  // ...
});
```

## Marketing showcase (high-res feature videos)

A separate, opt-in harness records high-resolution video of **real** agent runs
for marketing — the deliberate inverse of the deterministic e2e suite above (no
RPC mocks, real auth, real local docker backend, long waits).

```bash
# Record every scene, then transcode to mp4
npx nx run ptah-electron-e2e:showcase
```

Prereqs:

1. Run `nx serve ptah-electron` once so the **default profile is
   authenticated** and a real workspace is restored — the showcase reuses that
   profile. (Set `PTAH_SHOWCASE_USER_DATA_DIR` to use a dedicated profile.)
2. Quit any running Ptah instance first (single-instance lock).

For a **pristine canvas** (no tiles restored from prior sessions), point at a
fresh profile: `PTAH_SHOWCASE_USER_DATA_DIR=/tmp/ptah-showcase`. Provider auth
via the Claude CLI is machine-global, so a fresh Electron profile is still
authenticated. Scenes also auto-dismiss the startup license/trial modal and
tolerate pre-existing tiles, but a fresh profile gives the cleanest shot.

What it does differently from `e2e`:

- Boots with `NODE_ENV=development` (hits the local docker dev URLs) and
  `PTAH_NO_DEVTOOLS=1` (keeps DevTools out of frame — gated in
  `apps/ptah-electron/src/activation/post-window.ts`).
- Records via Playwright `recordVideo` at marketing resolution. Set
  `PTAH_SHOWCASE_RES=1080p|1440p|4k` (default `1080p`); the window is forced to
  that size for crisp frames.
- Output: `dist/apps/ptah-electron-e2e/recordings/*.webm`, transcoded to
  `recordings/mp4/*.mp4` via `scripts/transcode.mjs` (uses bundled
  `ffmpeg-static`).

Authoring scenes:

- Drop a `*.scene.ts` under `src/showcase/`, import `test` from
  `./_harness/showcase-fixtures`, and drive the UI through the `director`
  fixture (`type`, `click`, `moveTo`, `caption`, `hold`, `waitForAgentTurn`).
- `canvas-orchestra.scene.ts` is the reference scene (P2.1 — three live agents
  in the Canvas). Scenes map to `docs/video-content-plan.md`.
- Config lives in `showcase.config.ts` (15-min timeout, serial, no retries).

> The shell-navigation selectors in a scene (e.g. `goToCanvas()`) are
> best-effort; verify them against the live UI on first capture.

## Architecture

- `src/support/electron-launcher.ts` -- resolves the built `main.mjs`
  and launches via Playwright's `_electron.launch()`.
- `src/support/rpc-bridge.ts` -- IPC test helper running inside the
  Electron main process via `electronApp.evaluate()`. Supports
  fire-and-forget RPC, correlation-id matching, push-message waits, and
  state get/set.
- `src/support/fixtures.ts` -- the Playwright `test` extension wiring
  the three fixtures together.
- `src/support/build-precheck.ts` -- `globalSetup` that verifies
  `main.mjs`, `preload.js`, and `renderer/index.html` exist before any
  spec runs.

The harness uses Playwright's built-in Electron support
(`@playwright/test ^1.50`). No separate `playwright-electron` package
is needed.
