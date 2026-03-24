# Implementation Plan - TASK_2025_201: Electron App — Complete Missing RPC Methods and DI Gaps

## Codebase Investigation Summary

### Files Examined

- **Electron RPC core**: `apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts` (already has: `chat:start`, `chat:abort`, `config:model-get`, `config:model-set`, `session:list`, `session:delete`, `auth:*`, `context:*`, `file:*`, `license:*`)
- **Electron RPC extended**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (already has: `session:load`, `session:validate`, `session:cli-sessions`, `autocomplete:*`, `chat:subagent-query`, `chat:send-message`, `chat:stop`, `setup-status:get-status`, `llm:*`, `plugins:*`, `workspace:getInfo`, `editor:*`)
- **Electron DI container**: `apps/ptah-electron/src/di/container.ts` (Phase 0-3 registration)
- **Electron main**: `apps/ptah-electron/src/main.ts` (Phase 1-5 app bootstrap)
- **VS Code chat handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
- **VS Code config handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/config-rpc.handlers.ts`
- **VS Code setup handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`
- **VS Code wizard-gen handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`
- **VS Code command handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/command-rpc.handlers.ts`
- **VS Code quality handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts`
- **VS Code agent handlers**: `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts`
- **Frontend RPC service**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
- **Workspace-intelligence DI**: `libs/backend/workspace-intelligence/src/di/register.ts`
- **Angular webview project.json**: `apps/ptah-extension-webview/project.json`
- **Electron project.json**: `apps/ptah-electron/project.json`

### Patterns Identified

1. **Inline RPC registration pattern**: Both `rpc-handler-setup.ts` and `rpc-method-registration.service.ts` register methods inline via `rpcHandler.registerMethod('method:name', async (params) => { ... })`. The handler resolves services from the DI container at call time using structural typing (inline interface definitions).

2. **Platform adaptation pattern**: VS Code handlers use `vscode.workspace.workspaceFolders[0].uri.fsPath` for workspace path. Electron handlers use `container.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER).getWorkspaceRoot()`. This pattern is already established in `rpc-handler-setup.ts:182-194`.

3. **Error handling pattern**: Handlers wrap all logic in try/catch, log errors via `logger.error()` or `logger.warn()`, and return `{ success: false, error: message }` or default empty arrays on failure.

4. **Streaming pattern**: The existing `chat:start` handler in `rpc-handler-setup.ts` calls `sdkAdapter.startSession()` but does NOT stream events to the renderer. The `chat:continue` and `chat:resume` handlers in VS Code stream events via `this.streamExecutionNodesToWebview()` which uses `webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, ...)`.

### DI Token Investigation

**TOKENS.AGENT_DISCOVERY_SERVICE** and **TOKENS.COMMAND_DISCOVERY_SERVICE**:

- Defined in `libs/backend/vscode-core/src/di/tokens.ts:110-111`
- Registered by `registerWorkspaceIntelligenceServices()` in `libs/backend/workspace-intelligence/src/di/register.ts:194-201`
- This function IS called in `container.ts:199` (Phase 2.1)
- HOWEVER: `registerWorkspaceIntelligenceServices()` has a dependency check at line 85-89 that requires `TOKENS.FILE_SYSTEM_MANAGER` to be registered. This token is registered by `registerVsCodeCoreServices()` (which is NOT called in Electron).
- **This means `registerWorkspaceIntelligenceServices()` likely throws at startup**, preventing AGENT_DISCOVERY_SERVICE and COMMAND_DISCOVERY_SERVICE from being registered.
- **Fix**: Register a `TOKENS.FILE_SYSTEM_MANAGER` shim in the Electron container BEFORE calling `registerWorkspaceIntelligenceServices()`. The shim can delegate to `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` which IS registered.

### Build Path Verification

- `apps/ptah-extension-webview/project.json:13` outputs to `dist/apps/ptah-extension-webview`
- Angular 20 with `@angular/build:application` outputs to `{outputPath}/browser/` by default
- `apps/ptah-electron/project.json:60` copies from `dist/apps/ptah-extension-webview/browser` to `dist/apps/ptah-electron/renderer`
- `apps/ptah-electron/src/main.ts:159` loads renderer from `path.join(__dirname, 'renderer', 'index.html')`
- **Verdict**: Build path is CORRECT. No fix needed.

---

## Architecture Design

### Design Philosophy

**Approach**: Register all missing RPC methods inline in the existing files, following the established pattern. No new handler classes. Use the same delegation-to-domain-services pattern as existing handlers.

**Evidence**: All existing Electron RPC handlers in `rpc-handler-setup.ts` and `rpc-method-registration.service.ts` follow this pattern (verified across 30+ method registrations).

### Missing RPC Methods Breakdown

Based on cross-referencing VS Code handler files with Electron registrations:

| Method                    | VS Code Reference                           | Electron Target File                 | Status      |
| ------------------------- | ------------------------------------------- | ------------------------------------ | ----------- |
| `chat:continue`           | `chat-rpc.handlers.ts:742-1002`             | `rpc-handler-setup.ts`               | **MISSING** |
| `chat:resume`             | `chat-rpc.handlers.ts:1126-1246`            | `rpc-handler-setup.ts`               | **MISSING** |
| `chat:running-agents`     | `chat-rpc.handlers.ts:1293-1320`            | `rpc-handler-setup.ts`               | **MISSING** |
| `agent:stop`              | `agent-rpc.handlers.ts:554-582`             | `rpc-method-registration.service.ts` | **MISSING** |
| `config:autopilot-get`    | `config-rpc.handlers.ts:271-298`            | `rpc-method-registration.service.ts` | **MISSING** |
| `config:autopilot-toggle` | `config-rpc.handlers.ts:174-266`            | `rpc-method-registration.service.ts` | **MISSING** |
| `config:models-list`      | `config-rpc.handlers.ts:303-406`            | `rpc-method-registration.service.ts` | **MISSING** |
| `config:model-switch`     | `config-rpc.handlers.ts:95-142`             | `rpc-method-registration.service.ts` | **MISSING** |
| `command:execute`         | `command-rpc.handlers.ts:64-112`            | `rpc-method-registration.service.ts` | **MISSING** |
| `setup-wizard:launch`     | `setup-rpc.handlers.ts:201-239`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:cancel`           | `wizard-generation-rpc.handlers.ts:659-746` | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:cancel-analysis`  | `setup-rpc.handlers.ts:551-604`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:deep-analyze`     | `setup-rpc.handlers.ts:249-399`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:list-analyses`    | `setup-rpc.handlers.ts:613-633`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:load-analysis`    | `setup-rpc.handlers.ts:638-662`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:recommend-agents` | `setup-rpc.handlers.ts:418-542`             | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:retry-item`       | `wizard-generation-rpc.handlers.ts:762-908` | `rpc-method-registration.service.ts` | **MISSING** |
| `wizard:submit-selection` | `wizard-generation-rpc.handlers.ts:239-539` | `rpc-method-registration.service.ts` | **MISSING** |
| `quality:export`          | `quality-rpc.handlers.ts:190-289`           | `rpc-method-registration.service.ts` | **MISSING** |

