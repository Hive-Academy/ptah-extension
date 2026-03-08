# Implementation Plan - TASK_2025_149

## Prompt Harness Wizard Integration & Silent Fallback Elimination

---

## Codebase Investigation Summary

### Libraries Investigated

- **@ptah-extension/agent-sdk** (`libs/backend/agent-sdk/`)

  - Key exports: `EnhancedPromptsService`, `PromptDesignerAgent`, `PromptDesignerOutput`, `EnhancedPromptsStatus`
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`
  - Relevant files:
    - `src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` (silent fallback at line 434-436)
    - `src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts` (state/config types)
    - `src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts` (silent fallbacks at lines 208-212, 273-285)
    - `src/lib/prompt-harness/prompt-designer/prompt-designer.types.ts` (output/status types)
    - `src/lib/internal-query/internal-query.service.ts` (consumer at line 306-319)

- **@ptah-extension/agent-generation** (`libs/backend/agent-generation/`)

  - Key exports: `OrchestratorService`, `VsCodeLmService`, `AGENT_GENERATION_TOKENS`
  - Documentation: `libs/backend/agent-generation/CLAUDE.md`
  - Relevant files:
    - `src/lib/services/orchestrator.service.ts` (silent fallbacks at lines 276-289, 638-654)
    - `src/lib/di/register.ts` (DI registration)
    - `src/lib/di/tokens.ts` (DI tokens)

- **@ptah-extension/shared** (`libs/shared/`)

  - Key exports: `WizardMessage`, `GenerationCompletePayload`, `WizardErrorPayload`, `WizardMessageType`
  - Documentation: `libs/shared/CLAUDE.md`
  - Relevant file: `src/lib/types/setup-wizard.types.ts`

- **@ptah-extension/setup-wizard** (`libs/frontend/setup-wizard/`)

  - Key exports: `SetupWizardStateService`, `WizardRpcService`, wizard step components
  - Documentation: `libs/frontend/setup-wizard/CLAUDE.md`
  - Relevant files:
    - `src/lib/services/setup-wizard-state.service.ts` (WizardStep type, state signals)
    - `src/lib/services/wizard-rpc.service.ts` (RPC facade)
    - `src/lib/components/wizard-view.component.ts` (step container)
    - `src/lib/components/scan-progress.component.ts` (scan UI)
    - `src/lib/components/generation-progress.component.ts` (generation UI with existing EP section)
    - `src/lib/components/completion.component.ts` (completion summary)

- **ptah-extension-vscode** (`apps/ptah-extension-vscode/`)
  - Documentation: `apps/ptah-extension-vscode/CLAUDE.md`
  - Relevant files:
    - `src/services/rpc/handlers/setup-rpc.handlers.ts` (silent fallback at lines 316-326)
    - `src/services/rpc/handlers/wizard-generation-rpc.handlers.ts` (generation RPC handlers)

### Patterns Identified

1. **Silent Fallback Pattern** (6 instances identified):

   - All follow same anti-pattern: `catch/if-error -> log.warn -> return fallback` without notifying user
   - Evidence: Lines cited above across 5 files

2. **RPC Handler Pattern** (verified):

   - Backend: `rpcHandler.registerMethod('namespace:method', async (payload) => { ... })`
   - Frontend: `this.rpcService.call('namespace:method', payload)` returns `Promise<T>`
   - Evidence: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

3. **Wizard Message Broadcast Pattern** (verified):

   - `webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_*, payload)`
   - Frontend receives via `window.addEventListener('message', handler)` in `SetupWizardStateService`
   - Discriminated union pattern with exhaustive switch: `WizardMessage` type
   - Evidence: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts:885-898`

4. **Signal-Based State Pattern** (verified):

   - Private `signal<T>()` + public `asReadonly()`
   - `computed()` for derived state
   - `effect()` for side effects (see `enhancedPromptsEffect` at generation-progress.component.ts:704)
   - Evidence: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

5. **DI Pattern** (verified):

   - `tsyringe` with `Symbol.for()` tokens
   - Lazy resolution: `this.resolveService<T>(TOKEN, 'ServiceName')`
   - Registration: `container.registerSingleton(TOKEN, ServiceClass)`
   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts`

6. **Result Pattern** (verified):

   - `Result<T, Error>` with `.isOk()`, `.isErr()`, `.value!`, `.error!`
   - Evidence: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts:276`

