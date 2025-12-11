# Development Tasks - TASK_2025_065_FIXES

**Total Tasks**: 27 | **Batches**: 5 | **Status**: 0/5 complete
**Parent Task**: TASK_2025_065 (Agent Generation System - Frontend Track)
**Type**: BUGFIX / QUALITY IMPROVEMENT
**Priority**: HIGH

---

## Batch Overview

| Batch | Name                           | Tasks | Developer          | Complexity | Dependencies |
| ----- | ------------------------------ | ----- | ------------------ | ---------- | ------------ |
| 1     | Critical Infrastructure        | 4     | frontend-developer | HIGH       | None         |
| 2     | Type Safety & Code Cleanup     | 5     | frontend-developer | MEDIUM     | Batch 1      |
| 3     | Error Handling Standardization | 3     | frontend-developer | MEDIUM     | Batch 2      |
| 4     | Accessibility & Polish         | 4     | frontend-developer | LOW        | Batch 3      |
| 5     | Unit Tests (Required)          | 11    | frontend-developer | HIGH       | Batch 1-4    |

**Estimated Total Effort**: 16-20 hours

---

## Success Criteria

- [ ] Code Style Review Score: ≥8.0/10 (currently 6.5/10)
- [ ] Code Logic Review Score: ≥8.0/10 (currently 6.2/10)
- [ ] No blocking issues remaining (currently 5)
- [ ] No critical issues remaining (currently 3)
- [ ] Unit test coverage: ≥80% for all 8 files
- [ ] TypeScript compilation: 0 errors
- [ ] No native browser APIs (window.confirm, alert)
- [ ] All RPC progress updates flow correctly

---

## Batch 1: Critical Infrastructure 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None
**Complexity**: HIGH - Core integration work with backend RPC and state management
**Estimated Effort**: 4-5 hours

These are BLOCKING issues that prevent the wizard from working correctly in production.

---

### Task 1.1: Add Message Listener for Backend Progress Updates ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts
**Issue Type**: CRITICAL - Missing Backend Integration
**Spec Reference**: code-logic-review.md:43-48 (Failure Mode 1), code-style-review.md:41-46
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts:47-60 (message listener setup)

**Problem**:

- Backend sends progress updates (`setup-wizard:scan-progress`, `setup-wizard:generation-progress`, etc.)
- SetupWizardStateService has NO message listener to receive them
- All progress updates are silently dropped
- Users see frozen progress bars, think wizard is broken

**Solution**:
Add constructor with VSCodeService injection and setup message listener for ALL backend messages:

**Implementation Details**:

1. Add constructor injection:

```typescript
constructor(private readonly vscodeService: VSCodeService) {
  this.setupMessageListener();
}
```

2. Create private `setupMessageListener()` method that subscribes to backend messages:

   - `setup-wizard:scan-progress` → Update `scanProgress` signal
   - `setup-wizard:analysis-complete` → Update `analysisResults` signal, transition to 'analysis' step
   - `setup-wizard:available-agents` → Update `availableAgents` signal
   - `setup-wizard:generation-progress` → Update `generationProgress` signal
   - `setup-wizard:generation-complete` → Update `completionData` signal, transition to 'completion' step
   - `setup-wizard:error` → Update `errorState` signal with error details

3. Add proper message type checking and payload validation

**Quality Requirements**:

- All 6 message types must be handled
- Proper TypeScript type guards for payload validation
- Update appropriate signals based on message type
- State transitions (step changes) must be atomic
- Error messages must be user-facing (not technical exceptions)

**Validation**:

- [x] Constructor injects VSCodeService
- [x] setupMessageListener() called in constructor
- [x] All 6 message types have handlers
- [x] Signals update correctly for each message
- [x] No console errors during message handling

---

### Task 1.2: Replace window.confirm() with DaisyUI Modal ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
**Line**: 178-186 (confirmCancel method)
**Issue Type**: CRITICAL - Browser API Incompatibility
**Spec Reference**: code-logic-review.md:183-188 (Failure Mode 6), code-style-review.md:34-39
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\permission-request-card.component.ts:45-70 (DaisyUI modal pattern)

**Problem**:

- `window.confirm()` does NOT work in VS Code webviews
- Cancel confirmation dialog will fail silently or crash
- Users cannot cancel scans reliably

**Solution**:
Create reusable `ConfirmationModalComponent` with DaisyUI modal, use it in ScanProgressComponent

**Implementation Details**:

1. Create new file: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\confirmation-modal.component.ts`

2. Component interface:

```typescript
@Component({
  selector: 'ptah-confirmation-modal',
  standalone: true,
  template: `
    <dialog #modal class="modal">
      <div class="modal-box">
        <h3 class="font-bold text-lg">{{ title() }}</h3>
        <p class="py-4">{{ message() }}</p>
        <div class="modal-action">
          <button class="btn btn-ghost" (click)="onCancel()">{{ cancelText() }}</button>
          <button class="btn btn-primary" (click)="onConfirm()">{{ confirmText() }}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  `,
})
export class ConfirmationModalComponent {
  title = input.required<string>();
  message = input.required<string>();
  confirmText = input<string>('Confirm');
  cancelText = input<string>('Cancel');

  confirmed = output<void>();
  cancelled = output<void>();

  @ViewChild('modal', { static: true }) modal!: ElementRef<HTMLDialogElement>;

  show(): void {
    this.modal.nativeElement.showModal();
  }
  hide(): void {
    this.modal.nativeElement.close();
  }

  onConfirm(): void {
    this.confirmed.emit();
    this.hide();
  }

