# Development Tasks - TASK_2025_149

**Total Tasks**: 24 | **Batches**: 6 | **Status**: 0/6 complete | **Current**: Batch 5 IMPLEMENTED

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `WizardStep` type union at `setup-wizard-state.service.ts:33-40` is confirmed; adding `'enhance'` is additive and backward-compatible
- `stepIndex` computed at line 462-474 uses inline `stepOrder` array; must update here AND in `wizard-view.component.ts:218-225`
- `GenerationSummary` already has `warnings: string[]` at `core.types.ts:591`; no new type needed for orchestrator warnings
- `WizardRpcService` already has `runEnhancedPromptsWizard()` and `getEnhancedPromptsStatus()` methods; no new frontend RPC methods needed for the Enhance step
- `InternalQueryService` at line 314-315 already falls back to `PTAH_CORE_SYSTEM_PROMPT` when enhanced content is null; change to `EnhancedPromptsService` is safe
- `PromptDesignerOutput` at `prompt-designer.types.ts:77-129` has no `usedFallback` field; adding as optional is backward-compatible
- `generation-progress.component.ts:704-713` has EP auto-trigger logic that must be REMOVED (not duplicated) when creating the Enhance step

### Risks Identified

| Risk                                                                                                                                                                              | Severity | Mitigation                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Two separate `stepOrder` arrays exist (state service line 464 AND wizard-view line 218) -- if one is updated but not the other, navigation breaks                                 | HIGH     | Task 3.1 and 3.3 explicitly call out both locations; developer must update BOTH         |
| `GenerationOptions` in `core.types.ts:521-548` vs local `OrchestratorGenerationOptions` in `wizard-generation-rpc.handlers.ts:62-67` -- two separate option types to keep in sync | MED      | Task 4.2 explicitly notes both types need the `enhancedPromptContent` field             |
| Removing EP auto-trigger from generation-progress.component.ts changes `isFullyComplete` logic -- could affect Continue button visibility                                         | MED      | Task 3.4 explicitly covers simplifying `isFullyComplete` to only check agent completion |
| `EnhancedPromptsRunWizardResponse` and `EnhancedPromptsGetStatusResponse` types must be confirmed in shared types                                                                 | LOW      | These types already exist and are imported in `wizard-rpc.service.ts:6-7`               |

### Edge Cases to Handle

- [ ] User skips Enhance step -> generation works with null enhanced prompts -> Handled in Task 4.2
- [ ] Agentic analysis fails AND fallback analysis fails -> must throw, not silently degrade further -> Handled in Task 1.3
- [ ] `enhancedPromptsService` DI resolution fails in wizard-generation-rpc.handlers.ts -> must use try/catch pattern -> Handled in Task 4.1
- [ ] Concurrent enhanced prompt generation (wizard + settings) -> existing generation lock prevents this -> Documented in Task 5.1

---

## Batch 1: Shared Types & Backend Silent Fallback Elimination -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None
**Status**: IMPLEMENTED

### Task 1.1: Add shared type fields for warnings, fallback tracking, and error categorization

**File(s)**: `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`
**Action**: MODIFY
**Requirements**: R2, R12, R1

**What to do**:

- Add `warnings?: string[]` field to `GenerationCompletePayload` interface (line 837-846). This carries Phase 3 customization warnings to the frontend.
- Add `enhancedPromptsUsed?: boolean` field to `GenerationCompletePayload` interface. This tells the frontend whether enhanced prompts were active during generation.
- Add `type?: 'error' | 'fallback-warning'` field to `WizardErrorPayload` interface (line 852-857). This allows the frontend to distinguish real errors from degraded-mode warnings.
- All new fields MUST be optional to preserve backward compatibility with existing consumers and the exhaustive switch in `SetupWizardStateService`.

**Acceptance Criteria**:

- [ ] `GenerationCompletePayload` has `warnings?: string[]` field
- [ ] `GenerationCompletePayload` has `enhancedPromptsUsed?: boolean` field
- [ ] `WizardErrorPayload` has `type?: 'error' | 'fallback-warning'` field
- [ ] All fields are optional (no breaking changes)
- [ ] TypeScript compiles without errors: `npx nx run shared:typecheck`

---

