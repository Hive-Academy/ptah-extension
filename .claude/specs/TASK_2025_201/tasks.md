# Development Tasks - TASK_2025_201

**Total Tasks**: 12 | **Batches**: 3 | **Status**: 2/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `TOKENS.FILE_SYSTEM_MANAGER` dependency check at `workspace-intelligence/di/register.ts:85`: Verified -- `container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER)` throws if missing
- `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` is registered in Phase 0 (platform-electron): Verified -- can be used as shim
- Inline RPC registration pattern is established: Verified -- 30+ methods across both files
- `MESSAGE_TYPES` exists in `@ptah-extension/shared`: Verified at `libs/shared/src/lib/types/message.types.ts`
- All DI tokens referenced in plan exist in their respective libraries: Verified by architect

### Risks Identified

| Risk                                                                                                                       | Severity | Mitigation                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sdkAdapter.startSession()` may not return a stream in Electron (current signature returns `{ sessionId }`)                | HIGH     | Task 2.1 must verify SDK adapter method signatures before implementing streaming; may need to use event-based approach |
| `registerWorkspaceIntelligenceServices()` may have additional dependency checks beyond FILE_SYSTEM_MANAGER                 | MED      | Task 1.1 developer should wrap the call in try/catch and verify all services registered successfully                   |
| wizard:submit-selection and wizard:retry-item have complex orchestration that may need services not registered in Electron | MED      | Task 3.4 should use try/catch with graceful degradation for each resolved service                                      |

### Edge Cases to Handle

- [ ] chat:continue with inactive session must auto-resume (handled in Task 2.2)
- [ ] Wizard concurrent generation guard must prevent duplicate runs (handled in Task 3.4)
- [ ] command:execute must silently accept ptah.\* commands (handled in Task 3.2)
- [ ] quality:export must return content to renderer, not open save dialog (handled in Task 3.3)

---

## Batch 1: DI Gap Fix -- FILE_SYSTEM_MANAGER Shim [COMPLETE]

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None
**Commit**: 92593984

### Task 1.1: Register FILE_SYSTEM_MANAGER shim in Electron DI container [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
**Spec Reference**: implementation-plan.md Component 1 (lines 92-113)
**Pattern to Follow**: container.ts Phase 1.2 registration pattern (lines 150-179)

**Quality Requirements**:

- Register `TOKENS.FILE_SYSTEM_MANAGER` AFTER Phase 1.2 and BEFORE Phase 2.1 (`registerWorkspaceIntelligenceServices`)
- Delegate to `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` which is already registered in Phase 0
- Add as Phase 1.3 with appropriate comment block
- Log the registration via `logger.info()`

**Validation Notes**:

- The `registerWorkspaceIntelligenceServices()` at line 199 checks `container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER)` and throws if missing
- This shim unblocks `TOKENS.AGENT_DISCOVERY_SERVICE` and `TOKENS.COMMAND_DISCOVERY_SERVICE` registration
- The shim is a simple `useValue` delegation -- no new class needed

**Implementation Details**:

- Resolve `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` from container
- Register it as `TOKENS.FILE_SYSTEM_MANAGER` via `container.register(TOKENS.FILE_SYSTEM_MANAGER, { useValue: fileSystemProvider })`
- Place between Phase 1.2 logger.info call (line 191) and Phase 2 header comment (line 194)

---

**Batch 1 Verification**:

- container.ts has Phase 1.3 shim registration
- Build passes: `npx nx build ptah-electron`
- code-logic-reviewer approved
- `registerWorkspaceIntelligenceServices()` no longer throws at startup

---

## Batch 2: Chat Core Methods + Streaming Helper [COMPLETE]

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (FILE_SYSTEM_MANAGER must be registered for workspace-intelligence services)

### Task 2.1: Add streamEventsToRenderer() helper function [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts`
**Spec Reference**: implementation-plan.md Component 8 (lines 456-503)
**Pattern to Follow**: VS Code `chat-rpc.handlers.ts` streamExecutionNodesToWebview pattern

**Quality Requirements**:

- Extract as a module-level async function in rpc-handler-setup.ts
- Iterate AsyncIterable stream, broadcast CHAT_CHUNK events via TOKENS.WEBVIEW_MANAGER
- Send CHAT_COMPLETE on message_complete event or stream end
- Wrap in try/catch -- streaming errors must NOT crash the app
- Import MESSAGE_TYPES from @ptah-extension/shared

**Validation Notes**:

- RISK: Must verify that the SDK adapter actually returns an AsyncIterable stream. Check the `startSession` and `resumeSession` return types in agent-sdk
- If SDK does not return a stream, implement an event-listener-based alternative

**Implementation Details**:

- Imports: `MESSAGE_TYPES` from `@ptah-extension/shared`, `TOKENS` from `@ptah-extension/vscode-core`
- Function signature: `async function streamEventsToRenderer(container, sessionId, stream, tabId?)`
- Broadcast each event as `MESSAGE_TYPES.CHAT_CHUNK` with `{ tabId, sessionId, event }`
- Detect `event.eventType === 'message_complete'` for completion signal

### Task 2.2: Add chat:continue RPC handler [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts`
**Spec Reference**: implementation-plan.md Component 2, chat:continue section (lines 125-197)
**Pattern to Follow**: Existing chat:start handler at rpc-handler-setup.ts lines 171-203
**Dependencies**: Task 2.1 (uses streamEventsToRenderer)

**Quality Requirements**:

- Accept params: `{ sessionId, message, tabId?, contextFiles?, model? }`
- Validate sessionId and message are required
- Auto-resume inactive sessions via sdkAdapter.resumeSession() + streamEventsToRenderer()
- Send follow-up message via sdkAdapter.sendMessageToSession()
- Use IWorkspaceProvider for workspace path (NOT vscode.workspace)
- Skip MCP, license checks, CLI dispatch, slash commands (Electron simplification)

**Validation Notes**:

- This is the most critical missing method -- called every time user sends a follow-up message
- Must handle the auto-resume case where session was stopped and user sends a new message

**Implementation Details**:

- Place inside registerChatMethods() function after chat:abort handler
- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, SDK_TOKENS.SDK_AGENT_ADAPTER, TOKENS.STORAGE_SERVICE, TOKENS.WEBVIEW_MANAGER
- Model default: `storageService.get('model.selected', 'claude-sonnet-4-20250514')`
- Premium always true in Electron stub

### Task 2.3: Add chat:resume RPC handler [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts`
**Spec Reference**: implementation-plan.md Component 2, chat:resume section (lines 199-226)
**Pattern to Follow**: Existing chat:start handler pattern

**Quality Requirements**:

- Accept params: `{ sessionId }`
- Read session history via SDK_TOKENS.SDK_SESSION_HISTORY_READER
- Register interrupted agents into SubagentRegistryService
- Return `{ success: true, messages, events, stats, resumableSubagents }`
- Skip CLI session metadata and recoverMissingCliSessions (Electron simplification)

**Validation Notes**:

- This handler loads historical data for display, does NOT start streaming
- Different from chat:continue which actively sends a message

**Implementation Details**:

- Place inside registerChatMethods() after chat:continue
- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, SDK_TOKENS.SDK_SESSION_HISTORY_READER, TOKENS.SUBAGENT_REGISTRY_SERVICE
- Use try/catch with graceful empty result on failure

### Task 2.4: Add chat:running-agents RPC handler [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts`
**Spec Reference**: implementation-plan.md Component 2, chat:running-agents section (lines 218-226)
**Pattern to Follow**: Existing chat:abort handler pattern

**Quality Requirements**:

- Accept params: `{ sessionId }`
- Query SubagentRegistryService.getRunningBySession(sessionId)
- Return `{ agents: [{ agentId, agentType }] }`
- Platform-agnostic (no adaptation needed)

**Implementation Details**:

- Place inside registerChatMethods() after chat:resume
- DI token: TOKENS.SUBAGENT_REGISTRY_SERVICE
- Simple one-liner delegation with try/catch

