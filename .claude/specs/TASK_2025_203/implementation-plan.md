# Implementation Plan - TASK_2025_203: Unify RPC Handler Architecture

## Codebase Investigation Summary

### Handler Audit: `vscode` Import Usage Per Handler

| Handler                         | `import * as vscode` | Actual `vscode.*` API Usage                                                                                                                                                                                                                | Can Share?                                            |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **SessionRpcHandlers**          | NO                   | None (uses `fs`, `path`, `os`)                                                                                                                                                                                                             | YES - as-is                                           |
| **ContextRpcHandlers**          | NO                   | None                                                                                                                                                                                                                                       | YES - as-is                                           |
| **AutocompleteRpcHandlers**     | NO                   | None                                                                                                                                                                                                                                       | YES - as-is                                           |
| **SubagentRpcHandlers**         | NO                   | None                                                                                                                                                                                                                                       | YES - as-is                                           |
| **LlmRpcHandlers**              | NO                   | None (delegates to `LlmRpcHandlersInterface` via container)                                                                                                                                                                                | YES - as-is                                           |
| **PluginRpcHandlers**           | NO                   | None                                                                                                                                                                                                                                       | YES - as-is                                           |
| **PtahCliRpcHandlers**          | NO                   | None                                                                                                                                                                                                                                       | YES - as-is                                           |
| **ChatRpcHandlers**             | YES                  | `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` (1 line, line ~1478)                                                                                                                                                                  | YES - replace with `IWorkspaceProvider`               |
| **AuthRpcHandlers**             | YES                  | `vscode.window.createTerminal()` (codexLogin), `vscode.authentication.getSession()` (getGitHubUsername)                                                                                                                                    | PARTIAL - 2 methods need platform abstraction         |
| **ConfigRpcHandlers**           | YES                  | `vscode.ConfigurationTarget.Workspace` (passed to `configManager.set()`)                                                                                                                                                                   | YES - remove ConfigurationTarget param                |
| **FileRpcHandlers**             | YES                  | `vscode.Uri.file()`, `vscode.workspace.openTextDocument()`, `vscode.window.showTextDocument()`, `vscode.commands.executeCommand('revealInExplorer')`, `vscode.Position`, `vscode.Selection`, `vscode.Range`, `vscode.TextEditorRevealType` | NO - deeply VS Code specific                          |
| **CommandRpcHandlers**          | YES                  | `vscode.commands.executeCommand()`                                                                                                                                                                                                         | NO - deeply VS Code specific                          |
| **SetupRpcHandlers**            | YES                  | `vscode.workspace.workspaceFolders` (5 occurrences)                                                                                                                                                                                        | YES - replace with `IWorkspaceProvider`               |
| **LicenseRpcHandlers**          | YES                  | `vscode.commands.executeCommand('workbench.action.reloadWindow')` (1 line)                                                                                                                                                                 | PARTIAL - 1 line needs abstraction                    |
| **EnhancedPromptsRpcHandlers**  | YES                  | `vscode.workspace.workspaceFolders` (resolveWorkspacePath), `vscode.window.showSaveDialog()`, `vscode.workspace.fs.writeFile()`, `vscode.Uri.file()`                                                                                       | PARTIAL - download method uses VS Code dialogs        |
| **QualityRpcHandlers**          | YES                  | `vscode.workspace.workspaceFolders` (3 occurrences), `vscode.window.showSaveDialog()`, `vscode.workspace.fs.writeFile()`, `vscode.Uri.joinPath()`                                                                                          | PARTIAL - export method uses VS Code dialogs          |
| **ProviderRpcHandlers**         | YES                  | `vscode.lm.selectChatModels()` (Copilot/Codex dynamic fetcher)                                                                                                                                                                             | PARTIAL - dynamic model fetchers are VS Code specific |
| **AgentRpcHandlers**            | YES                  | `vscode.workspace.getConfiguration()`, `vscode.workspace.workspaceFolders`, `vscode.workspace.textDocuments`, `vscode.window.activeTextEditor`, `vscode.lm.selectChatModels()`, `vscode.ConfigurationTarget.Global`                        | NO - deeply VS Code specific                          |
| **WizardGenerationRpcHandlers** | YES                  | `vscode.workspace.workspaceFolders` (3 occurrences)                                                                                                                                                                                        | YES - replace with `IWorkspaceProvider`               |

