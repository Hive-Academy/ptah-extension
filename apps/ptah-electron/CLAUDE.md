# Ptah Electron - Standalone Desktop Application

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-electron** application is the standalone desktop build of Ptah.
It embeds the same Angular webview the VS Code extension uses, but runs it
inside an Electron window instead of the extension host. This lets Ptah ship
as a self-contained app for users who do not want VS Code.

It provides:

- Electron main-process bootstrap (window, IPC, auto-updater, menu, preload)
- A VS Code API shim (`src/shims/vscode-shim.ts`) so the `vscode-*` libraries
  run unmodified
- The same DI container, RPC layer, and library stack as the VS Code extension
- Workspace-folder persistence and restoration across launches
- Code-signed installer builds via `electron-builder`

## Boundaries

**Belongs here**:

- Electron main-process entry (`src/main.ts`) and activation phases
  (`src/activation/`)
- `BrowserWindow` creation, menu, preload, IPC bridge
- Platform adapters that rely on `electron` APIs directly (PTY, clipboard,
  safe-storage, save dialog, auto-updater)
- Electron-specific RPC handlers (`src/services/rpc/handlers/electron-*`)
- DI container setup for the Electron host (`src/di/`)
- The `vscode` module shim (`src/shims/vscode-shim.ts`)

**Does NOT belong**:

- Business logic — belongs in backend libraries
- Angular UI — belongs in `apps/ptah-extension-webview`
- Shared RPC handler classes — belong in `libs/backend/rpc-handlers`
- VS Code-specific glue — belongs in `apps/ptah-extension-vscode`
- CLI agent process management — belongs in `libs/backend/llm-abstraction`
  (to be moved into `libs/backend/agent-sdk/cli-agents/` by Wave C5)

## Key Files

### Entry Points

- `src/main.ts` — Electron main-process entry; single-instance lock +
  `app.whenReady` orchestrator
- `src/preload.ts` — contextBridge preload exposed to the renderer
- `src/activation/bootstrap.ts` — Phases 1–3.6 (CLI args, DI container,
  workspace restore, license, SDK auth)
- `src/activation/wire-runtime.ts` — Phases 4–4.9 (IPC bridge, RPC, MCP,
  plugins, skills, CLI sync, git watcher)
- `src/activation/post-window.ts` — Phases 4.95–7 (startup config IPC,
  window creation, auto-updater, license watcher)

### Configuration

- `tsconfig.app.json` — TypeScript base for the app
- `tsconfig.build.json` — build-time path mappings (includes the `vscode`
  shim mapping)
- `tsconfig.preload.json` — separate tsconfig for the preload bundle
- `project.json` — Nx targets: `build-main`, `build-preload`, `serve`, `package`
- `electron-builder.yml` — installer configuration (publish channels, code
  signing, NSIS/DMG options)

### Assets

