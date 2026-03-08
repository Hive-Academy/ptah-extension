# Development Tasks - TASK_2025_150

**Total Tasks**: 10 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- **Type guards exist in SDK barrel**: Verified - `isContentBlockDelta`, `isStreamEvent`, `isTextDelta`, `isInputJsonDelta`, `isThinkingDelta`, `isContentBlockStart`, `isContentBlockStop` are all exported via wildcard from `libs/backend/agent-sdk/src/index.ts` line 42
- **AnalysisStreamPayload already defined**: Verified - exists at `libs/shared/src/lib/types/setup-wizard.types.ts:749`
- **WizardMessage discriminated union uses exhaustive switch**: Verified - `SetupWizardStateService` has `default: never` exhaustive check at line 864
- **AnalysisTranscriptComponent reads directly from state**: Verified - `wizardState.analysisStream()` is hardcoded throughout the component (line 416, 452, 548)
- **Callback pattern matches existing progressCallback**: Verified - `OrchestratorService.generateAgents()` already accepts a `progressCallback` parameter
- **EnhancedPromptsSdkConfig is exported from barrel**: Verified - exported from `@ptah-extension/agent-sdk`

### Risks Identified

| Risk                                                                                                                                                       | Severity | Mitigation                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding new WizardMessageType entries breaks exhaustive switch in SetupWizardStateService                                                                   | HIGH     | Task 3.1 MUST add both the new types to `WizardMessageType` union AND new cases to the switch statement AND update `isWizardMessage()` type guard - all in the same batch |
| ContentGenerationService uses `for await` loop - adding stream event handling before the result check must not interfere with structured_output extraction | MED      | Stream events are `message.type === 'stream_event'` while result is `message.type === 'result'` - these are mutually exclusive type checks                                |
| OrchestratorGenerationOptions is locally mirrored in wizard-generation-rpc.handlers.ts (line 67)                                                           | MED      | Task 2.2 must update BOTH the canonical interface AND the local mirror                                                                                                    |
| AnalysisTranscriptComponent refactor to accept `input()` could break existing ScanProgressComponent usage                                                  | LOW      | Use optional input with fallback to state service - existing usage without input continues to work                                                                        |

### Edge Cases to Handle

