# ptah-electron

[Back to Main](../../CLAUDE.md)

## Purpose

Standalone Electron 40 desktop build of Ptah. Reuses the Angular webview from `apps/ptah-extension-webview` inside a `BrowserWindow`, runs the same DI graph as the VS Code extension via a `vscode` module shim, and ships as a code-signed installer via electron-builder.

## Boundaries

**Belongs here**: Electron main-process entry, the multi-phase activation (`bootstrap` -> `wireRuntime` -> `registerPostWindow`), `BrowserWindow` creation, preload + contextBridge, IPC bridge, the `vscode` shim, electron-specific RPC handlers, electron-builder config.
**Does NOT belong**: business logic, Angular UI, shared RPC handlers, VS Code-only glue.

## Entry Points

- `src/main.ts` — single-instance lock, then on `app.whenReady`: `bootstrapElectron` -> `wireRuntimePreWindow` -> `registerPostWindow` (the window opens here) -> `coordinator.startPostWindow(...)`. It holds ONE `BootCoordinator`, not a set of nullable refs: the heavy boot now runs behind the window, so services arrive after a copy would have been taken. `coordinator.refs` is the stable object the boot writes into and `will-quit` reads from. `app.on('will-quit')` is a branch-free delegation to `handleWillQuit` (`src/activation/shutdown.ts`).
- `src/preload.ts` — built separately via `build-preload`, output `dist/apps/ptah-electron/preload.js`.

## Key Wiring

- `src/activation/bootstrap.ts` — minimal DI, license/membership verify (non-blocking, identity-only — never gates bootstrap), full DI, workspace restore, SDK auth.
- `src/activation/boot-coordinator.ts` — `BootRefs` (every long-lived handle), the boot `AbortSignal`, the bounded `awaitCompletion` drain, the embedder-warmup barrier (`did-finish-load` AND `refs.memoryCurator !== null`) and the persistence gate (`markPersistenceSettled` / `whenPersistenceSettled`) — opened by the heavy boot right after `bootThothRuntime` returns, and fallback-settled when the post-window boot finishes or aborts so no waiter is ever stranded.
- `src/activation/wire-runtime.ts` — the PRE-window half only: `armDiagnostics`, the IPC bridge, `registerRpcSurface`, `bringUpSubsystems`, the workspace-folders listener and the startup boot reservation. It returns a `postWindow()` closure. The listener propagates the harness ONLY when `booter.isReserved(active)` was already true before it reserved — a first switch to a root is fully covered by the boot it just started, and propagating beside it ran two full user-layer passes on one tree at the same time (TASK_2026_345).
- `src/activation/boot-heavy-services.ts` — the POST-window half: `bootThothRuntime` FIRST (it awaits `openAndMigrate()`), then plugin loader, `refreshUserLayer`, the deliberate double harness reconcile, session import, git watcher and cron. One-shot per normalized workspace root, and `isReserved(root)` answers whether that shot has been taken.
- `src/activation/coalesced-job.ts` — `createCoalescedJob`: per-key trailing window, serialized runs, the reason list preserved for the log, never rejects. `plugin-activation.ts` uses it for the user-layer pass keyed by normalized workspace root.
- `normalizeWorkspaceRoot` + `NO_WORKSPACE_KEY` — the canonical "are these two strings the same open folder" key, in **`@ptah-extension/shared`** (`utils/workspace-root-key.ts`). It moved out of this app in TASK_2026_364 because three consumers now need one answer: the boot latch, the user-layer coalescer and `AgentProcessManager`'s workspace-scoped agent registry. NOT `platform-core`'s same-named function, which resolves a path and keeps case.
- `src/activation/shutdown.ts` — `handleWillQuit` + the LIFO `disposeBootRefs` chain, split into `disposeBeforePersistence` / an awaited `stopMessagingGateway` / `disposeAfterPersistence` / an awaited final metadata flush. A quit is deferred for either of two reasons: a post-window boot is in flight (abort, then drain for at most 2 s), or the chain has something to AWAIT. Two handles qualify, each because a WRITE happens after the await — `GatewayService.stop()`, whose outbound drain writes to the database `SQLite close` is about to shut (`GATEWAY_STOP_BUDGET_MS`), and `AgentProcessManager.disposeAll()`, whose exiting agents stage a session reference that only the final flush writes (`AGENT_REAP_BUDGET_MS`). With neither, the listener is synchronous and identical to the pre-change code. Every bounded await goes through one `withBudget` helper, which never rejects and never cancels the step it gave up on.
- **The session metadata store is flushed TWICE, and neither call replaces the other (TASK_2026_334).** The EARLY flush in `handleWillQuit` is started, not awaited, and drains what was already staged when the quit arrived — it is all the undeferred path gets, which is why it must not move below the disposals (TASK_2026_324). The FINAL flush in `disposeBootRefs` is awaited and runs after the agents are reaped, because an agent stages its session reference as it EXITS and that reference is the only route to `ptah.agentOutput:<agentId>`. Reaping fire-and-forget and flushing once meant the relaunched session showed no CLI agent and could not continue it.
- `src/activation/post-window.ts` — startup config IPC handler, `BrowserWindow` creation, messaging gateway, auto-updater (production only). The gateway/bridge START is delegated to `src/activation/start-messaging-gateway.ts`, which waits on the coordinator's persistence gate — this phase runs BEFORE the heavy boot opens SQLite.
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
- `nx serve:watch ptah-electron` — parallel watch on main/preload/embedder/webview, plus `scripts/watch-renderer.js`, which mirrors each webview rebuild into `dist/apps/ptah-electron/renderer`. Without it the renderer keeps the chunk hashes of the last `copy-renderer` run, and the next lazy import in a live window 404s.
- `nx package ptah-electron` — depends on `rebuild-native`; runs `electron-builder` then `verify-packed-native.js` (asserts the packed `better-sqlite3` carries the Electron ABI).
- `nx validate-deps ptah-electron` — runs after `build-main`; verifies externals declared in the generated `package.json`.

