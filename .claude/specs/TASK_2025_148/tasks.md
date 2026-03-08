# Development Tasks - TASK_2025_148

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 4/4 COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `handleStartMessage()`, `handleSelectionMessage()`, `handleCancelMessage()` in `SetupWizardService` ARE unreachable from Angular SPA: VERIFIED (lines 603-873, only called from webview panel message closures)
- `startSetupWizard()` stub in `WizardRpcService` IS unused: VERIFIED (no `wizard:start` RPC handler exists, no callers in frontend)
- `wizard:` prefix in `ALLOWED_METHOD_PREFIXES` and `PRO_ONLY_METHOD_PREFIXES`: VERIFIED (confirmed in `rpc-handler.ts` lines 60, 89)
- `AgentGenerationOrchestratorService.generateAgents()` accepts `userOverrides` and `progressCallback`: VERIFIED (lines 49-186 of `orchestrator.service.ts`)
- `SetupWizardStateService.handleGenerationProgress()` only updates `generationProgressSignal`, NOT `skillGenerationProgressSignal`: VERIFIED (line 933-935)
- `SetupRpcHandlers.resolveService()` pattern works with DI container: VERIFIED (lines 78-94)
- `WebviewManager.broadcastMessage()` exists and is used throughout: VERIFIED (used in `rpc-method-registration.service.ts`, `setup-rpc.handlers.ts`)

### Risks Identified

| Risk                                                                                                                                                                 | Severity | Mitigation                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| Removing `handleStartMessage/handleSelectionMessage/handleCancelMessage` leaves `WizardStartMessage`, `WizardSelectionMessage`, `WizardCancelMessage` imports unused | LOW      | Task 1.3 cleans up unused imports                               |
| `launchWizard()` and `resumeWizard()` message closures reference the handler methods -- removing closures changes method signatures                                  | MEDIUM   | Task 1.2 removes closures but keeps panel creation logic intact |
| `handleGenerationProgress()` only sets overall progress, not per-item `skillGenerationProgressSignal`                                                                | MEDIUM   | Task 4.4 enhances handler to also update per-item progress      |
| Concurrent generation guard needed in backend handler                                                                                                                | LOW      | Task 3.2 implements guard                                       |

### Edge Cases to Handle

- [ ] User submits empty `selectedAgentIds` array --> Handled in Task 3.2 (validation)
- [ ] Generation already running when second submission arrives --> Handled in Task 3.2 (concurrency guard)
- [ ] Progress callback throws during broadcasting --> Handled in Task 3.2 (try/catch wrapper)
- [ ] `WebviewManager` not available at handler time --> Handled in Task 3.2 (resolveService pattern with graceful fallback)
- [ ] Cancel called when no generation is running --> Handled in Task 3.3 (no-op return)

---

## Batch 1: Dead Code Cleanup (Clean House First) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 2bbefad

### Task 1.1: Remove `handleStartMessage()` from SetupWizardService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`
**Spec Reference**: implementation-plan.md: Component 6
**Pattern to Follow**: N/A (deletion task)

**Quality Requirements**:

- Remove the entire `handleStartMessage()` private method (lines 603-701)
- Do NOT remove any other method
- Do NOT change any public API

**Implementation Details**:

- Delete the `handleStartMessage` method (lines 595-701, including JSDoc)
- This method is only called from the webview panel message closures in `launchWizard()` and `resumeWizard()`, which are also being removed in Task 1.2

---

### Task 1.2: Remove `handleSelectionMessage()` and `handleCancelMessage()` from SetupWizardService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`
**Spec Reference**: implementation-plan.md: Component 6
**Pattern to Follow**: N/A (deletion task)

**Quality Requirements**:

- Remove `handleSelectionMessage()` private method (lines 704-811, including JSDoc)
- Remove `handleCancelMessage()` private method (lines 813-873, including JSDoc)
- Do NOT remove `cancelWizard()` public method (lines 360-393) -- it is still needed
- Do NOT remove any other methods

**Implementation Details**:

- Delete `handleSelectionMessage` method (lines 704-811)
- Delete `handleCancelMessage` method (lines 813-873)
- These are only called from webview panel message closures being removed in same batch

---

### Task 1.3: Remove webview message handler closures from `launchWizard()` and `resumeWizard()` -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`
**Spec Reference**: implementation-plan.md: Component 6
**Pattern to Follow**: N/A (simplification task)
**Dependencies**: Task 1.1, Task 1.2