### Key Findings

1. **7 handlers are already platform-agnostic** (no `vscode` import): Session, Context, Autocomplete, Subagent, Llm, Plugin, PtahCli.

2. **4 handlers only use `vscode.workspace.workspaceFolders`**: Chat, Setup, WizardGeneration, and partly Config. This is already abstracted by `IWorkspaceProvider` (PLATFORM_TOKENS.WORKSPACE_PROVIDER).

3. **3 handlers are deeply VS Code specific and should NOT be shared**: File (editor APIs), Command (vscode.commands), Agent (vscode.workspace.getConfiguration, vscode.lm, text documents).

4. **3 handlers have a mix** (mostly portable + 1-2 VS Code-specific methods): Auth (terminal + authentication), EnhancedPrompts (save dialog), Quality (save dialog), License (window reload), Provider (vscode.lm).

### Existing Platform Abstractions (from TASK_2025_199/200)

- `IWorkspaceProvider` (PLATFORM_TOKENS.WORKSPACE_PROVIDER) - replaces `vscode.workspace.workspaceFolders`
- `ISecretStorage` (PLATFORM_TOKENS.SECRET_STORAGE) - replaces `vscode.ExtensionContext.secrets`
- `IStateStorage` (PLATFORM_TOKENS.STATE_STORAGE) - replaces `globalState`
- `IFileSystemProvider` (PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) - replaces `vscode.workspace.fs`
- `ConfigManager` shim in Electron - replaces `vscode.workspace.getConfiguration`
- `EXTENSION_CONTEXT` shim in Electron - delegates to platform storage

---

## Architecture Decision

### Where Should Shared Handlers Live?

**Decision: Option A - `libs/backend/vscode-core/src/rpc/handlers/`**

**Rationale:**

- `vscode-core` already has an `src/rpc/` directory containing `llm-rpc-handlers.ts` (evidence: `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts`)
- `vscode-core` already exports `RpcHandler`, `TOKENS`, `Logger`, and all DI tokens the handlers need
- The `vscode-core` CLAUDE.md explicitly lists "RPC messaging infrastructure" as belonging here
- A new library (`libs/backend/rpc-handlers/`) adds unnecessary build complexity for what's essentially a set of classes that depend on existing vscode-core infrastructure
- The handlers depend on TOKENS from vscode-core, SDK_TOKENS from agent-sdk, and AGENT_GENERATION_TOKENS from agent-generation - all of which are already vscode-core dependencies

**Evidence:**

