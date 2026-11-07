# @ptah-extension/webview-e2e-harness

Playwright harness and specs for the Angular renderer (`apps/ptah-extension-webview`) run in plain
Chromium. It is not the Electron end-to-end suite; that is `apps/ptah-electron-e2e`.

The renderer expects a host: a strict Content-Security-Policy, an `acquireVsCodeApi()` bridge
(`libs/frontend/core/src/lib/services/vscode.service.ts`) and inbound `window.postMessage`
events. The harness stubs these so the SPA can boot in a browser.

Specs live under `src/lib/scenarios/**/*.e2e.spec.ts` (`playwright.config.ts` `testMatch`).

## Public API (`src/index.ts`)

- `test`, `expect`: Playwright `test` extended with the `webviewPage`, `bridge`, `fixtureServer`
  and `useAppBuild` fixtures (`src/lib/test-fixtures.ts`). `useAppBuild` is off by default, so
  the fixture server serves a minimal placeholder page; turn it on to serve the real renderer
  build from `dist/apps/ptah-extension-webview`.
- `installPostMessageBridge(page)`: the `acquireVsCodeApi()` stub plus outbound capture and
  inbound injection.
- `installCspStub(page, opts?)`: strips CSP headers and serves fonts from a local copy.
- `startFixtureServer({ port?, rootDir?, appBuild? })`: static HTTP server.

## Running

The `e2e` target is on this project (`project.json`). It needs a renderer build and the
Playwright browsers (`npm install` does not download them):

```bash
npm run build:webview
npx playwright install chromium
npx nx run webview-e2e-harness:e2e
```

CI runs this through `.github/workflows/webview-e2e.yml`.

## Constraints

Nx tags are `scope:webview`, `type:test-harness` (`project.json`). Production libs must not
import it.