## Guidelines

- Keep `contextIsolation` and `sandbox` enabled. The renderer must never receive raw Node access — go through the preload contextBridge.
- All cleanup in `will-quit` runs LIFO. New long-lived resources must add a field to `BootRefs` (`src/activation/boot-coordinator.ts`) and a `nonFatal(...)` line in the right half of the chain (`src/activation/shutdown.ts`): anything that touches SQLite on stop goes in `disposeBeforePersistence` (the `SQLite close` is the first line of `disposeAfterPersistence`), everything else after. If that stop is async and its write must LAND, it has to be awaited the way `stopMessagingGateway` and the agent reap are — a `void x.stop()` followed by a same-tick `close()` writes into a closed connection — and `requiresDeferredDisposal` must say so, or Electron will not wait for it. **Put the null check at the `await` site, not inside an async helper**: `await f()` suspends even when `f` returns immediately, so a guard hidden one call down pushes every later line into a microtask, and on a path Electron does not wait for, a microtask is never. Never copy a ref out of `coordinator.refs` into a local — the heavy boot fills the object AFTER `whenReady` returns, so a copy is a snapshot of nulls.
- Anything started in the post-window phase that touches SQLite must `await coordinator.whenPersistenceSettled()` first. Do not poll `SqliteConnectionService.isOpen`: `openAndMigrate` assigns the handle before it applies migrations, so `isOpen` is already true mid-migration. `sqliteOpen: false` from the gate is a terminal answer (no workspace root, failed boot, quit) — run degraded, do not keep waiting.
- Nothing on the critical path may await the network or a disk scan. `wireRuntimePreWindow` holds only what the renderer needs the moment it loads; everything else belongs in `boot-heavy-services.ts` and must honour `coordinator.abortSignal`.
- The user-layer pass — mirror, reconcile, `skill_registry` catalog sync — has ONE entry point, `refreshUserLayer(container, root, reason)` in `src/activation/plugin-activation.ts`. Never call `mirrorUserLayer`, `reconcileUserLayer` or `syncSkillRegistryCatalog` directly from a new trigger: a workspace switch fires up to four of them within a few hundred milliseconds, and before TASK_2026_345 that meant two mirrors and four catalog syncs, with two passes interleaving on the same tree. Give the coalescer a new `reason` string instead; it will merge yours into whatever pass is already forming and name it in the log line.
- When a library reaches a `vscode` API the shim doesn't cover, extend `src/shims/vscode-shim.ts` — never add a runtime check in the caller.
- `generatePackageJson: true` emits a trimmed `package.json` with the external deps; electron-builder installs from there.

## Deployment Notes

- `better-sqlite3` must be compiled from source for the Electron ABI (no prebuilt exists for Electron 38+; Electron 40 = ABI 143): run `nx rebuild-native ptah-electron` after Electron upgrades. Requires a C++ toolchain (MSVC / Xcode CLT / gcc). `node-pty` (N-API prebuild) and `sqlite-vec` (loadable extension) need no rebuild.
- Update detection queries the GitHub Releases API directly (no `electron-updater`); it runs in `post-window` Phase 6 (`UpdateManager.start()`) and is skipped in dev builds and under the e2e harness (`PTAH_E2E=1`; a spec that wants the real network path opts back in with `PTAH_E2E_ALLOW_UPDATE_CHECK=1`). The Download action opens the platform installer in the browser.
- **The prompt repeats until the user downloads, and "Later" does not stop it.** "Later" is a renderer-side snooze, so every later check re-opens the dialog — a stray click cannot lose an update. Download is the acknowledgement: it calls `update:mark-downloaded`, which persists the version under `ptah.update.downloadedVersion` in `IStateStorage`. `checkViaGitHub` then broadcasts `idle` for that version only, so the next release prompts again. The key is deliberately never cleared — once the user installs, `latest <= installed` ends the prompt anyway.
- **The first check is deferred 10 s and every request gets one retry.** `start()` runs alongside native module loading, SQLite and window creation, and the fetch abort timer lives on the same main-process event loop — a boot stall spends the timeout budget even when the network is fine. That, a ~160 KB response and Windows WPAD proxy resolution together blew the old 5 s budget and painted a "request timed out" error at every launch (TASK: `fix/electron-update-check-timeout`). The budget is now 15 s. Do not surface `error` in the renderer: a failed _check_ is not user-actionable, so `<ptah-update-dialog>` opens only on `available`.
- Code signing inputs (Windows SSL.com IV / eSigner, macOS Developer ID) are read from env at `electron-builder` invocation time; never commit signing material.
- Renderer copy: `scripts/copy-renderer.js` lives under `apps/ptah-electron/scripts/`. Run as a script it does a clean copy (packaging); required as a module it exports `syncRenderer({ clean })`, which `watch-renderer.js` calls with `clean: false` so a running window keeps the stale chunks it already resolved.