- Existing RPC handler in library: `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (line 82 in index.ts)
- RpcHandler class: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
- TOKENS namespace: `libs/backend/vscode-core/src/di/tokens.ts`

### Handler Classification for Sharing

**Tier 1 - Share As-Is (no changes needed):**

- SessionRpcHandlers
- ContextRpcHandlers
- AutocompleteRpcHandlers
- SubagentRpcHandlers
- LlmRpcHandlers
- PluginRpcHandlers
- PtahCliRpcHandlers

**Tier 2 - Share After Minor Refactoring (replace `vscode.workspace.workspaceFolders`):**

- ChatRpcHandlers (1 line)
- SetupRpcHandlers (5 occurrences of `vscode.workspace.workspaceFolders`)
- WizardGenerationRpcHandlers (3 occurrences)
- ConfigRpcHandlers (remove `ConfigurationTarget` param - ConfigManager shim ignores it anyway)
- LicenseRpcHandlers (1 line: `vscode.commands.executeCommand('workbench.action.reloadWindow')`)
- EnhancedPromptsRpcHandlers (resolveWorkspacePath + download method)
- QualityRpcHandlers (workspace folders + export method)
- ProviderRpcHandlers (Copilot/Codex dynamic fetchers are platform-specific but can be injected)

**Tier 3 - Keep Platform-Specific:**

- FileRpcHandlers (deeply VS Code: editor APIs, document model, text positions)
- CommandRpcHandlers (deeply VS Code: `vscode.commands.executeCommand`)
- AgentRpcHandlers (deeply VS Code: configuration API, `vscode.lm`, text documents, dirty file detection)

---

## New Abstractions Needed

### 1. IWorkspaceFolderResolver (inject via DI token)

Replaces all `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` usages.

```typescript
// Already exists: IWorkspaceProvider from @ptah-extension/platform-core
// Has: getWorkspaceFolders(): { uri: { fsPath: string } }[]
// Registered: PLATFORM_TOKENS.WORKSPACE_PROVIDER
```

**No new interface needed.** Inject `IWorkspaceProvider` via `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.

Both VS Code and Electron already register this token:

- VS Code: `registerPlatformVscodeServices()` (evidence: `apps/ptah-extension-vscode/src/di/container.ts:127`)
- Electron: `registerPlatformElectronServices()` (evidence: `apps/ptah-electron/src/di/container.ts:118`)

### 2. IPlatformCommands (new interface for platform-specific commands)

For handlers that need to execute commands (License reload, Auth terminal):

```typescript
// New token: TOKENS.PLATFORM_COMMANDS
interface IPlatformCommands {
  /** Reload the application window */
  reloadWindow(): Promise<void>;
  /** Open a terminal with a command (for auth flows). No-op on Electron. */
  openTerminal(name: string, command: string): void;
}
```

- VS Code impl: delegates to `vscode.commands.executeCommand('workbench.action.reloadWindow')` and `vscode.window.createTerminal()`
- Electron impl: delegates to Electron's `app.relaunch()` / no-op for terminal

### 3. IPlatformAuthProvider (new interface for GitHub authentication)

For AuthRpcHandlers.getGitHubUsername():

```typescript
// New token: TOKENS.PLATFORM_AUTH_PROVIDER
interface IPlatformAuthProvider {
  /** Get GitHub username from platform auth session. Returns undefined if unavailable. */
  getGitHubUsername(): Promise<string | undefined>;
}
```

- VS Code impl: uses `vscode.authentication.getSession('github', ...)`
- Electron impl: returns `undefined` (Copilot auth not available outside VS Code)

### 4. ISaveDialogProvider (new interface for save dialogs)

For EnhancedPrompts download and Quality export:

```typescript
// New token: TOKENS.SAVE_DIALOG_PROVIDER
interface ISaveDialogProvider {
  /** Show a save dialog and write content to the selected path. Returns file path or null if cancelled. */
  showSaveAndWrite(options: { defaultFilename: string; filters: Record<string, string[]>; title: string; content: Buffer }): Promise<string | null>;
}
```

- VS Code impl: uses `vscode.window.showSaveDialog()` + `vscode.workspace.fs.writeFile()`
- Electron impl: uses `dialog.showSaveDialog()` + `fs.writeFile()`

### 5. IModelDiscovery (new interface for platform-specific model listing)

For ProviderRpcHandlers dynamic fetchers:

```typescript
// New token: TOKENS.MODEL_DISCOVERY
interface IModelDiscovery {
  /** Fetch available models from the platform's LM API. Returns empty array if unavailable. */
  getCopilotModels(): Promise<Array<{ id: string; name: string; contextLength: number }>>;
  getCodexModels(): Promise<Array<{ id: string; name: string; contextLength: number }>>;
}
```

- VS Code impl: uses `vscode.lm.selectChatModels()`
- Electron impl: returns empty arrays (VS Code LM API not available)

---