- `src/assets/` — app icons (PNG, ICO, ICNS) consumed by electron-builder
- `scripts/` — helper scripts (launch, rebuild native deps)

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Electron Main Process (Node.js)                               │
├────────────────────────────────────────────────────────────────┤
│  main.ts (single-instance lock)                                │
│    ↓                                                           │
│  activation/bootstrap.ts                                       │
│    → ElectronDIContainer.setup(platformOptions)                │
│    → LicenseService.verifyLicense()                            │
│    → SdkAgentAdapter.initialize()                              │
│    ↓                                                           │
│  activation/wire-runtime.ts                                    │
│    → IpcBridge.initialize()                                    │
│    → ElectronRpcMethodRegistrationService.registerAll()        │
│    → PluginLoader / SkillJunction / CLI sync (fire-and-forget) │
│    → CodeExecutionMCP.start()                                  │
│    ↓                                                           │
│  activation/post-window.ts                                     │
│    → ipcMain.on('get-startup-config', ...)                     │
│    → createMainWindow() → loadFile(rendererPath)               │
│    → autoUpdater.checkForUpdatesAndNotify()                    │
│    ↓                                                           │
│  ┌───────────────────────────────────────────┐                 │
│  │  BrowserWindow (renderer)                 │                 │
│  │  loads dist/apps/ptah-extension-webview   │                 │
│  │  ↑                                        │                 │
│  │  preload.ts exposes `window.ptah.*`       │                 │
│  │  via contextBridge (RPC + IPC)            │                 │
│  └───────────────────────────────────────────┘                 │
└────────────────────────────────────────────────────────────────┘
```

## Dependencies

### Internal Libraries

- `@ptah-extension/shared` — types and message protocol
- `@ptah-extension/platform-core` — platform interfaces and tokens
- `@ptah-extension/platform-electron` — Electron implementations of
  platform-core interfaces (10 providers)
- `@ptah-extension/vscode-core` — infrastructure (DI, logger, RPC, license,
  session watcher, subagent registry, feature gate)
- `@ptah-extension/workspace-intelligence` — workspace analysis
- `@ptah-extension/agent-sdk` — Claude Agent SDK integration
- `@ptah-extension/agent-generation` — agent generation services
- `@ptah-extension/llm-abstraction` — CLI agent process manager and CLI
  adapters (slated for merge into agent-sdk by Wave C5)
- `@ptah-extension/vscode-lm-tools` — MCP code execution + PtahAPI builder
- `@ptah-extension/rpc-handlers` — shared platform-agnostic RPC handlers

### External NPM Packages

- `electron`, `electron-updater` — runtime + auto-update
- `tsyringe`, `reflect-metadata` — dependency injection
- `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`, `@openai/codex-sdk`
  — AI provider SDKs (kept external in the esbuild bundle)
- `node-pty` — terminal hosting (native module, rebuilt per Electron ABI)
- `chrome-launcher`, `chrome-remote-interface` — browser automation
- `chokidar`, `fast-glob`, `minimatch`, `picomatch` — file system
- `axios`, `exa-js`, `@tavily/core` — HTTP + search providers

All npm dependencies actually shipped in the installer are declared in
`apps/ptah-electron/package.json` (this app's own manifest — not the root
`package.json`) so electron-builder resolves them from there.

### Build Dependencies

- `@nx/esbuild` — bundles `main.ts` and `preload.ts` to ESM
- `electron-builder` — installer packaging (NSIS on Windows, DMG on macOS,
  AppImage / deb on Linux)

## Commands

```bash
# Development
npm run electron:serve                 # Build once + launch Electron
npm run electron:watch                 # Watch mode
npm run electron:launch                # Custom launcher script

# Build
npm run electron:build                 # Production build (nx build)
npm run electron:build:dev             # Dev build
npm run electron:rebuild               # Rebuild node-pty for current Electron