### Task 1.2: Add fallback tracking fields to PromptDesignerOutput and PromptGenerationStatus

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`
**Action**: MODIFY
**Requirements**: R3, R4

**What to do**:

- Add `usedFallback?: boolean` to the `PromptDesignerOutput` interface (after line 129, before `generatedAt`). This flags when template-based fallback guidance was returned instead of LLM-generated guidance.
- Add `fallbackReason?: string` to the `PromptDesignerOutput` interface. This contains the specific reason for fallback (e.g., "LLM service not available", "Rate limit exceeded").
- Add `'fallback'` to the `PromptGenerationStatus` type union (line 180-185). Currently: `'idle' | 'analyzing' | 'generating' | 'complete' | 'error'`. Change to: `'idle' | 'analyzing' | 'generating' | 'complete' | 'error' | 'fallback'`.

**Acceptance Criteria**:

- [ ] `PromptDesignerOutput` has `usedFallback?: boolean` field
- [ ] `PromptDesignerOutput` has `fallbackReason?: string` field
- [ ] `PromptGenerationStatus` includes `'fallback'` in the union
- [ ] TypeScript compiles: `npx nx run agent-sdk:typecheck`

---

### Task 1.3: Fix R1 - Make agentic analysis fallback visible to user

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Action**: MODIFY
**Requirements**: R1

**What to do**:

- In the fallback region (lines 316-326), after the existing `this.logger.warn(...)` call, add a VS Code warning notification: `vscode.window.showWarningMessage('AI-powered analysis unavailable. Using quick analysis mode -- results may be less detailed.');`
- After the VS Code notification, broadcast a `setup-wizard:error` message with fallback-warning type to the webview. Use the existing `webviewManager` that is already resolved at line 329-337. The broadcast should be: `webviewManager.broadcastMessage(MESSAGE_TYPES.SETUP_WIZARD_ERROR, { type: 'fallback-warning', message: 'AI-powered analysis unavailable. Using quick analysis mode -- results may be less detailed.', details: error instanceof Error ? error.message : String(error) })` -- wrapped in try/catch for best-effort broadcasting.
- The existing DeepProjectAnalysisService fallback (line 358+) MUST still execute. This change only adds visibility, not changes to fallback behavior.
- Move the webviewManager resolution (lines 329-337) to BEFORE the warning broadcast (currently it's after the warning log but before the scan-progress broadcast; just ensure it's available for both uses).

**Acceptance Criteria**:

- [ ] When agentic analysis fails, a VS Code warning notification appears
- [ ] A `setup-wizard:error` message with `type: 'fallback-warning'` is broadcast to the webview
- [ ] The DeepProjectAnalysisService fallback still executes after the warning
- [ ] The scan-progress broadcast at line 340-349 still works
- [ ] TypeScript compiles: `npx nx run ptah-extension-vscode:typecheck`

---

### Task 1.4: Fix R2 - Include warnings in generation completion payload

**File(s)**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
  **Action**: MODIFY
  **Requirements**: R2

**What to do**:

**orchestrator.service.ts** (lines 637-654):

- In the section results loop where individual section failures are handled, add per-section warnings to the `warnings` array. Currently warnings are only added at the Phase 3 top-level failure (line 282-283). For the per-section loop (lines 637-654):
  - For `LlmValidationFallbackError` (line 638): add `warnings.push(\`Section '${sectionId}' for agent '${agentId}' customization failed (validation): using generic content\`);`
  - For real errors (line 648): add `warnings.push(\`Section '${sectionId}' for agent '${agentId}' customization failed (infrastructure): using generic content\`);`
- Verify that `warnings` is already included in the returned `GenerationSummary`. It is -- `GenerationSummary.warnings` at `core.types.ts:591` already exists and the orchestrator already populates it.

**wizard-generation-rpc.handlers.ts** (line 331-337):

- In the `registerSubmitSelection` method, when building the `GenerationCompletePayload` at line 331, add the new fields:
  - Change `errors: summary.warnings.length > 0 ? summary.warnings : undefined` to also populate `warnings: summary.warnings.length > 0 ? summary.warnings : undefined` (the field name changes from `errors` to `warnings` for semantic correctness, but keep `errors` too for backward compatibility).
- The `GenerationCompletePayload` already has `errors?: string[]` being populated with `summary.warnings`. Now also populate the new `warnings?: string[]` field from Task 1.1.

**Acceptance Criteria**:

- [ ] Per-section customization failures produce distinct warning strings in `GenerationSummary.warnings`
- [ ] Warning strings include section ID, agent ID, and error type (validation vs infrastructure)
- [ ] `GenerationCompletePayload.warnings` is populated from `GenerationSummary.warnings`
- [ ] Existing generation behavior is unchanged (empty-string fallback still used for failed sections)
- [ ] TypeScript compiles for both projects

---

### Task 1.5: Fix R3 & R4 - Add fallback tracking to PromptDesignerAgent

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`
**Action**: MODIFY
**Requirements**: R3, R4

**What to do**:

**R3 fix (lines 208-212)** - When `!this.llmService.hasProvider()`:

- Before calling `return this.generateFallbackGuidance(input, qualityAssessment)`, emit a progress callback: `onProgress?.({ status: 'fallback', message: 'LLM provider unavailable. Using template-based guidance.' });`
- Pass `'LLM service not available'` as the fallbackReason to `generateFallbackGuidance`.

**R4 fix (lines 273-285)** - In the catch block:

- Change the `onProgress` call (line 278-282) from `status: 'error'` to `status: 'fallback'` since this is a non-fatal fallback, not a fatal error.
- Pass `error instanceof Error ? error.message : 'Unknown error'` as the fallbackReason to `generateFallbackGuidance`.

**generateFallbackGuidance method** (find it in the same file, likely around line 300+):

- Add a `fallbackReason?: string` parameter to the method signature.
- On the returned `PromptDesignerOutput`, set `usedFallback: true` and `fallbackReason: fallbackReason ?? 'Fallback guidance generated'`.

**Acceptance Criteria**:

- [ ] When `hasProvider()` returns false, the returned output has `usedFallback: true` and `fallbackReason: 'LLM service not available'`
- [ ] When LLM call throws an error, the returned output has `usedFallback: true` and `fallbackReason` containing the error message
- [ ] Progress callbacks emit `status: 'fallback'` (not `'error'`) for non-fatal fallbacks
- [ ] When LLM succeeds, `usedFallback` is NOT set (or is undefined)
- [ ] TypeScript compiles: `npx nx run agent-sdk:typecheck`

---

### Task 1.6: Fix R5 - Return null from getEnhancedPromptContent when no generated prompt exists

**File(s)**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
  **Action**: MODIFY
  **Requirements**: R5

**What to do**:

**enhanced-prompts.service.ts** (lines 434-436):

- Replace `return PTAH_CORE_SYSTEM_PROMPT;` with `return null;`
- Add a log line before the null return: `this.logger.info('Enhanced prompts enabled but no generated prompt available. Run the setup wizard to generate enhanced prompts.', { workspacePath });`
- Update the JSDoc for the method to document that `null` means "enabled but no prompt generated yet".

**internal-query.service.ts** (lines 306-319):

- The code at line 314-315 already handles null by using `PTAH_CORE_SYSTEM_PROMPT` as fallback. This is correct.
- Add an explicit info log at the else branch (line 315 area): `this.logger.info('Enhanced prompt not generated yet, using PTAH_CORE_SYSTEM_PROMPT. Run the setup wizard Enhance step to generate.', { cwd: config.cwd });`
- No behavioral change needed -- the caller already falls back correctly. We're just making it visible in logs.

**Acceptance Criteria**:

- [ ] `getEnhancedPromptContent()` returns `null` (not `PTAH_CORE_SYSTEM_PROMPT`) when enabled but no generated prompt exists
- [ ] `getEnhancedPromptContent()` still returns the generated prompt when it exists
- [ ] `getEnhancedPromptContent()` still returns `null` when disabled
- [ ] `InternalQueryService` logs an info message when falling back to `PTAH_CORE_SYSTEM_PROMPT`
- [ ] End-user behavior is unchanged (still gets PTAH_CORE as fallback via caller)
- [ ] TypeScript compiles: `npx nx run agent-sdk:typecheck`

---

**Batch 1 Verification**:

- All 6 files modified exist at specified paths
- Build passes: `npx nx run shared:typecheck && npx nx run agent-sdk:typecheck && npx nx run ptah-extension-vscode:typecheck`
- code-logic-reviewer approved
- No stubs, TODOs, or placeholder code

---

## Batch 2: Frontend Fallback Warning Display -- IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (shared types with `type` field on WizardErrorPayload, `warnings` on GenerationCompletePayload)
**Status**: IMPLEMENTED

### Task 2.1: Display fallback warning in ScanProgressComponent and state service

**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
  **Action**: MODIFY
  **Requirements**: R1 (frontend portion)

**What to do**:

**setup-wizard-state.service.ts**:

- Add a new private signal: `private readonly fallbackWarningSignal = signal<string | null>(null);`
- Add public readonly: `readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();`
- Add a mutation method: `setFallbackWarning(warning: string | null): void { this.fallbackWarningSignal.set(warning); }`
- Modify the `handleError` method (line 1019-1027): Check `payload.type`. If `payload.type === 'fallback-warning'`, call `this.setFallbackWarning(payload.message)` instead of `this.errorStateSignal.set(...)`. If `payload.type` is undefined or `'error'`, keep existing behavior (set errorState).
- In the `reset()` method, add `this.fallbackWarningSignal.set(null);` to clear fallback warnings on reset.

**scan-progress.component.ts**:

- Add a reference to the fallback warning signal: `protected readonly fallbackWarning = this.wizardState.fallbackWarning;` (wizardState is already injected as `SetupWizardStateService`).
- Add a template block BEFORE the existing error alert block. Use DaisyUI `alert alert-warning` class:

```html
@if (fallbackWarning()) {
<div class="alert alert-warning mb-4" role="status">
  <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
  <span>{{ fallbackWarning() }}</span>
</div>
}
```

- The warning must persist on screen and NOT block wizard progression.

**Acceptance Criteria**:

- [ ] Fallback warning signal exists in state service with getter and setter
- [ ] `handleError` routes `type: 'fallback-warning'` messages to fallbackWarning signal (not errorState)
- [ ] `handleError` routes `type: undefined` or `type: 'error'` messages to errorState (existing behavior)
- [ ] ScanProgressComponent displays a yellow/amber warning alert when fallbackWarning is set
- [ ] Warning is visually distinct from error (alert-warning vs alert-error)
- [ ] Warning does not block wizard progression
- [ ] `reset()` clears the fallback warning

---

### Task 2.2: Display generation warnings and enhanced prompts status in CompletionComponent

**File(s)**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`
  **Action**: MODIFY
  **Requirements**: R2 (frontend), R12

**What to do**:

**setup-wizard-state.service.ts**:

- Update `CompletionData` interface (line 117-122) to add: `warnings?: string[]` and `enhancedPromptsUsed?: boolean`.
- Update `handleGenerationComplete` method (line 1000-1011) to map the new fields from `GenerationCompletePayload`: `warnings: payload.warnings, enhancedPromptsUsed: payload.enhancedPromptsUsed`.

**completion.component.ts**:

- Add computed signals:
  - `protected readonly warnings = computed(() => this.wizardState.completionData()?.warnings ?? []);`
  - `protected readonly hasWarnings = computed(() => this.warnings().length > 0);`
  - `protected readonly enhancedPromptsUsed = computed(() => this.wizardState.completionData()?.enhancedPromptsUsed ?? false);`
- Add a warnings section in the template. Use a DaisyUI `collapse` component that only renders when `hasWarnings()` is true:

```html
@if (hasWarnings()) {
<div class="collapse collapse-arrow bg-warning/10 border border-warning/20 rounded-box mt-4">
  <input type="checkbox" />
  <div class="collapse-title text-sm font-medium text-warning">{{ warnings().length }} warning(s) during generation</div>
  <div class="collapse-content">
    <ul class="list-disc list-inside text-sm text-base-content/70">
      @for (warning of warnings(); track $index) {
      <li>{{ warning }}</li>
      }
    </ul>
  </div>
</div>
}
```

- Add an enhanced prompts status indicator:

```html
@if (enhancedPromptsUsed()) {
<div class="badge badge-success badge-sm gap-1 mt-2">Enhanced prompts applied</div>
} @else {
<div class="badge badge-ghost badge-sm gap-1 mt-2">Standard prompts used</div>
}
```

- Warnings and badges do NOT block the "Close" or "Open Files" actions.

**Acceptance Criteria**:

- [ ] `CompletionData` interface includes `warnings?: string[]` and `enhancedPromptsUsed?: boolean`
- [ ] `handleGenerationComplete` maps the new payload fields to CompletionData
- [ ] Warnings section only appears when warnings exist
- [ ] Each warning is shown as a readable list item
- [ ] Enhanced prompts status badge is shown on completion screen
- [ ] Warnings section is collapsible (not overwhelming the success state)

---

**Batch 2 Verification**:

- All modified files exist
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- Warning display is visually distinct from errors

---

## Batch 3: Prompt Enhancement Wizard Step -- IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2 (state service already has fallbackWarning, enhanced prompts signals already exist)
**Status**: IMPLEMENTED

### Task 3.1: Add 'enhance' to WizardStep type and update computed signals

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
**Action**: MODIFY
**Requirements**: R6

**What to do**:

- Add `'enhance'` to the `WizardStep` type union (line 33-40). New type: `'premium-check' | 'welcome' | 'scan' | 'analysis' | 'selection' | 'enhance' | 'generation' | 'completion'`
- Update the `stepIndex` computed signal's `stepOrder` array (line 464-472) to include `'enhance'` after `'selection'`: `['premium-check', 'welcome', 'scan', 'analysis', 'selection', 'enhance', 'generation', 'completion']`
- Update `percentComplete` computed signal's `stepProgress` record (line 446-454) to include: `enhance: 55` (between selection:50 and generation:65)
- Update `canProceed` computed signal (line 416-436) to add: `case 'enhance': return false;` -- the Enhance step manages its own Continue button, not the generic canProceed logic.

**IMPORTANT**: The `stepOrder` array in `wizard-view.component.ts:218-225` is a SEPARATE array that must ALSO be updated. That is handled in Task 3.3. Both must match.

**Acceptance Criteria**:

- [ ] `WizardStep` type includes `'enhance'`
- [ ] `stepIndex` computed returns correct 0-based index for all 8 steps (including enhance)
- [ ] `percentComplete` returns 55 for the enhance step
- [ ] `canProceed` returns false for the enhance step
- [ ] TypeScript compiles with no errors

---

### Task 3.2: Create PromptEnhancementComponent (new wizard step)

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`
**Action**: CREATE
**Requirements**: R7

**What to do**:

- Create a new standalone Angular component with `ChangeDetectionStrategy.OnPush`.
- Selector: `ptah-prompt-enhancement`
- Inject: `SetupWizardStateService` (as `wizardState`) and `WizardRpcService` (as `wizardRpc`)
- Use existing state signals: `wizardState.enhancedPromptsStatus`, `wizardState.enhancedPromptsError`, `wizardState.enhancedPromptsDetectedStack`
- Auto-trigger enhanced prompts generation on component init using an `effect()` that checks if status is `'idle'` and triggers `triggerEnhancedPrompts()` (same pattern as the existing code at generation-progress.component.ts:704-713, but adapted).
- The `triggerEnhancedPrompts()` method should:
  1. Set status to `'generating'` via `wizardState.setEnhancedPromptsStatus('generating')`
  2. Call `wizardRpc.runEnhancedPromptsWizard('.')` (workspace path)
  3. On success: set status to `'complete'`, populate detected stack labels
  4. On error: set status to `'error'`, set error message
- Computed signals:
  - `status = this.wizardState.enhancedPromptsStatus`
  - `errorMsg = this.wizardState.enhancedPromptsError`
  - `detectedStack = computed(() => this.wizardState.enhancedPromptsDetectedStack() ?? [])`
  - `canContinue = computed(() => { const s = this.status(); return s === 'complete' || s === 'error' || s === 'skipped'; })`
- Template structure (use DaisyUI patterns matching existing wizard components):
  - Header: "Enhance Your Prompts" title with subtitle
  - Status card using `@switch (status())`:
    - `'idle'` / `'generating'`: Spinner with "Generating project-specific guidance..." message
    - `'complete'`: Success message with detected stack badges (each framework/language as a DaisyUI badge)
    - `'error'`: Error alert with error message, "Retry" button
    - `'skipped'`: "Skipped" badge
  - Footer buttons: "Skip" (always visible, btn-ghost) and "Continue to Generation" (btn-primary, disabled until canContinue)
- Skip handler: `onSkip()` sets `wizardState.setEnhancedPromptsStatus('skipped')` then `wizardState.setCurrentStep('generation')`
- Continue handler: `onContinue()` calls `wizardState.setCurrentStep('generation')`
- Retry handler: `onRetry()` resets status to `'idle'` (which retriggers the effect)

**Acceptance Criteria**:

- [ ] Component file exists at the specified path
- [ ] Component is standalone with OnPush change detection
- [ ] Auto-triggers enhanced prompts on init
- [ ] Displays progress spinner during generation
- [ ] Shows detected stack on success
- [ ] Shows error with retry on failure
- [ ] Skip button works (sets status to 'skipped', advances to generation)
- [ ] Continue button disabled until generation complete/error/skipped
- [ ] No `// TODO` or placeholder comments

---

### Task 3.3: Wire the Enhance step into WizardViewComponent

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`
**Action**: MODIFY
**Requirements**: R6

**What to do**:

- Import `PromptEnhancementComponent` from `'./prompt-enhancement.component'`
- Add `PromptEnhancementComponent` to the `imports` array in the `@Component` decorator (alongside WelcomeComponent, ScanProgressComponent, etc.)
- Add a new `@case ('enhance')` block in the `@switch (currentStep())` template (between `@case ('selection')` at line 197 and `@case ('generation')` at line 198):

```html
} @case ('enhance') { <ptah-prompt-enhancement />
```

- Update the `stepOrder` array at line 218-225 to include `'enhance'` after `'selection'`:

```typescript
private readonly stepOrder: WizardStep[] = [
  'welcome', 'scan', 'analysis', 'selection', 'enhance', 'generation', 'completion',
];
```

- Add a new step `<li>` in the stepper UI (between the "Select" step at line 154-163 and the "Generate" step at line 164-173). The new step should be "Enhance" with the same pattern as existing steps, using `stepIndex() >= 4` for primary class (all subsequent indices shift by 1):
  - "Select" stays at index 3
  - NEW "Enhance" at index 4
  - "Generate" becomes index 5 (was 4)
  - "Complete" becomes index 6 (was 5)
- Update the `canNavigateToStep` usage for all steps after Enhance (their indices shift by 1).

**Acceptance Criteria**:

- [ ] `PromptEnhancementComponent` is imported and in the imports array
- [ ] `@case ('enhance')` renders `<ptah-prompt-enhancement />`
- [ ] Stepper UI shows 7 steps: Welcome, Scan, Analysis, Select, Enhance, Generate, Complete
- [ ] Step indices are correct (Enhance=4, Generate=5, Complete=6)
- [ ] `stepOrder` array matches the state service's stepOrder (both have 'enhance')
- [ ] Navigation between steps works correctly

---

### Task 3.4: Remove EP auto-trigger from GenerationProgressComponent

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
**Action**: MODIFY
**Requirements**: R6 (removing duplicated responsibility)

**What to do**:

- Remove the `enhancedPromptsTriggered` field (line 594)
- Remove the `enhancedPromptsEffect` effect (lines 704-713)
- Remove the `triggerEnhancedPrompts()` private method (lines 719+, approximately 20-30 lines)
- Remove the `onRetryEnhancedPrompts()` method if it exists
- Simplify the `isFullyComplete` computed signal (lines 681-687). Since the Enhance step now runs BEFORE generation, the generation step no longer needs to wait for EP completion. Change to:

```typescript
protected readonly isFullyComplete = computed(() => {
  return this.wizardState.isGenerationComplete();
});
```

- KEEP the Enhanced Prompts status display signals (`enhancedPromptsStatus`, `enhancedPromptsErrorMsg`, `enhancedPromptsStack` at lines 661-675) -- these can stay as read-only status indicators showing what happened in the Enhance step. But if there is a template section that triggers EP or shows retry buttons for EP, remove those trigger/retry parts and keep only the read-only status display.

**Acceptance Criteria**:

- [ ] No `enhancedPromptsTriggered` field exists
- [ ] No `enhancedPromptsEffect` effect exists
- [ ] No `triggerEnhancedPrompts` method exists
- [ ] `isFullyComplete` only depends on `isGenerationComplete()` (not EP status)
- [ ] The EP status display signals are kept for read-only display
- [ ] TypeScript compiles: `npx nx build setup-wizard`

---

### Task 3.5: Export PromptEnhancementComponent from library barrel

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\index.ts`
**Action**: MODIFY
**Requirements**: R6

**What to do**:

- Add export for the new component. Insert after the "Wizard Components (Steps 4-6)" section (around line 14-16):

```typescript
export { PromptEnhancementComponent } from './lib/components/prompt-enhancement.component';
```

- Place it logically between the Steps 4-6 exports and the Utility Components exports.

**Acceptance Criteria**:

- [ ] `PromptEnhancementComponent` is exported from the library barrel
- [ ] Library builds successfully: `npx nx build setup-wizard`

---

**Batch 3 Verification**:

- New component file exists at `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\prompt-enhancement.component.ts`
- All modified files compile
- Build passes: `npx nx build setup-wizard`
- code-logic-reviewer approved
- Wizard flow: Welcome -> Scan -> Analysis -> Selection -> Enhance -> Generation -> Complete

---

## Batch 4: Enhanced Prompts RPC Handler & Generation Pipeline Integration -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (shared types, orchestrator warning propagation)
**Status**: IMPLEMENTED

### Task 4.1: Add wizard:generate-enhanced-prompt RPC handler -- VERIFIED EXISTING

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Action**: MODIFY
**Requirements**: R8

**What to do**:

- NOTE: The `WizardRpcService` frontend already calls `enhancedPrompts:runWizard` (not `wizard:generate-enhanced-prompt`). Check whether this handler already exists in the codebase by searching for `enhancedPrompts:runWizard` in the backend RPC handler files. If it already exists, this task may only need verification. If it does NOT exist, register it here.
- Add a new RPC handler method to the `register()` method. Register a new private method `registerEnhancedPromptGeneration()` and call it from `register()`.
- The handler name should match what the frontend calls: `enhancedPrompts:runWizard` (this is what `WizardRpcService.runEnhancedPromptsWizard()` calls at wizard-rpc.service.ts:185).
- Handler logic:
  1. Check workspace folder: `const workspaceFolder = vscode.workspace.workspaceFolders?.[0]; if (!workspaceFolder) return { success: false, error: 'No workspace folder open.' };`
  2. Resolve `EnhancedPromptsService` from DI: `this.resolveService<EnhancedPromptsServiceInterface>(SDK_TOKENS.ENHANCED_PROMPTS_SERVICE, 'EnhancedPromptsService')` -- you'll need to import `SDK_TOKENS` from `@ptah-extension/agent-sdk` and define a local interface `EnhancedPromptsServiceInterface` with `runWizard(workspacePath: string): Promise<any>`.
  3. Call `enhancedPromptsService.runWizard(workspaceFolder.uri.fsPath)`
  4. Return `{ success: true, detectedStack: result.detectedStack }` on success
  5. Return `{ success: false, error: error.message }` on failure
  6. Use try/catch with the same error handling pattern as `registerSubmitSelection`.
- Add `'enhancedPrompts:runWizard'` to the methods list logged in `register()` method (line 170-175).

**Acceptance Criteria**:

- [x] An `enhancedPrompts:runWizard` RPC handler is registered (VERIFIED: exists in enhanced-prompts-rpc.handlers.ts:161)
- [x] It resolves `EnhancedPromptsService` from the DI container (via constructor injection)
- [x] It calls `runWizard()` with the workspace path
- [x] It returns success/failure response matching `EnhancedPromptsRunWizardResponse` shape
- [x] It handles missing workspace folder
- [x] It handles DI resolution failure gracefully
- [x] TypeScript compiles

---

### Task 4.2: Wire enhanced prompts into orchestrator Phase 3 -- IMPLEMENTED

**File(s)**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
  **Action**: MODIFY
  **Requirements**: R11, R12

**What to do**:

**orchestrator.service.ts**:

- Add `enhancedPromptContent?: string` to the `OrchestratorGenerationOptions` interface (or the method parameter, wherever options are defined -- check the `generateAgents` method signature). Also update the local `OrchestratorGenerationOptions` interface in wizard-generation-rpc.handlers.ts to match.
- In the `customizeAgents()` method (or wherever the system prompt for Phase 3 LLM calls is built), if `options.enhancedPromptContent` is provided and non-null, prepend it to the system prompt as a "Project Context" section. Format: `"## Project Context\n\n" + enhancedPromptContent + "\n\n"` before the existing prompt content.
- When enhanced prompts are used, the generation should track this. Either add `enhancedPromptsUsed` to `GenerationSummary` or return it separately. The simplest approach: add `enhancedPromptsUsed?: boolean` to `GenerationSummary` in `core.types.ts`.

**wizard-generation-rpc.handlers.ts**:

- In `registerSubmitSelection`, before calling `orchestrator.generateAgents(options, progressCallback)`:
  1. Try to resolve `EnhancedPromptsService` from DI (use try/catch, same pattern as Task 4.1)
  2. If resolved, call `getEnhancedPromptContent(workspaceFolder.uri.fsPath)`
  3. If content is returned (non-null), add it to `options.enhancedPromptContent`
  4. If resolution or getContent fails, log a warning and proceed without enhanced prompts (this is optional/non-blocking)
- Update the local `OrchestratorGenerationOptions` interface (line 62-67) to include `enhancedPromptContent?: string`
- In the `GenerationCompletePayload` building (line 331), add: `enhancedPromptsUsed: !!options.enhancedPromptContent` (or from `summary.enhancedPromptsUsed` if tracked in GenerationSummary)

**core.types.ts**:

- Add `enhancedPromptsUsed?: boolean` to `GenerationSummary` interface (line 566-597).

**Acceptance Criteria**:

- [x] `OrchestratorGenerationOptions` accepts `enhancedPromptContent?: string`
- [x] When enhanced prompt content is provided, it is prepended to Phase 3 LLM system prompt
- [x] When enhanced prompt content is null/undefined, Phase 3 works exactly as before (no regression)
- [x] `GenerationCompletePayload` includes `enhancedPromptsUsed` flag
- [x] Enhanced prompts resolution failure is non-blocking (logs warning, continues without)
- [x] TypeScript compiles for both projects

---

### Task 4.3: Add enhancedPrompts:getStatus RPC handler (if not already registered) -- VERIFIED EXISTING

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Action**: MODIFY
**Requirements**: R10 (partial -- status handler)

**What to do**:

- Search the codebase for an existing `enhancedPrompts:getStatus` RPC handler. The frontend `WizardRpcService.getEnhancedPromptsStatus()` calls this at wizard-rpc.service.ts:209.
- If the handler already exists (registered elsewhere in setup-rpc.handlers.ts or another file), document where it is and skip creation.
- If it does NOT exist, register it in `WizardGenerationRpcHandlers`:
  1. Resolve `EnhancedPromptsService` from DI
  2. Call `getStatus(workspacePath)` or equivalent method
  3. Return `EnhancedPromptsGetStatusResponse` shape: `{ enabled, hasGeneratedPrompt, generatedAt, detectedStack, cacheValid }`
  4. Handle errors gracefully

**Acceptance Criteria**:

- [x] `enhancedPrompts:getStatus` RPC handler exists (VERIFIED: exists in enhanced-prompts-rpc.handlers.ts:95)
- [x] It returns the enhanced prompts status for the current workspace
- [x] It handles errors gracefully (returns default response on failure)

---

**Batch 4 Verification**:

- All modified files compile
- Build passes: `npx nx run ptah-extension-vscode:typecheck && npx nx run agent-generation:typecheck`
- code-logic-reviewer approved
- Enhanced prompts flow: Enhance step -> generation uses enhanced prompt content -> completion shows enhancedPromptsUsed

---

## Batch 5: Settings UI & Prompt Harness Toggle -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 4 (RPC handlers for enhanced prompts)
**Status**: IMPLEMENTED

### Task 5.1: Add settings RPC handlers for enhanced prompts

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
**Action**: MODIFY
**Requirements**: R10, R10a

**What to do**:

- Register additional RPC handlers for settings operations. Add new private methods and call them from `register()`:
  - `enhancedPrompts:toggle` -- payload: `{ workspacePath: string, enabled: boolean }`. Calls `EnhancedPromptsService.setEnabled(workspacePath, enabled)`. Returns `{ success: true }` or `{ success: false, error: string }`.
  - `enhancedPrompts:regenerate` -- payload: `{ workspacePath: string }`. Calls `EnhancedPromptsService.runWizard(workspacePath)` (same as the wizard handler but callable from settings). Returns `EnhancedPromptsRunWizardResponse`.
  - `enhancedPrompts:getPromptContent` -- payload: `{ workspacePath: string }`. Calls `EnhancedPromptsService.getEnhancedPromptContent(workspacePath)`. Returns `{ content: string | null }`.
  - `enhancedPrompts:download` -- payload: `{ workspacePath: string }`. Gets the prompt content, then uses `vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file('enhanced-prompt.md'), filters: { 'Markdown': ['md'] } })` to let the user save it. Writes the content to the selected file using `vscode.workspace.fs.writeFile()`. Returns `{ success: true, filePath: string }` or `{ success: false, error: string }`.
- All handlers should use the same `resolveService` pattern with try/catch.
- All handlers should check for workspace folder availability.
- The `regenerate` handler should respect the existing generation lock in `EnhancedPromptsService` (the service handles this internally).

**Acceptance Criteria**:

- [x] `enhancedPrompts:toggle` handler registered and working (VERIFIED: pre-existing as `enhancedPrompts:setEnabled` in enhanced-prompts-rpc.handlers.ts:244)
- [x] `enhancedPrompts:regenerate` handler registered and working (VERIFIED: pre-existing in enhanced-prompts-rpc.handlers.ts:306)
- [x] `enhancedPrompts:getPromptContent` handler registered and returning prompt content or null (NEW: added to enhanced-prompts-rpc.handlers.ts)
- [x] `enhancedPrompts:download` handler registered, opens save dialog, writes .md file (NEW: added to enhanced-prompts-rpc.handlers.ts)
- [x] All handlers validate workspace path
- [x] All handlers use try/catch with error logging
- [x] TypeScript compiles

---

### Task 5.2: Add VS Code settings contribution for enhanced prompts

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Action**: MODIFY
**Requirements**: R9 (partial -- VS Code settings integration)

**What to do**:

- In the `contributes.configuration.properties` section, add a new setting:

```json
"ptah.enhancedPrompts.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable project-specific enhanced prompts (requires Pro license). When enabled, Ptah generates custom guidance based on your codebase to improve AI responses.",
  "scope": "resource"
}
```

- The `"scope": "resource"` ensures it can be set per-workspace (since enhanced prompts are per-workspace).
- This allows users to toggle enhanced prompts via VS Code Settings UI as well as the webview settings.

**Acceptance Criteria**:

- [x] `ptah.enhancedPrompts.enabled` setting exists in package.json contributes.configuration
- [x] Default value is `true`
- [x] Description is user-friendly
- [x] Scope is `"resource"` for per-workspace configuration

---

### Task 5.3: Add frontend RPC methods for settings operations

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
**Action**: MODIFY
**Requirements**: R10, R10a

**What to do**:

- Add new methods to `WizardRpcService` for settings functionality:
  - `async toggleEnhancedPrompts(workspacePath: string, enabled: boolean): Promise<void>` -- calls `enhancedPrompts:toggle`
  - `async regenerateEnhancedPrompts(workspacePath: string): Promise<EnhancedPromptsRunWizardResponse>` -- calls `enhancedPrompts:regenerate` with a long timeout (5 minutes)
  - `async getEnhancedPromptContent(workspacePath: string): Promise<string | null>` -- calls `enhancedPrompts:getPromptContent`
  - `async downloadEnhancedPrompt(workspacePath: string): Promise<{ success: boolean; filePath?: string; error?: string }>` -- calls `enhancedPrompts:download`
- Each method should follow the same pattern as existing methods (call `this.rpcService.call()`, check `result.isSuccess()`, throw on failure for void methods, return data for non-void methods).
- Import any additional types needed from `@ptah-extension/shared`.

**Acceptance Criteria**:

- [x] `toggleEnhancedPrompts()` method exists and calls the correct RPC (`enhancedPrompts:setEnabled`)
- [x] `regenerateEnhancedPrompts()` method exists with 5-minute timeout
- [x] `getEnhancedPromptContent()` method exists and returns string or null
- [x] `downloadEnhancedPrompt()` method exists and returns success/failure
- [x] All methods follow existing error handling patterns
- [x] TypeScript compiles: `npx nx typecheck setup-wizard` passes

---

**Batch 5 Verification**:

- All modified files compile
- Build passes: `npx nx run ptah-extension-vscode:typecheck && npx nx build setup-wizard`
- code-logic-reviewer approved
- Settings RPC handlers work end-to-end

---

## Batch 6: Tests & Verification

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batches 1-5 (all implementation complete)

### Task 6.1: PromptDesignerAgent fallback tracking tests

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.spec.ts`
**Action**: CREATE or MODIFY (if exists)
**Requirements**: R13

**What to do**:

- Write unit tests for the fallback tracking behavior added in Task 1.5:
  - `it('should set usedFallback=true when LLM provider is unavailable')` -- mock `llmService.hasProvider()` to return false, verify output has `usedFallback: true` and `fallbackReason: 'LLM service not available'`
  - `it('should set usedFallback=true with error reason when LLM call fails')` -- mock LLM to throw an error, verify output has `usedFallback: true` and `fallbackReason` containing the error message
  - `it('should emit fallback progress status when falling back')` -- verify `onProgress` callback receives `{ status: 'fallback' }` (not `'error'`)
  - `it('should NOT set usedFallback when LLM succeeds')` -- mock successful LLM response, verify output does NOT have `usedFallback: true`
  - `it('should include fallbackReason in output when LLM errors')` -- verify the reason string matches the thrown error
- Use Jest mocking for `llmService` and `onProgress` callback.
- Follow existing test patterns in the agent-sdk library.

**Acceptance Criteria**:

- [ ] Test file exists with 5+ test cases
- [ ] All tests pass: `npx nx test agent-sdk --testPathPattern=prompt-designer-agent`
- [ ] Tests mock LLM service correctly
- [ ] Tests verify both `usedFallback` and `fallbackReason` fields
- [ ] Tests verify progress callback status

---

### Task 6.2: EnhancedPromptsService null-return tests

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.spec.ts`
**Action**: CREATE or MODIFY (if exists)
**Requirements**: R13

**What to do**:

- Write unit tests for the null-return behavior added in Task 1.6:
  - `it('should return null when enabled but no generated prompt exists')` -- mock state with enabled=true, generatedPrompt=null. Verify return is `null` (not `PTAH_CORE_SYSTEM_PROMPT`).
  - `it('should return generated prompt when available')` -- mock state with enabled=true, generatedPrompt='some content'. Verify returns 'some content'.
  - `it('should return null when disabled')` -- mock state with enabled=false. Verify returns null.
  - `it('should log when returning null for enabled workspace')` -- verify logger.info is called with the expected message.
- Mock the internal `loadState` method and logger.

**Acceptance Criteria**:

- [ ] Test file exists with 4+ test cases
- [ ] All tests pass: `npx nx test agent-sdk --testPathPattern=enhanced-prompts.service`
- [ ] Tests verify null return (not PTAH_CORE_SYSTEM_PROMPT) for enabled-but-no-prompt
- [ ] Tests verify logging behavior

---

### Task 6.3: OrchestratorService warning propagation tests

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`
**Action**: CREATE or MODIFY (if exists)
**Requirements**: R13

**What to do**:

- Write unit tests for warning propagation added in Task 1.4 and pipeline integration from Task 4.2:
  - `it('should include warnings in summary when Phase 3 customization fails')` -- mock Phase 3 to return an error result, verify `GenerationSummary.warnings` contains the failure message
  - `it('should include per-section warnings for individual section failures')` -- mock individual section results with mixed success/failure, verify warnings contain section-specific messages
  - `it('should include enhancedPromptsUsed flag when enhanced content provided')` -- pass `enhancedPromptContent` in options, verify `summary.enhancedPromptsUsed === true`
  - `it('should work without enhanced prompts (backward compatible)')` -- do NOT pass `enhancedPromptContent`, verify generation works as before and `enhancedPromptsUsed` is false/undefined

**Acceptance Criteria**:

- [ ] Test file exists with 4+ test cases
- [ ] All tests pass: `npx nx test agent-generation --testPathPattern=orchestrator.service`
- [ ] Tests verify warning strings are present and descriptive
- [ ] Tests verify enhanced prompts integration flag

---

### Task 6.4: SetupWizardStateService enhance step and fallback warning tests

**File(s)**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts`
**Action**: CREATE or MODIFY (if exists)
**Requirements**: R14

**What to do**:

- Write unit tests for the state service changes from Batches 2-3:
  - `it('should set fallbackWarning when error type is fallback-warning')` -- call handleError with `{ type: 'fallback-warning', message: 'test' }`, verify fallbackWarning signal is set
  - `it('should set errorState when error type is error or undefined')` -- call handleError with `{ message: 'test' }` (no type), verify errorState signal is set, fallbackWarning is null
  - `it('should include enhance in step order')` -- verify stepIndex returns correct index for 'enhance' step
  - `it('should reset fallbackWarning on reset()')` -- set a fallback warning, call reset(), verify it's null
  - `it('should map warnings from GenerationCompletePayload to CompletionData')` -- call handleGenerationComplete with warnings array, verify completionData has warnings

**Acceptance Criteria**:

- [ ] Test file exists with 5+ test cases
- [ ] All tests pass: `npx nx test setup-wizard --testPathPattern=setup-wizard-state.service`
- [ ] Tests cover fallback warning signal routing
- [ ] Tests cover enhance step integration
- [ ] Tests cover CompletionData warnings mapping

---

### Task 6.5: Wizard RPC handler tests for enhanced prompts

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.spec.ts`
**Action**: CREATE or MODIFY (if exists)
**Requirements**: R13

**What to do**:

- Write unit tests for the RPC handlers added in Tasks 4.1 and 5.1:
  - `it('should register enhancedPrompts:runWizard handler')` -- verify the handler is registered on the rpcHandler mock
  - `it('should return success when enhanced prompts wizard succeeds')` -- mock EnhancedPromptsService.runWizard to succeed, verify response shape
  - `it('should return error when no workspace folder is open')` -- mock no workspace folders, verify error response
  - `it('should return error when EnhancedPromptsService resolution fails')` -- mock container.resolve to throw, verify error response
  - `it('should register settings handlers (toggle, regenerate, getPromptContent, download)')` -- verify all handlers are registered
- Mock `DependencyContainer`, `RpcHandler`, `Logger`, and `vscode.workspace`.

**Acceptance Criteria**:

- [ ] Test file exists with 5+ test cases
- [ ] All tests pass
- [ ] Tests mock DI container correctly
- [ ] Tests cover success and error paths for the enhanced prompts RPC handler

---

**Batch 6 Verification**:

- All test files exist
- All tests pass: `npx nx run-many --target=test --projects=agent-sdk,agent-generation,setup-wizard`
- code-logic-reviewer approved
- No skipped or pending tests

---

## Requirements Coverage Matrix

| Requirement                                            | Task(s)                                        | Batch   |
| ------------------------------------------------------ | ---------------------------------------------- | ------- |
| R1: Agentic Analysis Fallback Visibility               | 1.1, 1.3 (backend), 2.1 (frontend)             | 1, 2    |
| R2: Phase 3 LLM Customization Failure Visibility       | 1.1, 1.4 (backend), 2.2 (frontend)             | 1, 2    |
| R3: Prompt Designer LLM Unavailable Visibility         | 1.2, 1.5                                       | 1       |
| R4: Prompt Designer LLM Error Visibility               | 1.2, 1.5                                       | 1       |
| R5: Enhanced Prompts Missing Prompt Visibility         | 1.6                                            | 1       |
| R6: New Wizard Step Definition                         | 3.1, 3.3, 3.5                                  | 3       |
| R7: Prompt Enhancement Component                       | 3.2                                            | 3       |
| R8: Backend RPC Handler for Enhanced Prompt Generation | 4.1                                            | 4       |
| R9: System Prompt Mode Selector                        | 5.1, 5.2                                       | 5       |
| R10: Settings RPC Handlers                             | 4.3, 5.1, 5.3                                  | 4, 5    |
| R10a: Prompt Content Preview & Download                | 5.1 (download handler), 5.3 (frontend methods) | 5       |
| R11: Wire Enhanced Prompts into Phase 3                | 4.2                                            | 4       |
| R12: Generation Progress Includes Enhancement Status   | 1.1, 4.2, 2.2                                  | 1, 4, 2 |
| R13: Error Path Tests                                  | 6.1, 6.2, 6.3, 6.5                             | 6       |
| R14: Frontend Component Tests                          | 6.4                                            | 6       |
