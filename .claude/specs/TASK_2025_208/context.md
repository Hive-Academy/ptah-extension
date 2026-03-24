# TASK_2025_208: Multi-Workspace Isolation for Electron App

## User Request

Allow opening different workspace folders where each folder has its own encapsulated chat tabs, sessions, and editor view that don't interfere with other workspaces. True agentic workflow with best performance.

## Strategy

**Type**: FEATURE
**Workflow**: Full (PM → Architect → Team-Leader → QA)
**Complexity**: Complex

## Current State (from research)

### What Exists

1. **Monaco Editor**: Fully integrated in `libs/frontend/editor/` with 3-panel layout (sidebar + chat + editor)
2. **Workspace Provider**: `ElectronWorkspaceProvider` supports `setWorkspaceFolders()` and per-workspace state isolation via base64url-encoded storage paths
3. **Chat Session Scoping**: Sessions ARE workspace-scoped — `session:list` takes `workspacePath`, SDK stores at `~/.claude/projects/{workspace-path}/`
4. **State Storage**: Per-workspace storage with `ElectronStateStorage` at `${userDataPath}/workspace-storage/${encodedPath}/`

### What's Missing

1. **No workspace lifecycle manager** — DI container initialized once at startup with single workspace; no re-scoping on switch
2. **Backend gaps** — `addFolder()`, `removeFolder()`, `setActiveFolder()` not implemented in `ElectronWorkspaceProvider`
3. **No per-workspace chat isolation** — Tab state in localStorage is global, not workspace-scoped
4. **No per-workspace editor isolation** — File tree and open files not scoped to active workspace
5. **No workspace switching without restart** — Switching folders requires app restart currently

### Key Files

- `apps/ptah-electron/src/di/container.ts` — DI orchestrator (single workspace init)
- `apps/ptah-electron/src/main.ts` — App entry, workspace CLI parsing
- `apps/ptah-electron/src/windows/main-window.ts` — BrowserWindow creation
- `apps/ptah-electron/src/menu/application-menu.ts` — Open Folder menu action
- `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts` — Workspace provider
- `libs/backend/platform-electron/src/registration.ts` — Platform registration with workspace storage
- `libs/frontend/core/src/lib/services/electron-layout.service.ts` — Frontend workspace UI signals
- `libs/frontend/chat/src/lib/services/tab-manager.service.ts` — Chat tab management
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — 3-panel layout
- `libs/frontend/editor/src/lib/services/editor.service.ts` — Editor state
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` — Session RPC
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — Session metadata persistence
