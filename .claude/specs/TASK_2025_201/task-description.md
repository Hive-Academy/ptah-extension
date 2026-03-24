# Requirements Document - TASK_2025_201

## Introduction

The Electron app (`apps/ptah-electron/`) was scaffolded in TASK_2025_200 and builds/launches successfully. However, the Angular frontend calls approximately 19 RPC methods that are not registered in the Electron RPC layer, and 2 DI tokens are missing from the container. This renders chat continuation, configuration, setup wizard, and quality export non-functional. This bugfix task closes all gaps so the Electron app has full feature parity with the VS Code extension's RPC surface.

All patterns are already established: `rpc-handler-setup.ts` and `rpc-method-registration.service.ts` demonstrate the inline registration approach. The VS Code handler classes in `apps/ptah-extension-vscode/src/services/rpc/handlers/` document the expected behavior for each method. The work is mechanical: register missing methods using the same delegation-to-domain-services pattern, fix the 2 DI gaps, verify the build path, and smoke test.

---

## Requirements

### Requirement 1: Chat Continuation and Session Control RPC Methods

**User Story:** As a user of the Electron app, I want to continue, resume, and stop chat sessions, so that I have the same conversational experience as in the VS Code extension.

#### Acceptance Criteria

1. WHEN a user sends a follow-up message in an existing session THEN the `chat:continue` RPC method SHALL delegate to `SdkAgentAdapter.continueSession()` with sessionId, message, contextFiles, and stream execution events back to the renderer via IPC.

2. WHEN a user clicks "Resume" on a previously stopped session THEN `chat:resume` RPC SHALL delegate to `SdkAgentAdapter.resumeSession()` with the sessionId and begin streaming events again.

3. WHEN a user queries running agents THEN `chat:running-agents` RPC SHALL return the list of currently active agent sessions from the `AgentSessionWatcherService` or equivalent tracking.

4. WHEN a user clicks "Stop" on a running agent THEN `agent:stop` RPC SHALL delegate to `SdkAgentAdapter.abortSession()` or `AgentProcessManager.stop()` and return a success/error response.

5. WHEN `chat:abort` is already registered THEN it SHALL be verified to work correctly end-to-end (it exists in `rpc-handler-setup.ts` but needs confirmation that the abort propagates to the SDK and streams an abort event to the renderer).

#### Technical Notes

- The VS Code `ChatRpcHandlers` class uses `vscode.workspace.workspaceFolders` for workspace resolution. The Electron handlers must use `IWorkspaceProvider.getWorkspaceRoot()` instead (same pattern as existing `chat:start`).
- `chat:continue` is the most critical method -- it is called every time the user sends a follow-up message. The VS Code implementation builds an `AISessionConfig` with model, MCP config, permissions, and plugin paths before calling `sdkAdapter.continueSession()`. The Electron version should mirror this, using `IWorkspaceProvider` and `ISecretStorage` for platform-specific values.
- `chat:resume` re-opens a stopped session. The VS Code implementation calls `sdkAdapter.resumeSession()` with a full `AISessionConfig`. The Electron version should build an equivalent config using platform tokens.
- `chat:running-agents` returns `{ agents: AgentSessionInfo[] }` from the watcher service.
- The event streaming callback in `chat:continue` and `chat:resume` must use the Electron IPC bridge (same pattern as `chat:start` already uses) to push `FlatStreamEventUnion` events to the renderer.

---

### Requirement 2: Configuration RPC Methods

**User Story:** As a user of the Electron app, I want to view and change AI model selection and autopilot settings, so that I can configure the AI behavior to my preferences.

#### Acceptance Criteria

1. WHEN the settings panel requests autopilot state THEN `config:autopilot-get` RPC SHALL return `{ enabled: boolean, permissionLevel: PermissionLevel }` from the storage service.

2. WHEN the user toggles autopilot THEN `config:autopilot-toggle` RPC SHALL accept `{ enabled, permissionLevel, sessionId? }`, persist to storage, sync the permission level to `SdkPermissionHandler` if available, and return `{ enabled, permissionLevel }`.

3. WHEN the settings panel requests available models THEN `config:models-list` RPC SHALL return the list of models from `SdkAgentAdapter.getSupportedModels()` with selection state and metadata.

4. WHEN the user selects a different model THEN `config:model-switch` RPC SHALL accept `{ model, sessionId? }`, persist to storage, optionally sync to the active SDK session, and return `{ model }`.

5. WHEN the frontend calls `command:execute` THEN the RPC handler SHALL validate the command against a whitelist (ptah.\* prefix only in Electron since there are no VS Code commands) and execute or reject accordingly.