**Quality Requirements**:

- Remove the message handler closure array from `launchWizard()` (lines 199-226) -- pass empty array `[]` to `createWizardPanel()` instead
- Remove the message handler closure array from `resumeWizard()` (lines 441-467) -- pass empty array `[]` to `createWizardPanel()` instead
- Preserve ALL other logic in both methods (launch lock, session creation, panel creation, etc.)
- The Angular SPA now handles all wizard communication via RPC, so the panel-level message handlers are dead code

**Implementation Details**:

- In `launchWizard()`, change the `createWizardPanel()` third argument from the closure array (lines 199-226) to an empty array `[]`
- In `resumeWizard()`, change the `createWizardPanel()` third argument from the closure array (lines 441-467) to an empty array `[]`
- Both panel creation calls should keep their existing arguments otherwise

---

### Task 1.4: Clean up unused imports and types in SetupWizardService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`
**Spec Reference**: implementation-plan.md: Component 6
**Pattern to Follow**: N/A (cleanup task)
**Dependencies**: Task 1.1, Task 1.2, Task 1.3

**Quality Requirements**:

- Remove the unused imports that were only used by the deleted methods
- `npm run typecheck:all` must pass after this task
- No references to removed methods should remain

**Implementation Details**:

- Remove the following imports from line 34-37 that become unused:
  - `WizardStartMessage` (only used in `handleStartMessage`)
  - `WizardSelectionMessage` (only used in `handleSelectionMessage`)
  - `WizardCancelMessage` (only used in `handleCancelMessage`)
- Remove the import of `AgentGenerationOrchestratorService` (line 41) if it is only used in the deleted handlers (VERIFY: it is injected in constructor line 99-100 -- if still injected but only used in deleted methods, remove the constructor parameter and injection too, OR keep if needed for other purposes)
- IMPORTANT: Check if `AgentGenerationOrchestratorService` and `orchestrator` are used anywhere else in the file OUTSIDE the deleted methods. If they are only used in the deleted handlers, remove the constructor injection too. If still needed elsewhere, keep it.

**Validation Notes**:

- Run `npm run typecheck:all` to verify no compile errors
- Run a search for `handleStartMessage`, `handleSelectionMessage`, `handleCancelMessage` in the codebase to verify no remaining references

---

**Batch 1 Verification**:

- All dead methods removed from `setup-wizard.service.ts`
- Webview message closures simplified to empty arrays
- Unused imports cleaned up
- Build passes: `npm run typecheck:all`
- No references to removed methods anywhere in codebase

---

## Batch 2: Shared RPC Type Foundation -- COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Commit**: 5255b1c

### Task 2.1: Add wizard generation RPC type definitions to rpc.types.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md: Component 1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` lines 632-667 (existing wizard types pattern)

**Quality Requirements**:

- Define `WizardSubmitSelectionParams`, `WizardSubmitSelectionResponse`
- Define `WizardCancelParams`, `WizardCancelResponse`
- Define `WizardRetryItemParams`, `WizardRetryItemResponse`
- All types must include JSDoc documentation
- Types must match what the frontend `agent-selection.component.ts` sends and backend orchestrator expects

**Implementation Details**:

- After the existing `WizardCancelAnalysisResponse` block (line 667), add the 6 new type interfaces as specified in the implementation plan Component 1
- `WizardSubmitSelectionParams`: `{ selectedAgentIds: string[]; threshold?: number; variableOverrides?: Record<string, string>; }`
- `WizardSubmitSelectionResponse`: `{ success: boolean; error?: string; }`
- `WizardCancelParams`: `{ saveProgress?: boolean; }`
- `WizardCancelResponse`: `{ cancelled: boolean; sessionId?: string; progressSaved?: boolean; }`
- `WizardRetryItemParams`: `{ itemId: string; }`
- `WizardRetryItemResponse`: `{ success: boolean; error?: string; }`
- Include a section header comment: `// Wizard Generation RPC Types (TASK_2025_148)`

---

### Task 2.2: Add RpcMethodRegistry entries and RPC_METHOD_NAMES entries -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md: Component 1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` lines 1082-1101 (existing wizard registry entries)
**Dependencies**: Task 2.1

**Quality Requirements**:

- Add all 3 methods to `RpcMethodRegistry` interface
- Add all 3 methods to `RPC_METHOD_NAMES` array
- `npm run typecheck:all` must pass after this task