7. **WizardStep Type** (verified):
   - Currently: `'premium-check' | 'welcome' | 'scan' | 'analysis' | 'selection' | 'generation' | 'completion'`
   - Visible stepper: 6 steps (premium-check is invisible gating step)
   - Evidence: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:33-40`

### Integration Points Verified

1. **EnhancedPromptsService** already has signals in state service:

   - `enhancedPromptsStatusSignal` (type: `EnhancedPromptsWizardStatus`)
   - `enhancedPromptsErrorSignal` (type: `string | null`)
   - `enhancedPromptsDetectedStackSignal` (type: `string[] | null`)
   - Evidence: `setup-wizard-state.service.ts:272-292`

2. **WizardRpcService** already has EP methods:

   - `runEnhancedPromptsWizard(workspacePath: string)`
   - `getEnhancedPromptsStatus(workspacePath: string)`
   - Evidence: `wizard-rpc.service.ts` (read in previous session)

3. **GenerationProgressComponent** already auto-triggers EP:

   - `enhancedPromptsEffect` at line 704 watches `isGenerationComplete()` and triggers `triggerEnhancedPrompts()`
   - This needs to be MOVED to the new Enhance step component (not duplicated)
   - Evidence: `generation-progress.component.ts:704-713`

4. **PromptDesignerOutput** interface currently lacks fallback tracking:

   - Has: `projectContext`, `frameworkGuidelines`, `codingStandards`, `architectureNotes`, `qualityGuidance?`, `qualityScore?`, `qualityAssessment?`, `generatedAt`, `totalTokens`, `tokenBreakdown`
   - Missing: `usedFallback`, `fallbackReason` (needed for R3, R4)
   - Evidence: `prompt-designer.types.ts:77-129`

5. **GenerationCompletePayload** currently lacks warnings/EP flag:
   - Has: `success`, `generatedCount`, `duration?`, `errors?`
   - Missing: `warnings?`, `enhancedPromptsUsed?` (needed for R2, R12)
   - Evidence: `setup-wizard.types.ts:837-846`

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Incremental modification of existing patterns with visible error surfacing.

**Rationale**: The codebase already has most of the infrastructure (state signals, RPC methods, EP service). The primary work is (1) replacing silent fallbacks with visible error reporting, (2) adding an 'enhance' wizard step, (3) wiring enhanced prompts into the generation pipeline, and (4) adding settings UI. All changes follow existing patterns verified from codebase.

**Evidence**: All 6 silent fallback locations identified, all integration points verified, all patterns extracted from existing code.

### Component Specifications

---

## Batch 1: Shared Types & Backend Error Surfacing Foundation

**Goal**: Add shared type fields needed by all subsequent batches, then fix all 6 silent fallback locations to surface errors visibly.

### Component 1.1: Shared Types Additions

**Purpose**: Extend shared type contracts with fields for warnings, fallback tracking, and error categorization.

**Pattern**: Backward-compatible optional field additions to existing interfaces.
**Evidence**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts:837-846` (GenerationCompletePayload), `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts:852-857` (WizardErrorPayload)

**Changes**:

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`

- **Action**: MODIFY
- Add `warnings?: string[]` to `GenerationCompletePayload` (for R2 Phase 3 warnings)
- Add `enhancedPromptsUsed?: boolean` to `GenerationCompletePayload` (for R12 pipeline flag)
- Add `type?: 'error' | 'fallback-warning'` to `WizardErrorPayload` (for R1 fallback distinction)

**Functional Requirements**:

- All new fields MUST be optional to avoid breaking existing consumers
- `WizardErrorPayload.type` defaults to `'error'` if omitted (backward compatible)

### Component 1.2: PromptDesignerOutput Fallback Tracking

**Purpose**: Add fallback metadata to PromptDesignerOutput so callers can detect when fallback guidance was used.

**Pattern**: Optional field additions to existing interface.
**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts:77-129`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`

- **Action**: MODIFY
- Add `usedFallback?: boolean` to `PromptDesignerOutput` interface
- Add `fallbackReason?: string` to `PromptDesignerOutput` interface
- Add `'fallback'` to `PromptGenerationStatus` type union (line 180-185)

### Component 1.3: Fix R1 - Agentic Analysis Fallback (setup-rpc.handlers.ts)

**Purpose**: Make the agentic-to-DeepProjectAnalysis fallback VISIBLE to the user via a warning broadcast and VS Code notification.

**Pattern**: Existing broadcast pattern at `setup-rpc.handlers.ts:340-349` already broadcasts a fallback transition message. Extend this to also send a `setup-wizard:error` with `type: 'fallback-warning'`.
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts:316-349`

