# TASK_2025_214: Electron Plugin & Setup Wizard Integration

## User Request

Make plugins and setup wizard work in the Electron app. Plugin assets currently live only under the VS Code app (`apps/ptah-extension-vscode/assets/plugins/`), and several services need wiring/adaptation for Electron.

## Task Type

FEATURE

## Workflow

Partial: Architect → Team-Leader → Developers → QA

## Key Issues Identified

### 1. Plugin Assets Location

- Assets under `apps/ptah-extension-vscode/assets/plugins/` — Electron app can't access them
- Need shared location or build-time copy
- 4 plugins: ptah-core, ptah-angular, ptah-nx-saas, ptah-react

### 2. Plugin Initialization in Electron

- `PluginLoaderService` needs initialization in Electron DI container
- Uses `IPlatformInfo.extensionPath` and `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`
- `SkillJunctionService` needs activation in Electron bootstrap

### 3. Setup Wizard Panel Lifecycle

- VS Code uses `WizardWebviewLifecycleService` → `vscode.window.createWebviewPanel()`
- Electron has no webview panel API — wizard renders in existing BrowserWindow
- Need Electron-specific wizard lifecycle service

### 4. Skill Junction Workspace Change Events

- `SkillJunctionService` subscribes to `onDidChangeWorkspaceFolders`
- `ElectronWorkspaceProvider` must fire this event properly

## Prior Analysis (from conversation)

### Already Portable (no changes needed)

- `plugin-loader.service.ts` — uses `IStateStorage` abstraction
- `plugin-skill-discovery.ts` — pure Node.js `fs`
- `sdk-query-options-builder.ts` — pure data construction
- `plugin-rpc.handlers.ts` — clean RPC handler
- `wizard-generation-rpc.handlers.ts` — uses `WebviewBroadcaster` abstraction
- `setup-rpc.handlers.ts` — uses `IWorkspaceProvider` from platform-core
- All wizard Angular components — no VS Code imports

### Needs Adaptation

- `skill-junction.service.ts` — workspace change event wiring
- `setup-wizard.service.ts` — VS Code webview panel API (full rewrite for Electron)
- `main.ts` plugin init section — needs Electron equivalent in DI container

## Existing Architecture

- Platform abstraction: `platform-core` (8 interfaces, 10 DI tokens) + `platform-electron` (implementations)
- Electron app: `apps/ptah-electron/` with `ElectronDIContainer.setup()` (783 LOC)
- 16 shared RPC handlers + 7 Electron-specific handlers
- Angular webview renders in Electron's BrowserWindow via IPC bridge
