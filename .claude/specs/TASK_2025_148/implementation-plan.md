# Implementation Plan - TASK_2025_148

## Wire Setup Wizard Generation Pipeline via RPC

### Problem Statement

The setup wizard's agent generation pipeline is broken. The frontend has **stub methods** that throw errors ("Backend handler not implemented"), while the backend has a **complete generation pipeline** in `SetupWizardService.handleSelectionMessage()` that connects to `AgentGenerationOrchestratorService.generateAgents()`. These two are not connected via RPC because the backend handler uses the old `postMessage` webview panel approach (messages sent to a specific panel), while the frontend uses the new Angular SPA RPC approach (via `ClaudeRpcService`).

### Root Cause

The wizard was originally designed as a separate webview panel with its own message handlers (lines 200-225 of `setup-wizard.service.ts`). After migration to the Angular SPA webview, the frontend now communicates via `ClaudeRpcService.call()` -> `RpcHandler.registerMethod()`, but **no RPC handlers were created** for `wizard:submit-selection`, `wizard:cancel`, or `wizard:retry-item`. The old postMessage handlers in `SetupWizardService` are **unreachable** from the Angular SPA.

---

## Codebase Investigation Summary

### Libraries Discovered

- **`@ptah-extension/agent-generation`**: Agent generation orchestrator, setup wizard service, DI tokens (`D:\projects\ptah-extension\libs\backend\agent-generation\src`)
  - Key exports: `AGENT_GENERATION_TOKENS`, `AgentGenerationOrchestratorService` (not barrel-exported but registered in DI)
  - Documentation: `D:\projects\ptah-extension\libs\backend\agent-generation\CLAUDE.md`
- **`@ptah-extension/vscode-core`**: RPC infrastructure (`D:\projects\ptah-extension\libs\backend\vscode-core\src`)
  - Key exports: `RpcHandler`, `Logger`, `TOKENS`, `verifyRpcRegistration`, `WebviewManager`
  - RPC handler verification: `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-verification.ts`
- **`@ptah-extension/shared`**: RPC type registry (`D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`)
  - Key exports: `RpcMethodRegistry`, `RPC_METHOD_NAMES`, `RpcMethodName`

### Patterns Identified

#### 1. RPC Handler Registration Pattern

**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts:53-81`

```typescript
@injectable()
export class EnhancedPromptsRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    // ... domain services
  ) {}

  register(): void {
    this.registerMethod1();
    this.registerMethod2();
    this.logger.debug('Handler registered', { methods: [...] });
  }

  private registerMethod1(): void {
    this.rpcHandler.registerMethod<ParamsType, ResultType>('prefix:method', async (params) => {
      // handler implementation
      return result;
    });
  }
}
```

#### 2. RPC Method Security Validation

**Evidence**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts:44-106`

- `ALLOWED_METHOD_PREFIXES`: Must include prefix for new methods. `'wizard:'` already present (line 60).
- `PRO_ONLY_METHOD_PREFIXES`: `'wizard:'` already present (line 89). New methods auto-gated.
- No changes needed to allowed/PRO prefix lists.

#### 3. RPC Method Registry

**Evidence**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts:1003-1293`

- Every RPC method must be added to `RpcMethodRegistry` interface AND `RPC_METHOD_NAMES` array.
- Types (`params`/`result`) must be defined in the same file.
- `verifyRpcRegistration()` checks at startup that all registry entries have handlers.

#### 4. DI Registration

**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts:163-167`

- `AgentGenerationOrchestratorService` is registered under `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR`
- Handler class can resolve it via `DependencyContainer` (same pattern as `SetupRpcHandlers` using `this.resolveService()`)

#### 5. Service Resolution Pattern (Lazy via Container)

**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts:78-94`

- `SetupRpcHandlers` uses `this.container.resolve(token)` for lazy service resolution
- This avoids constructor-time DI failures for services with deep dependency chains

#### 6. Frontend RPC Call Pattern

**Evidence**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\claude-rpc.service.ts:168-172`