**Changes**:

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`

- **Action**: MODIFY (lines 316-326 region)
- After `logger.warn(...)` on line 316, add:
  1. `vscode.window.showWarningMessage(...)` with user-readable message about fallback
  2. `webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_ERROR, { type: 'fallback-warning', message: 'AI-powered analysis unavailable. Using quick analysis mode (less detailed results).', details: error.message })`
- Keep the DeepProjectAnalysisService fallback as a HARD fallback (per task requirements)
- The existing fallback transition broadcast at lines 340-349 is already present; the new error broadcast provides a persistent warning

**Functional Requirements**:

- Frontend must display a warning alert (not error) when `type === 'fallback-warning'`
- The fallback must still work (DeepProjectAnalysisService still executes)
- VS Code notification provides awareness outside the webview

### Component 1.4: Fix R2 - Phase 3 LLM Customization Fallback (orchestrator.service.ts)

**Purpose**: Surface Phase 3 customization failures as warnings in the generation completion payload, not silently swallowed.

**Pattern**: The orchestrator already collects `warnings` array (line 282-283). The issue is these warnings never reach the frontend.
**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts:276-289`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

- **Action**: MODIFY
- Ensure `warnings` array is included in the `GenerationSummary` return value
- Verify `GenerationSummary` type already has `warnings` field (it does, per investigation)

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

- **Action**: MODIFY
- When building the `setup-wizard:generation-complete` payload, include `warnings` from `GenerationSummary.warnings`
- Map to new `GenerationCompletePayload.warnings` field

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

- **Action**: MODIFY (lines 638-654 region)
- For individual section failures: add per-section warning to the `warnings` array with section ID and error type (validation vs infrastructure)
- Keep the empty-string fallback for rendering (template still renders without customization)
- Add structured warning: `"Section '${sectionId}' customization failed (${errorType}): using generic content"`

**Functional Requirements**:

- Warnings MUST reach the frontend via `GenerationCompletePayload.warnings`
- The generation must NOT fail due to customization issues (existing behavior preserved)
- Each failed section should produce a distinct warning message

### Component 1.5: Fix R3 & R4 - PromptDesignerAgent Fallback Tracking (prompt-designer-agent.ts)

**Purpose**: Mark fallback outputs with metadata instead of silently returning them as if they were LLM-generated.

**Pattern**: Set `usedFallback: true` and `fallbackReason` on the `PromptDesignerOutput` returned by `generateFallbackGuidance()`.
**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts:208-212, 273-285`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`

- **Action**: MODIFY
- **R3 (lines 208-212)**: When `!this.llmService.hasProvider()`, set `onProgress?.({ status: 'fallback', message: 'LLM not available, using template guidance' })` before returning fallback. The `generateFallbackGuidance()` return value must include `usedFallback: true, fallbackReason: 'LLM service not available'`
- **R4 (lines 273-285)**: In the catch block, set `usedFallback: true, fallbackReason: error.message` on the fallback return. Change `onProgress` status from `'error'` to `'fallback'` to distinguish from fatal errors

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`

- **Action**: MODIFY (`generateFallbackGuidance` method)
- Add `usedFallback: true` to the returned `PromptDesignerOutput`
- Accept optional `fallbackReason: string` parameter and include it in output

**Functional Requirements**:

- `generateFallbackGuidance()` MUST always set `usedFallback: true` on its output
- Callers can check `output.usedFallback` to distinguish LLM-generated vs hardcoded guidance
- The `onProgress` callback must emit `status: 'fallback'` (not `'error'`) for non-fatal fallbacks

### Component 1.6: Fix R5 - EnhancedPromptsService Silent Fallback (enhanced-prompts.service.ts)

**Purpose**: Return `null` instead of `PTAH_CORE_SYSTEM_PROMPT` when enabled but no generated prompt exists. This makes the fallback explicit so callers can decide what to do.

**Pattern**: Change return value semantics of `getEnhancedPromptContent()`.
**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts:420-437`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`

- **Action**: MODIFY (lines 434-436)
- Replace `return PTAH_CORE_SYSTEM_PROMPT;` with `return null;`
- Add log: `this.logger.info('Enhanced Prompts enabled but no generated prompt available', { workspacePath })`
- Update JSDoc to document that `null` means "enabled but no prompt generated yet"

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`

- **Action**: MODIFY (lines 306-319 region)
- The existing code at line 315 already falls back to `PTAH_CORE_SYSTEM_PROMPT` when `enhancedContent` is null
- Add explicit logging: `this.logger.info('Enhanced prompt not available, using PTAH_CORE_SYSTEM_PROMPT', { cwd })`
- This preserves the existing caller behavior while making the fallback explicit

**Functional Requirements**:

- `getEnhancedPromptContent()` returns `null` (not `PTAH_CORE_SYSTEM_PROMPT`) when no generated prompt exists
- Callers (InternalQueryService) handle `null` explicitly with logging
- The end-user behavior is unchanged (still gets PTAH_CORE as fallback) but the fallback is now visible in logs

### Files Affected (Batch 1)

| File                                                                                                                    | Action |
| ----------------------------------------------------------------------------------------------------------------------- | ------ |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`                                            | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`     | MODIFY |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`                 | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`                     | MODIFY |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`     | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`     | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts` | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`                    | MODIFY |

