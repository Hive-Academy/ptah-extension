# ptah-extension-webview

[Back to Main](../../CLAUDE.md)

## Purpose

Angular 21 single-page application that renders inside the VS Code webview and the Electron `BrowserWindow`. Same build artifact is copied into both `apps/ptah-extension-vscode` and `apps/ptah-electron` `renderer/` directories. Hosts chat, setup wizard, harness builder, orchestra canvas, Monaco editor, and gateway UI.

## Boundaries

**Belongs here**: Angular bootstrap, root `App` component, global error handler, DI token wiring that breaks library-level cycles (`SESSION_DATA_PROVIDER`, `WORKSPACE_COORDINATOR`, etc.), Monaco worker shim, app-level styles/Prism scripts.
**Does NOT belong**: feature components (live in `libs/frontend/<feature>`), backend logic, RPC handler implementations, type definitions (`libs/shared`).

## Entry Points

- `src/main.ts` — imports `zone.js` first, calls `getRpcClient().markReady()` (hardens RPC ready gate before any component fires), then `bootstrapApplication(App, appConfig)`.
- `src/index.html` — VS Code/Electron-injected globals: `window.vscode`, `window.ptahConfig`, `window.ptahPreviousState`.

## Key Wiring

- `src/app/app.config.ts` is the cycle-breaking hub. It registers:
  - `provideZoneChangeDetection({ eventCoalescing: true })` (this app is NOT zoneless — Zone is required by `provideZoneChangeDetection`).
  - `provideVSCodeService()` + `provideMessageRouter()` from `@ptah-extension/core`.
  - The `MESSAGE_HANDLERS` multi-token populated by 8+ services (`VSCodeService`, `ClaudeRpcService`, `AutopilotStateService`, `AppStateManager`, `ChatMessageHandler`, `AgentMonitorMessageHandler`, `EditorService`, `ElectronLayoutService`, `WorkspaceIndexingService`, `GatewayStateService`).
  - Inversion tokens to break frontend lib cycles: `SESSION_DATA_PROVIDER`, `WORKSPACE_COORDINATOR`, `WIZARD_VIEW_COMPONENT`, `ORCHESTRA_CANVAS_COMPONENT`, `HARNESS_BUILDER_COMPONENT`, `SETUP_HUB_COMPONENT`.
  - `provideMonacoEditor({...})` with a Blob-URL `getWorker` shim so Monaco's `importScripts` works under Electron 35+ `file://`.
  - `provideMarkdownRendering({ extensions: 'full' })`.
- `WebviewErrorHandler` in `app.config.ts` swallows History API `SecurityError` (webviews disallow `pushState`) and logs CSP violations with guidance.

## Library Dependencies

- `@ptah-extension/core`, `@ptah-extension/chat`, `@ptah-extension/setup-wizard`, `@ptah-extension/editor`, `@ptah-extension/canvas`, `@ptah-extension/messaging-gateway-ui`, `@ptah-extension/harness-builder`, `@ptah-extension/markdown`
- External: `ngx-monaco-editor-v2`, `prismjs` (loaded as global scripts), `monaco-editor` (assets), `monaco-vim`

## Build & Run

- `nx build ptah-extension-webview` — `@angular/build:application`. Production budgets: initial bundle 2.5mb warn / 3.5mb error.
- `nx serve ptah-extension-webview` — standalone dev server (Angular dev-server).
- Build assets include `monaco-editor/min` -> `/assets/monaco` and `monaco-vim` UMD. Production replaces `environments/environment.ts` with `environment.production.ts`.
- Output `dist/apps/ptah-extension-webview/browser/` is copied into the VS Code extension and Electron renderer by their respective post-build steps.

## Guidelines

- Do not import features directly across cycles — register them via the inversion tokens in `app.config.ts`.
- Any new push-event consumer service should be added to `MESSAGE_HANDLERS` as `useExisting` so it joins the router's broadcast.
- The webview has no `pushState`/`replaceState` — never use Angular Router here (note: route inside via signals; `WebviewErrorHandler` proves the constraint).
- Keep `provideMonacoEditor`'s worker shim intact — Electron 35+ Chromium 135+ breaks the default data-URL worker.
- Component-level styles must stay under 10kb warn / 20kb error.