```typescript
async call<T extends RpcMethodName>(
  method: T,
  params: RpcMethodParams<T>,
  options?: RpcCallOptions
): Promise<RpcResult<RpcMethodResult<T>>>
```

- Compile-time type-safe: method name must exist in `RpcMethodRegistry`
- Returns `RpcResult<T>` with `.isSuccess()`, `.data`, `.error`

#### 7. Progress Push Pattern (Backend -> Frontend)

**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts:763-771`

- Backend uses `webviewLifecycle.emitProgress(panel, 'setup-wizard:generation-progress', {...})` on panel
- Frontend `SetupWizardStateService` listens for `setup-wizard:generation-progress` via `window.addEventListener('message', ...)`
- **But** this only works when a separate webview panel exists. In the Angular SPA, progress must be pushed via `WebviewManager.broadcastMessage()`

### Integration Points

- `AgentGenerationOrchestratorService.generateAgents(options, progressCallback)` - the pipeline entry point
- `WebviewManager.broadcastMessage(type, payload)` - push progress to Angular SPA webview
- `SetupWizardStateService.handleGenerationProgress(payload)` - already handles `setup-wizard:generation-progress`
- `SetupWizardStateService.skillGenerationProgressSignal` - fine-grained per-item progress

---

## Architecture Design

### Design Philosophy

**Direct RPC wiring**: Create new backend RPC handlers in the established pattern that call into the existing `AgentGenerationOrchestratorService`. Push generation progress via `WebviewManager.broadcastMessage()` which the existing `SetupWizardStateService` message listener already handles.

**No parallel implementations**: The old `SetupWizardService` postMessage handlers (`handleStartMessage`, `handleSelectionMessage`, `handleCancelMessage`) become dead code once RPC handlers exist. They should be marked for removal but the facade service itself is still needed for `launchWizard()` and `performDeepAnalysis()`.

### Component Specifications

---

#### Component 1: RPC Type Definitions for New Methods

**Purpose**: Define the params/result types and registry entries for `wizard:submit-selection`, `wizard:cancel`, and `wizard:retry-item` in the shared type system.

**Pattern**: Same as existing setup wizard RPC types (lines 613-667 of `rpc.types.ts`)
**Evidence**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts:1082-1100`

**Responsibilities**:

- Define `WizardSubmitSelectionParams` with `selectedAgentIds: string[]`, optional `threshold`, optional `variableOverrides`
- Define `WizardSubmitSelectionResponse` with `success: boolean`, `error?: string`
- Define `WizardCancelParams` with `saveProgress?: boolean`
- Define `WizardCancelResponse` with `cancelled: boolean`
- Define `WizardRetryItemParams` with `itemId: string`
- Define `WizardRetryItemResponse` with `success: boolean`, `error?: string`
- Add all three to `RpcMethodRegistry` interface
- Add all three to `RPC_METHOD_NAMES` array
- Remove `wizard:start` from frontend stub (unused, no backend handler needed)

**Quality Requirements**:

- Types must match what the frontend `agent-selection.component.ts` sends and expects
- `selectedAgentIds` must be `string[]` matching the `AgentRecommendation.agentId` format

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY)

**Exact Changes**:

After the existing `WizardCancelAnalysisResponse` block (line 667), add:

```typescript
// ============================================================
// Wizard Generation RPC Types (TASK_2025_148)
// ============================================================

/** Parameters for wizard:submit-selection RPC method */
export interface WizardSubmitSelectionParams {
  /** Array of agent IDs to generate (from AgentRecommendation.agentId) */
  selectedAgentIds: string[];
  /** Minimum relevance threshold for agent selection (0-100). Default: 50 */
  threshold?: number;
  /** Variable overrides for template rendering */
  variableOverrides?: Record<string, string>;
}

/** Response from wizard:submit-selection RPC method */
export interface WizardSubmitSelectionResponse {
  /** Whether the selection was accepted and generation started */
  success: boolean;
  /** Error message if selection failed */
  error?: string;
}

/** Parameters for wizard:cancel RPC method */
export interface WizardCancelParams {
  /** Whether to save progress for later resume */
  saveProgress?: boolean;
}

/** Response from wizard:cancel RPC method */
export interface WizardCancelResponse {
  /** Whether cancellation was performed */
  cancelled: boolean;
  /** Session ID of cancelled session */
  sessionId?: string;
  /** Whether progress was saved */
  progressSaved?: boolean;
}

/** Parameters for wizard:retry-item RPC method */
export interface WizardRetryItemParams {
  /** ID of the generation item to retry */
  itemId: string;
}

/** Response from wizard:retry-item RPC method */
export interface WizardRetryItemResponse {
  /** Whether retry was initiated */
  success: boolean;
  /** Error message if retry failed */
  error?: string;
}
```

In the `RpcMethodRegistry` interface, after the `'wizard:cancel-analysis'` entry (line 1100), add:

```typescript
  'wizard:submit-selection': {
    params: WizardSubmitSelectionParams;
    result: WizardSubmitSelectionResponse;
  };
  'wizard:cancel': {
    params: WizardCancelParams;
    result: WizardCancelResponse;
  };
  'wizard:retry-item': {
    params: WizardRetryItemParams;
    result: WizardRetryItemResponse;
  };
```

In the `RPC_METHOD_NAMES` array, after `'wizard:cancel-analysis'` (line 1256), add:

```typescript
  'wizard:submit-selection',
  'wizard:cancel',
  'wizard:retry-item',
```

---

#### Component 2: Backend RPC Handler - WizardGenerationRpcHandlers

**Purpose**: New RPC handler class that wires `wizard:submit-selection`, `wizard:cancel`, and `wizard:retry-item` to the existing backend generation pipeline.

**Pattern**: Follows `EnhancedPromptsRpcHandlers` pattern exactly (injectable class with `register()` method)
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts:53-81`

**Responsibilities**:

- `wizard:submit-selection`: Resolves `AgentGenerationOrchestratorService` from DI, calls `generateAgents()` with user-selected agent IDs as `userOverrides`, pushes generation progress via `WebviewManager.broadcastMessage()`
- `wizard:cancel`: Resolves `SetupWizardService` from DI, calls `cancelWizard()` (or just cleans up the active generation)
- `wizard:retry-item`: Resolves orchestrator, re-runs generation for a single failed item

**Implementation Pattern**:

```typescript
// D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS, type WebviewManager } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type { WizardSubmitSelectionParams, WizardSubmitSelectionResponse, WizardCancelParams, WizardCancelResponse, WizardRetryItemParams, WizardRetryItemResponse } from '@ptah-extension/shared';
import * as vscode from 'vscode';