---

## Batch 2: Frontend Fallback Warning Display

**Goal**: Update frontend components to display fallback warnings and Phase 3 customization warnings visibly to the user.

### Component 2.1: Scan Progress Fallback Warning (R1 Frontend)

**Purpose**: Display a visible warning alert in the scan-progress component when the agentic analysis falls back.

**Pattern**: Existing error display pattern using `alert alert-error` class in `scan-progress.component.ts`. Extend with `alert-warning` for fallback warnings.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (has `@if (errorState())` block with `alert alert-error`)

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

- **Action**: MODIFY
- Add a new private signal: `private readonly fallbackWarningSignal = signal<string | null>(null);`
- Add public readonly: `readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();`
- Add mutation: `setFallbackWarning(warning: string | null): void`
- In `handleError()` method (line 1019): check `payload.type === 'fallback-warning'` and call `setFallbackWarning(payload.message)` instead of `errorStateSignal.set()`
- Add `'fallback-warning'` to reset method
- Update the `isWizardMessage` type guard if needed (the `WizardErrorPayload` now has optional `type` field)

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`

- **Action**: MODIFY
- Inject `SetupWizardStateService` (already injected)
- Add `fallbackWarning = this.wizardState.fallbackWarning;` computed/signal reference
- Add template block with `alert alert-warning` showing fallback warning when present
- The warning should say something like: "AI-powered analysis was not available. Results below are from quick analysis mode and may be less detailed."

**Functional Requirements**:

- Fallback warning must be visually distinct from errors (yellow/warning, not red/error)
- Warning should persist on screen (not disappear) so user can read it
- Warning should NOT block wizard progression (user can still proceed)

### Component 2.2: Completion Warnings Display (R2 Frontend)

**Purpose**: Display Phase 3 customization warnings on the completion screen so users know which agents got generic content.

**Pattern**: Existing completion component pattern with stats cards.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

- **Action**: MODIFY
- Update `CompletionData` interface to include `warnings?: string[]` and `enhancedPromptsUsed?: boolean`
- In `handleGenerationComplete()` (line 1000-1011): map `payload.warnings` and `payload.enhancedPromptsUsed` to `CompletionData`

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`

- **Action**: MODIFY
- Add computed signal: `warnings = computed(() => this.wizardState.completionData()?.warnings ?? [])`
- Add computed signal: `hasWarnings = computed(() => this.warnings().length > 0)`
- Add template section: collapsible warning list using DaisyUI `collapse` component
- Each warning shown as a `text-warning` line item

**Functional Requirements**:

- Warnings section only appears when `warnings.length > 0`
- Each warning is a readable sentence (e.g., "Agent 'backend-developer' section 'codingStandards' used generic content due to LLM validation failure")
- Warnings do not block the "Close" or "Open Files" actions

### Files Affected (Batch 2)

| File                                                                                                   | Action |
| ------------------------------------------------------------------------------------------------------ | ------ |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts` | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`  | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`     | MODIFY |

---

## Batch 3: Prompt Enhancement Wizard Step

**Goal**: Add a dedicated "Enhance" wizard step between Selection and Generation, moving the EP auto-trigger logic from `GenerationProgressComponent` into its own step.

### Component 3.1: WizardStep Type Extension

**Purpose**: Add `'enhance'` to the `WizardStep` type union and update all step-related logic.

**Pattern**: Existing `WizardStep` type union pattern.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts:33-40`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

- **Action**: MODIFY
- Add `'enhance'` to `WizardStep` type: `| 'premium-check' | 'welcome' | 'scan' | 'analysis' | 'selection' | 'enhance' | 'generation' | 'completion'`
- Update `stepIndex` computed signal's `stepOrder` array to include `'enhance'` after `'selection'`
- Update `percentComplete` computed signal: add `enhance: 55` (between selection:50 and generation:65)
- Update `canProceed` computed signal: add `case 'enhance': return false;` (cannot proceed during enhancement)
- In `reset()`: no special handling needed (enhance step resets with overall flow)

### Component 3.2: Prompt Enhancement Component (New)

**Purpose**: Dedicated wizard step that triggers Enhanced Prompts generation with clear status display, skip option, and retry capability.

**Pattern**: Same standalone Angular component pattern as other wizard step components. Signal-based, OnPush change detection.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts` (similar structure)

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`

- **Action**: CREATE
- Standalone component with `ChangeDetectionStrategy.OnPush`
- Selector: `ptah-prompt-enhancement`
- Injects: `SetupWizardStateService`, `WizardRpcService`
- Auto-triggers `runEnhancedPromptsWizard()` on init (via `effect()` or `ngOnInit`)
- Displays:
  - Status: "Generating project-specific prompt guidance..." (with spinner)
  - On success: Detected stack, "Enhanced prompts generated!" with continue button
  - On error: Error message with retry button
  - Skip button: Always visible, sets status to 'skipped' and advances to 'generation' step
