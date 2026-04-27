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
`ptah-electron:copy-renderer`, so you do not need to run the build by
hand. If artifacts are missing for any reason, `globalSetup` fails fast
with the exact command to run.

## Debug

```bash
# Inspector (steps through with the Playwright UI)
PWDEBUG=1 npx nx run ptah-electron-e2e:e2e

# Interactive UI mode
cd apps/ptah-electron-e2e && npx playwright test --ui
```

The Electron child process inherits `NODE_ENV=test` and `PTAH_E2E=1` so
features that gate on E2E mode can opt in.

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