#### Technical Notes

- The VS Code `ConfigRpcHandlers` uses `vscode.ConfigurationTarget.Workspace` for persistence. The Electron version should use the `TOKENS.STORAGE_SERVICE` adapter (already registered in `container.ts`).
- `config:models-list` needs `SdkAgentAdapter.getSupportedModels()` which is platform-agnostic via `SDK_TOKENS.SDK_AGENT_ADAPTER`.
- `command:execute` in Electron should accept the command name and log it, but since there is no `vscode.commands` API, it should return `{ success: true }` for recognized commands or `{ success: false, error }` for unknown ones. Alternatively, it can be a no-op that always succeeds since Electron does not have a command palette.

---

### Requirement 3: Setup Wizard RPC Methods

**User Story:** As a user of the Electron app, I want to run the setup wizard to analyze my workspace and generate AI agent configurations, so that I can customize which agents are available for my project.

#### Acceptance Criteria

1. WHEN the user launches the setup wizard THEN `setup-wizard:launch` RPC SHALL initialize a wizard session via `SetupWizardService.launchWizard()` using `IWorkspaceProvider.getWorkspaceRoot()`.

2. WHEN the user cancels the wizard THEN `wizard:cancel` RPC SHALL cancel the active wizard session via `SetupWizardService.cancelWizard()` and reset any generation flags.

3. WHEN the user cancels an ongoing analysis THEN `wizard:cancel-analysis` RPC SHALL invoke cancellation on `MultiPhaseAnalysisService` and/or `AgenticAnalysisService`.

4. WHEN the user triggers deep analysis THEN `wizard:deep-analyze` RPC SHALL delegate to `MultiPhaseAnalysisService.analyzeWorkspace()` with workspace path, model, and premium/MCP config. In Electron, premium is always true (stub license) and MCP may not be available.

5. WHEN the user requests saved analyses THEN `wizard:list-analyses` RPC SHALL return metadata from `AnalysisStorageService.list()`.

6. WHEN the user loads a saved analysis THEN `wizard:load-analysis` RPC SHALL return the full analysis data from `AnalysisStorageService.loadMultiPhase()`.

7. WHEN the user requests agent recommendations THEN `wizard:recommend-agents` RPC SHALL delegate to `AgentRecommendationService.calculateRecommendations()` (or return all 13 agents recommended for multi-phase analyses).

8. WHEN the user retries a failed generation item THEN `wizard:retry-item` RPC SHALL re-run generation for the single specified agent via the orchestrator.

9. WHEN the user submits agent selection THEN `wizard:submit-selection` RPC SHALL trigger the generation pipeline via `AgentGenerationOrchestratorService.generateAgents()` and stream progress events to the renderer.

#### Technical Notes

- All wizard methods in VS Code use `vscode.workspace.workspaceFolders[0].uri.fsPath`. The Electron versions must use `IWorkspaceProvider.getWorkspaceRoot()`.
- `wizard:deep-analyze` requires license + MCP in VS Code. In Electron, the license stub always returns Pro. MCP availability should be checked but gracefully degraded.
- The VS Code `SetupRpcHandlers` and `WizardGenerationRpcHandlers` are the reference implementations. The Electron versions should follow the same error handling patterns (concurrent generation guard, background execution with progress broadcasting).
- Progress broadcasting in Electron should use the IPC bridge to push `setup-wizard:generation-progress` and `setup-wizard:generation-complete` messages to the renderer.

---

### Requirement 4: Quality Export RPC Method

**User Story:** As a user of the Electron app, I want to export quality assessment reports, so that I can share project health metrics with my team.

#### Acceptance Criteria

1. WHEN the user clicks export in the quality dashboard THEN `quality:export` RPC SHALL accept `{ format: 'markdown' | 'json' | 'csv' }`, generate the report content via `QualityExportService`, and return `{ content, filename, mimeType }`.

2. WHEN the export format is invalid THEN the handler SHALL return an error with supported formats listed.

3. WHEN no workspace is open THEN the handler SHALL return an error message.

#### Technical Notes