@injectable()
export class WizardGenerationRpcHandlers {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler, private readonly container: DependencyContainer) {}

  private resolveService<T>(token: symbol | string, serviceName: string): T {
    // Same pattern as SetupRpcHandlers.resolveService
    // ...
  }

  register(): void {
    this.registerSubmitSelection();
    this.registerCancel();
    this.registerRetryItem();

    this.logger.debug('Wizard generation RPC handlers registered', {
      methods: ['wizard:submit-selection', 'wizard:cancel', 'wizard:retry-item'],
    });
  }

  private registerSubmitSelection(): void {
    this.rpcHandler.registerMethod<WizardSubmitSelectionParams, WizardSubmitSelectionResponse>('wizard:submit-selection', async (params) => {
      // 1. Validate params
      // 2. Get workspace folder
      // 3. Resolve WebviewManager for progress broadcasting
      // 4. Resolve AgentGenerationOrchestratorService
      // 5. Call generateAgents() with selectedAgentIds as userOverrides
      // 6. Push progress via WebviewManager.broadcastMessage('setup-wizard:generation-progress', ...)
      // 7. On completion, push 'setup-wizard:generation-complete'
      // 8. Return { success: true }
    });
  }

  // ... registerCancel, registerRetryItem
}
```

**Key Design Decision -- Progress Broadcasting**:

The orchestrator has a `progressCallback` parameter. The RPC handler will:

1. Resolve `WebviewManager` from DI (token `TOKENS.WEBVIEW_MANAGER`)
2. In the callback, broadcast `setup-wizard:generation-progress` and per-item `SkillGenerationProgressItem` updates
3. The existing `SetupWizardStateService.handleGenerationProgress()` already handles these messages

This means **no changes to the frontend state service message listener**. The only gap is mapping `GenerationProgress` (from orchestrator) to `GenerationProgressPayload` (shared type) and per-item `SkillGenerationProgressItem` updates.

**Quality Requirements**:

- Must handle concurrent selection submissions (return error if generation already running)
- Must validate `selectedAgentIds` is non-empty
- Must catch and surface orchestrator errors
- Progress callback must not throw (wrap in try/catch)

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` (CREATE)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts` (MODIFY - add export)

---

#### Component 3: Register Handler in RpcMethodRegistrationService

**Purpose**: Wire the new `WizardGenerationRpcHandlers` into the orchestration service that registers all handlers.

**Pattern**: Same as all other handlers (constructor inject + `register()` call)
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts:37-122`

**Responsibilities**:

- Import `WizardGenerationRpcHandlers`
- Add as constructor parameter
- Call `this.wizardGenerationHandlers.register()` in `registerAll()`

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY)

**Exact Changes**:

Add import:

```typescript
import { WizardGenerationRpcHandlers } from './handlers/wizard-generation-rpc.handlers';
```

Add constructor parameter after `qualityHandlers`:

```typescript
private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers, // TASK_2025_148
```

Add registration call after `this.qualityHandlers.register()`:

```typescript
this.wizardGenerationHandlers.register(); // TASK_2025_148
```

---

#### Component 4: Replace Frontend Stubs in WizardRpcService

**Purpose**: Replace the throwing stub methods with real RPC calls using `ClaudeRpcService.call()`.

**Pattern**: Same as working `deepAnalyze()` and `recommendAgents()` methods (lines 171-200)
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts:171-200`

**Responsibilities**:

- `submitAgentSelection()`: Call `wizard:submit-selection` RPC, return `AgentSelectionResponse`
- `cancelWizard()`: Call `wizard:cancel` RPC
- `retryGenerationItem()`: Call `wizard:retry-item` RPC
- Remove `startSetupWizard()` stub entirely (unused, no corresponding backend method)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts` (MODIFY)

**Before** (stubs):

```typescript
async submitAgentSelection(_selections: AgentSelection[]): Promise<AgentSelectionResponse> {
  console.warn('[WizardRpcService] submitAgentSelection: Backend handler not implemented');
  throw new Error('Agent selection submission not yet implemented');
}

async cancelWizard(_saveProgress = true): Promise<void> {
  console.warn('[WizardRpcService] cancelWizard: Backend handler not implemented');
  throw new Error('Wizard cancellation not yet implemented');
}

async retryGenerationItem(_itemId: string): Promise<void> {
  console.warn('[WizardRpcService] retryGenerationItem: Backend handler not implemented');
  throw new Error('Retry generation item not yet implemented');
}
```

**After** (real RPC calls):