---

## Component Specifications

### Component 1: DI Gap Fix — FILE_SYSTEM_MANAGER Shim

**File**: `apps/ptah-electron/src/di/container.ts` (MODIFY)

**Purpose**: Register `TOKENS.FILE_SYSTEM_MANAGER` before `registerWorkspaceIntelligenceServices()` so the dependency check passes. Several workspace-intelligence services and agent-sdk services (`PromptCacheService`) inject this token.

**Evidence**: `libs/backend/workspace-intelligence/src/di/register.ts:85-89` checks for `TOKENS.FILE_SYSTEM_MANAGER`. `libs/backend/vscode-core/src/di/register.ts:93` registers `FileSystemManager` (which imports vscode).

**Implementation**: Create a thin shim object that delegates to `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (already registered via platform-electron). The `FileSystemManager` in VS Code wraps `vscode.workspace.fs`. The workspace-intelligence services that use it mainly call `readFile()`, `writeFile()`, and `stat()` methods.

**Where to add**: In `container.ts`, AFTER Phase 1.2 (platform-agnostic vscode-core services) and BEFORE Phase 2.1 (`registerWorkspaceIntelligenceServices`). Add as Phase 1.3.

```typescript
// ========================================
// PHASE 1.3: FILE_SYSTEM_MANAGER shim (required by workspace-intelligence)
// ========================================
// registerWorkspaceIntelligenceServices() checks container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER).
// The real FileSystemManager imports vscode, so we provide a shim that delegates to
// the platform-agnostic IFileSystemProvider.
const fileSystemProvider = container.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);
container.register(TOKENS.FILE_SYSTEM_MANAGER, { useValue: fileSystemProvider });
```

---

### Component 2: Chat Core Methods — chat:continue, chat:resume, chat:running-agents

**File**: `apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts` (MODIFY)

**Purpose**: These are core chat methods that belong alongside the existing `chat:start` and `chat:abort` handlers. `chat:continue` is the most critical -- it is called every time the user sends a follow-up message.

**Pattern source**: VS Code `chat-rpc.handlers.ts:742-1320` adapted for Electron.

#### chat:continue

**VS Code behavior** (chat-rpc.handlers.ts:742-1002):

1. Check if session is active in memory
2. If not active, auto-resume: build AISessionConfig, call `sdkAdapter.resumeSession()`, start streaming
3. Handle subagent context injection (resume interrupted agents)
4. Send message via `sdkAdapter.sendMessageToSession()`

**Electron adaptation**:

- Replace `vscode.workspace.workspaceFolders[0].uri.fsPath` with `workspaceProvider.getWorkspaceRoot()`
- Skip MCP server checks (no `CodeExecutionMCP` in Electron)
- Skip license checks (Electron stub is always Pro)
- Skip Ptah CLI dispatch (Electron does not support CLI agent orchestration)
- Skip slash command interception (simplification for Electron MVP)
- Keep auto-resume logic (critical for UX)
- Use `TOKENS.WEBVIEW_MANAGER` for event streaming to renderer

**DI tokens needed**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `SDK_TOKENS.SDK_AGENT_ADAPTER`, `TOKENS.STORAGE_SERVICE`, `TOKENS.WEBVIEW_MANAGER`, `TOKENS.SUBAGENT_REGISTRY_SERVICE`

**Implementation pattern**:

```typescript
rpcHandler.registerMethod(
  'chat:continue',
  async (
    params:
      | {
          sessionId: string;
          message: string; // VS Code uses 'prompt' field name
          tabId?: string;
          contextFiles?: string[];
          model?: string;
        }
      | undefined
  ) => {
    if (!params?.sessionId || !params?.message) {
      return { success: false, error: 'sessionId and message are required' };
    }

    const workspaceProvider = container.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER);
    const sdkAdapter = container.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
    const workspaceRoot = workspaceProvider.getWorkspaceRoot() ?? '';

    // Auto-resume if session not active
    if (!sdkAdapter.isSessionActive(params.sessionId)) {
      const storageService = container.resolve(TOKENS.STORAGE_SERVICE);
      const currentModel = params.model || storageService.get('model.selected', 'claude-sonnet-4-20250514');

      const stream = await sdkAdapter.resumeSession(params.sessionId, {
        projectPath: workspaceRoot,
        model: currentModel,
        isPremium: true, // Electron stub
        mcpServerRunning: false,
        tabId: params.tabId,
      });

      // Stream events to renderer via IPC
      streamEventsToRenderer(container, params.sessionId, stream, params.tabId);
    }

    // Send message to active session
    await sdkAdapter.sendMessageToSession(params.sessionId, params.message, {
      files: params.contextFiles ?? [],
    });

    return { success: true, sessionId: params.sessionId };
  }
);
```

**CRITICAL**: The streaming helper function `streamEventsToRenderer()` must be extracted as a shared utility within `rpc-handler-setup.ts`. It should mirror the VS Code `streamExecutionNodesToWebview()` pattern, broadcasting `MESSAGE_TYPES.CHAT_CHUNK` events via `TOKENS.WEBVIEW_MANAGER`, and sending `MESSAGE_TYPES.CHAT_COMPLETE` on `message_complete` events.

#### chat:resume

**VS Code behavior** (chat-rpc.handlers.ts:1126-1246):

1. Read session history from JSONL files via `SessionHistoryReaderService`
2. Register interrupted agents from history into `SubagentRegistryService`
3. Return `{ success: true, messages, events, stats, resumableSubagents, cliSessions }`

**Electron adaptation**:

- Replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
- Skip CLI session metadata queries (no Ptah CLI in Electron)
- Skip `recoverMissingCliSessions()` (Electron-specific simplification)
- Keep session history reading and subagent registration

**DI tokens needed**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `SDK_TOKENS.SDK_SESSION_HISTORY_READER`, `TOKENS.SUBAGENT_REGISTRY_SERVICE`

#### chat:running-agents

**VS Code behavior** (chat-rpc.handlers.ts:1293-1320):

1. Query `subagentRegistry.getRunningBySession(sessionId)`
2. Return `{ agents: [{ agentId, agentType }] }`

**Electron adaptation**: Identical to VS Code (no platform-specific code).

**DI tokens needed**: `TOKENS.SUBAGENT_REGISTRY_SERVICE`

---

### Component 3: Configuration Methods — config:autopilot-get, config:autopilot-toggle, config:models-list, config:model-switch

**File**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

**Purpose**: Settings panel requires these methods for model selection and autopilot configuration.

#### config:autopilot-get

**VS Code behavior** (config-rpc.handlers.ts:271-298): Reads `autopilot.enabled` and `autopilot.permissionLevel` from ConfigManager.

**Electron adaptation**: Read from `TOKENS.STORAGE_SERVICE` instead of VS Code ConfigManager.

```typescript
rpcHandler.registerMethod('config:autopilot-get', async () => {
  try {
    const storageService = container.resolve(TOKENS.STORAGE_SERVICE);
    const enabled = storageService.get('autopilot.enabled', false);
    const permissionLevel = storageService.get('autopilot.permissionLevel', 'ask');
    return { enabled, permissionLevel };
  } catch (error) {
    return { enabled: false, permissionLevel: 'ask' };
  }
});
```

#### config:autopilot-toggle

**VS Code behavior** (config-rpc.handlers.ts:174-266): Validates permission level, persists to config, syncs to `SdkPermissionHandler`, syncs to active session.

**Electron adaptation**: Persist via `TOKENS.STORAGE_SERVICE`. Sync to `SdkPermissionHandler` via `SDK_TOKENS.SDK_PERMISSION_HANDLER`. Skip VS Code ConfigurationTarget.

**DI tokens needed**: `TOKENS.STORAGE_SERVICE`, `SDK_TOKENS.SDK_PERMISSION_HANDLER`, `SDK_TOKENS.SDK_AGENT_ADAPTER`

#### config:models-list

**VS Code behavior** (config-rpc.handlers.ts:303-406): Fetches models from `sdkAdapter.getSupportedModels()`, applies provider tier overrides, marks selection state.

**Electron adaptation**: Same SDK call. Skip OpenRouter tier overrides (simplification). Mark saved model as selected.

**DI tokens needed**: `SDK_TOKENS.SDK_AGENT_ADAPTER`, `TOKENS.STORAGE_SERVICE`

#### config:model-switch

**VS Code behavior** (config-rpc.handlers.ts:95-142): Saves model to config, optionally syncs to active SDK session.

**Electron adaptation**: Save to `TOKENS.STORAGE_SERVICE`. Optionally sync to active session.

**DI tokens needed**: `TOKENS.STORAGE_SERVICE`, `SDK_TOKENS.SDK_AGENT_ADAPTER`

---

### Component 4: Command Execute — command:execute

**File**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

**VS Code behavior** (command-rpc.handlers.ts:64-112): Validates command against whitelist, executes via `vscode.commands.executeCommand()`.

**Electron adaptation**: Since Electron has no VS Code command palette, `command:execute` should:

- Accept the command name and args
- For `ptah.*` prefixed commands: log and return `{ success: true }` (no-op, these are VS Code extension commands)
- For other commands: return `{ success: false, error: 'Command not available in Electron' }`

```typescript
rpcHandler.registerMethod('command:execute', async (params: { command: string; args?: unknown[] } | undefined) => {
  if (!params?.command) {
    return { success: false, error: 'command is required' };
  }
  // In Electron, VS Code commands are not available
  // Accept ptah.* commands silently (frontend expects success)
  if (params.command.startsWith('ptah.')) {
    logger.debug('[Electron RPC] command:execute no-op for ptah command', { command: params.command });
    return { success: true };
  }
  return { success: false, error: `Command not available in Electron: ${params.command}` };
});
```

---

### Component 5: Setup Wizard Methods (9 methods)

**File**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

**Purpose**: The setup wizard flow requires all 9 methods to function. Add a new `registerWizardMethods()` function.

#### setup-wizard:launch

**VS Code behavior**: Resolves `SetupWizardService` from DI, calls `launchWizard(workspacePath)`.
**Electron adaptation**: Same, using `IWorkspaceProvider.getWorkspaceRoot()`.
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`