- Uses existing state signals: `enhancedPromptsStatus`, `enhancedPromptsError`, `enhancedPromptsDetectedStack`
- Uses existing RPC: `wizardRpc.runEnhancedPromptsWizard(workspacePath)`
- On completion/skip: calls `wizardState.setCurrentStep('generation')`

**Template structure** (following existing DaisyUI patterns):

```html
<div class="container mx-auto px-4 py-8">
  <div class="max-w-4xl mx-auto">
    <h2>Enhance Your Prompts</h2>
    <p>Generating project-specific guidance to improve AI responses...</p>

    <!-- Status card -->
    <div class="card bg-base-200 shadow-xl">
      <!-- Switch on enhancedPromptsStatus() -->
      <!-- 'idle'/'generating': spinner + progress message -->
      <!-- 'complete': success with detected stack -->
      <!-- 'error': error with retry -->
      <!-- 'skipped': skipped badge -->
    </div>

    <!-- Action buttons -->
    <div class="flex justify-between mt-6">
      <button class="btn btn-ghost" (click)="onSkip()">Skip</button>
      <button class="btn btn-primary" [disabled]="!canContinue()" (click)="onContinue()">Continue to Generation</button>
    </div>
  </div>
</div>
```

### Component 3.3: Wizard View Integration

**Purpose**: Wire the new 'enhance' step into the wizard container's step switch.

**Pattern**: Existing `@switch (currentStep())` pattern in wizard-view.component.ts.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`

- **Action**: MODIFY
- Import `PromptEnhancementComponent`
- Add to `imports` array
- Add `@case ('enhance') { <ptah-prompt-enhancement /> }` in the step switch, between `'selection'` and `'generation'`
- Update `stepOrder` array in the stepper UI to include 'Enhance' between 'Select' and 'Generate'

### Component 3.4: Remove EP Auto-Trigger from GenerationProgressComponent

**Purpose**: Remove the EP auto-trigger logic from GenerationProgressComponent since it is now handled by the dedicated Enhance step.

**Pattern**: Direct removal of duplicated responsibility.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts:704-713` (enhancedPromptsEffect), lines 591-594 (enhancedPromptsTriggered flag), lines 719-729 (triggerEnhancedPrompts method)

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`

- **Action**: MODIFY
- Remove `enhancedPromptsTriggered` field (line 594)
- Remove `enhancedPromptsEffect` (lines 704-713)
- Remove `triggerEnhancedPrompts()` method (lines 719+)
- Remove `onRetryEnhancedPrompts()` method
- Keep the Enhanced Prompts section in the template as a READ-ONLY status display (shows current EP status but does not trigger it)
- Update `isFullyComplete` computed: Since EP is now done before generation starts, the generation step completion no longer needs to wait for EP. Change to: `isFullyComplete = computed(() => this.wizardState.isGenerationComplete())` -- EP status is irrelevant here since it's already handled in the Enhance step

### Component 3.5: Library Exports

**Purpose**: Export the new component from the setup-wizard library.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\index.ts`

- **Action**: MODIFY
- Add export for `PromptEnhancementComponent`

### Files Affected (Batch 3)

| File                                                                                                        | Action |
| ----------------------------------------------------------------------------------------------------------- | ------ |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`      | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`  | CREATE |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`         | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts` | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\index.ts`                                        | MODIFY |

---

## Batch 4: Enhanced Prompts RPC Handler & Generation Pipeline Integration

**Goal**: Add the backend RPC handler for the Enhance step, and wire enhanced prompts into the generation pipeline (Phase 3).

### Component 4.1: Enhanced Prompts RPC Handler (R8)

**Purpose**: Register a `wizard:generate-enhanced-prompt` RPC handler that the new Enhance step calls.

**Pattern**: Existing RPC handler pattern in `wizard-generation-rpc.handlers.ts`.
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

**Changes**:

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

- **Action**: MODIFY
- Add new RPC handler: `rpcHandler.registerMethod('wizard:generate-enhanced-prompt', async (payload: { workspacePath: string }) => { ... })`
- Handler logic:
  1. Resolve `EnhancedPromptsService` via `resolveService<EnhancedPromptsService>(SDK_TOKENS.ENHANCED_PROMPTS_SERVICE, 'EnhancedPromptsService')`
  2. Call `enhancedPromptsService.runWizard(payload.workspacePath)`
  3. Return result with status, detectedStack, and any error
  4. On error: return `{ success: false, error: error.message }` (NOT silently swallowed)

**Note**: There may already be an existing `enhancedPrompts:runWizard` handler registered elsewhere. Verify via grep and either reuse or consolidate into wizard-generation-rpc.handlers.ts for consistency.

### Component 4.2: Generation Pipeline Integration (R11, R12)

**Purpose**: Wire enhanced prompts into the OrchestratorService Phase 3 customization so generated agents benefit from project-specific guidance.

**Pattern**: OrchestratorService Phase 3 calls `VsCodeLmService.batchCustomize()` with section requests. The system prompt used for LLM customization should incorporate enhanced prompts when available.
**Evidence**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts:265-289`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