```typescript
async submitAgentSelection(selections: AgentSelection[]): Promise<AgentSelectionResponse> {
  const selectedIds = selections.filter((s) => s.selected).map((s) => s.id);
  const result = await this.rpcService.call('wizard:submit-selection', {
    selectedAgentIds: selectedIds,
  }, { timeout: 300000 }); // 5 min timeout for long generation

  if (result.isSuccess()) {
    return result.data as AgentSelectionResponse;
  }
  throw new Error(result.error || 'Failed to submit agent selection');
}

async cancelWizard(saveProgress = true): Promise<void> {
  const result = await this.rpcService.call('wizard:cancel', { saveProgress });
  if (!result.isSuccess()) {
    throw new Error(result.error || 'Failed to cancel wizard');
  }
}

async retryGenerationItem(itemId: string): Promise<void> {
  const result = await this.rpcService.call('wizard:retry-item', { itemId });
  if (!result.isSuccess()) {
    throw new Error(result.error || 'Failed to retry generation item');
  }
}
```

**Remove entirely**:

```typescript
// Remove startSetupWizard() method -- it's unused and has no backend handler
async startSetupWizard(_workspaceUri: string): Promise<void> { ... }
```

---

#### Component 5: Generation Progress Broadcasting

**Purpose**: Map the orchestrator's `GenerationProgress` callback to `setup-wizard:generation-progress` and per-item `SkillGenerationProgressItem` updates that the frontend already handles.

**Pattern**: `WebviewManager.broadcastMessage()` (same as `setup-rpc.handlers.ts` lines 340-356)
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts:340-356`

**Responsibilities**:

- In `wizard:submit-selection` handler, before calling `generateAgents()`:
  - Build initial `SkillGenerationProgressItem[]` list from `selectedAgentIds` + fixed commands + skill files
  - Broadcast initial items via `setup-wizard:generation-progress` so the UI shows "Pending" items
- In the orchestrator's `progressCallback`:
  - Map `GenerationProgress.phase/percentComplete/currentOperation` to `GenerationProgressPayload`
  - Broadcast via `webviewManager.broadcastMessage('setup-wizard:generation-progress', payload)`
- On completion:
  - Broadcast `setup-wizard:generation-complete` with `GenerationCompletePayload`

**Key Insight**: The frontend `SetupWizardStateService` already has handlers for both:

- `setup-wizard:generation-progress` -> `handleGenerationProgress()` (updates `generationProgressSignal`)
- `setup-wizard:generation-complete` -> `handleGenerationComplete()` (updates `completionDataSignal`, transitions to `completion` step)

However, the per-item progress (`skillGenerationProgressSignal`) is NOT currently populated by these handlers. The `handleGenerationProgress` only sets the overall progress. **The per-item tracking needs to be wired via a new message type OR by enhancing the existing progress payload.**

**Design Decision**: Rather than creating a new message type, we will enhance the RPC handler to:

1. Set initial `skillGenerationProgressSignal` items via the `WizardRpcService.submitAgentSelection()` return path
2. Push per-item updates via `setup-wizard:generation-progress` messages with an extended payload
3. The state service will need a small update to also handle per-item updates from the progress message

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` (part of Component 2)
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts` (MODIFY - enhance `handleGenerationProgress` to update `skillGenerationProgressSignal`)

---

#### Component 6: Cleanup Dead Code in SetupWizardService

**Purpose**: Remove the old postMessage handlers that are unreachable from the Angular SPA.

**Pattern**: Direct elimination (no backward compatibility)

**Responsibilities**:

- Remove `handleStartMessage()` private method (superseded by `wizard:deep-analyze` + `wizard:recommend-agents` RPC)
- Remove `handleSelectionMessage()` private method (superseded by `wizard:submit-selection` RPC)
- Remove `handleCancelMessage()` private method (superseded by `wizard:cancel` RPC)
- Remove the webview message handler closures in `launchWizard()` (lines 200-225) and `resumeWizard()` (lines 441-466)
- Simplify `launchWizard()` and `resumeWizard()` to only create the panel without message handlers (the panel is now the Angular SPA, not a separate wizard panel)
- Keep `performDeepAnalysis()`, `cancelWizard()`, `getCurrentSession()`, `handleStepTransition()`, and `handleAgentSelectionUpdate()` as they may be called from the RPC handler layer

**IMPORTANT NOTE**: The `SetupWizardService.launchWizard()` is still called from `setup-wizard:launch` RPC handler. If the separate wizard webview panel approach is entirely replaced by the Angular SPA, then `launchWizard()` may also be dead code. The research report (TASK_2025_147) suggests the wizard runs inside the main webview. In that case:

- `setup-wizard:launch` should trigger the frontend to navigate to the wizard view (via broadcast message) rather than creating a separate panel
- OR `launchWizard()` should be simplified to just ensure the wizard panel/view is active

This cleanup should be done carefully. The developer should verify whether `launchWizard()` is still creating a separate panel or if the wizard is in the main SPA.

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts` (MODIFY)