#### wizard:cancel

**VS Code behavior**: Resolves `SetupWizardService`, gets current session, calls `cancelWizard()`. Has concurrent generation guard reset.
**Electron adaptation**: Same logic. Must track `isGenerating` flag locally (module-level variable).
**DI tokens**: `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`

#### wizard:cancel-analysis

**VS Code behavior**: Calls `cancelAnalysis()` on both `MultiPhaseAnalysisService` and `AgenticAnalysisService`.
**Electron adaptation**: Same, with graceful degradation if services not available.
**DI tokens**: `AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE`, `AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE`

#### wizard:deep-analyze

**VS Code behavior**: Requires premium + MCP, calls `MultiPhaseAnalysisService.analyzeWorkspace()`, reads phase files from `AnalysisStorageService`.
**Electron adaptation**: Premium is always true (stub). MCP is not available -- implement graceful degradation: pass `mcpServerRunning: false`. Without MCP, analysis may still work (it's the SDK that uses MCP, not the analysis itself).
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `TOKENS.STORAGE_SERVICE`, `AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE`, `AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE`

#### wizard:list-analyses

**VS Code behavior**: Calls `AnalysisStorageService.list(workspacePath)`.
**Electron adaptation**: Same, using `IWorkspaceProvider.getWorkspaceRoot()`.
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE`

#### wizard:load-analysis

**VS Code behavior**: Calls `AnalysisStorageService.loadMultiPhase(workspacePath, filename)`.
**Electron adaptation**: Same.
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE`

#### wizard:recommend-agents

**VS Code behavior**: For multi-phase results, returns all 13 agents with score=100. For legacy, runs Zod validation and scoring.
**Electron adaptation**: Same logic (platform-agnostic).
**DI tokens**: `AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE`

#### wizard:retry-item

**VS Code behavior**: Resolves orchestrator, runs generation for single agent. Has concurrent guard.
**Electron adaptation**: Same logic, using `IWorkspaceProvider`. No MCP, always premium.
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR`, `TOKENS.WEBVIEW_MANAGER`

#### wizard:submit-selection

**VS Code behavior**: Complex -- validates input, checks concurrent guard, resolves orchestrator + WebviewManager + EnhancedPromptsService, builds options, runs generation in background, broadcasts progress.
**Electron adaptation**: Same structure. Premium always true. No MCP. No CLI target detection. Use `TOKENS.WEBVIEW_MANAGER` for progress broadcasting.
**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR`, `TOKENS.WEBVIEW_MANAGER`, `SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE`, `TOKENS.STORAGE_SERVICE`

**Concurrent generation guard**: Use a module-level `let isGenerating = false` variable shared by `wizard:submit-selection`, `wizard:cancel`, and `wizard:retry-item` -- same pattern as `WizardGenerationRpcHandlers` in VS Code.

---

### Component 6: agent:stop

**File**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

**VS Code behavior** (agent-rpc.handlers.ts:554-582): Calls `AgentProcessManager.stop(agentId)`.

**Electron adaptation**: In Electron, there is no `AgentProcessManager` (that's a VS Code-specific service for managing CLI agent processes). The `agent:stop` method should:

1. Try resolving `SDK_TOKENS.SDK_AGENT_ADAPTER` and call `abortSession(agentId)` -- this handles SDK-based sessions
2. If that fails, return error

```typescript
rpcHandler.registerMethod('agent:stop', async (params: { agentId: string } | undefined) => {
  if (!params?.agentId) {
    return { success: false, error: 'agentId is required' };
  }
  try {
    const sdkAdapter = container.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
    await sdkAdapter.abortSession(params.agentId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
```

---

### Component 7: quality:export

**File**: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)

**VS Code behavior** (quality-rpc.handlers.ts:190-289): Generates report content, shows VS Code save dialog, writes file.

**Electron adaptation**: Generate report content and return it to the renderer. The renderer can use Electron's `dialog.showSaveDialog` via IPC, or we can use Node.js `fs` directly. For simplicity, return the content to the renderer and let it decide how to save.

**DI tokens**: `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `TOKENS.PROJECT_INTELLIGENCE_SERVICE`, `TOKENS.QUALITY_EXPORT_SERVICE`

```typescript
rpcHandler.registerMethod('quality:export', async (params: { format?: string } | undefined) => {
  const format = params?.format;
  if (!format || !['markdown', 'json', 'csv'].includes(format)) {
    throw new Error(`Invalid export format: ${format}. Supported: markdown, json, csv`);
  }

  const workspaceProvider = container.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER);
  const workspaceRoot = workspaceProvider.getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('No workspace folder open.');
  }

  const intelligenceService = container.resolve(TOKENS.PROJECT_INTELLIGENCE_SERVICE);
  const exportService = container.resolve(TOKENS.QUALITY_EXPORT_SERVICE);
  const intelligence = await intelligenceService.getIntelligence(workspaceRoot);

  // Generate report content based on format
  let content, filename, mimeType;
  const dateStamp = new Date().toISOString().split('T')[0];

  switch (format) {
    case 'markdown':
      content = exportService.exportMarkdown(intelligence);
      filename = `quality-report-${dateStamp}.md`;
      mimeType = 'text/markdown';
      break;
    case 'json':
      content = exportService.exportJson(intelligence);
      filename = `quality-report-${dateStamp}.json`;
      mimeType = 'application/json';
      break;
    case 'csv':
      content = exportService.exportCsv(intelligence);
      filename = `quality-report-${dateStamp}.csv`;
      mimeType = 'text/csv';
      break;
  }

  return { content, filename, mimeType };
});
```

---

### Component 8: Streaming Helper Function

**File**: `apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts` (MODIFY)

**Purpose**: Both `chat:start` (existing, needs fix) and `chat:continue` (new) need to stream SDK events to the renderer. Extract a shared helper.

**Evidence**: VS Code uses `streamExecutionNodesToWebview()` at `chat-rpc.handlers.ts:1433-1499`. The Electron version should do the same via the `TOKENS.WEBVIEW_MANAGER` adapter (which wraps IPC bridge).

```typescript
async function streamEventsToRenderer(container: DependencyContainer, sessionId: string, stream: AsyncIterable<unknown>, tabId?: string): Promise<void> {
  try {
    const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER);
    let turnCompleteSent = false;

    for await (const event of stream) {
      // Broadcast each event to renderer via IPC
      await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
        tabId: tabId || sessionId,
        sessionId: event.sessionId || sessionId,
        event,
      });

      // Send chat:complete on message_complete event
      if (event.eventType === 'message_complete' && !turnCompleteSent) {
        turnCompleteSent = true;
        await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
          tabId: tabId || sessionId,
          sessionId: event.sessionId || sessionId,
        });
      }
    }

    // Stream ended (session closed) - send completion if not yet sent
    if (!turnCompleteSent) {
      await webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
        tabId: tabId || sessionId,
        sessionId,
      });
    }
  } catch (error) {
    // Stream errors should not crash the app
    console.error('[Electron RPC] Event streaming error:', error);
  }
}
```

**IMPORTANT**: The existing `chat:start` handler in `rpc-handler-setup.ts` currently does NOT stream events. It calls `sdkAdapter.startSession()` which returns a result, but the VS Code version streams an `AsyncIterable<FlatStreamEventUnion>`. The Electron `chat:start` must be updated to also stream events. The `startSession` type should be updated to return the stream and call `streamEventsToRenderer`.

---

## Files Affected Summary

### MODIFY

1. **`apps/ptah-electron/src/di/container.ts`**

   - Add Phase 1.3: `TOKENS.FILE_SYSTEM_MANAGER` shim registration (delegate to `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`)

2. **`apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts`**

   - Add `chat:continue` handler in `registerChatMethods()`
   - Add `chat:resume` handler in `registerChatMethods()`
   - Add `chat:running-agents` handler in `registerChatMethods()`
   - Add `streamEventsToRenderer()` helper function
   - Update existing `chat:start` to stream events (it currently returns result without streaming)
   - Add imports: `MESSAGE_TYPES` from `@ptah-extension/shared`, `SessionHistoryReaderService` type from agent-sdk

3. **`apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`**
   - Add `registerConfigExtendedMethods()` function: `config:autopilot-get`, `config:autopilot-toggle`, `config:models-list`, `config:model-switch`
   - Add `registerCommandMethods()` function: `command:execute`
   - Add `registerWizardMethods()` function: `setup-wizard:launch`, `wizard:cancel`, `wizard:cancel-analysis`, `wizard:deep-analyze`, `wizard:list-analyses`, `wizard:load-analysis`, `wizard:recommend-agents`, `wizard:retry-item`, `wizard:submit-selection`
   - Add `registerQualityMethods()` function: `quality:export`
   - Add `registerAgentMethods()` function: `agent:stop`
   - Add module-level `isGenerating` flag for wizard concurrent guard
   - Call all new register functions from `registerExtendedRpcMethods()`
   - Add imports: `AGENT_GENERATION_TOKENS` (already imported), `MESSAGE_TYPES` from `@ptah-extension/shared`

### NO CHANGES NEEDED

4. **`apps/ptah-electron/project.json`** -- Build path is CORRECT (verified)

---

## Integration Architecture

### Data Flow for chat:continue (most critical)

```
Renderer (Angular) sends RPC: chat:continue { sessionId, message, tabId }
  |
  v