- The VS Code `QualityRpcHandlers.registerExport()` uses `vscode.window.showSaveDialog` to save the file. In Electron, the handler should return the content to the renderer and let it handle saving (via Electron's dialog API or by providing content for download), OR use Node.js `fs` to write to a user-chosen path via Electron's `dialog.showSaveDialog`.
- The quality services (`IProjectIntelligenceService`, `IQualityHistoryService`, `IQualityExportService`) are registered via `registerWorkspaceIntelligenceServices()` which is already called in the Electron container.

---

### Requirement 5: Missing DI Registrations

**User Story:** As a developer, I want all DI tokens that are resolved at runtime to be properly registered, so that the app does not crash with "unresolvable dependency" errors.

#### Acceptance Criteria

1. WHEN `autocomplete:agents` RPC is invoked THEN `TOKENS.AGENT_DISCOVERY_SERVICE` SHALL be resolvable from the container, providing the `AgentDiscoveryService` from `workspace-intelligence`.

2. WHEN `autocomplete:commands` RPC is invoked THEN `TOKENS.COMMAND_DISCOVERY_SERVICE` SHALL be resolvable from the container, providing the `CommandDiscoveryService` from `workspace-intelligence`.

3. WHEN the Electron app starts up THEN no DI resolution errors SHALL appear in the console logs for any token referenced in RPC handlers.

#### Technical Notes

- These two tokens are currently resolved in `rpc-method-registration.service.ts` lines 214-246 but never registered in `container.ts`.
- `registerWorkspaceIntelligenceServices()` is already called in Phase 2.1 of `container.ts`. Check if it registers these tokens. If not, register them explicitly after the workspace-intelligence phase.
- The `AgentDiscoveryService` and `CommandDiscoveryService` classes live in `@ptah-extension/workspace-intelligence`. Verify their exports and registration patterns.

---

### Requirement 6: Angular Build Path Verification

**User Story:** As a developer, I want the Electron app's `copy-renderer` build target to correctly copy the Angular webview output, so that the UI loads when the Electron app launches.

#### Acceptance Criteria

1. WHEN `nx build ptah-electron` runs THEN the `copy-renderer` target SHALL copy files from the actual Angular CLI output directory to the Electron app's resources.

2. WHEN the Angular build outputs to `dist/apps/ptah-extension-webview/browser/` THEN the copy source path in `project.json` SHALL match this path exactly.

3. WHEN the Electron app launches THEN the renderer process SHALL load `index.html` from the copied webview files without 404 errors.

#### Technical Notes

- Angular 20 with `@angular/build` outputs to `dist/apps/<project>/browser/` by default.
- The current `copy-renderer` target in `apps/ptah-electron/project.json` copies from `dist/apps/ptah-extension-webview/browser/`. Verify this matches the actual output.

---

### Requirement 7: End-to-End Smoke Test

**User Story:** As a developer, I want to verify that all fixed RPC methods work in the running Electron app, so that I can confirm feature parity with the VS Code extension.

#### Acceptance Criteria

1. WHEN the Electron app launches THEN the Angular UI SHALL load without console errors related to missing RPC methods.

2. WHEN a user starts a new chat THEN the message SHALL be sent to Claude and the response SHALL stream back to the UI.

3. WHEN a user sends a follow-up message THEN `chat:continue` SHALL process the message and stream the response.

4. WHEN a user stops a chat THEN the session SHALL terminate and the UI SHALL reflect the stopped state.

5. WHEN a user opens settings THEN model list, autopilot state, and model switching SHALL all function correctly.

6. WHEN a user opens the setup wizard THEN analysis, recommendations, and agent generation SHALL progress through all steps.

7. WHEN a user opens a folder THEN the file tree SHALL populate and files SHALL open in the Monaco editor panel.

---

## Non-Functional Requirements

### Performance Requirements

- **RPC Response Time**: All non-streaming RPC methods shall respond within 500ms under normal conditions.
- **Streaming Latency**: Chat streaming events shall be forwarded to the renderer within 50ms of receipt from the SDK.

### Reliability Requirements

- **Graceful Degradation**: If an optional service (MCP, premium features) is unavailable, the handler SHALL return a meaningful error or default value rather than crashing.
- **Error Isolation**: A failure in one RPC handler SHALL NOT affect other handlers or crash the main process.
- **Concurrent Guard**: Wizard generation SHALL maintain the concurrent generation guard pattern to prevent duplicate runs.

### Security Requirements

- **Command Execution**: `command:execute` SHALL only execute whitelisted commands (ptah.\* prefix). No arbitrary command execution.
- **API Key Protection**: Secret storage access SHALL use `ISecretStorage` and never expose raw API keys in RPC responses.

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder             | Impact Level | Involvement      | Success Criteria                                         |
| ----------------------- | ------------ | ---------------- | -------------------------------------------------------- |
| End Users (Electron)    | High         | Testing/Feedback | All chat flows, settings, and wizard work end-to-end     |
| Developer (Implementer) | High         | Implementation   | All 19 methods registered, 2 DI gaps fixed, build passes |

### Secondary Stakeholders

| Stakeholder   | Impact Level | Involvement | Success Criteria                                                       |
| ------------- | ------------ | ----------- | ---------------------------------------------------------------------- |
| VS Code Users | None         | No impact   | No changes to VS Code extension behavior                               |
| Maintainers   | Low          | Code review | Patterns consistent with existing `rpc-method-registration.service.ts` |

---

## Risk Assessment

| Risk                                                   | Probability | Impact | Score | Mitigation Strategy                                                   |
| ------------------------------------------------------ | ----------- | ------ | ----- | --------------------------------------------------------------------- |
| SDK methods behave differently without VS Code context | Medium      | Medium | 4     | Use platform interfaces consistently; test each method individually   |
| Missing transitive DI dependencies                     | Low         | High   | 3     | Verify each service's dependency chain resolves in Electron container |
| Build path mismatch for Angular output                 | Low         | Medium | 2     | Verify actual output path before coding; add build verification step  |
| IPC bridge drops streaming events                      | Low         | High   | 3     | Reuse proven pattern from existing chat:start streaming               |
| Wizard generation crashes without MCP                  | Medium      | Low    | 2     | Graceful degradation: skip MCP-dependent features, log warning        |

---

## Scope

### IN Scope

- Register all 19 missing RPC methods in `rpc-method-registration.service.ts` (or `rpc-handler-setup.ts` for core methods)
- Fix 2 missing DI registrations (`AGENT_DISCOVERY_SERVICE`, `COMMAND_DISCOVERY_SERVICE`)
- Verify and fix the Angular build copy path if needed
- Manual smoke test of all user flows listed in context.md

### OUT of Scope

- Extracting a shared RPC handler library (larger refactor for a future task)
- Auto-updater for the Electron app
- Code signing and distribution packaging
- Electron-specific features not present in VS Code (native menus, tray icon, etc.)
- Changes to the VS Code extension or shared libraries (unless a missing export is needed)

---

## Dependencies

- **TASK_2025_199** (Platform Abstraction Layer) -- COMPLETE
- **TASK_2025_200** (Electron Application Scaffold) -- COMPLETE
- All domain services (`agent-sdk`, `workspace-intelligence`, `agent-generation`, `llm-abstraction`, `template-generation`) are already registered in the Electron DI container

---

## Implementation Reference

### Key Files to Modify

1. `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` -- Add missing methods here (preferred location for extended methods)
2. `apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts` -- Add `chat:continue`, `chat:resume`, `chat:running-agents` here alongside existing `chat:start` and `chat:abort`
3. `apps/ptah-electron/src/di/container.ts` -- Add `TOKENS.AGENT_DISCOVERY_SERVICE` and `TOKENS.COMMAND_DISCOVERY_SERVICE` registrations
4. `apps/ptah-electron/project.json` -- Verify/fix `copy-renderer` target path

### Key Files to Reference (Read-Only)

- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` -- Chat continue/resume/running-agents behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/config-rpc.handlers.ts` -- Config autopilot/model behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts` -- Wizard launch/analyze/recommend behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts` -- Wizard submit/cancel/retry behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/command-rpc.handlers.ts` -- Command execute behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/quality-rpc.handlers.ts` -- Quality export behavior
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` -- Agent stop behavior
- `libs/frontend/core/src/lib/services/claude-rpc.service.ts` -- Frontend RPC calls (what the UI actually calls)
- `libs/shared/src/lib/types/rpc.types.ts` -- RPC method type registry

### Method-to-Category Mapping

| Category    | Methods                                                                                                                                                                                                            | Location                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Chat (core) | `chat:continue`, `chat:resume`, `chat:running-agents`                                                                                                                                                              | `rpc-handler-setup.ts`               |
| Agent       | `agent:stop`                                                                                                                                                                                                       | `rpc-method-registration.service.ts` |
| Config      | `config:autopilot-get`, `config:autopilot-toggle`, `config:models-list`, `config:model-switch`                                                                                                                     | `rpc-method-registration.service.ts` |
| Command     | `command:execute`                                                                                                                                                                                                  | `rpc-method-registration.service.ts` |
| Wizard      | `setup-wizard:launch`, `wizard:cancel`, `wizard:cancel-analysis`, `wizard:deep-analyze`, `wizard:list-analyses`, `wizard:load-analysis`, `wizard:recommend-agents`, `wizard:retry-item`, `wizard:submit-selection` | `rpc-method-registration.service.ts` |
| Quality     | `quality:export`                                                                                                                                                                                                   | `rpc-method-registration.service.ts` |
| DI          | `AGENT_DISCOVERY_SERVICE`, `COMMAND_DISCOVERY_SERVICE`                                                                                                                                                             | `container.ts`                       |