- **Action**: MODIFY
- Add optional `enhancedPromptContent?: string` to the `GenerationOptions` type (or the method's options parameter)
- Before Phase 3 (`customizeAgents` call), resolve enhanced prompt content:
  ```
  const enhancedPromptContent = options.enhancedPromptContent ?? null;
  ```
- Pass `enhancedPromptContent` into the `customizeAgents()` method
- Inside `customizeAgents()`, if `enhancedPromptContent` is available, prepend it to the system prompt used for LLM section customization
- Add `enhancedPromptsUsed: !!enhancedPromptContent` to the `GenerationSummary` return

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

- **Action**: MODIFY
- Before calling `orchestratorService.generate()`, resolve enhanced prompt:
  1. Resolve `EnhancedPromptsService`
  2. Call `getEnhancedPromptContent(workspacePath)`
  3. Pass result as `options.enhancedPromptContent` to orchestrator
- Include `enhancedPromptsUsed` in the `generation-complete` broadcast payload

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`

- **Action**: MODIFY (if `GenerationOptions` is defined here)
- Add `enhancedPromptContent?: string` to the options type

**Functional Requirements**:

- Enhanced prompts are OPTIONAL -- if null, Phase 3 works exactly as before
- When available, enhanced prompt content is prepended to the LLM system prompt for section customization
- The `enhancedPromptsUsed` flag is included in the completion payload for frontend display

### Files Affected (Batch 4)

| File                                                                                                                | Action |
| ------------------------------------------------------------------------------------------------------------------- | ------ |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`                 | MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`                              | MODIFY |

---

## Batch 5: Settings UI & Prompt Harness Toggle

**Goal**: Add VS Code settings integration for prompt harness toggle, and add settings RPC handlers for frontend control.

### Component 5.1: Settings RPC Handlers (R10)

**Purpose**: Register RPC handlers for toggling enhanced prompts on/off, regenerating, and checking status from the webview.

**Pattern**: Existing RPC handler registration pattern.
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

**Changes**:

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

- **Action**: MODIFY
- Add RPC handlers:
  - `enhancedPrompts:toggle` -- calls `EnhancedPromptsService.setEnabled(workspacePath, enabled)`
  - `enhancedPrompts:regenerate` -- calls `EnhancedPromptsService.regenerate(workspacePath)`
  - `enhancedPrompts:getStatus` -- calls `EnhancedPromptsService.getStatus(workspacePath)` and returns full status object
  - `enhancedPrompts:getPromptContent` -- calls `EnhancedPromptsService.getEnhancedPromptContent(workspacePath)` for preview

### Component 5.2: VS Code Settings Configuration (R10a)

**Purpose**: Register VS Code configuration contribution for the prompt harness toggle.

**Pattern**: VS Code `contributes.configuration` in `package.json`.
**Evidence**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`

**Changes**:

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`

- **Action**: MODIFY
- Add to `contributes.configuration.properties`:
  ```json
  "ptah.enhancedPrompts.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable project-specific enhanced prompts (requires Pro license). When enabled, Ptah generates custom guidance based on your codebase."
  }
  ```
- This allows users to toggle via VS Code Settings UI as well as the webview

### Component 5.3: WizardRpcService Settings Methods (Frontend)

**Purpose**: Add frontend RPC methods for the settings functionality.

**Pattern**: Existing `WizardRpcService` RPC call pattern.
**Evidence**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`

**Changes**:

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`

- **Action**: MODIFY
- Add methods:
  - `toggleEnhancedPrompts(workspacePath: string, enabled: boolean): Promise<void>`
  - `regenerateEnhancedPrompts(workspacePath: string): Promise<EnhancedPromptsWizardResult>`
  - `getEnhancedPromptsFullStatus(workspacePath: string): Promise<EnhancedPromptsStatus>`
  - `getEnhancedPromptContent(workspacePath: string): Promise<string | null>`

### Files Affected (Batch 5)

| File                                                                                                                | Action |
| ------------------------------------------------------------------------------------------------------------------- | ------ |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts` | MODIFY |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`                                                | MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`                      | MODIFY |

---

## Batch 6: Tests & Verification