IpcBridge receives ipcMain 'rpc-call' event
  |
  v
RpcHandler dispatches to registered 'chat:continue' handler
  |
  v
Handler resolves IWorkspaceProvider for workspace path
  |
  v
Check sdkAdapter.isSessionActive(sessionId)
  |-- NOT active: call sdkAdapter.resumeSession() -> get stream -> streamEventsToRenderer()
  |-- ACTIVE: skip resume
  |
  v
sdkAdapter.sendMessageToSession(sessionId, message, { files })
  |
  v
SDK processes message, yields FlatStreamEventUnion events via stream
  |
  v
streamEventsToRenderer() iterates stream, broadcasts CHAT_CHUNK via WebviewManager
  |
  v
ElectronWebviewManagerAdapter.broadcastMessage() calls IpcBridge.sendToRenderer()
  |
  v
Renderer (Angular) receives 'chat-chunk' IPC event with streaming data
```

### Data Flow for wizard:submit-selection

```
Renderer sends RPC: wizard:submit-selection { selectedAgentIds, analysisData, ... }
  |
  v
Handler checks isGenerating guard (reject if true)
  |
  v
Resolve orchestrator, WebviewManager, EnhancedPromptsService
  |
  v
Build OrchestratorGenerationOptions (always premium, no MCP, no CLI targets)
  |
  v