### Task 2.5: Update existing chat:start to stream events [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts`
**Spec Reference**: implementation-plan.md Component 8, last paragraph (lines 502-503)
**Dependencies**: Task 2.1 (uses streamEventsToRenderer)

**Quality Requirements**:

- Current chat:start returns `{ sessionId }` but does NOT stream events to renderer
- Update to also call streamEventsToRenderer() with the session stream
- Must verify SDK adapter return type -- may need to adjust based on actual API

**Validation Notes**:

- RISK: The current SDK adapter's startSession() returns `Promise<{ sessionId }>`. The VS Code version uses a different method that returns a stream. Developer must check actual API and adapt accordingly
- If startSession() does not return a stream, the streaming may need to be set up separately

**Implementation Details**:

- Modify existing chat:start handler at lines 171-203
- After sdkAdapter.startSession(), get the stream and call streamEventsToRenderer()
- Add required imports for MESSAGE_TYPES

---

**Batch 2 Verification**:

- All 4 new handlers registered in registerChatMethods()
- chat:start updated to stream events
- streamEventsToRenderer() helper function exists
- Build passes: `npx nx build ptah-electron`
- code-logic-reviewer approved

---

## Batch 3: Extended RPC Methods (Config, Command, Wizard, Quality, Agent) [IN PROGRESS]

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 1 (DI shim must be in place for workspace-intelligence services)

### Task 3.1: Add config extended methods (4 methods) [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Component 3 (lines 229-277)
**Pattern to Follow**: Existing registerLlmMethods() in same file (lines 366-492)

**Quality Requirements**:

- Create `registerConfigExtendedMethods(container, rpcHandler, logger)` function
- Register: `config:autopilot-get`, `config:autopilot-toggle`, `config:models-list`, `config:model-switch`
- config:autopilot-get: read from TOKENS.STORAGE_SERVICE
- config:autopilot-toggle: persist to storage, sync to SDK_TOKENS.SDK_PERMISSION_HANDLER and active session
- config:models-list: call sdkAdapter.getSupportedModels(), mark saved model as selected
- config:model-switch: save to storage, optionally sync to active session
- Call from registerExtendedRpcMethods()

**Implementation Details**:

- DI tokens: TOKENS.STORAGE_SERVICE, SDK_TOKENS.SDK_PERMISSION_HANDLER, SDK_TOKENS.SDK_AGENT_ADAPTER
- Each method needs its own try/catch with error logging
- config:autopilot-toggle must validate permissionLevel is one of: 'ask', 'auto-approve', 'auto-deny'

### Task 3.2: Add command:execute and agent:stop methods [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Components 4 and 6 (lines 280-397)
**Pattern to Follow**: Existing registerChatExtendedMethods() in same file

**Quality Requirements**:

- Create `registerCommandMethods(container, rpcHandler, logger)` function
- command:execute: accept ptah.\* commands silently (return success), reject others
- Create `registerAgentMethods(container, rpcHandler, logger)` function
- agent:stop: delegate to sdkAdapter.abortSession(agentId)
- Call both from registerExtendedRpcMethods()

**Implementation Details**:

- command:execute: check `params.command.startsWith('ptah.')` for no-op
- agent:stop: DI token SDK_TOKENS.SDK_AGENT_ADAPTER
- Both are simple methods with minimal logic

### Task 3.3: Add quality:export method [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Component 7 (lines 401-452)
**Pattern to Follow**: Existing registerSetupStatusMethods() in same file

**Quality Requirements**:

- Create `registerQualityMethods(container, rpcHandler, logger)` function
- Validate format is one of: 'markdown', 'json', 'csv'
- Resolve TOKENS.PROJECT_INTELLIGENCE_SERVICE and TOKENS.QUALITY_EXPORT_SERVICE
- Generate report content and return `{ content, filename, mimeType }` to renderer
- No VS Code save dialog -- return content for renderer to handle
- Call from registerExtendedRpcMethods()

**Implementation Details**:

- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, TOKENS.PROJECT_INTELLIGENCE_SERVICE, TOKENS.QUALITY_EXPORT_SERVICE
- Use try/catch with graceful degradation if quality services unavailable
- Date stamp format: `new Date().toISOString().split('T')[0]`

### Task 3.4: Add wizard methods -- setup-wizard:launch, wizard:cancel, wizard:cancel-analysis (3 methods) [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Component 5, first 3 methods (lines 309-331)
**Pattern to Follow**: Existing registerSetupStatusMethods() in same file

**Quality Requirements**:

- Create `registerWizardMethods(container, rpcHandler, logger)` function (will hold all 9 wizard methods)
- Add module-level `let isGenerating = false` flag for concurrent guard
- setup-wizard:launch: resolve AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, call launchWizard(workspacePath)
- wizard:cancel: get current session, call cancelWizard(), reset isGenerating flag
- wizard:cancel-analysis: call cancelAnalysis() on both MULTI_PHASE_ANALYSIS_SERVICE and AGENTIC_ANALYSIS_SERVICE
- Call registerWizardMethods from registerExtendedRpcMethods()

**Validation Notes**:

- RISK: AGENTIC_ANALYSIS_SERVICE may not be registered in Electron -- use try/catch for graceful degradation
- The isGenerating flag is shared across wizard:submit-selection, wizard:cancel, and wizard:retry-item

**Implementation Details**:

- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE, AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE
- Each method gets its own try/catch

### Task 3.5: Add wizard methods -- deep-analyze, list-analyses, load-analysis, recommend-agents (4 methods) [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Component 5, middle methods (lines 333-355)
**Pattern to Follow**: Same registerWizardMethods() function from Task 3.4

**Quality Requirements**:

- wizard:deep-analyze: call MultiPhaseAnalysisService.analyzeWorkspace(), pass mcpServerRunning:false, premium:true
- wizard:list-analyses: call AnalysisStorageService.list(workspacePath)
- wizard:load-analysis: call AnalysisStorageService.loadMultiPhase(workspacePath, filename)
- wizard:recommend-agents: call AgentRecommendationService, return all 13 agents with score=100 for multi-phase
- All use IWorkspaceProvider.getWorkspaceRoot() for workspace path

**Implementation Details**:

- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, TOKENS.STORAGE_SERVICE, AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE, AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE
- wizard:deep-analyze is the most complex -- must handle streaming progress updates
- All methods use try/catch with meaningful defaults on failure

### Task 3.6: Add wizard methods -- submit-selection, retry-item (2 methods) [IN PROGRESS]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md Component 5, last 2 methods (lines 357-369)
**Pattern to Follow**: VS Code wizard-generation-rpc.handlers.ts pattern

**Quality Requirements**:

- wizard:submit-selection: validate input, check isGenerating guard, resolve orchestrator + WebviewManager + EnhancedPromptsService, build options, fire-and-forget generation, broadcast progress
- wizard:retry-item: similar to submit-selection but for single agent retry
- Both must use the module-level isGenerating concurrent guard
- Both must set isGenerating=false in finally block
- Both must broadcast progress via TOKENS.WEBVIEW_MANAGER
- Import MESSAGE_TYPES from @ptah-extension/shared for progress event types

**Validation Notes**:

- These are the most complex wizard methods -- they run generation in background and broadcast progress
- Premium always true, no MCP, no CLI target detection in Electron

**Implementation Details**:

- DI tokens: PLATFORM_TOKENS.WORKSPACE_PROVIDER, AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR, TOKENS.WEBVIEW_MANAGER, SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE, TOKENS.STORAGE_SERVICE
- wizard:submit-selection returns `{ success: true }` immediately, generation runs async
- Progress callback broadcasts 'setup-wizard:generation-progress' events
- Completion broadcasts 'setup-wizard:generation-complete' event

---

**Batch 3 Verification**:

- All 16 new methods registered (4 config + 2 command/agent + 1 quality + 9 wizard)
- registerExtendedRpcMethods() calls all new register functions
- Module-level isGenerating flag shared by wizard methods
- Build passes: `npx nx build ptah-electron`
- code-logic-reviewer approved
