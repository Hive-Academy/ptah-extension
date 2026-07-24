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

- `src/activation/bootstrap.ts` — minimal DI, license/membership verify (non-blocking, identity-only — never gates bootstrap), full DI, workspace restore, SDK auth.
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
- Native + heavy externals (not bundled, listed in `project.json` externals): `electron`, `node-pty`, `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`, `chrome-launcher`, `chrome-remote-interface`, `grammy`, `discord.js`, `@slack/bolt`, `ffmpeg-static`, `web-tree-sitter`, and all three AI provider SDKs. Voice transcription runs on `@huggingface/transformers` (ASR) + `onnxruntime-node` — the same runtime as the memory embedder; there is no whisper.cpp / nodejs-whisper native build.

## Build & Run

- `nx build ptah-electron` — chains `build-main` + `build-preload` + `build-embedder-worker` + `ptah-extension-webview:build`, then copies WASM.
- `nx build-embedder-worker ptah-electron` — bundles `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts` separately to `embedder-worker.mjs` (runs as an Electron `utilityProcess`, like the voice worker; `@huggingface/transformers` stays external). Spawned via `ElectronEmbedderWorkerFactory` (`src/services/platform/electron-embedder-worker-factory.ts`, alongside `electron-voice-worker-factory.ts`), registered under `MEMORY_TOKENS.EMBEDDER_WORKER_PROCESS_FACTORY` in `phase-2-libraries.ts`. The factory posts the `init` config (model cache dir) immediately after `utilityProcess.fork`.
- `nx serve ptah-electron` — runs `rebuild-native.js` first (compiles `better-sqlite3` from source for the current Electron ABI via `@electron/rebuild`), then dev builds, copies renderer, launches via `scripts/launch.js`.
- `nx serve:watch ptah-electron` — parallel watch on main/preload/embedder/webview.
- `nx package ptah-electron` — depends on `rebuild-native`; runs `electron-builder` then `verify-packed-native.js` (asserts the packed `better-sqlite3` carries the Electron ABI).
- `nx validate-deps ptah-electron` — runs after `build-main`; verifies externals declared in the generated `package.json`.

## Guidelines

- Keep `contextIsolation` and `sandbox` enabled. The renderer must never receive raw Node access — go through the preload contextBridge.
- All cleanup in `will-quit` runs LIFO and synchronously. New long-lived resources must register a stop/close ref captured in `main.ts` and disposed in `will-quit`.
- When a library reaches a `vscode` API the shim doesn't cover, extend `src/shims/vscode-shim.ts` — never add a runtime check in the caller.
- `generatePackageJson: true` emits a trimmed `package.json` with the external deps; electron-builder installs from there.

## Deployment Notes

- `better-sqlite3` must be compiled from source for the Electron ABI (no prebuilt exists for Electron 38+; Electron 40 = ABI 143): run `nx rebuild-native ptah-electron` after Electron upgrades. Requires a C++ toolchain (MSVC / Xcode CLT / gcc). `node-pty` (N-API prebuild) and `sqlite-vec` (loadable extension) need no rebuild.
- Update detection queries the GitHub Releases API directly (no `electron-updater`); it runs in `post-window` Phase 6 (`UpdateManager.start()`) and is skipped in dev builds. The Download action opens the platform installer in the browser.
- Code signing inputs (Windows SSL.com IV / eSigner, macOS Developer ID) are read from env at `electron-builder` invocation time; never commit signing material.
- Renderer copy: `scripts/copy-renderer.js` lives under `apps/ptah-electron/scripts/`.