# Package (installer)
npm run electron:package               # electron-builder → dist installers
```

## Build Process

1. **build-main**: esbuild bundles `src/main.ts` → `dist/apps/ptah-electron/main.mjs`
   (ESM, Node 20, with `createRequire` banner for CommonJS interop). All native
   / heavy deps are kept external (see `project.json` externals list).
2. **build-preload**: separate esbuild target for `src/preload.ts` → preload
   bundle loaded via `webPreferences.preload`.
3. **Webview copy**: post-build step copies the Angular SPA from
   `dist/apps/ptah-extension-webview/browser` into
   `dist/apps/ptah-electron/renderer/`.
4. **generatePackageJson**: esbuild emits a trimmed `package.json` listing
   exactly the external deps used; electron-builder installs these into the
   packaged app.
5. **package**: electron-builder reads `electron-builder.yml` and produces
   per-platform installers into `dist/installers/`.

## Electron-specific Concerns

### Preload + contextIsolation

`src/preload.ts` runs in an isolated world and uses
`contextBridge.exposeInMainWorld('ptah', {...})` to expose a narrow RPC
surface to the renderer. **Never** disable `contextIsolation` or
`sandbox`. The renderer gets no direct access to Node APIs.

### IPC

The main process uses `ipcMain.handle('...')` for request/response and
`ipcMain.on('...')` for fire-and-forget. The RPC layer rides on top via
`IpcBridge` (`src/ipc/ipc-bridge.ts`) which multiplexes the shared
`rpc-handlers` library. Electron-specific one-shot channels include
`get-startup-config` (sync on preload), `clipboard:read-text`,
`clipboard:write-text`.

### The `vscode` module shim

Many libraries import `vscode` directly. `src/shims/vscode-shim.ts`
provides a minimal stub; `tsconfig.build.json` maps the `vscode` module
to the shim so the Electron bundle compiles and runs without the VS Code
API. When a library reaches a vscode API the shim does not cover, the
shim should grow — never add a runtime check in the calling library.

### Windowing

`src/windows/main-window.ts` is the only window factory. State (position,
size) persists via `IStateStorage` resolved from the DI container.

### Auto-updater

Enabled only in production builds (dynamic `import('electron-updater')` in
`activation/post-window.ts` Phase 6). In dev mode it is skipped.

### Code signing

Windows builds rely on SSL.com IV certificate + eSigner (see project memory
`code-signing-research.md`). macOS uses Apple Developer ID. CI sets the
required env vars before invoking `electron-builder`.

## Development Workflow

1. **Start watch mode**:
   ```bash
   npm run electron:watch
   ```
2. **Launch**: the watch script rebuilds and relaunches the app on main /
   preload changes. Renderer code (webview) hot-reloads independently.
3. **DevTools**: automatically opened in dev (`mainWindow.webContents.openDevTools()`).
4. **Native deps after Electron upgrade**: run `npm run electron:rebuild`
   to recompile `node-pty` against the new Electron ABI.

## Guidelines

### Activation Lifecycle

```typescript
// main.ts (thin orchestrator)
app.whenReady().then(async () => {
  const boot = await bootstrapElectron(() => mainWindow);
  const wired = await wireRuntime({
    container: boot.container,
    getMainWindow: () => mainWindow,
    /* ... */
  });
  const post = await registerPostWindow({
    container: boot.container,
    setMainWindow: (w) => {
      mainWindow = w;
    },
    /* ... */
  });
});
```

See `WAVE_C1_DESIGN.md` for the authoritative phase-by-phase contract.

### IPC

- Register one `ipcMain.handle(channel, ...)` per channel; no wildcards.
- Validate the payload at the boundary (use the shared RPC message validator
  when possible).
- Never pass `BrowserWindow` objects across the bridge.

### Window Creation

- Single main window per instance. Additional views live inside the renderer
  or use the Angular router.
- Persist window bounds via the `IStateStorage` DI token.

### Performance

- Fire-and-forget every non-blocking startup step (plugin load, CLI sync,
  pricing pre-fetch). The window must appear within 2 seconds of ready.
- Do not await any license-server RPC beyond a 5-second timeout.

## Testing

```bash
# Unit tests
nx test ptah-electron

# Smoke test (developer only)
npm run electron:serve
# → verify window opens, workspace loads, a chat round-trip succeeds.
```

## Troubleshooting

**App does not launch**:

- Check the single-instance lock — another Ptah instance may already own it.
- Inspect `dist/apps/ptah-electron/main.mjs` for the esbuild banner line;
  missing `createRequire` indicates a build misconfiguration.

**Renderer is blank**:

- Confirm `dist/apps/ptah-extension-webview/browser/index.html` was copied
  into `dist/apps/ptah-electron/renderer/`.
- Inspect the renderer devtools console (`Ctrl+Shift+I`).

**`node-pty` crash on launch**:

- Run `npm run electron:rebuild` to rebuild the native module for the current
  Electron version.

**Auto-updater fails in dev**:

- Expected — auto-updater is disabled outside production builds.

**Preload not loaded**:

- Check `webPreferences.preload` path in `src/windows/main-window.ts`.
- Verify the preload bundle exists at `dist/apps/ptah-electron/preload.mjs`.

## Related Documentation

- [VS Code Extension App](../ptah-extension-vscode/CLAUDE.md)
- [Angular Webview App](../ptah-extension-webview/CLAUDE.md)
- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
- [Conventions](../../CONVENTIONS.md)
- [Wave C1 Design (bootstrap split)](../../.ptah/specs/TASK_2025_291/WAVE_C1_DESIGN.md)
