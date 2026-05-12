# Webview E2E Harness

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

**Testing infrastructure.** Playwright-based E2E harness for the Ptah Angular webview SPA. Provides a stub of `acquireVsCodeApi()`, a postMessage capture/inject bridge, CSP-permissive routing, a fixture HTTP server, and Playwright test fixtures.

## Boundaries

**Belongs here**: harness primitives (bridge, csp stub, fixture server, Playwright fixtures), scenario specs that exercise the SPA against a stubbed extension host.
**Does NOT belong**: production webview code, real RPC types (the bridge stays decoupled from `@ptah-extension/shared` on purpose), unit tests (Jest/Karma).

## Public API

From `src/index.ts` — barrel is the ONLY allowed entry point ("spec authors should import from `@ptah-extension/webview-e2e-harness` only — never reach into subpaths"):

- `installPostMessageBridge`, `PostMessageBridge`, `WebviewToExtensionMessage`, `ExtensionToWebviewMessage`
- `installCspStub`, `CspStubOptions`
- `startFixtureServer`, `FixtureServerHandle`, `FixtureServerOptions`
- Playwright fixtures: `test`, `expect`, `WebviewFixtures`, `WebviewWorkerFixtures`

## Internal Structure

- `src/lib/postmessage-bridge.ts` — installs `acquireVsCodeApi()` stub, captures outbound messages on `window.__ptahE2EBridge__`, exposes `outbound() / waitForOutbound() / inject() / reset()`.
- `src/lib/csp-stub.ts` — installs CSP-permissive routing so the SPA loads under Playwright.
- `src/lib/fixture-server.ts` — Node `http` server serving `dist/apps/ptah-extension-webview/browser` (or `…/ptah-extension-webview`), with inline `index.html` fallback. Default port = 0 (ephemeral).
- `src/lib/test-fixtures.ts` — extends `@playwright/test` with worker + test fixtures wiring the above together.
- `src/lib/scenarios/` — spec authors' E2E suites grouped by surface: `chat/`, `command-palette/`, `monitor/`, `sessions/`, `settings/`.

## Key Files

- `src/lib/postmessage-bridge.ts:30` — `PostMessageBridge` interface; bridge global is `__ptahE2EBridge__`.
- `src/lib/fixture-server.ts:14` — `FixtureServerOptions`; probes two dist locations before falling back to inline HTML.
- `src/lib/scenarios/chat/` — example scenarios (`streaming-response.e2e.spec.ts`, `tool-call.e2e.spec.ts`, `permission-prompt.e2e.spec.ts`, `prompt-input.e2e.spec.ts`, `response-render.e2e.spec.ts`, `error-recovery.e2e.spec.ts`).

## Dependencies

**Internal**: none — intentionally decoupled from `@ptah-extension/shared` to keep the test graph independent of webview source.
**External**: `@playwright/test` (peer ^1.50.0), Node `http` / `fs` / `path` / `url`.

## package.json Note

`"type": "module"`, peer-depends on `@playwright/test`, `sideEffects: false`. This is the only frontend lib with a package.json — because it's consumed as an ESM Playwright harness, not built into the webview bundle.

## Guidelines

- **Always import from the barrel.** Reaching into subpaths from a spec is a soft contract violation.
- Keep types generic (`<TPayload = unknown>`); do not import real RPC protocol types here.
- Fixture server defaults to ephemeral port (0); never hard-code a port.
- Scenarios go under `src/lib/scenarios/<surface>/`; one assertion target per spec file.