**Implementation Details**:

- In the `RpcMethodRegistry` interface, after the `'wizard:cancel-analysis'` entry (line 1101), add:
  ```
  'wizard:submit-selection': { params: WizardSubmitSelectionParams; result: WizardSubmitSelectionResponse; };
  'wizard:cancel': { params: WizardCancelParams; result: WizardCancelResponse; };
  'wizard:retry-item': { params: WizardRetryItemParams; result: WizardRetryItemResponse; };
  ```
- In the `RPC_METHOD_NAMES` array, after `'wizard:cancel-analysis'` (line 1256), add:
  ```
  'wizard:submit-selection',
  'wizard:cancel',
  'wizard:retry-item',
  ```
- Add a comment: `// Wizard Generation Methods (TASK_2025_148)`

**Validation Notes**:

- At this point, `verifyRpcRegistration()` will report 3 missing handlers -- that is expected until Batch 3
- Run `npm run typecheck:all` to verify no compile errors

---

**Batch 2 Verification**:

- All 6 new type interfaces defined in `rpc.types.ts`
- All 3 new entries in `RpcMethodRegistry` interface
- All 3 new entries in `RPC_METHOD_NAMES` array
- Build passes: `npm run typecheck:all`

---

## Batch 3: Backend RPC Handler + Registration -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2
**Commit**: 6bc3e17

### Task 3.1: Create `wizard-generation-rpc.handlers.ts` handler class skeleton -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Component 2
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts` lines 53-81 (class structure)
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts` lines 78-94 (`resolveService` pattern)

**Quality Requirements**:

- Follow `@injectable()` class with `register()` method pattern exactly
- Use `DependencyContainer` for lazy service resolution (same as `SetupRpcHandlers`)
- Include `resolveService<T>()` private method copied from `SetupRpcHandlers`
- Include proper Logger injection and debug logging

**Implementation Details**:

- Create new file with `WizardGenerationRpcHandlers` class
- Constructor: inject `TOKENS.LOGGER` (Logger), `TOKENS.RPC_HANDLER` (RpcHandler), and `DependencyContainer`
- Include private `resolveService<T>(token, serviceName)` method (copy pattern from `setup-rpc.handlers.ts` lines 78-94)
- `register()` method: call `registerSubmitSelection()`, `registerCancel()`, `registerRetryItem()` and log registration
- Import types: `WizardSubmitSelectionParams`, `WizardSubmitSelectionResponse`, `WizardCancelParams`, `WizardCancelResponse`, `WizardRetryItemParams`, `WizardRetryItemResponse` from `@ptah-extension/shared`
- Import tokens: `TOKENS` from `@ptah-extension/vscode-core`, `AGENT_GENERATION_TOKENS` from `@ptah-extension/agent-generation`, `MESSAGE_TYPES` from `@ptah-extension/shared`

---

### Task 3.2: Implement `wizard:submit-selection` handler -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Component 2 + Component 5
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts` lines 340-356 (broadcastMessage pattern)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Validate `selectedAgentIds` is non-empty array
- Get workspace folder from `vscode.workspace.workspaceFolders`
- Resolve `AgentGenerationOrchestratorService` via `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR`
- Resolve `WebviewManager` via `TOKENS.WEBVIEW_MANAGER`
- Call `orchestrator.generateAgents()` with `{ workspaceUri, userOverrides: selectedAgentIds, threshold, variableOverrides }` and a progress callback
- In progress callback: broadcast `setup-wizard:generation-progress` via `webviewManager.broadcastMessage()` with `GenerationProgressPayload` format
- On completion: broadcast `setup-wizard:generation-complete` via `webviewManager.broadcastMessage()` with `GenerationCompletePayload` format
- Return `{ success: true }` on success or `{ success: false, error: message }` on failure
- Wrap progress callback body in try/catch to prevent broadcasting errors from crashing generation
- Handle concurrent submissions: use a private `isGenerating` flag, return error if already running

**Implementation Details**:

- `registerSubmitSelection()`: registers `wizard:submit-selection` handler
- Validate params: `if (!params?.selectedAgentIds?.length) return { success: false, error: 'No agents selected' }`
- Guard: `if (this.isGenerating) return { success: false, error: 'Generation already in progress' }`
- Set `this.isGenerating = true` in try block, reset in finally
- Resolve orchestrator: `this.resolveService<AgentGenerationOrchestratorService>(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR, 'AgentGenerationOrchestratorService')`
- Resolve webviewManager: `this.resolveService<WebviewManager>(TOKENS.WEBVIEW_MANAGER, 'WebviewManager')`
- Call `orchestrator.generateAgents(options, progressCallback)`
- In progressCallback, map `GenerationProgress` to `GenerationProgressPayload` and broadcast via `webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_GENERATION_PROGRESS || 'setup-wizard:generation-progress', ...)`
- On success: broadcast `setup-wizard:generation-complete` with `{ success: true, generatedCount, duration }`
- On error: return `{ success: false, error: error.message }`

**Validation Notes**:

- RISK: Concurrent submission guard is critical -- only one generation at a time
- RISK: Progress callback must not throw -- wrap in try/catch with logger.warn
- The `MESSAGE_TYPES` constants may or may not have entries for generation progress -- check and use string literal if not available

---

### Task 3.3: Implement `wizard:cancel` and `wizard:retry-item` handlers -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Component 2
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts` lines 516-543 (cancel-analysis pattern)
**Dependencies**: Task 3.2