---

## Integration Architecture

### Data Flow

```
Frontend (Angular SPA)                    Backend (Extension Host)
========================                  ========================

1. User clicks "Generate" button
   in agent-selection.component.ts
         |
         v
2. WizardRpcService.submitAgentSelection()
   -> ClaudeRpcService.call('wizard:submit-selection', { selectedAgentIds })
         |
         v (postMessage RPC request)
         |
3.       |                                RpcHandler routes to
         |                                WizardGenerationRpcHandlers
         |                                         |
         |                                         v
4.       |                                Resolve AgentGenerationOrchestratorService
         |                                via AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR
         |                                         |
         |                                         v
5.       |                                orchestrator.generateAgents({
         |                                  workspaceUri,
         |                                  userOverrides: selectedAgentIds,
         |                                  threshold: 50
         |                                }, progressCallback)
         |                                         |
         |                     +-------------------+
         |                     |  Progress Loop
         |                     |
6.       |                     v
         |  <--- broadcastMessage('setup-wizard:generation-progress', payload)
         |
         v
7. SetupWizardStateService.handleGenerationProgress(payload)
   -> updates generationProgressSignal
   -> updates skillGenerationProgressSignal (per-item)
         |
         v
8. GenerationProgressComponent re-renders with new progress
         |
         |                     (generation completes)
         |                     |
9.       |  <--- broadcastMessage('setup-wizard:generation-complete', payload)
         |
         v
10. SetupWizardStateService.handleGenerationComplete(payload)
    -> transitions to 'completion' step
         |
         v
11. RPC response returns { success: true } to submitAgentSelection()
    -> AgentSelectionComponent receives acknowledgment
```

### Dependencies

- `wizard:submit-selection` depends on: `AgentGenerationOrchestratorService`, `WebviewManager`
- `wizard:cancel` depends on: `SetupWizardService` (for session cancellation)
- `wizard:retry-item` depends on: `AgentGenerationOrchestratorService` (for single-item retry)

---

## Quality Requirements

### Functional Requirements

- `wizard:submit-selection` must trigger the full 5-phase generation pipeline
- Progress must be visible in the generation-progress.component in real-time
- Cancel must abort any running generation
- Retry must re-run generation for a single failed item
- All existing UI components must work without modification (generation-progress, completion, agent-selection)

### Non-Functional Requirements

- **Performance**: Generation timeout of 5 minutes (orchestrator has `PHASE_3_TIMEOUT_MS = 5 * 60 * 1000`)
- **Concurrency**: Only one generation can run at a time (guard in handler)
- **Error surfacing**: All orchestrator errors must propagate to the frontend via RPC error response

### Pattern Compliance

- All handlers follow `@injectable()` class with `register()` method pattern (verified: `enhanced-prompts-rpc.handlers.ts:53`)
- All types in `RpcMethodRegistry` (verified: `rpc.types.ts:1003`)
- All method names in `RPC_METHOD_NAMES` (verified: `rpc.types.ts:1215`)
- All method prefixes in `ALLOWED_METHOD_PREFIXES` (`'wizard:'` already present: `rpc-handler.ts:60`)
- All PRO methods in `PRO_ONLY_METHOD_PREFIXES` (`'wizard:'` already present: `rpc-handler.ts:89`)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Primary work is backend RPC handler creation (NestJS/tsyringe DI patterns)
- Frontend changes are minimal (replacing stubs with real calls, same pattern as existing working methods)
- Requires understanding of DI container, service resolution, progress broadcasting

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Shared types (Component 1): ~30 min
- Backend RPC handler (Component 2): ~2 hours (most complex -- progress mapping)
- Registration wiring (Component 3): ~15 min
- Frontend stub replacement (Component 4): ~30 min
- Progress broadcasting integration (Component 5): ~1 hour
- Dead code cleanup (Component 6): ~30 min
- Testing & verification: ~1 hour

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

