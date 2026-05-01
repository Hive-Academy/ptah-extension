# @ptah-extension/webview-e2e-harness

Playwright-based end-to-end test harness for the Ptah Angular webview SPA.

This library provides both the harness infrastructure and the spec
files. Specs live under `src/lib/scenarios/**/*.e2e.spec.ts` (chat,
sessions, monitor, settings, command palette).

## Why this exists

The webview normally runs inside a VS Code iframe with:

- A strict `Content-Security-Policy` that blocks Playwright's
  `addInitScript` / `evaluate` helpers.
- An `acquireVsCodeApi()` bridge that doesn't exist in a vanilla
  browser — so the SPA crashes on boot in Playwright unless we stub it.
- Inbound `window.postMessage` events sent by the extension host.

This harness solves all three.

## Public API

```ts
import { test, expect } from '@ptah-extension/webview-e2e-harness';

test('webview boots and sends an init message', async ({ webviewPage, bridge }) => {
  // `webviewPage` is a Page with:
  //   - the CSP stub installed,
  //   - `acquireVsCodeApi()` shimmed,
  //   - already navigated to the fixture server root.
  // `bridge` exposes outbound capture + inbound injection.
  const init = await bridge.waitForOutbound((m) => m.type === 'webview:ready');
  expect(init).toBeDefined();
});
```

Lower-level primitives are also exported for tests that want to drive the
harness manually:

- `installPostMessageBridge(page)` — install the `acquireVsCodeApi()` stub.
- `installCspStub(page, opts?)` — strip CSP headers from intercepted responses.
- `startFixtureServer({ port?, rootDir? })` — boot a static HTTP server
  that serves the webview build output (or a minimal inline placeholder).

## Running E2E

The Nx target lives on this project:

```bash
# Local: assumes you have a webview build in dist/ and Playwright browsers installed.
npm run build:webview
npx playwright install chromium
npx nx run webview-e2e-harness:e2e

# CI: must install browsers explicitly before invoking the target.
#   npx playwright install --with-deps chromium
#   npx nx run webview-e2e-harness:e2e:ci
```

> **Note**: `npm install` does NOT download Playwright browser binaries.
> Both local devs and CI must run `npx playwright install chromium` once
> per machine before running E2E.

## Module-boundary tags

`scope:webview`, `type:test-harness`. Per Nx ESLint rules this library
may import only from `scope:shared` and other `scope:webview` libs, and
production libs may not import back into it. It must never depend on
backend or extension-host code.

## Layout

```
libs/frontend/webview-e2e-harness/
├── src/
│   ├── index.ts
│   └── lib/
│       ├── postmessage-bridge.ts
│       ├── csp-stub.ts
│       ├── fixture-server.ts
│       ├── test-fixtures.ts
│       └── scenarios/
│           ├── chat/*.e2e.spec.ts
│           ├── command-palette/*.e2e.spec.ts
│           ├── monitor/*.e2e.spec.ts
│           ├── sessions/*.e2e.spec.ts
│           └── settings/*.e2e.spec.ts
├── playwright.config.ts
├── project.json
├── package.json
├── tsconfig.json
├── tsconfig.lib.json
└── tsconfig.spec.json
```