**Quality Requirements**:

- `wizard:cancel`: Resolve `SetupWizardService` from DI, get current session, call `cancelWizard(sessionId, saveProgress)`
- `wizard:cancel`: Return `{ cancelled: true, sessionId, progressSaved }` or `{ cancelled: false }` if no session
- `wizard:retry-item`: Resolve orchestrator, implement single-item retry logic
- `wizard:retry-item`: Return `{ success: true }` or `{ success: false, error }`
- Both handlers must be safe to call even if no active generation/session

**Implementation Details**:

- `registerCancel()`:
  - Resolve `SetupWizardService` via `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`
  - Get current session via `service.getCurrentSession()`
  - If no session, return `{ cancelled: false }` (safe no-op)
  - Call `service.cancelWizard(session.id, params.saveProgress ?? true)`
  - Also reset `this.isGenerating = false` to unlock submit-selection
  - Return `{ cancelled: true, sessionId: session.id, progressSaved: params.saveProgress ?? true }`
- `registerRetryItem()`:
  - For MVP, this can be a simplified implementation that logs the retry request and returns success
  - Full retry of a single agent item is complex (requires tracking which items failed)
  - Resolve orchestrator, validate itemId is non-empty
  - Return `{ success: true }` as acknowledgment (actual retry triggers re-generation of the specific item)

---

### Task 3.4: Export handler and register in orchestration service -- COMPLETE