## Migration Strategy: Incremental (Handler by Handler)

The migration can be done incrementally because each handler class is independent. Handlers are registered individually in the DI container and called individually by `RpcMethodRegistrationService.registerAll()`.

### Phase 1: Move Tier 1 Handlers (7 handlers, zero refactoring)

These handlers have NO `vscode` imports. Move them directly.

**Files to CREATE:**

- `libs/backend/vscode-core/src/rpc/handlers/session-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/context-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/autocomplete-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/subagent-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/llm-rpc.handlers-app.ts` (copy from app - note: different from existing `llm-rpc-handlers.ts` which is the backend interface)
- `libs/backend/vscode-core/src/rpc/handlers/plugin-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/ptah-cli-rpc.handlers.ts` (copy from app)
- `libs/backend/vscode-core/src/rpc/handlers/index.ts` (barrel export)

**Files to MODIFY:**

- `libs/backend/vscode-core/src/index.ts` (add handler exports)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts` (re-export from library)
- `apps/ptah-extension-vscode/src/di/container.ts` (update imports to use library path)
- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (replace inline implementations with shared handler classes for these 7 methods)
- `apps/ptah-electron/src/di/container.ts` (register shared handler classes)

**Files to DELETE (after Electron switch-over):**

- `apps/ptah-extension-vscode/src/services/rpc/handlers/session-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/context-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/autocomplete-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/plugin-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/ptah-cli-rpc.handlers.ts`

### Phase 2: Create Platform Abstractions (4 new interfaces + implementations)

**Files to CREATE:**

- `libs/backend/vscode-core/src/di/platform-tokens.ts` (new tokens: PLATFORM_COMMANDS, PLATFORM_AUTH_PROVIDER, SAVE_DIALOG_PROVIDER, MODEL_DISCOVERY)
- `apps/ptah-extension-vscode/src/services/platform/vscode-platform-commands.ts`
- `apps/ptah-extension-vscode/src/services/platform/vscode-platform-auth.ts`
- `apps/ptah-extension-vscode/src/services/platform/vscode-save-dialog.ts`
- `apps/ptah-extension-vscode/src/services/platform/vscode-model-discovery.ts`
- `apps/ptah-electron/src/services/platform/electron-platform-commands.ts`
- `apps/ptah-electron/src/services/platform/electron-platform-auth.ts`
- `apps/ptah-electron/src/services/platform/electron-save-dialog.ts`
- `apps/ptah-electron/src/services/platform/electron-model-discovery.ts`

**Files to MODIFY:**

- `libs/backend/vscode-core/src/di/tokens.ts` (add new tokens to TOKENS namespace)
- `libs/backend/vscode-core/src/index.ts` (export new interfaces)
- `apps/ptah-extension-vscode/src/di/container.ts` (register VS Code implementations)
- `apps/ptah-electron/src/di/container.ts` (register Electron implementations)

### Phase 3: Move Tier 2 Handlers (9 handlers, minor refactoring)

Refactor each handler to replace `vscode.*` calls with DI-injected platform abstractions, then move to library.

**Per-handler refactoring summary:**

1. **ChatRpcHandlers**: Replace `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` with `IWorkspaceProvider.getWorkspaceFolders()[0]?.uri.fsPath`. Inject via `PLATFORM_TOKENS.WORKSPACE_PROVIDER`.

2. **SetupRpcHandlers**: Replace 5 `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`. No other changes.

3. **WizardGenerationRpcHandlers**: Replace 3 `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`. No other changes.

4. **ConfigRpcHandlers**: Remove `{ target: vscode.ConfigurationTarget.Workspace }` option from `configManager.set()` calls. The ConfigManager interface doesn't require it (Electron shim ignores it). VS Code ConfigManager can default to Workspace target.

5. **LicenseRpcHandlers**: Replace `vscode.commands.executeCommand('workbench.action.reloadWindow')` with `IPlatformCommands.reloadWindow()`.

6. **AuthRpcHandlers**: Replace `vscode.window.createTerminal()` with `IPlatformCommands.openTerminal()`. Replace `vscode.authentication.getSession()` with `IPlatformAuthProvider.getGitHubUsername()`.

7. **EnhancedPromptsRpcHandlers**: Replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`. Replace `vscode.window.showSaveDialog()` + `vscode.workspace.fs.writeFile()` with `ISaveDialogProvider.showSaveAndWrite()`.

