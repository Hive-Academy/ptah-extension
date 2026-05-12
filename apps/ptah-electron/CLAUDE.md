# ptah-electron

[Back to Main](../../CLAUDE.md)

## Purpose

Standalone Electron 40 desktop build of Ptah. Reuses the Angular webview from `apps/ptah-extension-webview` inside a `BrowserWindow`, runs the same DI graph as the VS Code extension via a `vscode` module shim, and ships as a code-signed installer via electron-builder.

## Boundaries

**Belongs here**: Electron main-process entry, the multi-phase activation (`bootstrap` -> `wireRuntime` -> `registerPostWindow`), `BrowserWindow` creation, preload + contextBridge, IPC bridge, the `vscode` shim, electron-specific RPC handlers, electron-builder config.
**Does NOT belong**: business logic, Angular UI, shared RPC handlers, VS Code-only glue.

## Entry Points

- `src/main.ts` — single-instance lock, then on `app.whenReady`: `bootstrapElectron` -> `wireRuntime` -> `registerPostWindow`. Manages many disposable refs: skill junctions, git watcher, SQLite handle, memory curator, cron scheduler, messaging gateway, symbol watcher, license revalidation interval. LIFO cleanup wired in `app.on('will-quit')`.
- `src/preload.ts` — built separately via `build-preload`, output `dist/apps/ptah-electron/preload.js`.

## Key Wiring

- `src/activation/bootstrap.ts` — minimal DI, license verify, full DI, workspace restore, SDK auth.
- `src/activation/wire-runtime.ts` — `IpcBridge`, RPC registration, plugin loader, skill junctions, CLI sync, MCP code execution, git watcher, memory curator, cron scheduler, messaging gateway, symbol watcher.
- `src/activation/post-window.ts` — startup config IPC handler, `BrowserWindow` creation, auto-updater (production only).
- `src/di/container.ts` — `ElectronDIContainer`, same phased pattern as VS Code.
- `src/shims/vscode-shim.ts` — minimal `vscode` API stub; `tsconfig.build.json` `paths` maps the `vscode` module to it so `vscode-core` etc. compile unchanged.
- `src/windows/main-window.ts` — sole window factory; persists bounds via `IStateStorage`.
- `src/ipc/`, `src/services/rpc/handlers/electron-*` — electron-specific transport.

## Library Dependencies

- `@ptah-extension/platform-core`, `@ptah-extension/platform-electron` — hexagonal ports + electron adapters
- `@ptah-extension/vscode-core` — shared infrastructure (DI, logger, RPC, license)
- `@ptah-extension/agent-sdk` (`SDK_TOKENS`), `@ptah-extension/rpc-handlers`
- `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-generation`, `@ptah-extension/llm-abstraction`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/memory-curator`, `@ptah-extension/persistence-sqlite`
- Native + heavy externals (not bundled, listed in `project.json` externals): `electron`, `electron-updater`, `node-pty`, `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`, `chrome-launcher`, `chrome-remote-interface`, `grammy`, `discord.js`, `@slack/bolt`, `ffmpeg-static`, `nodejs-whisper`, `web-tree-sitter`, and all three AI provider SDKs.

## Build & Run

- `nx build ptah-electron` — chains `build-main` + `build-preload` + `build-embedder-worker` + `ptah-extension-webview:build`, then copies WASM.
- `nx build-embedder-worker ptah-electron` — bundles `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts` separately to `embedder-worker.mjs`.
- `nx serve ptah-electron` — runs `rebuild-native.js` first (rebuilds `node-pty` etc. for current Electron ABI), then dev builds, copies renderer, launches via `scripts/launch.js`.
- `nx serve:watch ptah-electron` — parallel watch on main/preload/embedder/webview.
- `nx package ptah-electron` — `electron-builder --config electron-builder.yml --project dist/apps/ptah-electron`.
- `nx validate-deps ptah-electron` — runs after `build-main`; verifies externals declared in the generated `package.json`.

## Guidelines

- Keep `contextIsolation` and `sandbox` enabled. The renderer must never receive raw Node access — go through the preload contextBridge.
- All cleanup in `will-quit` runs LIFO and synchronously. New long-lived resources must register a stop/close ref captured in `main.ts` and disposed in `will-quit`.
- When a library reaches a `vscode` API the shim doesn't cover, extend `src/shims/vscode-shim.ts` — never add a runtime check in the caller.
- `generatePackageJson: true` emits a trimmed `package.json` with the external deps; electron-builder installs from there.

## Deployment Notes

- Native modules must be rebuilt for the Electron ABI: run `nx rebuild-native ptah-electron` after Electron upgrades.
- Auto-updater (`electron-updater`) is imported dynamically inside `post-window` Phase 6 and is intentionally disabled in dev builds.
- Code signing inputs (Windows SSL.com IV / eSigner, macOS Developer ID) are read from env at `electron-builder` invocation time; never commit signing material.
- Renderer copy: `scripts/copy-renderer.js` lives under `apps/ptah-electron/scripts/`.