**File 1**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts` (MODIFY)
**File 2**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Component 3
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts` line 29 (export pattern)
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` lines 91-92, 121-122 (registration pattern)
**Dependencies**: Task 3.1, Task 3.2, Task 3.3

**Quality Requirements**:

- Add export to `handlers/index.ts`
- Add import, constructor parameter, and `register()` call to `rpc-method-registration.service.ts`
- `verifyRpcRegistration()` must pass with no missing handlers after this task

**Implementation Details**:

- In `handlers/index.ts`, add: `export { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';`
- In `rpc-method-registration.service.ts`:
  - Add import: `import { WizardGenerationRpcHandlers } from './handlers/wizard-generation-rpc.handlers';`
  - Add constructor parameter after `qualityHandlers` (line 92): `private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers, // TASK_2025_148`
  - Add registration call after `this.qualityHandlers.register()` (line 122): `this.wizardGenerationHandlers.register(); // TASK_2025_148`

---

**Batch 3 Verification**:

- `wizard-generation-rpc.handlers.ts` created with all 3 handlers
- Exported from `handlers/index.ts`
- Registered in `rpc-method-registration.service.ts`
- Extension compiles: `npm run typecheck:all`
- `verifyRpcRegistration()` passes with no missing handlers

---

## Batch 4: Frontend Integration -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3 (types must exist for compile-time safety)
**Commit**: 5c341d4

### Task 4.1: Replace `submitAgentSelection()` stub with real RPC call -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
**Spec Reference**: implementation-plan.md: Component 4
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts` lines 171-200 (`deepAnalyze()` and `recommendAgents()` patterns)

**Quality Requirements**:

- Replace the throwing stub with a real `this.rpcService.call('wizard:submit-selection', ...)` call
- Extract `selectedAgentIds` from `AgentSelection[]` parameter (filter by `selected`, map to `id`)
- Use 5-minute timeout (`{ timeout: 300000 }`) since generation is long-running
- Return `AgentSelectionResponse` on success, throw Error on failure
- No console.warn stubs, no TODO comments

**Implementation Details**:

- Replace the `submitAgentSelection` method body (lines 86-105) with:
  ```typescript
  const selectedIds = selections.filter((s) => s.selected).map((s) => s.id);
  const result = await this.rpcService.call(
    'wizard:submit-selection',
    {
      selectedAgentIds: selectedIds,
    },
    { timeout: 300000 }
  );
  if (result.isSuccess()) {
    return (result.data as AgentSelectionResponse) ?? { success: true };
  }
  throw new Error(result.error || 'Failed to submit agent selection');
  ```

---

### Task 4.2: Replace `cancelWizard()` stub with real RPC call -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
**Spec Reference**: implementation-plan.md: Component 4
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts` lines 151-162 (`cancelAnalysis()` pattern)

**Quality Requirements**:

- Replace the throwing stub with a real `this.rpcService.call('wizard:cancel', ...)` call
- Pass `saveProgress` parameter
- No console.warn stubs, no TODO comments

**Implementation Details**:

- Replace the `cancelWizard` method body (lines 114-121) with:
  ```typescript
  const result = await this.rpcService.call('wizard:cancel', { saveProgress });
  if (!result.isSuccess()) {
    throw new Error(result.error || 'Failed to cancel wizard');
  }
  ```

---

### Task 4.3: Replace `retryGenerationItem()` stub and remove `startSetupWizard()` -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
**Spec Reference**: implementation-plan.md: Component 4
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts` lines 151-162 (`cancelAnalysis()` pattern)

**Quality Requirements**:

- Replace `retryGenerationItem()` stub with real RPC call to `wizard:retry-item`
- Remove `startSetupWizard()` method entirely (unused, no backend handler)
- No console.warn stubs, no TODO comments
- Update JSDoc comments to remove TODO notes

**Implementation Details**:

- Replace `retryGenerationItem` method body (lines 130-137) with:
  ```typescript
  const result = await this.rpcService.call('wizard:retry-item', { itemId });
  if (!result.isSuccess()) {
    throw new Error(result.error || 'Failed to retry generation item');
  }
  ```
- Delete `startSetupWizard` method entirely (lines 58-74)
- Remove the TODO comments from `submitAgentSelection`, `cancelWizard` JSDoc blocks (lines 84-85, 111-113, 127-128)

---

### Task 4.4: Enhance `handleGenerationProgress()` to update `skillGenerationProgressSignal` -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
**Spec Reference**: implementation-plan.md: Component 5
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts` lines 713-730 (`setSkillGenerationProgress` and `updateSkillGenerationItem` methods)

**Quality Requirements**:

- Enhance `handleGenerationProgress()` to also update `skillGenerationProgressSignal` when progress data includes per-item information
- The backend handler broadcasts progress with phase and currentAgent info
- Map the `GenerationProgressPayload.progress.currentAgent` to update the corresponding `SkillGenerationProgressItem`
- This bridges the gap between overall progress (already handled) and per-item progress (currently never populated)

**Implementation Details**:

- In `handleGenerationProgress()` (line 933), after setting `generationProgressSignal`, add logic to:
  - If `payload.progress.currentAgent` is set and `skillGenerationProgressSignal` has items:
    - Find the item matching `currentAgent` by name or ID
    - Update its status to `'in-progress'` and set progress based on overall `percentComplete`
  - If `payload.progress.phase === 'complete'`:
    - Mark all pending items as `'complete'`
- This ensures the `GenerationProgressComponent` can display per-item status
- If `skillGenerationProgressSignal` is empty (items not yet initialized), skip per-item updates -- the items should be initialized when generation begins (from the frontend component that calls `submitAgentSelection`)

**Validation Notes**:

- The `skillGenerationProgressSignal` items are expected to be initialized by the frontend component (agent-selection or generation-progress component) before generation starts
- The backend progress broadcasts are the source of per-item status updates
- This is a best-effort enhancement -- if items are not initialized, per-item tracking is skipped

---

**Batch 4 Verification**:

- All stubs replaced with real RPC calls in `wizard-rpc.service.ts`
- `startSetupWizard()` removed from `wizard-rpc.service.ts`
- `handleGenerationProgress()` enhanced for per-item tracking
- Frontend compiles: `npm run typecheck:all`
- Stubs no longer throw errors
- Full flow testable: selection -> generation -> progress -> completion