  onCancel(): void {
    this.cancelled.emit();
    this.hide();
  }
}
```

3. Update `scan-progress.component.ts`:
   - Add `@ViewChild(ConfirmationModalComponent)` reference
   - Replace `confirmCancel()` implementation:
     ```typescript
     private async confirmCancel(): Promise<boolean> {
       this.confirmationModal.show();
       return new Promise<boolean>((resolve) => {
         // Set up one-time listeners for modal events
         const confirmedSub = this.confirmationModal.confirmed.subscribe(() => {
           resolve(true);
           confirmedSub.unsubscribe();
           cancelledSub.unsubscribe();
         });
         const cancelledSub = this.confirmationModal.cancelled.subscribe(() => {
           resolve(false);
           confirmedSub.unsubscribe();
           cancelledSub.unsubscribe();
         });
       });
     }
     ```
   - Add modal to template

**Quality Requirements**:

- DaisyUI modal markup (dialog element, modal-box, modal-action classes)
- Modal closes on backdrop click
- Modal closes on ESC key
- Promise-based API for easy async/await usage
- Reusable component (can be used in other files)
- No memory leaks (unsubscribe after resolve)

**Validation**:

- [x] ConfirmationModalComponent created
- [x] Modal uses DaisyUI classes
- [x] scan-progress.component uses modal instead of window.confirm()
- [x] Modal shows/hides correctly
- [x] confirmCancel() replaced with event-based API
- [x] No console errors

---

### Task 1.3: Replace alert() with DaisyUI Modal ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts
**Line**: 184-193 (onManualAdjustment method)
**Issue Type**: CRITICAL - Browser API Incompatibility
**Spec Reference**: code-style-review.md:34-39
**Pattern to Follow**: Task 1.2 ConfirmationModalComponent (Alert mode)

**Problem**:

- `alert()` does NOT work in VS Code webviews
- Future enhancement notification will fail or show ugly native dialog

**Solution**:
Extend ConfirmationModalComponent to support "alert mode" (single button), use it here

**Implementation Details**:

1. Update `ConfirmationModalComponent` (from Task 1.2):

   - Add `mode = input<'confirm' | 'alert'>('confirm')` input
   - Update template to show only confirmText button when mode='alert'
   - Hide cancel button when mode='alert'

2. Update `analysis-results.component.ts`:
   - Add `@ViewChild(ConfirmationModalComponent)` reference
   - Replace `alert()` call with modal:
     ```typescript
     protected async onManualAdjustment(): Promise<void> {
       this.alertModal.show();
       await new Promise<void>((resolve) => {
         const sub = this.alertModal.confirmed.subscribe(() => {
           resolve();
           sub.unsubscribe();
         });
       });
     }
     ```
   - Add modal to template with appropriate title/message

**Quality Requirements**:

- Single button "OK" in alert mode
- Same DaisyUI styling as confirm mode
- Modal closes on button click
- Modal closes on backdrop click or ESC key
- Promise-based API for consistency

**Validation**:

- [x] ConfirmationModalComponent supports alert mode
- [x] analysis-results.component uses alert modal
- [x] Modal shows single "OK" button
- [x] No alert() calls remain in codebase
- [x] No console errors

---

### Task 1.4: Add try-catch for VSCodeService.postMessage() ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts
**Line**: 151 (send method)
**Issue Type**: SERIOUS - Unhandled Exception Risk
**Spec Reference**: code-logic-review.md:99-108 (Failure Mode 2), code-style-review.md (implicit)
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.ts:89-95 (error handling pattern)

**Problem**:

- `this.vscodeService.postMessage(message)` can throw if webview API not ready
- Unhandled exception crashes entire webview
- User sees white screen, must reload extension

**Solution**:
Wrap postMessage() in try-catch, propagate error to caller via Promise rejection

**Implementation Details**:

1. Update `send<TPayload, TResult>()` method (line 143-157):

```typescript
private async send<TPayload, TResult>(
  method: string,
  payload: TPayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<TResult> {
  const requestId = generateId();
  const message: RpcRequest = {
    type: 'rpc:request',
    id: requestId,
    method,
    payload,
  };

  return new Promise<TResult>((resolve, reject) => {
    this.pendingRequests.set(requestId, { resolve, reject });

    const timeoutId = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      reject(new Error(`RPC timeout for method: ${method}`));
    }, timeoutMs);

    // Store timeoutId for cleanup
    this.timeoutIds.set(requestId, timeoutId);

    // Wrap postMessage in try-catch
    try {
      this.vscodeService.postMessage(message);
    } catch (error) {
      // Clean up on send failure
      this.pendingRequests.delete(requestId);
      clearTimeout(timeoutId);
      this.timeoutIds.delete(requestId);

      reject(new Error(`Failed to send RPC message: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}
```

2. Add `private timeoutIds = new Map<string, number>();` field for timeout cleanup

**Quality Requirements**:

- try-catch wraps only postMessage() call
- Promise rejected with descriptive error message
- All pending request state cleaned up on failure
- Timeout cleared to prevent memory leak
- Error message includes original error context

**Validation**:

- [x] postMessage() wrapped in try-catch
- [x] Promise rejected on exception
- [x] pendingRequests cleaned up
- [x] timeoutId cleared
- [x] Error message is descriptive

---

**Batch 1 Verification**:

- [x] All 4 files modified exist at paths
- [x] Linting passes: `npx nx lint setup-wizard`
- [x] TypeScript compilation: 0 errors
- [x] No window.confirm() or alert() calls remain in setup-wizard library
- [x] Message listener implemented with proper type guards
- [x] ConfirmationModalComponent reusable by other components
- [x] ConfirmationModalComponent exported from index.ts

---

## Batch 2: Type Safety & Code Cleanup 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete
**Complexity**: MEDIUM - Type system fixes and dead code removal
**Estimated Effort**: 2-3 hours

These issues violate TypeScript best practices and create maintainability debt.

---

### Task 2.1: Remove `any` types (Dead Code) ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts
**Lines**: 62-65
**Issue Type**: BLOCKING - Type Safety Violation
**Spec Reference**: code-style-review.md:47-50

**Problem**:

```typescript
private claudeRpcService: any; // Line 62
private chatStore: any; // Line 63
```

- Both fields bypass TypeScript type checking
- Neither field is ever used (dead code)
- Future developers might use them incorrectly

**Solution**:
DELETE both lines entirely. They are never used.

**Implementation Details**:

1. Search for all usages of `claudeRpcService` (result: 0 usages)
2. Search for all usages of `chatStore` (result: 0 usages)
3. Delete lines 62-63
4. Verify build passes

**Quality Requirements**:

- Complete removal of both fields
- No references to these fields anywhere in codebase
- TypeScript compilation succeeds

**Validation**:

- [x] Lines 62-63 deleted (already clean - no `any` types found)
- [x] No compiler errors
- [x] Grep search confirms no usages

---

### Task 2.2: Replace Non-Null Assertions with Safe Operators ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts
**Lines**: 56, 62
**Issue Type**: BLOCKING - Runtime Crash Risk
**Spec Reference**: code-style-review.md:115-123
**Pattern to Follow**: completion.component.ts:75 (uses `??` operator safely)

**Problem**:

```typescript
// Line 56
[style.width.%]="progress()!.percentComplete"

// Line 62
<span>{{ progress()!.currentAgent }}</span>
```

- Non-null assertion `!` disables TypeScript safety
- If `progress()` returns null, app CRASHES at runtime
- Type system allows null (Signal<GenerationProgress | null>)

**Solution**:
Replace with safe navigation (`?.`) and nullish coalescing (`??`) operators

**Implementation Details**:

1. Line 56 - Progress bar width:

```typescript
// OLD
[style.width.%]="progress()!.percentComplete"

// NEW
[style.width.%]="progress()?.percentComplete ?? 0"
```

2. Line 62 - Current agent display:

```typescript
// OLD
<span>{{ progress()!.currentAgent }}</span>

// NEW - Option A (inline fallback)
<span>{{ progress()?.currentAgent ?? 'Unknown' }}</span>

// NEW - Option B (template variable - preferred)
@if (progress(); as prog) {
  <span>{{ prog.currentAgent }}</span>
} @else {
  <span>Unknown</span>
}
```

Use Option B (template variable) for better type safety and readability.

**Quality Requirements**:

- No `!` non-null assertions in templates
- Safe fallback values (0 for percentages, 'Unknown' for strings)
- Template variable usage for better type inference
- No runtime errors if progress() returns null

**Validation**:

- [x] No `!` operators in generation-progress.component.ts template
- [x] Grep confirms no non-null assertions
- [x] Template variable approach used (`@if (progress(); as prog)`)
- [x] Safe navigation throughout

---

### Task 2.3: Remove Unused Payload Interfaces ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts
**Lines**: 33-55
**Issue Type**: SERIOUS - Dead Code
**Spec Reference**: code-style-review.md (implicit - unused interfaces)

**Problem**:
5 payload interfaces defined but NEVER used:

- `ScanWorkspacePayload` (line 33)
- `CancelScanPayload` (line 37)
- `GetAnalysisPayload` (line 41)
- `SelectAgentsPayload` (line 45)
- `GenerateAgentsPayload` (line 49)

**Solution**:
After Task 1.1 (message listener), verify if these interfaces are needed. If not, DELETE them.

**Implementation Details**:

1. Check if Task 1.1 message listener uses any of these interfaces

   - If YES → Keep those interfaces
   - If NO → Delete all 5 interfaces

2. Grep search for usages:

```bash
grep -n "ScanWorkspacePayload\|CancelScanPayload\|GetAnalysisPayload\|SelectAgentsPayload\|GenerateAgentsPayload" libs/frontend/setup-wizard/
```

3. If no usages found, delete lines 33-55

**Quality Requirements**:

- Only delete if truly unused
- Verify message listener in Task 1.1 doesn't need them
- No broken imports after deletion

**Validation**:

- [x] Grep search completed for all 5 interfaces
- [x] All 5 interfaces were unused
- [x] All unused interfaces deleted (lines 33-55)
- [x] TypeScript compilation succeeds

---

### Task 2.4: Remove Unnecessary CommonModule Imports ✅ IMPLEMENTED

**Files**: All 6 wizard components
**Issue Type**: SERIOUS - Unnecessary Dependencies
**Spec Reference**: code-style-review.md:107-115
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\chat-message.component.ts:7-15 (no CommonModule with modern control flow)

**Problem**:

- All 6 components import `CommonModule`
- Modern Angular 20 standalone components with `@if`/`@for` DON'T need CommonModule
- Adds unnecessary bundle size

**Solution**:
Remove `CommonModule` imports and from `imports` array in all 6 components

**Implementation Details**:

For EACH of these 6 files:

1. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`
2. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
3. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`
4. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
5. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
6. `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`

Remove:

```typescript
// DELETE this import
import { CommonModule } from '@angular/common';

// DELETE CommonModule from imports array
@Component({
  imports: [CommonModule, ...], // Remove CommonModule
})
```

**Quality Requirements**:

- All 6 components updated
- No CommonModule imports remain in setup-wizard library
- Templates still work (they use @if/@for, not *ngIf/*ngFor)
- Build passes after changes

**Validation**:

- [x] Grep confirms no CommonModule in components
- [x] All 6 files updated
- [x] Lint passes
- [x] Modern control flow (@if/@for) works without CommonModule

---

### Task 2.5: Remove Computed Signal with No Computation ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
**Lines**: 118-120
**Issue Type**: SERIOUS - Unnecessary Complexity
**Spec Reference**: code-style-review.md:67-70

**Problem**:

```typescript
protected readonly progress = computed(() =>
  this.wizardState.generationProgress()
);
```

- Computed signal that just forwards another signal
- No transformation, no logic, no computation
- Adds unnecessary reactive overhead

**Solution**:
Replace with direct signal reference

**Implementation Details**:

1. Find the `progress` computed signal (line 118-120)

2. Replace with direct reference:

```typescript
// OLD
protected readonly progress = computed(() =>
  this.wizardState.generationProgress()
);

// NEW
protected readonly progress = this.wizardState.generationProgress;
```

3. Update template usages (if any) - no changes needed, signal API stays the same

**Quality Requirements**:

- Direct signal reference (no computed wrapper)
- Template calls still work: `progress().percentComplete`
- No behavioral changes
- Slight performance improvement (no extra reactive node)

**Validation**:

- [x] Computed wrapper removed
- [x] progress assigned directly from wizardState.generationProgress
- [x] Template still works (signal API unchanged)
- [x] Performance improved (no extra reactive node)

---

**Batch 2 Verification**:

- [x] All 6 component files modified
- [x] wizard-rpc.service.ts cleaned up
- [x] No `any` types in setup-wizard library
- [x] No non-null assertions in templates
- [x] No CommonModule imports
- [x] TypeScript compilation: 0 errors
- [x] Lint passes: `npx nx lint setup-wizard` - All files pass linting

---

## Batch 3: Error Handling Standardization 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 complete
**Complexity**: MEDIUM - Consistent error patterns across components
**Estimated Effort**: 2-3 hours

Standardize error handling to match best practices from welcome.component.ts.

---

### Task 3.1: Add Error Handling to AgentSelectionComponent ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
**Lines**: 205-221 (onGenerateAgents method)
**Issue Type**: CRITICAL - Silent Failure
**Spec Reference**: code-logic-review.md:33-37 (Failure Mode 3), code-style-review.md:54-62
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts:99-123 (error handling pattern)

**Problem**:

```typescript
async onGenerateAgents(): Promise<void> {
  try {
    await this.rpcService.generateAgents(...);
  } catch (error) {
    console.error('Failed to generate agents', error); // ONLY console.error
    // NO user feedback, NO loading state reset
  }
}
```

- Error only logged to console
- User sees nothing when RPC fails
- Button stays disabled, no way to retry

**Solution**:
Follow welcome.component.ts pattern: Add errorMessage signal, display in template, reset loading state

**Implementation Details**:

1. Add signals to component class:

```typescript
protected readonly errorMessage = signal<string | null>(null);
protected readonly isGenerating = signal<boolean>(false);
```

2. Update `onGenerateAgents()` method:

```typescript
protected async onGenerateAgents(): Promise<void> {
  if (this.isGenerating() || !this.canGenerate()) {
    return;
  }

  this.isGenerating.set(true);
  this.errorMessage.set(null);

  try {
    const selectedAgents = this.agents().filter(a => a.selected);
    await this.rpcService.generateAgents({
      projectContext: this.projectContext(),
      agents: selectedAgents,
    });

    // Success - wizard state will update via message listener (Task 1.1)
  } catch (error) {
    this.errorMessage.set(
      `Failed to generate agents: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    console.error('Agent generation failed', error);
  } finally {
    this.isGenerating.set(false);
  }
}
```

3. Update template to show error alert (similar to welcome.component.ts):

```html
@if (errorMessage(); as error) {
<div class="alert alert-error mb-4" role="alert">
  <svg>...</svg>
  <span>{{ error }}</span>
</div>
}
```

4. Update "Generate Agents" button:

```html
<button class="btn btn-primary" [class.btn-disabled]="isGenerating() || !canGenerate()" [disabled]="isGenerating() || !canGenerate()" (click)="onGenerateAgents()">
  @if (isGenerating()) {
  <span class="loading loading-spinner"></span>
  Generating... } @else { Generate {{ selectedCount() }} Agent{{ selectedCount() !== 1 ? 's' : '' }} }
</button>
```

**Quality Requirements**:

- User-facing error message displayed in DaisyUI alert
- Loading state (isGenerating signal) with spinner
- Button disabled during RPC call
- Error state resets on retry
- finally block always resets loading state

**Validation**:

- [x] errorMessage signal added
- [x] isGenerating signal added
- [x] Error alert displayed in template
- [x] Button shows spinner during RPC
- [x] finally block resets isGenerating
- [x] Manual test: Simulate RPC failure (disconnect backend)

---

### Task 3.2: Standardize Error Handling in ScanProgressComponent ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
**Lines**: 157-170 (onCancel method)
**Issue Type**: SERIOUS - Inconsistent Error Pattern
**Spec Reference**: code-logic-review.md:39-43, code-style-review.md:54-62

**Problem**:

```typescript
async onCancel(): Promise<void> {
  try {
    await this.rpcService.cancelScan();
  } catch (error) {
    console.error('Failed to cancel scan', error);
  } finally {
    this.isCanceling.set(false); // Resets even if cancel failed
  }
}
```

- Resets state even if backend cancel FAILED
- No user feedback on error
- UI shows "canceled" but backend still running

**Solution**:
Add errorMessage signal, display error, DON'T reset state on failure

**Implementation Details**:

1. Add signal:

```typescript
protected readonly errorMessage = signal<string | null>(null);
```

2. Update `onCancel()` method:

```typescript
protected async onCancel(): Promise<void> {
  if (this.isCanceling()) {
    return;
  }

  // Use modal from Task 1.2
  const confirmed = await this.confirmCancel();
  if (!confirmed) {
    return;
  }

  this.isCanceling.set(true);
  this.errorMessage.set(null);

  try {
    await this.rpcService.cancelScan();

    // Success - reset wizard state
    this.wizardState.resetWizard();
  } catch (error) {
    // Error - keep isCanceling true, show error
    this.errorMessage.set(
      `Failed to cancel scan: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
    );
    console.error('Scan cancellation failed', error);
  } finally {
    // Only reset isCanceling on SUCCESS (when no error)
    if (!this.errorMessage()) {
      this.isCanceling.set(false);
    }
  }
}
```

3. Add error alert to template (similar to Task 3.1)

4. Update "Cancel" button to show error state:

```html
<button class="btn btn-outline btn-error" [class.btn-disabled]="isCanceling()" [disabled]="isCanceling()" (click)="onCancel()">
  @if (isCanceling()) {
  <span class="loading loading-spinner"></span>
  Canceling... } @else if (errorMessage()) { Retry Cancel } @else { Cancel Scan }
</button>
```

**Quality Requirements**:

- Error displayed in DaisyUI alert
- State NOT reset if cancel fails
- User can retry cancel after failure
- Button text changes to "Retry Cancel" on error
- State only resets on successful cancel

**Validation**:

- [x] errorMessage signal added
- [x] Error alert displayed
- [x] State preserved on failure
- [x] "Retry Cancel" button on error
- [x] finally block conditional on error

---

### Task 3.3: Add Loading State to AgentSelectionComponent (Already Covered) ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
**Issue Type**: SERIOUS - Missing Loading Feedback
**Spec Reference**: code-logic-review.md:128-133

**Note**: This task is already covered by Task 3.1 (isGenerating signal + button spinner).

**Implementation Details**:
Verify Task 3.1 implementation includes:

- [x] isGenerating signal
- [x] Button disabled during RPC
- [x] Spinner shown during generation
- [x] Loading state reset in finally block

**Quality Requirements**:

- Same as Task 3.1

**Validation**:

- [x] All requirements from Task 3.1 met
- [x] Button shows loading spinner
- [x] Button disabled during RPC
- [x] No duplicate loading states

---

**Batch 3 Verification**:

- [x] All error handlers follow welcome.component.ts pattern
- [x] Error messages user-facing (not technical exceptions)
- [x] Loading states consistent across components
- [x] finally blocks always reset loading states (conditionally for scan-progress)
- [x] Error alerts use DaisyUI alert component
- [x] Lint passes: `npx nx lint setup-wizard`

---

## Batch 4: Accessibility & Polish 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 3 complete
**Complexity**: LOW - Incremental improvements
**Estimated Effort**: 2-3 hours

Improve accessibility and handle edge cases for production readiness.

---

### Task 4.1: Add ARIA Labels to Async Buttons ✅ IMPLEMENTED

**Files**: All 6 wizard components
**Issue Type**: MEDIUM - Accessibility Gap
**Spec Reference**: code-logic-review.md:133-137
**Pattern to Follow**: WCAG 2.1 ARIA guidelines for buttons

**Problem**:

- No ARIA labels on async buttons
- Screen readers don't announce loading state
- Buttons not accessible to assistive technologies

**Solution**:
Add `[attr.aria-busy]` and `[attr.aria-label]` to all async buttons

**Implementation Details**:

For EACH async button in all 6 components, add ARIA attributes:

**Example - welcome.component.ts**:

```html
<button class="btn btn-primary" [class.btn-disabled]="isStarting()" [disabled]="isStarting()" [attr.aria-busy]="isStarting()" [attr.aria-label]="isStarting() ? 'Starting wizard setup' : 'Start wizard setup'" (click)="onStartSetup()">
  @if (isStarting()) {
  <span class="loading loading-spinner"></span>
  Starting... } @else { Start Setup }
</button>
```

**Buttons to Update**:

1. welcome.component.ts - "Start Setup" button
2. scan-progress.component.ts - "Cancel Scan" button
3. analysis-results.component.ts - "Continue" button (if async)
4. agent-selection.component.ts - "Generate Agents" button
5. generation-progress.component.ts - No buttons (progress only)
6. completion.component.ts - "Close Wizard" button (if async)

**Quality Requirements**:

- All async buttons have aria-busy attribute
- aria-label describes current action state
- aria-label changes with loading state
- Works with screen readers (test with NVDA/JAWS if possible)

**Validation**:

- [x] All async buttons identified
- [x] aria-busy added to all buttons
- [x] aria-label added to all buttons
- [x] aria-label text appropriate for each state
- [x] Build passes

---

### Task 4.2: Add ARIA Labels to Progress Bars ✅ IMPLEMENTED

**Files**:

- D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts
- D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts

**Issue Type**: MEDIUM - Accessibility Gap
**Spec Reference**: WCAG 2.1 progressbar role requirements

**Problem**:

- Progress bars missing ARIA attributes
- Screen readers don't announce progress updates
- Progress value not semantically correct

**Solution**:
Add role="progressbar" and ARIA value attributes to progress elements

**Implementation Details**:

**scan-progress.component.ts** - Update progress bar element:

```html
<progress class="progress progress-primary w-full" [value]="progressPercentage()" max="100" role="progressbar" [attr.aria-valuenow]="progressPercentage()" [attr.aria-valuemin]="0" [attr.aria-valuemax]="100" [attr.aria-label]="'Workspace scan progress: ' + progressPercentage() + ' percent complete'"></progress>
```

**generation-progress.component.ts** - Update progress bar element:

```html
<progress class="progress progress-primary w-full" [value]="progress()?.percentComplete ?? 0" max="100" role="progressbar" [attr.aria-valuenow]="progress()?.percentComplete ?? 0" [attr.aria-valuemin]="0" [attr.aria-valuemax]="100" [attr.aria-label]="'Agent generation progress: ' + (progress()?.percentComplete ?? 0) + ' percent complete'"></progress>
```

**Quality Requirements**:

- role="progressbar" on both progress elements
- aria-valuenow matches current value
- aria-valuemin always 0
- aria-valuemax always 100
- aria-label includes context and percentage

**Validation**:

- [x] Both progress bars updated
- [x] All 5 ARIA attributes present
- [x] aria-valuenow updates reactively
- [x] Screen reader announces progress (if testable)

---

### Task 4.3: Add ARIA Labels to Checkboxes ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts
**Issue Type**: MEDIUM - Accessibility Gap
**Spec Reference**: WCAG 2.1 checkbox label requirements

**Problem**:

- Agent selection checkboxes missing explicit labels
- Screen readers may not announce checkbox purpose
- Label text not semantically associated

**Solution**:
Add `[attr.aria-label]` to each agent checkbox

**Implementation Details**:

Update agent checkbox in template:

```html
@for (agent of agents(); track agent.id) {
<div class="form-control">
  <label class="label cursor-pointer justify-start gap-3">
    <input type="checkbox" class="checkbox checkbox-primary" [checked]="agent.selected" [attr.aria-label]="'Select ' + agent.name + ' agent'" (change)="onToggleAgent(agent.id)" />
    <div class="flex-1">
      <span class="label-text font-medium">{{ agent.name }}</span>
      <p class="text-sm text-base-content/70">{{ agent.description }}</p>
    </div>
  </label>
</div>
}
```

**Quality Requirements**:

- Each checkbox has unique aria-label
- aria-label includes agent name
- aria-label describes action ("Select X agent")
- Works with screen readers

**Validation**:

- [x] All agent checkboxes have aria-label
- [x] aria-label includes agent name
- [x] aria-label dynamically generated
- [x] Build passes

---

### Task 4.4: Add Duration Edge Case Handling ✅ IMPLEMENTED

**Files**:

- D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts
- D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts

**Lines**: generation-progress:185-193, completion:188-206
**Issue Type**: MINOR - Edge Case
**Spec Reference**: code-logic-review.md:88-91 (Failure Mode 7)

**Problem**:

```typescript
protected formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  // If ms is negative, shows "-5s"
}
```

- No handling for negative durations (clock change, timing error)
- Shows "-5s" which looks broken

**Solution**:
Add `Math.max(0, ms)` to prevent negative display

**Implementation Details**:

**generation-progress.component.ts** - Update formatDuration():

```typescript
protected formatDuration(ms: number): string {
  // Ensure non-negative duration
  const safeMs = Math.max(0, ms);
  const seconds = Math.floor(safeMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
```

**completion.component.ts** - Update formatDuration() (same logic):

```typescript
protected formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const seconds = Math.floor(safeMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
```

**Quality Requirements**:

- Always returns non-negative duration
- Handles negative input gracefully
- Handles 0 correctly ("0s")
- Handles large values (hours, days) - optional enhancement

**Validation**:

- [x] Both formatDuration() methods updated
- [x] Math.max(0, ms) added
- [x] Test with negative input: formatDuration(-5000) returns "0s"
- [x] Build passes

---

**Batch 4 Verification**:

- [x] All ARIA labels added
- [x] Progress bars accessible
- [x] Checkboxes accessible
- [x] Edge cases handled
- [x] Build passes: `npx nx lint setup-wizard` (linting passed)
- [x] No console warnings about accessibility

---

## Batch 5: Unit Tests (REQUIRED) ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 11 (8 implementation files + 3 shared utilities)
**Dependencies**: Batches 1-4 complete
**Complexity**: HIGH - Comprehensive test coverage required
**Estimated Effort**: 6-8 hours

**CRITICAL**: Code cannot merge without 80% test coverage for all files.

---

### Task 5.1: Add Tests for setup-wizard-state.service.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state-manager.service.spec.ts

**Test Cases Required**:

1. **Initialization Tests**:

   - [ ] Service initializes with default state
   - [ ] currentStep starts as 'welcome'
   - [ ] All signals start as null/empty

2. **Message Listener Tests** (from Task 1.1):

   - [ ] Listener receives setup-wizard:scan-progress messages
   - [ ] Listener updates scanProgress signal correctly
   - [ ] Listener receives setup-wizard:generation-complete messages
   - [ ] Listener transitions to 'completion' step on complete
   - [ ] Listener handles malformed messages gracefully

3. **State Transition Tests**:

   - [ ] setCurrentStep() updates currentStep signal
   - [ ] resetWizard() resets all signals to initial state
   - [ ] State transitions are atomic (no partial updates)

4. **Error Handling Tests**:
   - [ ] Error messages update errorState signal
   - [ ] Errors don't corrupt other state

**Quality Requirements**:

- All public methods tested
- Signal updates verified
- Message listener integration tested
- Mock VSCodeService for message simulation
- No actual backend calls (use mocks)

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%: `npx nx test setup-wizard --coverage --testFile=setup-wizard-state.service.spec.ts`
- [ ] All tests pass
- [ ] No flaky tests

---

### Task 5.2: Add Tests for wizard-rpc.service.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%
**Pattern to Follow**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat.service.spec.ts

**Test Cases Required**:

1. **RPC Method Tests**:

   - [ ] startScan() sends correct RPC message
   - [ ] cancelScan() sends correct RPC message
   - [ ] generateAgents() sends correct payload
   - [ ] All methods return Promise

2. **Error Handling Tests** (from Task 1.4):

   - [ ] postMessage() exception caught
   - [ ] Promise rejected on send failure
   - [ ] Pending requests cleaned up on error
   - [ ] Timeout cleared on error

3. **Timeout Tests**:

   - [ ] RPC calls timeout after DEFAULT_TIMEOUT_MS
   - [ ] Timeout rejection message includes method name
   - [ ] Pending request removed on timeout

4. **Response Correlation Tests**:
   - [ ] Response with matching requestId resolves promise
   - [ ] Response with wrong requestId ignored
   - [ ] Multiple concurrent requests handled correctly

**Quality Requirements**:

- Mock VSCodeService.postMessage()
- Simulate timeout scenarios
- Test concurrent RPC calls
- Verify cleanup on all error paths

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass
- [ ] Timeout tests use fake timers (jasmine.clock())

---

### Task 5.3: Add Tests for welcome.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Rendering Tests**:

   - [ ] Component renders welcome template
   - [ ] "Start Setup" button displays
   - [ ] Loading spinner shows when isStarting() is true

2. **Interaction Tests**:

   - [ ] onStartSetup() calls rpcService.startScan()
   - [ ] isStarting signal updates during RPC
   - [ ] Button disabled when isStarting() is true

3. **Error Handling Tests**:
   - [ ] Error displayed when RPC fails
   - [ ] errorMessage signal updated
   - [ ] isStarting reset in finally block

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.4: Add Tests for scan-progress.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Progress Display Tests**:

   - [ ] progressPercentage() computed signal calculates correctly
   - [ ] Progress bar width updates with percentage
   - [ ] Handles division by zero (totalFiles = 0)

2. **Cancel Flow Tests** (from Task 1.2, Task 3.2):

   - [ ] onCancel() shows confirmation modal
   - [ ] onCancel() calls rpcService.cancelScan() on confirm
   - [ ] onCancel() does nothing on modal cancel
   - [ ] Error displayed if cancelScan() fails

3. **Modal Integration Tests**:
   - [ ] ConfirmationModalComponent injected
   - [ ] Modal shows on cancel button click
   - [ ] Modal result handled correctly

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass
- [ ] Modal mocked correctly

---

### Task 5.5: Add Tests for analysis-results.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Rendering Tests**:

   - [ ] projectContext displayed correctly
   - [ ] Tech stack badges render
   - [ ] Empty tech stack handled

2. **Manual Adjustment Tests** (from Task 1.3):

   - [ ] onManualAdjustment() shows alert modal
   - [ ] Modal uses alert mode (single button)
   - [ ] No window.alert() calls

3. **Continue Flow Tests**:
   - [ ] Continue button transitions to next step

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.6: Add Tests for agent-selection.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Agent Selection Tests**:

   - [ ] onToggleAgent() updates agent selected state
   - [ ] selectedCount() computed signal calculates correctly
   - [ ] onSelectAll() selects all agents
   - [ ] onDeselectAll() deselects all agents

2. **Generation Tests** (from Task 3.1):

   - [ ] onGenerateAgents() calls rpcService.generateAgents()
   - [ ] isGenerating signal updates during RPC
   - [ ] Error displayed when RPC fails
   - [ ] Button disabled when isGenerating() is true

3. **Validation Tests**:
   - [ ] canGenerate() returns false when no agents selected
   - [ ] canGenerate() returns true when agents selected

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.7: Add Tests for generation-progress.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Progress Display Tests**:

   - [ ] progress signal displays correctly
   - [ ] Progress bar updates with percentComplete
   - [ ] Current agent displayed

2. **Safe Navigation Tests** (from Task 2.2):

   - [ ] Handles null progress() gracefully
   - [ ] No crashes when progress is null
   - [ ] Fallback values used (0 for percentage)

3. **Duration Formatting Tests** (from Task 4.4):
   - [ ] formatDuration() formats seconds correctly
   - [ ] formatDuration() formats minutes correctly
   - [ ] formatDuration() handles negative values (returns "0s")
   - [ ] formatDuration() handles 0

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.8: Add Tests for completion.component.ts ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Completion Display Tests**:

   - [ ] Generated agents list displayed
   - [ ] Success message shown
   - [ ] Duration displayed

2. **Duration Formatting Tests** (from Task 4.4):

   - [ ] formatDuration() works same as generation-progress
   - [ ] Handles negative values correctly

3. **Close Wizard Tests**:
   - [ ] Close button resets wizard
   - [ ] Wizard state cleared

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.9: Add Tests for ConfirmationModalComponent ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\confirmation-modal.component.spec.ts
**Issue Type**: BLOCKING - Missing Tests (New Component from Task 1.2)
**Target Coverage**: ≥80%

**Test Cases Required**:

1. **Modal Display Tests**:

   - [ ] show() opens modal
   - [ ] hide() closes modal
   - [ ] Backdrop click closes modal

2. **Confirm Mode Tests**:

   - [ ] Both buttons shown in confirm mode
   - [ ] confirmed output emits on confirm
   - [ ] cancelled output emits on cancel

3. **Alert Mode Tests** (from Task 1.3):
   - [ ] Single button shown in alert mode
   - [ ] Only confirmed output emits
   - [ ] No cancel button in alert mode

**Validation**:

- [ ] Test file created
- [ ] Coverage ≥80%
- [ ] All tests pass

---

### Task 5.10: Integration Tests for Message Flow ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\setup-wizard.integration.spec.ts
**Issue Type**: HIGH - End-to-End Flow
**Target Coverage**: Key user flows

**Test Cases Required**:

1. **Happy Path Tests**:

   - [ ] Full wizard flow: welcome → scan → analysis → selection → generation → completion
   - [ ] State transitions correctly at each step
   - [ ] Message listener updates state

2. **Error Path Tests**:

   - [ ] RPC failure shows error
   - [ ] User can retry after error
   - [ ] Cancel flow works

3. **Edge Case Tests**:
   - [ ] Empty agents array
   - [ ] No workspace root
   - [ ] Rapid button clicks

**Validation**:

- [ ] Test file created
- [ ] All flows tested
- [ ] All tests pass

---

### Task 5.11: Run Full Test Suite & Verify Coverage ⏸️ PENDING

**Issue Type**: BLOCKING - Merge Gate
**Target Coverage**: ≥80% for entire setup-wizard library

**Implementation Details**:

1. Run full test suite:

```bash
npx nx test setup-wizard --coverage
```

2. Verify coverage report:

   - File coverage: All 8 files ≥80%
   - Branch coverage: ≥80%
   - Line coverage: ≥80%

3. If coverage < 80%, identify gaps:

```bash
npx nx test setup-wizard --coverage --coverageReporters=html
# Open coverage/index.html to see detailed report
```

4. Add missing tests for uncovered lines

**Quality Requirements**:

- All tests pass: 0 failures
- All files ≥80% coverage
- No skipped tests (no `xit` or `xdescribe`)
- No flaky tests (run 3 times, all pass)

**Validation**:

- [ ] Full test suite runs
- [ ] Coverage report generated
- [ ] All files ≥80% coverage
- [ ] 0 test failures
- [ ] Coverage report committed to task folder

---

**Batch 5 Verification**:

- [ ] All 8 implementation files have test files
- [ ] All test files have ≥80% coverage
- [ ] Full test suite passes: `npx nx test setup-wizard`
- [ ] Coverage report shows ≥80% overall
- [ ] No skipped or flaky tests
- [ ] Test files follow Angular testing best practices

---

## Post-Batch Actions

After ALL batches complete:

1. **Run Full Build**:

```bash
npx nx build setup-wizard --configuration=production
```

2. **Run Linters**:

```bash
npx nx lint setup-wizard
npx nx run setup-wizard:typecheck
```

3. **Verify All Files**:

```bash
# Confirm no window.confirm() or alert() calls
grep -r "window\.confirm\|window\.alert" libs/frontend/setup-wizard/src

# Confirm no CommonModule imports
grep -r "CommonModule" libs/frontend/setup-wizard/src/lib/components

# Confirm no non-null assertions in templates
grep -r "()!" libs/frontend/setup-wizard/src/lib/components/*.ts
```

4. **Create Git Commit** (team-leader handles this):

```bash
git add libs/frontend/setup-wizard/
git commit -m "fix(webview): resolve QA issues for agent generation wizard

- Add message listener for backend progress updates
- Replace window.confirm/alert with DaisyUI modals
- Fix type safety violations (remove any types, non-null assertions)
- Standardize error handling across all components
- Add comprehensive unit tests (80%+ coverage)
- Improve accessibility (ARIA labels, keyboard navigation)

Fixes: TASK_2025_065_FIXES
Related: TASK_2025_065"
```

5. **Request Re-Review**:
   - Invoke code-style-reviewer again
   - Invoke code-logic-reviewer again
   - Target: Both scores ≥8.0/10

---

## Notes for Developers

### Key Patterns to Follow

1. **Error Handling** (from welcome.component.ts):

   - Always have loading signal (isLoading, isStarting, etc.)
   - Always have errorMessage signal
   - Display errors in DaisyUI alert component
   - Reset loading state in finally block

2. **Modal Pattern** (from Task 1.2):

   - Use ConfirmationModalComponent for all dialogs
   - Never use window.confirm() or alert()
   - Promise-based API for async/await
   - Unsubscribe after promise resolves

3. **Type Safety**:

   - Never use `any` types
   - Never use non-null assertions (`!`) in templates
   - Use safe navigation (`?.`) and nullish coalescing (`??`)
   - Prefer template variables with `@if (signal(); as value)`

4. **Accessibility**:
   - All async buttons need aria-busy and aria-label
   - All progress bars need role and aria-value\* attributes
   - All checkboxes need aria-label
   - Test with keyboard navigation

### Testing Best Practices

1. **Component Tests**:

   - Mock all services (WizardRpcService, SetupWizardStateService)
   - Use TestBed.configureTestingModule() for setup
   - Test signals with TestBed.flushEffects()
   - Verify template rendering with fixture.nativeElement

2. **Service Tests**:

   - Mock VSCodeService
   - Use jasmine.clock() for timeout tests
   - Spy on postMessage() calls
   - Verify signal updates

3. **Coverage Goals**:
   - Line coverage: ≥80%
   - Branch coverage: ≥80%
   - Function coverage: ≥80%
   - Statement coverage: ≥80%

### Common Pitfalls to Avoid

1. **DON'T** use browser APIs (confirm, alert, prompt)
2. **DON'T** use `any` types or non-null assertions
3. **DON'T** import CommonModule with modern control flow
4. **DON'T** swallow errors (always show user feedback)
5. **DON'T** forget to reset loading states in finally blocks
6. **DON'T** skip tests (80% coverage is MANDATORY)

---

## End of Tasks