Fire-and-forget: orchestrator.generateAgents(options, progressCallback)
  |-- progressCallback broadcasts 'setup-wizard:generation-progress' via WebviewManager
  |-- on completion broadcasts 'setup-wizard:generation-complete'
  |-- finally: isGenerating = false
  |
  v
Return { success: true } immediately to unblock renderer
```

---

## Quality Requirements

### Functional Requirements

- All 19 missing RPC methods registered and callable from the Angular frontend
- `chat:continue` must auto-resume inactive sessions (same behavior as VS Code)
- `chat:continue` and `chat:start` must stream events to the renderer via IPC
- Wizard generation must have concurrent guard preventing duplicate runs
- Quality export must return content without VS Code save dialog (return to renderer)
- `command:execute` must be a safe no-op for ptah.\* commands

### Non-Functional Requirements

- **Error isolation**: Each handler catches errors independently; one handler failure must not affect others
- **Graceful degradation**: If optional services (MCP, analysis, recommendations) are unavailable, return meaningful defaults
- **Performance**: Non-streaming methods must respond within 500ms; streaming events forwarded within 50ms

### Pattern Compliance

- All handlers use inline `rpcHandler.registerMethod()` pattern (verified: 30+ existing examples)
- All handlers use structural typing for DI resolution (verified: existing pattern in both files)
- All handlers log errors via `logger.error()` or `logger.warn()` (verified: existing pattern)
- Platform-specific values use `IWorkspaceProvider` and `ISecretStorage` (verified: `rpc-handler-setup.ts:182-194`)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Pure Node.js/TypeScript service code (no UI components)
- DI container integration (tsyringe patterns)
- RPC handler registration (established pattern, mechanical work)
- SDK adapter integration (async streaming, session management)
- No Angular or frontend changes needed

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-8 hours

**Breakdown**:

- DI gap fix (FILE_SYSTEM_MANAGER shim): 15 minutes
- Chat core methods (continue, resume, running-agents) + streaming helper: 2-3 hours (most complex due to streaming)
- Config methods (4 methods): 1 hour
- Command execute: 15 minutes
- Wizard methods (9 methods): 2-3 hours (many methods but similar pattern)
- Quality export: 30 minutes
- Agent stop: 15 minutes
- Integration testing and debugging: 1 hour

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All DI tokens exist in codebase**:

   - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (verified: `libs/backend/platform-core/src/tokens.ts`)
   - `SDK_TOKENS.SDK_AGENT_ADAPTER` (verified: `libs/backend/agent-sdk/src/lib/di/tokens.ts`)
   - `SDK_TOKENS.SDK_PERMISSION_HANDLER` (verified: `libs/backend/agent-sdk/src/lib/di/tokens.ts`)
   - `SDK_TOKENS.SDK_SESSION_HISTORY_READER` (verified: `libs/backend/agent-sdk/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts`)
   - `TOKENS.WEBVIEW_MANAGER` (verified: registered in `main.ts:126`)
   - `TOKENS.PROJECT_INTELLIGENCE_SERVICE` (verified: registered by `registerQualityServices` in workspace-intelligence)
   - `TOKENS.QUALITY_EXPORT_SERVICE` (verified: registered by `registerQualityServices`)

2. **SDK adapter method signatures**:

   - Verify `sdkAdapter.isSessionActive(sessionId)` exists
   - Verify `sdkAdapter.resumeSession(sessionId, config)` returns `AsyncIterable<FlatStreamEventUnion>`
   - Verify `sdkAdapter.sendMessageToSession(sessionId, message, options)` exists
   - Verify `sdkAdapter.getSupportedModels()` returns model list
   - Verify `sdkAdapter.setSessionModel(sessionId, model)` exists

3. **MESSAGE_TYPES constants**:

   - Verify `MESSAGE_TYPES.CHAT_CHUNK` exists in `@ptah-extension/shared`
   - Verify `MESSAGE_TYPES.CHAT_COMPLETE` exists in `@ptah-extension/shared`

4. **Existing chat:start handler update**:
   - The current `chat:start` in `rpc-handler-setup.ts` calls `sdkAdapter.startSession()` which returns `{ sessionId: string }`. The VS Code version calls `sdkAdapter.startChatSession()` which returns `AsyncIterable<FlatStreamEventUnion>`. Developer must verify which method the Electron SDK adapter exposes and whether streaming is supported.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (30+ existing inline handler examples)
- [x] All DI tokens verified as existing
- [x] Quality requirements defined
- [x] Integration points documented (IPC bridge, WebviewManager, SDK adapter)
- [x] Files affected list complete (3 files to modify)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 6-8 hours)
- [x] Error handling strategy defined (catch-per-handler, graceful degradation)
- [x] Build path verified (CORRECT, no changes needed)
- [x] DI gap identified and fix specified (FILE_SYSTEM_MANAGER shim)
- [x] Streaming architecture specified (streamEventsToRenderer helper)