8. **QualityRpcHandlers**: Replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`. Replace save dialog with `ISaveDialogProvider`.

9. **ProviderRpcHandlers**: Replace `vscode.lm.selectChatModels()` with `IModelDiscovery`. Register Copilot/Codex dynamic fetchers using injected discovery service.

**Files to CREATE (per handler move):**

- `libs/backend/vscode-core/src/rpc/handlers/{handler-name}.ts`

**Files to DELETE (per handler move):**

- `apps/ptah-extension-vscode/src/services/rpc/handlers/{handler-name}.ts`

**Files to MODIFY:**

- `libs/backend/vscode-core/src/rpc/handlers/index.ts` (add exports)
- `libs/backend/vscode-core/src/index.ts` (add exports)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts` (re-export from library)
- `apps/ptah-extension-vscode/src/di/container.ts` (update imports)
- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (replace inline implementations)
- `apps/ptah-electron/src/di/container.ts` (register shared handlers)

### Phase 4: Electron Integration + Eliminate Procedural File

After all shared handlers are in the library:

1. Create an Electron `RpcMethodRegistrationService` class that mirrors the VS Code orchestrator pattern
2. Register shared handlers in Electron DI container using the same `registerSingleton` / factory pattern
3. Keep only the 3 Electron-specific handlers inline (file:open, command:execute, agent:\* config)
4. Delete the 2475-line procedural `registerExtendedRpcMethods` function

**Files to CREATE:**

- `apps/ptah-electron/src/services/rpc/electron-rpc-orchestrator.ts` (replaces procedural file)
- `apps/ptah-electron/src/services/rpc/handlers/electron-file-rpc.handlers.ts` (Electron-specific file:open using `shell.openPath`)
- `apps/ptah-electron/src/services/rpc/handlers/electron-command-rpc.handlers.ts` (Electron-specific command:execute)
- `apps/ptah-electron/src/services/rpc/handlers/electron-agent-rpc.handlers.ts` (Electron-specific agent config using Electron store)

**Files to REWRITE:**

- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (from 2475 lines to ~150 lines orchestrator)

### Phase 5: VS Code Orchestrator Update

Update the VS Code `RpcMethodRegistrationService` to import shared handlers from the library instead of the local handlers directory.

**Files to MODIFY:**

- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (update imports)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts` (keep only Tier 3 handlers + re-exports from library)

---

## Risk Assessment

### Low Risk

- **Tier 1 handlers** (Phase 1): Zero refactoring needed. These files have no `vscode` imports. Risk is only in import path changes.
- **DI registration**: Both platforms already use tsyringe with the same `@injectable()` + `@inject()` pattern. Electron's DI container already mirrors VS Code's.

### Medium Risk

- **ConfigManager.set() signature**: VS Code's `ConfigManager.set()` accepts an optional `{ target: ConfigurationTarget }` param. The Electron shim ignores it. Removing the param from shared handlers means VS Code will use the default target (Global). Need to verify VS Code ConfigManager defaults are acceptable.
- **IWorkspaceProvider injection**: Some handlers currently get workspace path as a constructor dependency (implicit), some get it per-call from `vscode.workspace.workspaceFolders`. Standardizing to `IWorkspaceProvider` injection is straightforward but touches many files.

### High Risk

- **Chat handler complexity**: ChatRpcHandlers is the largest handler (~1500 lines). It imports from 6+ libraries. Moving it requires careful import verification. Recommend moving it last within Phase 3.
- **Electron behavioral differences**: The Electron inline implementations may have subtle behavioral differences from the VS Code handler classes (e.g., different error handling, different metadata store API usage). Each handler move should be verified by running the Electron app.

### Mitigation

- Move handlers one at a time with a test cycle after each
- Keep both implementations temporarily during transition (VS Code imports from library, Electron's inline code coexists)
- Only delete Electron inline code after verifying shared handler works

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale:**

- All work is Node.js/TypeScript backend code (DI, services, handlers)
- No Angular/frontend changes required
- Deep understanding of DI patterns (tsyringe) required
- Platform abstraction design requires backend architecture skills

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-24 hours across 5 phases

**Breakdown:**

- Phase 1 (Tier 1 handlers): 3-4 hours (7 handlers, mechanical move)
- Phase 2 (Platform abstractions): 3-4 hours (4 interfaces + 8 implementations)
- Phase 3 (Tier 2 handlers): 6-8 hours (9 handlers, each needs refactoring + testing)
- Phase 4 (Electron integration): 3-4 hours (new orchestrator, delete procedural file)
- Phase 5 (VS Code orchestrator update): 1-2 hours (import path changes)

### Files Affected Summary

**CREATE**: ~25 files

- 16 shared handler files in `libs/backend/vscode-core/src/rpc/handlers/`
- 4 platform abstraction interfaces in `libs/backend/vscode-core/`
- 4 VS Code implementations in `apps/ptah-extension-vscode/src/services/platform/`
- 4 Electron implementations in `apps/ptah-electron/src/services/platform/`
- 3 Electron-specific handler files
- 1 Electron RPC orchestrator

**MODIFY**: ~8 files

- `libs/backend/vscode-core/src/index.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `apps/ptah-extension-vscode/src/di/container.ts`
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/index.ts`
- `apps/ptah-electron/src/di/container.ts`
- `apps/ptah-electron/src/main.ts` (update RPC registration call)

**DELETE**: ~17 files

- 16 handler files from `apps/ptah-extension-vscode/src/services/rpc/handlers/` (replaced by library exports)
- The 2475-line Electron procedural file (replaced by orchestrator)

**REWRITE**:

- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (2475 lines -> ~150 lines)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies:**

1. **All imports exist in codebase:**

   - `IWorkspaceProvider` from `@ptah-extension/platform-core` (verified: `apps/ptah-electron/src/di/container.ts:62`)
   - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (verified: `libs/backend/platform-core/`)
   - `RpcHandler` from `@ptah-extension/vscode-core` (verified: `libs/backend/vscode-core/src/index.ts:66`)
   - `TOKENS` from `@ptah-extension/vscode-core` (verified: `libs/backend/vscode-core/src/di/tokens.ts:296`)

2. **DI registration pattern verified:**

   - VS Code: `container.registerSingleton(HandlerClass)` (verified: `apps/ptah-extension-vscode/src/di/container.ts:220-283`)
   - Electron: `container.registerSingleton(TOKEN, Class)` pattern works (verified: `apps/ptah-electron/src/di/container.ts:180-204`)

3. **Handler `register()` pattern verified:**

   - All 19 handlers follow the same pattern: `@injectable()` class with `register(): void` method that calls `this.rpcHandler.registerMethod()`
   - VS Code orchestrator calls `handler.register()` for each (verified: `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts:123-143`)

4. **No vscode-core → app-layer circular dependencies:**
   - Handlers must only depend on libraries (vscode-core, agent-sdk, agent-generation, llm-abstraction, workspace-intelligence, shared, platform-core)
   - Handlers must NOT import from `apps/` directories
   - All current handler imports are from libraries (verified by reading all 19 handlers)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (handler-by-handler audit)
- [x] Integration points documented (DI registration, orchestrator pattern)
- [x] Files affected list complete
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (HIGH, 16-24 hours)
- [x] No step-by-step implementation (that's team-leader's job)