**Goal**: Write unit tests for all error paths, fallback behaviors, and new functionality.

### Component 6.1: PromptDesignerAgent Tests (R13)

**Purpose**: Test fallback tracking in PromptDesignerAgent.

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.spec.ts`

- **Action**: CREATE or MODIFY (if exists)
- Test cases:
  - `it('should set usedFallback=true when LLM provider unavailable')`
  - `it('should set usedFallback=true with error reason when LLM call fails')`
  - `it('should emit fallback progress status when falling back')`
  - `it('should NOT set usedFallback when LLM succeeds')`
  - `it('should include fallbackReason in output when LLM errors')`

### Component 6.2: EnhancedPromptsService Tests (R13)

**Purpose**: Test the null-return behavior and state management.

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.spec.ts`

- **Action**: CREATE or MODIFY (if exists)
- Test cases:
  - `it('should return null when enabled but no generated prompt')`
  - `it('should return generated prompt when available')`
  - `it('should return null when disabled')`
  - `it('should log when returning null for enabled workspace')`

### Component 6.3: OrchestratorService Tests (R14)

**Purpose**: Test warning propagation from Phase 3 failures.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`

- **Action**: CREATE or MODIFY (if exists)
- Test cases:
  - `it('should include warnings in summary when Phase 3 customization fails')`
  - `it('should include per-section warnings for individual failures')`
  - `it('should include enhancedPromptsUsed flag when enhanced content provided')`
  - `it('should work without enhanced prompts (backward compatible)')`

### Component 6.4: SetupWizardStateService Tests (R14)

**Purpose**: Test fallback warning signal handling and enhance step state.

**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`

- **Action**: CREATE or MODIFY (if exists)
- Test cases:
  - `it('should set fallbackWarning when error type is fallback-warning')`
  - `it('should set errorState when error type is error or undefined')`
  - `it('should include enhance in step order')`
  - `it('should reset fallbackWarning on reset()')`
  - `it('should map warnings from GenerationCompletePayload to CompletionData')`

### Files Affected (Batch 6)

| File                                                                                                                         | Action        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.spec.ts`     | CREATE/MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.spec.ts` | CREATE/MODIFY |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`                     | CREATE/MODIFY |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`                  | CREATE/MODIFY |

---

## Integration Architecture

### Data Flow: Wizard with Enhanced Prompts

```
User clicks "Start Setup"
  |
  v
[Welcome] -> [Scan] -> [Analysis] -> [Selection]
                                          |
                                          v
                                     [Enhance] (NEW)
                                       |  |
                                       |  +-> Skip (sets status='skipped')
                                       |
                                       +-> Run EnhancedPromptsService.runWizard()
                                       |     |-> Success: status='complete', detectedStack populated
                                       |     |-> Error: status='error', error message shown, retry available
                                       |
                                       v
                                   [Generation]
                                       |-> OrchestratorService.generate({enhancedPromptContent: ...})
                                       |     Phase 3: Uses enhanced prompt in LLM system prompt
                                       |     Warnings collected for failures
                                       |
                                       v
                                   [Completion]
                                       |-> Shows warnings (if any)
                                       |-> Shows enhancedPromptsUsed flag
```

### Data Flow: Silent Fallback Elimination

```
Before (Silent):
  Error occurs -> logger.warn() -> return fallback -> user sees nothing

After (Visible):
  Error occurs -> logger.warn() -> VS Code notification -> broadcast warning ->
    frontend displays warning alert -> user informed -> fallback still executes
```

### Error Message Flow

```
Backend Error
  |
  +-> vscode.window.showWarningMessage() -- VS Code notification (R1 only)
  |
  +-> webviewManager.broadcastMessage('setup-wizard:error', {
  |     type: 'fallback-warning',
  |     message: 'Human-readable warning',
  |     details: 'Technical details'
  |   })
  |
  +-> Frontend: SetupWizardStateService.handleError()
  |     |-> if type === 'fallback-warning': set fallbackWarningSignal
  |     |-> else: set errorStateSignal
  |
  +-> Component: displays alert-warning or alert-error based on signal
```

---

## Quality Requirements

### Functional Requirements

1. All 6 silent fallbacks MUST produce visible user notifications
2. The Enhance wizard step MUST be skippable (non-blocking)
3. Enhanced prompts MUST be optional in the generation pipeline
4. Settings toggle MUST work via both VS Code Settings and webview
5. All new shared type fields MUST be optional (backward compatible)

### Non-Functional Requirements

- **Performance**: Enhanced prompts generation has 5-minute timeout (existing `acquireGenerationLock` pattern)
- **Reliability**: Fallback paths still execute; only the VISIBILITY changes
- **Testability**: All error paths covered by unit tests (Batch 6)
- **Accessibility**: Warning alerts use ARIA roles (`role="alert"` or `role="status"`)