**MODIFY**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (add types, registry entries, method names)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts` (add export)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (add handler)
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts` (replace stubs)
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts` (enhance progress handler for per-item updates)
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts` (remove dead postMessage handlers)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `AGENT_GENERATION_TOKENS` from `@ptah-extension/agent-generation` (verified: `libs/backend/agent-generation/src/lib/di/tokens.ts:201`)
   - `RpcHandler`, `Logger`, `TOKENS` from `@ptah-extension/vscode-core` (verified: CLAUDE.md)
   - `WebviewManager` type from `@ptah-extension/vscode-core` (verified: `rpc-handler.ts:24`)
   - `MESSAGE_TYPES` from `@ptah-extension/shared` (verified: `setup-rpc.handlers.ts:25`)

2. **All patterns verified from examples**:

   - Handler class pattern: `enhanced-prompts-rpc.handlers.ts`
   - Service resolution: `setup-rpc.handlers.ts:78-94` (`resolveService` pattern)
   - Progress broadcasting: `setup-rpc.handlers.ts:340-356` (`broadcastMessage` pattern)
   - RPC type registry: `rpc.types.ts:1082-1100` (setup method entries)

3. **Library documentation consulted**:

   - `D:\projects\ptah-extension\libs\backend\agent-generation\CLAUDE.md`
   - `D:\projects\ptah-extension\libs\backend\vscode-core\CLAUDE.md`
   - `D:\projects\ptah-extension\libs\shared\CLAUDE.md`
   - `D:\projects\ptah-extension\libs\frontend\setup-wizard\CLAUDE.md`

4. **No hallucinated APIs**:
   - `AgentGenerationOrchestratorService.generateAgents()`: verified at `orchestrator.service.ts:183`
   - `OrchestratorGenerationOptions.userOverrides`: verified at `orchestrator.service.ts:65`
   - `GenerationProgress` callback type: verified at `orchestrator.service.ts:76-112`
   - `WebviewManager.broadcastMessage()`: verified via interface at `rpc-method-registration.service.ts:54-56`
   - `RpcHandler.registerMethod<P, R>()`: verified via usage in all handler files
   - `SetupWizardService.cancelWizard()`: verified at `setup-wizard.service.ts:360`

### Batch Ordering for Team-Leader

**Batch 1** (Foundation -- no dependencies):

1. Add RPC types to `rpc.types.ts` (Component 1)

**Batch 2** (Backend -- depends on Batch 1): 2. Create `wizard-generation-rpc.handlers.ts` (Component 2) 3. Add export to `handlers/index.ts` (Component 3) 4. Register in `rpc-method-registration.service.ts` (Component 3)

**Batch 3** (Frontend -- depends on Batch 1 for type safety): 5. Replace stubs in `wizard-rpc.service.ts` (Component 4) 6. Enhance `setup-wizard-state.service.ts` progress handler (Component 5)

**Batch 4** (Cleanup -- depends on Batch 2+3 working): 7. Remove dead postMessage handlers from `setup-wizard.service.ts` (Component 6)

**Verification After Each Batch**:

- Batch 1: `npm run typecheck:all` passes
- Batch 2: Extension compiles, RPC verification shows no missing handlers
- Batch 3: Frontend compiles, stubs no longer throw
- Batch 4: No regressions, removed code was truly unreachable

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
- [x] Batch ordering defined for team-leader