- [ ] Throttling text/thinking deltas at 100ms to prevent UI flooding -> Handled in Tasks 2.1 and 2.4
- [ ] Tool call grouping via Map for active tool blocks -> Handled in Tasks 2.1 and 2.4
- [ ] Clear generation/enhance stream signals on wizard reset -> Handled in Task 3.1
- [ ] Fire-and-forget broadcast pattern (don't block stream loop) -> Handled in Tasks 2.3 and 2.5

---

## Batch 1: Shared Types & Reusable Component Foundation -- BATCH STATUS: COMPLETE

**Commit**: aa7898f

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add GenerationStreamPayload type and new WizardMessage entries -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`
**Spec Reference**: implementation-plan.md: Step 1 (lines 38-66)
**Pattern to Follow**: `AnalysisStreamPayload` at line 749, `WizardMessageType` at line 701, `WizardMessage` at line 898

**Quality Requirements**:

- `GenerationStreamPayload` extends `AnalysisStreamPayload` with optional `agentId?: string`
- Add `'setup-wizard:generation-stream'` and `'setup-wizard:enhance-stream'` to `WizardMessageType` union
- Add two new entries to `WizardMessage` discriminated union
- Follow existing JSDoc documentation patterns

**Implementation Details**:

- Add `GenerationStreamPayload` interface after `AnalysisStreamPayload` (around line 769)
- Extend `WizardMessageType` union with two new entries
- Extend `WizardMessage` union with two new discriminated members
- Export `GenerationStreamPayload` (it's auto-exported via the barrel since it's in the same file)

---

### Task 1.2: Make AnalysisTranscriptComponent reusable via input binding -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-transcript.component.ts`
**Spec Reference**: implementation-plan.md: Step 11 (lines 303-317)
**Pattern to Follow**: Existing component at line 382, signal pattern at line 416

**Quality Requirements**:

- Add `messages = input<AnalysisStreamPayload[]>()` signal input
- Create `effectiveMessages` computed signal: returns `this.messages() ?? this.wizardState.analysisStream()`
- Update `messageCount` computed to use `effectiveMessages()` instead of `wizardState.analysisStream()`
- Update `transcriptItems` computed to use `effectiveMessages()` instead of `wizardState.analysisStream()`
- Update auto-scroll effect to use `effectiveMessages()`
- Existing usage in ScanProgressComponent (no input provided) must continue to work unchanged

**Validation Notes**:

- RISK: Must ensure backward compatibility. The fallback to `wizardState.analysisStream()` when no input is provided guarantees this.

**Implementation Details**:

- Import `input` from `@angular/core` (add to existing import)
- Add `messages` input signal declaration
- Add `effectiveMessages` computed signal
- Replace all 3 references to `this.wizardState.analysisStream()` with `this.effectiveMessages()`

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared` and `npx nx build setup-wizard`
- code-logic-reviewer approved
- Backward compatibility of AnalysisTranscriptComponent preserved

---

## Batch 2: Backend Stream Broadcasting (Generation + Enhanced Prompts Pipelines) -- BATCH STATUS: COMPLETE

**Commit**: 311a7a4

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 (needs GenerationStreamPayload type)

### Task 2.1: Add stream event broadcasting to ContentGenerationService -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`
**Spec Reference**: implementation-plan.md: Step 3 (lines 86-129)
**Pattern to Follow**: `AgenticAnalysisService.processStream()` in `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts` lines 348-420

**Quality Requirements**:

- Import type guards from `@ptah-extension/agent-sdk`: `isStreamEvent`, `isContentBlockDelta`, `isContentBlockStart`, `isContentBlockStop`, `isTextDelta`, `isInputJsonDelta`, `isThinkingDelta`
- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Update `processGenerationStream()` signature to accept `onStreamEvent` callback and `agentId`
- Add stream event handling inside the `for await` loop BEFORE the result check
- Implement 100ms throttling for text and thinking deltas
- Track active tool blocks via `Map<number, { name: string; inputBuffer: string; toolCallId: string }>`
- Generate unique toolCallId via `content_block_start` index
- Pass `onStreamEvent` and template name as `agentId` from `fillDynamicSections()`
- Extract `sdkConfig.onStreamEvent` in `fillDynamicSections()` and pass to `processGenerationStream()`

**Validation Notes**:

- RISK: Stream events (`message.type === 'stream_event'`) are mutually exclusive with result messages (`message.type === 'result'`), so adding stream event handling before the result check is safe
- Throttle text/thinking at 100ms to prevent UI flooding
- Use fire-and-forget pattern (callback invocation should not block the loop)

**Implementation Details**:

- Update `processGenerationStream` signature: add `onStreamEvent?: (event: GenerationStreamPayload) => void` and `agentId?: string`
- Add throttle tracking: `let lastTextEmit = 0; let lastThinkingEmit = 0;`
- Add tool block tracking: `const activeToolBlocks = new Map<number, { name: string; inputBuffer: string; toolCallId: string }>()`
- In `fillDynamicSections()`: extract `sdkConfig?.onStreamEvent`, pass to `processGenerationStream()` along with `templateName` as `agentId`

---

### Task 2.2: Add onStreamEvent callback to ContentGenerationSdkConfig and OrchestratorService -- STATUS: COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\interfaces\content-generation.interface.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

**Spec Reference**: implementation-plan.md: Steps 2 and 4 (lines 65-80 and 130-151)
**Pattern to Follow**: Existing `isPremium` and `mcpServerRunning` fields in `ContentGenerationSdkConfig`, existing `progressCallback` parameter in orchestrator

**Quality Requirements**:

- Import `GenerationStreamPayload` from `@ptah-extension/shared` in both files
- Add `onStreamEvent?: (event: GenerationStreamPayload) => void` to `ContentGenerationSdkConfig`
- Add `onStreamEvent?: (event: GenerationStreamPayload) => void` to `OrchestratorGenerationOptions`
- In `renderAgents()`, pass `options.onStreamEvent` into `sdkConfig`

**Implementation Details**:

- In `content-generation.interface.ts`: add import for `GenerationStreamPayload`, add `onStreamEvent` field to `ContentGenerationSdkConfig`
- In `orchestrator.service.ts`: add import for `GenerationStreamPayload`, add `onStreamEvent` field to `OrchestratorGenerationOptions`, update `sdkConfig` object in `renderAgents()` to include `onStreamEvent: options.onStreamEvent`

---

### Task 2.3: Create generation stream broadcaster in WizardGenerationRpcHandlers -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Step 5 (lines 152-176)
**Pattern to Follow**: Existing `progressCallback` at lines 384-425 in same file

**Quality Requirements**:

- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Create `onStreamEvent` callback that broadcasts via `webviewManager.broadcastMessage('setup-wizard:generation-stream', event)`
- Follow identical error handling pattern as progressCallback: try/catch with `.catch()` on broadcast promise
- Add `onStreamEvent` to the `options` object passed to `orchestrator.generateAgents()`
- Also update the local `OrchestratorGenerationOptions` interface mirror (line 67) to include `onStreamEvent`

**Validation Notes**:

- RISK: Local interface mirror must be updated alongside canonical interface. Both must include `onStreamEvent`.
- Fire-and-forget pattern: do NOT await broadcastMessage

**Implementation Details**:

- Add `GenerationStreamPayload` to shared imports
- Create `onStreamEvent` closure (same scope as `progressCallback`) that broadcasts to `'setup-wizard:generation-stream'`
- Add `onStreamEvent` to `options` object at line 371-381
- Update local `OrchestratorGenerationOptions` interface to include `onStreamEvent` field

---

### Task 2.4: Add stream event broadcasting to EnhancedPromptsService -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
**Spec Reference**: implementation-plan.md: Step 6 (lines 178-205)
**Pattern to Follow**: Same as Task 2.1, plus existing `processPromptDesignerStream()` at line 633

**Quality Requirements**:

- Import type guards from SDK types (same file's own types)
- Import `AnalysisStreamPayload` from `@ptah-extension/shared`
- Add `onStreamEvent?: (event: AnalysisStreamPayload) => void` to `EnhancedPromptsSdkConfig`
- Update `processPromptDesignerStream()` signature to accept `onStreamEvent` callback
- Add stream event handling inside the `for await` loop BEFORE the result check
- Implement 100ms throttling for text and thinking deltas
- Track active tool blocks for tool call grouping
- Pass `sdkConfig.onStreamEvent` from `generateGuidanceViaSdk()` to `processPromptDesignerStream()`

**Implementation Details**:

- Import type guards: `isStreamEvent`, `isContentBlockDelta`, `isContentBlockStart`, `isContentBlockStop`, `isTextDelta`, `isInputJsonDelta`, `isThinkingDelta` from `../../types/sdk-types/claude-sdk.types`
- Import `AnalysisStreamPayload` from `@ptah-extension/shared`
- Add `onStreamEvent` to `EnhancedPromptsSdkConfig`
- Update `processPromptDesignerStream` to accept `onStreamEvent` parameter
- Same throttle + tool tracking pattern as Task 2.1

---

### Task 2.5: Create enhance stream broadcaster in EnhancedPromptsRpcHandlers -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Step 7 (lines 207-231)
**Pattern to Follow**: Existing `resolveSdkConfig()` at line 584, existing webview broadcasting in wizard-generation-rpc.handlers.ts

**Quality Requirements**:

- Import `AnalysisStreamPayload` from `@ptah-extension/shared`
- Update `resolveSdkConfig()` to accept optional `onStreamEvent` callback and include it in returned config
- In `registerRunWizard()`, resolve WebviewManager and create `onStreamEvent` broadcaster for `'setup-wizard:enhance-stream'`
- In `registerRegenerate()`, create same broadcaster pattern
- Follow fire-and-forget pattern with try/catch error swallowing

**Implementation Details**:

- Add `AnalysisStreamPayload` to shared imports
- Update `resolveSdkConfig` signature: add `onStreamEvent?: (event: AnalysisStreamPayload) => void` parameter
- Include `onStreamEvent` in returned object
- In `registerRunWizard()`: resolve WebviewManager via DI container, create `onStreamEvent` closure, pass to `resolveSdkConfig()`
- In `registerRegenerate()`: same pattern

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-generation` and `npx nx build agent-sdk`
- `npx nx test agent-generation` passes (existing tests)
- `npx nx test agent-sdk` passes (existing tests)
- code-logic-reviewer approved
- Stream event handling does not interfere with structured_output extraction
- Throttling implemented at 100ms for text/thinking

---

## Batch 3: Frontend State + UI Integration -- BATCH STATUS: COMPLETE

**Commit**: fad013a

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (shared types), Batch 2 (backend broadcasting)

### Task 3.1: Add generation/enhance stream signals and handlers to SetupWizardStateService -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
**Spec Reference**: implementation-plan.md: Step 8 (lines 233-260)
**Pattern to Follow**: Existing `analysisStreamSignal` at line 226, `handleAnalysisStream()` at line 915, `isWizardMessage()` at line 792

**Quality Requirements**:

- Import `GenerationStreamPayload` from `@ptah-extension/shared`
- Add `generationStreamSignal` and `enhanceStreamSignal` private writable signals
- Add `generationStream` and `enhanceStream` public readonly signals
- Add `'setup-wizard:generation-stream'` and `'setup-wizard:enhance-stream'` to `isWizardMessage()` type guard's `validTypes` array
- Add two new cases to the message switch: `'setup-wizard:generation-stream'` and `'setup-wizard:enhance-stream'`
- Clear both new stream signals in `reset()` method
- CRITICAL: Update the `default: never` exhaustive check - adding new WizardMessage types means the switch must handle them, otherwise TypeScript compilation fails

**Validation Notes**:

- RISK (HIGH): The exhaustive switch with `const _exhaustiveCheck: never = message` will cause a compile error if the new message types are added to `WizardMessage` but not handled in the switch. Both Batch 1 (types) and Batch 3 (handler) must be in place for compilation.
- Clear streams on reset to prevent stale data from prior wizard runs

**Implementation Details**:

- Add signals after `analysisStreamSignal` (line 226):
  - `private readonly generationStreamSignal = signal<GenerationStreamPayload[]>([])`
  - `private readonly enhanceStreamSignal = signal<AnalysisStreamPayload[]>([])`
- Add readonly accessors after `analysisStream` (line 335):
  - `readonly generationStream = this.generationStreamSignal.asReadonly()`
  - `readonly enhanceStream = this.enhanceStreamSignal.asReadonly()`
- Update `isWizardMessage()` validTypes array to include both new types
- Add switch cases:
  - `case 'setup-wizard:generation-stream': this.generationStreamSignal.update(msgs => [...msgs, message.payload]); break;`
  - `case 'setup-wizard:enhance-stream': this.enhanceStreamSignal.update(msgs => [...msgs, message.payload]); break;`
- Add to `reset()`: `this.generationStreamSignal.set([]); this.enhanceStreamSignal.set([]);`

---

### Task 3.2: Add collapsible Agent Activity transcript to GenerationProgressComponent -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
**Spec Reference**: implementation-plan.md: Step 9 (lines 262-291)
**Pattern to Follow**: Existing `AnalysisTranscriptComponent` usage in `ScanProgressComponent`

**Quality Requirements**:

- Import `AnalysisTranscriptComponent` from `../components/analysis-transcript.component` (or relative import)
- Add `AnalysisTranscriptComponent` to component's `imports` array
- Expose `generationStream` from state service
- Add `hasStreamMessages` computed signal: `computed(() => this.generationStream().length > 0)`
- Add `streamMessageCount` computed signal: `computed(() => this.generationStream().length)`
- Add collapsible "Agent Activity Log" section in the template, placed after the overall progress card and before agent items section
- Use DaisyUI `collapse collapse-arrow bg-base-200` pattern
- Pass `generationStream()` to `ptah-analysis-transcript` via the new `[messages]` input

**Implementation Details**:

- Add computed signals in the class
- Add template section using `@if (hasStreamMessages())` guard
- Use `<ptah-analysis-transcript [messages]="generationStream()" />`
- Badge shows `streamMessageCount()`

---

### Task 3.3: Add collapsible Agent Activity transcript to PromptEnhancementComponent -- STATUS: COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`
**Spec Reference**: implementation-plan.md: Step 10 (lines 293-299)
**Pattern to Follow**: Same as Task 3.2

**Quality Requirements**:

- Import `AnalysisTranscriptComponent`
- Add to component's `imports` array
- Expose `enhanceStream` from state service
- Add `hasStreamMessages` and `streamMessageCount` computed signals
- Add collapsible "Agent Activity" section in template, placed after the Status Card and before footer buttons
- Use same DaisyUI collapse pattern as Task 3.2
- Pass `enhanceStream()` to `ptah-analysis-transcript` via `[messages]` input

**Implementation Details**:

- Follow exact same pattern as Task 3.2 but using `enhanceStream` instead of `generationStream`
- Place the activity section between the status card and footer buttons

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build setup-wizard`
- `npx nx test setup-wizard` passes (existing tests)
- code-logic-reviewer approved
- Exhaustive switch compiles without error
- AnalysisTranscriptComponent backward compatibility preserved

---

## Batch 4: Final Verification + QA Fixes -- BATCH STATUS: COMPLETE

**Commit**: dc09d3f

**Developer**: backend-developer (QA fixes)
**Tasks**: 5 QA fixes | **Dependencies**: Batches 1-3

**QA Fixes Applied**:

1. Added `completedToolNames` Map and `tool_result` broadcasting from `message.type === 'user'` in ContentGenerationService
2. Wrapped `processGenerationStream()` in `try/finally` with `handle.close()` to prevent SDK handle leaks
3. Added `onStreamEvent` broadcaster to `registerRetryItem()` in WizardGenerationRpcHandlers
4. Replaced `require('tsyringe')` with `DependencyContainer` constructor injection in EnhancedPromptsRpcHandlers
5. Extracted `createEnhanceStreamBroadcaster()` helper to deduplicate broadcaster closure

**Files Modified**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts` (Issues 1, 2)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts` (Issue 1)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` (Issue 3)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts` (Issues 4, 5)

**Verification**:

- All 4 files verified with real implementations (no stubs/TODOs/placeholders)
- Lint and format checks passed via pre-commit hook
- Commit message validated by commitlint

---