### Pattern Compliance

- All frontend components use `ChangeDetectionStrategy.OnPush` (verified: all existing components use this)
- All state management uses Angular signals (no RxJS BehaviorSubject)
- All RPC handlers use `registerMethod` pattern with error handling
- All DI uses `tsyringe` with `Symbol.for()` tokens
- All backend error returns use `Result<T, Error>` pattern where applicable

---

## Risk Mitigations

| Risk                              | Mitigation                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| EP generation slow (5min timeout) | Skip button on Enhance step; timeout already exists in EnhancedPromptsService           |
| Breaking existing wizard flow     | All new WizardStep value is additive; existing steps unchanged                          |
| Breaking shared types consumers   | All new fields are optional; existing serialization unaffected                          |
| EP service not registered in DI   | Verify `SDK_TOKENS.ENHANCED_PROMPTS_SERVICE` exists; use lazy resolution with try/catch |
| Phase 3 regression                | Enhanced prompt content is optional; null = existing behavior preserved                 |
| Test failures in CI               | Tests mock all external dependencies; no network/LLM calls in tests                     |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both backend-developer AND frontend-developer

**Rationale**:

- Batch 1, 4, 5 (backend): RPC handlers, service modifications, DI registration -- backend-developer
- Batch 2, 3 (frontend): Angular components, state service, template rendering -- frontend-developer
- Batch 6 (tests): Split between backend and frontend test files

**Suggested assignment**:

- Batches 1 + 4 + 5: backend-developer (shared types, silent fallbacks, RPC handlers, pipeline integration)
- Batches 2 + 3: frontend-developer (warning display, new Enhance step component)
- Batch 6: whichever developer handles the relevant library

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 12-18 hours

**Breakdown**:

- Batch 1 (Shared Types + Backend Fallbacks): 3-4 hours (8 files, straightforward modifications)
- Batch 2 (Frontend Warning Display): 2-3 hours (3 files, template + state changes)
- Batch 3 (Enhance Step): 3-4 hours (5 files, new component + wizard flow changes)
- Batch 4 (Pipeline Integration): 2-3 hours (3 files, orchestrator + RPC changes)
- Batch 5 (Settings): 1-2 hours (3 files, RPC handlers + package.json)
- Batch 6 (Tests): 2-3 hours (4 test files, multiple test cases)

### Files Affected Summary

**CREATE** (2 files):

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`
- Test files (up to 4, depending on what already exists)

**MODIFY** (15+ files):

- `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\index.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `EnhancedPromptsService` from `@ptah-extension/agent-sdk` (verified: exists in agent-sdk)
   - `SDK_TOKENS` from `@ptah-extension/agent-sdk` (verified: `src/lib/di/tokens.ts`)
   - `PTAH_CORE_SYSTEM_PROMPT` from `@ptah-extension/agent-sdk` (verified: used in enhanced-prompts.service.ts)
   - `Result` from appropriate error-handling module (verified: used in orchestrator.service.ts)
   - `MESSAGE_TYPES` from `@ptah-extension/vscode-core` (verified: used in setup-rpc.handlers.ts)

2. **All patterns verified from examples**:

   - RPC handler registration: `wizard-generation-rpc.handlers.ts`
   - Signal state management: `setup-wizard-state.service.ts`
   - Standalone component with OnPush: all existing wizard step components
   - Broadcast message pattern: `setup-rpc.handlers.ts:340-349`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/backend/agent-generation/CLAUDE.md`
   - `libs/frontend/setup-wizard/CLAUDE.md`
   - `libs/shared/CLAUDE.md`

4. **No hallucinated APIs**:
   - `EnhancedPromptsService.runWizard()` -- verified exists
   - `EnhancedPromptsService.getEnhancedPromptContent()` -- verified exists (line 420)
   - `EnhancedPromptsService.setEnabled()` -- verified exists
   - `EnhancedPromptsService.getStatus()` -- verified exists
   - `PromptDesignerAgent.generateGuidance()` -- verified exists
   - `PromptDesignerAgent.generateFallbackGuidance()` -- verified exists
   - `OrchestratorService.generate()` -- verified exists
   - `VsCodeLmService.batchCustomize()` -- verified exists (line 627 of orchestrator)
   - `webviewManager.broadcastMessage()` -- verified exists (line 342 of setup-rpc.handlers)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented (data flows, error flows)
- [x] Files affected list complete (17+ files, 2 new)
- [x] Developer type recommended (backend + frontend)
- [x] Complexity assessed (HIGH, 12-18 hours)
- [x] No step-by-step implementation (that is team-leader's job)
- [x] Batch structure enables independent commits
- [x] Risk mitigations documented
