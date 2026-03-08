# Code Review Fixes - Commit 3fff823

**Commit**: `3fff823 - feat(webview): fix setup wizard webview loading and navigation`
**Review Date**: 2025-12-15
**Priority**: HIGH (3 Critical + 3 Blocking issues)
**Estimated Total Effort**: 6-8 hours

---

## Executive Summary

This document organizes fixes for 10 critical/blocking issues and 12 serious/moderate issues identified in code style and logic reviews of commit 3fff823. Tasks are prioritized by severity and grouped by logical dependencies.

### Review Scores

- **Code Style Review**: 6.5/10 (3 Blocking, 7 Serious)
- **Code Logic Review**: 6.5/10 (3 Critical, 5 Serious)

### Issue Distribution by Priority

| Priority     | Count | Description                                                |
| ------------ | ----- | ---------------------------------------------------------- |
| **CRITICAL** | 3     | Runtime crashes, data corruption, security vulnerabilities |
| **BLOCKING** | 3     | Architectural violations, type safety violations           |
| **SERIOUS**  | 12    | Pattern inconsistencies, missing error handling            |
| **MODERATE** | 3     | Memory leaks, race conditions (low probability)            |

---

## BATCH 1: Critical Safety Fixes (PRIORITY: P0)

**Estimated Effort**: 2-3 hours
**Developer Type**: Backend Developer
**Must Complete Before**: Any other batches

These fixes address runtime crashes and null pointer exceptions that can cause extension failures.

### Task 1.1: Fix Null Panel Access Race Condition ⚠️ CRITICAL

**Issue**: `setup-wizard.service.ts:198` sets panel HTML BEFORE null check at line 189, causing potential crash.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 189-198

**Current Code Pattern**:

```typescript
// Line 189: Null check AFTER usage
if (!this.panel) {
  this.logger.error('Cannot show wizard: panel is undefined');
  throw new Error('Wizard panel not initialized');
}

// Line 198: HTML set BEFORE check (BUG!)
this.panel.webview.html = htmlGenerator.generateHtml({...});
```

**Required Fix**:

1. Move `this.panel` null check to line 186 (BEFORE any panel access)
2. Add early return if panel is null
3. Ensure all panel property accesses come AFTER validation

**Acceptance Criteria**:

- [ ] Null check occurs as first operation in method
- [ ] No panel property access before validation
- [ ] Maintain existing error logging

**Complexity**: Simple (5-10 lines changed)

---

### Task 1.2: Fix WebviewMessageHandlerService Silent Error Handling ⚠️ CRITICAL

**Issue**: `webview-message-handler.service.ts:146-151` catches handler errors but doesn't send error response to webview, leaving frontend hanging.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\lib\services\webview-message-handler.service.ts`

**Line Numbers**: 146-151

**Current Code Pattern**:

```typescript
catch (error) {
  this.logger.error(`Handler failed for ${messageType}:`, error);
  // BUG: No response sent to webview!
}
```

**Required Fix**:

1. Send error response to webview on handler failure
2. Use standard RPC error format: `{ success: false, error: string }`
3. Preserve error logging

**Implementation Pattern**:

```typescript
catch (error) {
  this.logger.error(`Handler failed for ${messageType}:`, error);

  // Send error response to webview
  this.panel.webview.postMessage({
    type: 'error',
    requestId: message.requestId,
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}
```

**Acceptance Criteria**:

- [ ] Error response sent to webview on handler failure
- [ ] Response includes `requestId` for request matching
- [ ] Error logging preserved
- [ ] Frontend receives structured error message

**Complexity**: Simple (10-15 lines changed)

---

### Task 1.3: Add initialView Validation ⚠️ CRITICAL

**Issue**: `app.ts:108-127` and `webview-html-generator.ts` accept any string for `initialView`, allowing invalid views to crash navigation.

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-html-generator.ts`

**Line Numbers**:

- `app.ts`: 108-127
- `webview-html-generator.ts`: 30-52

**Current Code Issue**:

```typescript
// app.ts - accepts any string
const initialView = document.body.dataset.initialView || 'chat';

// webview-html-generator.ts - no validation
generateHtml(options: { initialView?: string }) {
  // No validation that initialView is valid ViewType
}
```

**Required Fix**:

1. Add `ViewType` enum validation in `webview-html-generator.ts`
2. Throw descriptive error if invalid view provided
3. Add runtime validation in `app.ts`
4. Default to 'chat' on invalid value (graceful degradation)

**Implementation Pattern**:

```typescript
// In webview-html-generator.ts
import { ViewType } from '@ptah-extension/shared';

generateHtml(options: { initialView?: ViewType }) {
  const validViews: ViewType[] = ['chat', 'setup-wizard', 'settings', 'dashboard'];
  const initialView = options.initialView || 'chat';

  if (!validViews.includes(initialView)) {
    throw new Error(`Invalid initialView: ${initialView}. Valid values: ${validViews.join(', ')}`);
  }

  // Continue with validated view...
}

// In app.ts
const rawInitialView = document.body.dataset.initialView;
const validViews: ViewType[] = ['chat', 'setup-wizard', 'settings', 'dashboard'];
const initialView = validViews.includes(rawInitialView as ViewType)
  ? (rawInitialView as ViewType)
  : 'chat';
```

**Acceptance Criteria**:

- [ ] `webview-html-generator.ts` accepts only `ViewType` enum values
- [ ] Descriptive error thrown for invalid backend values
- [ ] `app.ts` validates runtime data-attribute value
- [ ] Graceful fallback to 'chat' on invalid frontend value
- [ ] Type safety enforced at compile time

**Complexity**: Medium (20-30 lines changed across 2 files)

---

## BATCH 2: Architectural Violations (PRIORITY: P1)

**Estimated Effort**: 2-3 hours
**Developer Type**: Backend Developer
**Dependencies**: None (can run parallel to Batch 1)

These fixes address architectural pattern violations that reduce maintainability.

### Task 2.1: Remove Runtime Symbol Resolution 🚫 BLOCKING

**Issue**: `webview-message-handler.service.ts:212-234` uses `Symbol.for('PermissionPromptService')` instead of importing from TOKENS, breaking DI consistency.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\lib\services\webview-message-handler.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts` (verify token exists)

**Line Numbers**: 212-234

**Current Code (BAD)**:

```typescript
const service = this.container.get(Symbol.for('PermissionPromptService'));
```

**Required Fix**:

1. Import `PERMISSION_PROMPT_SERVICE` from `@ptah-extension/vscode-core/tokens`
2. Replace runtime symbol resolution with imported token
3. Verify token is exported from `tokens.ts`

**Implementation Pattern**:

```typescript
import { PERMISSION_PROMPT_SERVICE } from '../di/tokens';

// In handler method
const service = this.container.get(PERMISSION_PROMPT_SERVICE);
```

**Acceptance Criteria**:

- [ ] `PERMISSION_PROMPT_SERVICE` token imported from tokens.ts
- [ ] No `Symbol.for()` calls in webview-message-handler.service.ts
- [ ] Service resolution works identically
- [ ] Pattern matches other DI token usage in file

**Complexity**: Simple (5 lines changed)

---

### Task 2.2: Remove Dual Message Handler Pattern 🚫 BLOCKING

**Issue**: `setup-wizard.service.ts:213-229` injects `WebviewMessageHandlerService` but doesn't use it, creating confusion about message handling architecture.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 213-229

**Current Code Issue**:

```typescript
constructor(
  @inject(WEBVIEW_MESSAGE_HANDLER_SERVICE)
  private readonly messageHandler: WebviewMessageHandlerService, // Injected but unused!
) {}

// Lines 218-229: Manually registers message listeners instead of delegating to messageHandler
private setupMessageHandlers(): void {
  this.panel.webview.onDidReceiveMessage((message) => {
    // Manual handling instead of using this.messageHandler
  });
}
```

**Decision Required**: Choose ONE approach:

**Option A: Use WebviewMessageHandlerService (RECOMMENDED)**

- Remove manual message listener registration
- Delegate to `this.messageHandler.handleMessage(message, this.panel)`
- Maintains architectural consistency

**Option B: Remove WebviewMessageHandlerService Injection**

- Remove dependency injection of `messageHandler`
- Keep manual listener registration
- Document why wizard uses custom handling

**Recommended**: **Option A** - Maintains consistency with established pattern

**Implementation Pattern (Option A)**:

```typescript
private setupMessageHandlers(): void {
  this.panel.webview.onDidReceiveMessage((message) => {
    this.messageHandler.handleMessage(message, this.panel);
  });
}
```

**Acceptance Criteria**:

- [ ] Wizard uses EITHER WebviewMessageHandlerService OR manual handling (not both)
- [ ] If using messageHandler, all messages delegated
- [ ] If using manual handling, remove messageHandler injection
- [ ] Pattern documented in JSDoc comment

**Complexity**: Medium (15-20 lines changed)

---

### Task 2.3: Add Type Safety for Step Transitions 🚫 BLOCKING

**Issue**: `setup-wizard-state.service.ts` uses `Record<string, unknown>` for step data instead of defined `StepData` discriminated union, losing type safety.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\types\wizard-types.ts` (verify StepData type exists)

**Line Numbers**: 116-151 (signal definitions)

**Current Code Issue**:

```typescript
// Generic Record loses type safety
private stepData = signal<Record<string, unknown>>({});
```

**Required Fix**:

1. Verify `StepData` discriminated union exists in wizard-types.ts
2. If missing, create proper discriminated union type
3. Update signal type to use `StepData`
4. Update step transition methods to enforce type safety

**Implementation Pattern**:

```typescript
// In wizard-types.ts (if doesn't exist)
export type StepData =
  | { step: 'project-detection'; data: { projectType: string; rootPath: string } }
  | { step: 'file-scanning'; data: { filesScanned: number; progress: number } }
  | { step: 'agent-selection'; data: { selectedAgent: string } }
  | { step: 'rule-generation'; data: { rulesGenerated: string[] } }
  // ... other steps

// In setup-wizard-state.service.ts
private stepData = signal<StepData | null>(null);

setStepData(data: StepData): void {
  this.stepData.set(data);
  // Type-safe access now enforced!
}
```

**Acceptance Criteria**:

- [ ] `StepData` discriminated union type exists
- [ ] Signal typed as `StepData | null`
- [ ] Step transition methods accept only valid StepData
- [ ] TypeScript enforces type safety at compile time
- [ ] No `Record<string, unknown>` usage for step data

**Complexity**: Medium (30-40 lines changed across 2 files)

---

## BATCH 3: Pattern Inconsistencies (PRIORITY: P2)

**Estimated Effort**: 1.5-2 hours
**Developer Type**: Frontend Developer
**Dependencies**: None

These fixes standardize signal patterns and documentation.

### Task 3.1: Fix Signal Exposure Pattern

**Issue**: `setup-wizard-state.service.ts:116-151` exposes signals directly instead of using `.asReadonly()` pattern.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Line Numbers**: 116-151

**Current Code Pattern**:

```typescript
public currentStep = signal<WizardStep>('project-detection');
// Should be:
// private currentStepSignal = signal<WizardStep>('project-detection');
// public readonly currentStep = this.currentStepSignal.asReadonly();
```

**Required Fix**:

1. Rename public signals to private with `Signal` suffix
2. Create public readonly computed signals
3. Update all internal usage to use private signals
4. Maintain public API compatibility

**Pattern to Follow** (from `AppStateManager`):

```typescript
// Private writable signal
private currentStepSignal = signal<WizardStep>('project-detection');

// Public readonly signal
public readonly currentStep = this.currentStepSignal.asReadonly();

// Setter method for internal use
private setCurrentStep(step: WizardStep): void {
  this.currentStepSignal.set(step);
}
```

**Acceptance Criteria**:

- [ ] All writable signals are private with `Signal` suffix
- [ ] All public signals use `.asReadonly()`
- [ ] Setter methods created for state mutations
- [ ] Public API unchanged (no breaking changes)
- [ ] Pattern matches `AppStateManager` in `@ptah-extension/core`

**Complexity**: Medium (40-50 lines changed)

---

### Task 3.2: Document Magic Window Augmentation

**Issue**: `app-state.service.ts:60-64` augments `window` object without documentation, making it unclear why this exists.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts`

**Line Numbers**: 60-64

**Current Code**:

```typescript
// Line 60-64: No explanation why window is augmented
(window as any).appStateManager = this;
```

**Required Fix**:

1. Add JSDoc comment explaining purpose
2. Document which tools/debugging scenarios need this
3. Add warning about not using in production code
4. Consider TypeScript declaration augmentation

**Implementation Pattern**:

````typescript
/**
 * DEBUG ONLY: Expose AppStateManager to window for VS Code DevTools debugging.
 *
 * Allows developers to inspect state in webview DevTools console:
 * ```
 * window.appStateManager.currentView() // Get current view
 * window.appStateManager.debugState()  // Dump full state
 * ```
 *
 * @internal - Do not use in production code
 * @see https://code.visualstudio.com/api/extension-guides/webview#debugging-webviews
 */
(window as WindowWithDebugTools).appStateManager = this;

// In types file:
interface WindowWithDebugTools extends Window {
  appStateManager?: AppStateManager;
}
````

**Acceptance Criteria**:

- [ ] JSDoc comment explains purpose
- [ ] Usage examples provided in comment
- [ ] Warning added about production usage
- [ ] Type augmentation added if keeping this pattern

**Complexity**: Simple (10-15 lines documentation)

---

### Task 3.3: Document Workspace State Persistence

**Issue**: `setup-wizard.service.ts:593-610` persists workspace state without documentation on persistence strategy.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 593-610

**Required Fix**:

1. Add JSDoc explaining what data is persisted
2. Document persistence location (workspace storage vs global storage)
3. Explain when persistence occurs (on step completion? on wizard close?)
4. Document cleanup strategy

**Implementation Pattern**:

```typescript
/**
 * Persists wizard progress to VS Code workspace storage.
 *
 * **Persisted Data**:
 * - Current step index
 * - Step completion status
 * - User selections per step
 *
 * **Storage Location**: `context.workspaceState.get('setupWizard')`
 *
 * **Persistence Trigger**: After each successful step transition
 *
 * **Cleanup**: Cleared when wizard completes successfully or user clicks "Start Over"
 *
 * @see https://code.visualstudio.com/api/references/vscode-api#Memento
 */
private async persistWizardState(): Promise<void> {
  // Implementation...
}
```

**Acceptance Criteria**:

- [ ] JSDoc documents persisted data structure
- [ ] Storage location documented
- [ ] Persistence triggers documented
- [ ] Cleanup strategy documented

**Complexity**: Simple (10-15 lines documentation)

---

### Task 3.4: Document Triple-Layered Message Routing

**Issue**: `webview-message-handler.service.ts:95-152` implements triple-layered routing (global → custom → fallback) without architecture documentation.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\lib\services\webview-message-handler.service.ts`

**Line Numbers**: 95-152

**Required Fix**:

1. Add class-level JSDoc explaining routing architecture
2. Document execution order (global → custom → fallback)
3. Explain when to use each layer
4. Provide examples of each handler type

**Implementation Pattern**:

````typescript
/**
 * Handles webview messages with triple-layered routing architecture.
 *
 * ## Routing Order
 *
 * 1. **Global Handlers** (registered via `registerGlobalHandler`)
 *    - Always execute first
 *    - Used for cross-cutting concerns (logging, analytics)
 *    - Cannot prevent custom handler execution
 *
 * 2. **Custom Handlers** (registered via `registerHandler`)
 *    - Execute after global handlers
 *    - Domain-specific message handling
 *    - If present, prevents fallback execution
 *
 * 3. **Fallback Handler** (optional, set via `setFallbackHandler`)
 *    - Executes ONLY if no custom handler registered
 *    - Used for generic error responses
 *
 * ## Example Usage
 *
 * ```typescript
 * // Global handler (runs for ALL messages)
 * messageHandler.registerGlobalHandler((msg) => logger.log(msg.type));
 *
 * // Custom handler (specific message type)
 * messageHandler.registerHandler('wizard:next-step', async (msg) => {...});
 *
 * // Fallback (unknown message types)
 * messageHandler.setFallbackHandler((msg) => ({ error: 'Unknown message' }));
 * ```
 */
@injectable()
export class WebviewMessageHandlerService {
  // Implementation...
}
````

**Acceptance Criteria**:

- [ ] Class JSDoc explains triple-layer architecture
- [ ] Execution order documented
- [ ] Use cases for each layer explained
- [ ] Code examples provided

**Complexity**: Simple (20-30 lines documentation)

---

## BATCH 4: Race Conditions & Resource Cleanup (PRIORITY: P2)

**Estimated Effort**: 2 hours
**Developer Type**: Backend Developer
**Dependencies**: Batch 1 (critical fixes must be done first)

### Task 4.1: Add Wizard Launch Debouncing

**Issue**: `setup-wizard.service.ts:125-168` has no debouncing for concurrent wizard launch attempts, allowing race conditions.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 125-168

**Current Code Issue**:

```typescript
async showWizard(): Promise<void> {
  // No check if wizard already launching
  this.panel = vscode.window.createWebviewPanel(...);
  // Race: Multiple calls create multiple panels
}
```

**Required Fix**:

1. Add `isLaunching` flag to prevent concurrent launches
2. Return early if wizard already launching
3. Clear flag after launch completes (success or error)

**Implementation Pattern**:

```typescript
private isLaunching = false;

async showWizard(): Promise<void> {
  // Prevent concurrent launches
  if (this.isLaunching) {
    this.logger.warn('Wizard launch already in progress, ignoring duplicate request');
    return;
  }

  if (this.panel) {
    this.panel.reveal();
    return;
  }

  try {
    this.isLaunching = true;
    this.panel = vscode.window.createWebviewPanel(...);
    // Rest of initialization...
  } finally {
    this.isLaunching = false;
  }
}
```

**Acceptance Criteria**:

- [ ] Concurrent launch attempts prevented
- [ ] `isLaunching` flag cleared on success and error
- [ ] Warning logged for duplicate launch attempts
- [ ] Existing panel revealed instead of creating duplicate

**Complexity**: Simple (15-20 lines changed)

---

### Task 4.2: Fix Message Listener Registration Order

**Issue**: `setup-wizard.service.ts:198-229` sets HTML before registering message listeners, creating race condition where early messages are lost.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 198-229

**Current Code Issue**:

```typescript
// Line 198: HTML set FIRST (webview starts loading)
this.panel.webview.html = htmlGenerator.generateHtml(...);

// Line 218: Listeners registered SECOND (race condition!)
this.setupMessageHandlers();
```

**Required Fix**:

1. Register message listeners BEFORE setting HTML
2. Ensure listeners are ready before webview starts loading
3. Add comment explaining order dependency

**Implementation Pattern**:

```typescript
// CRITICAL ORDER: Register listeners BEFORE setting HTML
// Prevents race condition where webview sends messages before listeners ready
this.setupMessageHandlers(); // FIRST

// Now safe to load webview content
this.panel.webview.html = htmlGenerator.generateHtml(...); // SECOND
```

**Acceptance Criteria**:

- [ ] Message listeners registered before HTML assignment
- [ ] Comment explains order dependency
- [ ] No messages lost during webview initialization

**Complexity**: Simple (5-10 lines reordered)

---

### Task 4.3: Add Workspace Root Validation

**Issue**: `setup-wizard.service.ts:164` doesn't validate empty workspace root before proceeding.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 164

**Required Fix**:

1. Check if workspace root is empty string or undefined
2. Show error message to user if no workspace open
3. Abort wizard launch gracefully

**Implementation Pattern**:

```typescript
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

if (!workspaceRoot) {
  this.logger.error('Cannot launch wizard: No workspace folder open');
  vscode.window.showErrorMessage('Setup Wizard requires an open workspace folder. Please open a project folder first.');
  return;
}

// Continue with valid workspace root...
```

**Acceptance Criteria**:

- [ ] Workspace root validated before wizard launch
- [ ] User-friendly error message shown if no workspace
- [ ] Wizard aborts gracefully (no crash)
- [ ] Error logged for debugging

**Complexity**: Simple (10-15 lines added)

---

### Task 4.4: Add Session Cleanup on Non-Panel Errors

**Issue**: `setup-wizard.service.ts:236-241` missing session cleanup when errors occur outside panel disposal.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

**Line Numbers**: 236-241

**Current Code**:

```typescript
// Panel disposal cleanup exists
this.panel.onDidDispose(() => {
  this.cleanup();
});

// But other error paths don't cleanup!
catch (error) {
  this.logger.error('Wizard failed:', error);
  // Missing: this.cleanup();
}
```

**Required Fix**:

1. Add `cleanup()` calls to all error paths
2. Make `cleanup()` idempotent (safe to call multiple times)
3. Ensure panel disposal still triggers cleanup

**Implementation Pattern**:

```typescript
private cleanup(): void {
  // Make idempotent
  if (!this.panel && !this.currentSession) {
    return; // Already cleaned up
  }

  // Cleanup logic...
  this.panel = undefined;
  this.currentSession = undefined;
}

// In error handlers
catch (error) {
  this.logger.error('Wizard failed:', error);
  this.cleanup(); // Ensure cleanup on errors
  throw error;
}
```

**Acceptance Criteria**:

- [ ] `cleanup()` method is idempotent
- [ ] All error paths call `cleanup()`
- [ ] Panel disposal still triggers cleanup
- [ ] No resource leaks on error

**Complexity**: Simple (10-15 lines changed)

---

### Task 4.5: Add Message Listener Unsubscription

**Issue**: `SetupWizardStateService` registers message listener but never unsubscribes, causing memory leak.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Line Numbers**: (Find message listener registration)

**Required Fix**:

1. Store message listener subscription
2. Implement `ngOnDestroy()` or cleanup method
3. Unsubscribe on service destruction

**Implementation Pattern**:

```typescript
export class SetupWizardStateService implements OnDestroy {
  private messageSubscription?: () => void;

  constructor() {
    // Store unsubscribe function
    this.messageSubscription = this.vscodeService.onMessage((msg) => {
      // Handler logic...
    });
  }

  ngOnDestroy(): void {
    this.messageSubscription?.();
  }
}
```

**Acceptance Criteria**:

- [ ] Message listener subscription stored
- [ ] `ngOnDestroy()` implemented
- [ ] Subscription cleaned up on destroy
- [ ] No memory leaks on component destruction

**Complexity**: Simple (10-15 lines added)

---

## BATCH 5: Documentation & Component Verification (PRIORITY: P3)

**Estimated Effort**: 1 hour
**Developer Type**: Frontend Developer
**Dependencies**: None (pure documentation)

### Task 5.1: Add Implicit View Switching Contract Documentation

**Issue**: `app-shell.component.html:186-193` has implicit contract for view switching without documentation.

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\components\templates\app-shell.component.html`
- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\components\templates\app-shell.component.ts`

**Line Numbers**: 186-193 (HTML)

**Required Fix**:

1. Add HTML comment explaining view switching logic
2. Add JSDoc to TypeScript component
3. Document signal dependencies

**Implementation Pattern**:

```html
<!--
  View Switching Contract:
  - appStateManager.currentView() signal determines visible component
  - Only ONE component rendered at a time (ngIf guards)
  - View changes trigger automatic component lifecycle (ngOnInit/ngOnDestroy)
  - View state persists in respective state services (ChatStore, SetupWizardStateService, etc.)
-->
@if (appStateManager.currentView() === 'chat') {
<app-chat-container />
} @else if (appStateManager.currentView() === 'setup-wizard') {
<app-wizard-view />
}
<!-- ... -->
```

**Acceptance Criteria**:

- [ ] HTML comment explains view switching contract
- [ ] Component JSDoc documents view lifecycle
- [ ] Signal dependencies documented

**Complexity**: Simple (10-15 lines documentation)

---

### Task 5.2: Standardize WizardViewComponent Documentation

**Issue**: `wizard-view.component.ts` has inconsistent component documentation.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`

**Required Fix**:

1. Add class JSDoc following project template
2. Document component responsibilities
3. Document signal inputs/outputs
4. Add usage example

**Pattern to Follow** (from existing components):

````typescript
/**
 * Wizard View Component - Main container for setup wizard UI.
 *
 * **Responsibilities**:
 * - Render current wizard step component
 * - Display step progress indicator
 * - Handle step navigation (next/previous)
 * - Coordinate with SetupWizardStateService for state
 *
 * **State Management**:
 * - Current step: `wizardState.currentStep()` signal
 * - Step data: `wizardState.stepData()` signal
 *
 * **Usage**:
 * ```html
 * <app-wizard-view />
 * ```
 *
 * @see SetupWizardStateService
 */
@Component({...})
export class WizardViewComponent {
  // Implementation...
}
````

**Acceptance Criteria**:

- [ ] Class JSDoc follows project template
- [ ] Responsibilities listed
- [ ] Signal dependencies documented
- [ ] Usage example provided

**Complexity**: Simple (15-20 lines documentation)

---

### Task 5.3: Verify WizardViewComponent Import Registration

**Issue**: Need to verify `WizardViewComponent` is properly registered in `app-shell.component.ts` imports array.

**Files to Verify**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\components\templates\app-shell.component.ts`

**Verification Steps**:

1. Check if `WizardViewComponent` in imports array
2. Check if import statement exists
3. Verify standalone component configuration

**Expected Code**:

```typescript
import { WizardViewComponent } from '@ptah-extension/setup-wizard';

@Component({
  standalone: true,
  imports: [
    // ... other imports
    WizardViewComponent, // Should be present
  ],
})
export class AppShellComponent {
  // ...
}
```

**If Missing**:

- Add import statement
- Add to imports array
- Test wizard view rendering

**Acceptance Criteria**:

- [ ] `WizardViewComponent` imported from correct library
- [ ] Component in imports array
- [ ] Wizard view renders without errors

**Complexity**: Simple (verification + possible 2-line fix)

---

## BATCH 6: Low-Priority Improvements (PRIORITY: P4)

**Estimated Effort**: 1.5 hours
**Developer Type**: Backend Developer
**Dependencies**: All previous batches complete

### Task 6.1: Add Custom Message Handler Timeout

**Issue**: No timeout protection for custom message handlers in `WebviewMessageHandlerService`.

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\lib\services\webview-message-handler.service.ts`

**Required Fix**:

1. Add configurable timeout (default: 5000ms)
2. Wrap handler execution in timeout Promise
3. Log timeout errors
4. Send timeout error to webview

**Implementation Pattern**:

```typescript
private async executeHandlerWithTimeout<T>(
  handler: MessageHandler<T>,
  message: T,
  timeoutMs = 5000
): Promise<unknown> {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Handler timeout')), timeoutMs);
  });

  const handlerPromise = handler(message);

  return Promise.race([handlerPromise, timeoutPromise]);
}
```

**Acceptance Criteria**:

- [ ] Default 5-second timeout for handlers
- [ ] Timeout configurable per handler
- [ ] Timeout errors logged
- [ ] Webview receives timeout error response

**Complexity**: Medium (30-40 lines added)

---

### Task 6.2: Add ptahConfig Bootstrap Race Condition Protection

**Issue**: `ptahConfig` may not be ready when accessed during bootstrap.

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.ts`

**Required Fix**:

1. Add null check for `window.ptahConfig`
2. Show loading state while config loads
3. Retry config load with timeout

**Implementation Pattern**:

```typescript
async function waitForPtahConfig(timeoutMs = 3000): Promise<PtahConfig> {
  const startTime = Date.now();

  while (!window.ptahConfig) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('ptahConfig not available after timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return window.ptahConfig;
}

// In bootstrap
const config = await waitForPtahConfig();
```

**Acceptance Criteria**:

- [ ] `ptahConfig` availability verified before use
- [ ] Retry logic with timeout
- [ ] Descriptive error on timeout
- [ ] Loading indicator shown during wait

**Complexity**: Medium (25-30 lines added)

---

### Task 6.3: Document Parameter Overloading in webview-html-generator

**Issue**: `webview-html-generator.ts:30-52` has parameter overloading without documentation explaining why.

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\webview-html-generator.ts`

**Line Numbers**: 30-52

**Required Fix**:

1. Add JSDoc explaining overload purpose
2. Document which overload to use when
3. Provide examples

**Implementation Pattern**:

````typescript
/**
 * Generates webview HTML with configurable options.
 *
 * **Overloads**:
 * 1. `generateHtml(options: HtmlOptions)` - Full control over all options
 * 2. `generateHtml(initialView: ViewType)` - Shorthand for common case
 *
 * **When to Use Each**:
 * - Use options overload when customizing CSP, scripts, or styles
 * - Use shorthand overload for simple view routing
 *
 * **Examples**:
 * ```typescript
 * // Shorthand (common case)
 * const html = generator.generateHtml('setup-wizard');
 *
 * // Full options (advanced)
 * const html = generator.generateHtml({
 *   initialView: 'chat',
 *   nonce: customNonce,
 *   cspSource: panel.webview.cspSource,
 * });
 * ```
 */
generateHtml(optionsOrView: HtmlOptions | ViewType): string {
  // Implementation...
}
````

**Acceptance Criteria**:

- [ ] JSDoc explains overload purpose
- [ ] Usage guidance provided
- [ ] Code examples for each overload

**Complexity**: Simple (15-20 lines documentation)

---

## Summary of All Tasks

### By Priority

| Priority               | Tasks        | Estimated Effort |
| ---------------------- | ------------ | ---------------- |
| **P0 (Critical)**      | 3            | 2-3 hours        |
| **P1 (Blocking)**      | 3            | 2-3 hours        |
| **P2 (Serious)**       | 9            | 4.5-5 hours      |
| **P3 (Documentation)** | 3            | 1 hour           |
| **P4 (Low Priority)**  | 3            | 1.5 hours        |
| **TOTAL**              | **21 tasks** | **11-14 hours**  |

### By Developer Type

| Developer Type     | Batches            | Estimated Effort |
| ------------------ | ------------------ | ---------------- |
| Backend Developer  | Batches 1, 2, 4, 6 | 7.5-9 hours      |
| Frontend Developer | Batches 3, 5       | 2-3 hours        |

### Execution Order

**Phase 1: Critical Safety** (MUST DO FIRST)

1. Batch 1: Critical Safety Fixes (Tasks 1.1-1.3)

**Phase 2: Architecture Compliance** (CAN RUN IN PARALLEL) 2. Batch 2: Architectural Violations (Tasks 2.1-2.3) 3. Batch 3: Pattern Inconsistencies (Tasks 3.1-3.4)

**Phase 3: Robustness** (AFTER PHASE 1) 4. Batch 4: Race Conditions & Cleanup (Tasks 4.1-4.5)

**Phase 4: Polish** (OPTIONAL - CAN DEFER) 5. Batch 5: Documentation (Tasks 5.1-5.3) 6. Batch 6: Low-Priority Improvements (Tasks 6.1-6.3)

---

## Testing Strategy

### Per-Batch Testing

**After Batch 1 (Critical Fixes)**:

- [ ] Test wizard launch with panel already open (null check)
- [ ] Test wizard with RPC handler errors (error response sent)
- [ ] Test with invalid initialView values (validation works)

**After Batch 2 (Architectural)**:

- [ ] Verify DI token resolution works
- [ ] Test message handler delegation
- [ ] Test step transitions with type-safe data

**After Batch 4 (Race Conditions)**:

- [ ] Test concurrent wizard launches (debouncing works)
- [ ] Test message listener registration order (no lost messages)
- [ ] Test wizard cleanup on errors

### Integration Testing

**Full Wizard Flow**:

1. Launch wizard from command palette
2. Navigate through all steps
3. Send messages from webview
4. Trigger errors and verify recovery
5. Close wizard and verify cleanup

### Regression Testing

**Verify No Breakage**:

- [ ] Chat view still loads correctly
- [ ] Dashboard view still loads correctly
- [ ] Settings view still loads correctly
- [ ] Setup wizard initialView works

---

## Risk Assessment

### High-Risk Changes

| Task                    | Risk                      | Mitigation                    |
| ----------------------- | ------------------------- | ----------------------------- |
| Task 1.1 (Null check)   | Breaking existing flow    | Test all wizard launch paths  |
| Task 2.2 (Dual handler) | Breaking message handling | Verify all message types work |
| Task 2.3 (Type safety)  | Breaking step transitions | Test all wizard steps         |

### Low-Risk Changes

| Task Category        | Risk Level                        |
| -------------------- | --------------------------------- |
| Documentation tasks  | Very Low (no code changes)        |
| Signal pattern fixes | Low (internal changes only)       |
| Validation additions | Low (adds safety, doesn't remove) |

---

## Acceptance Criteria for Complete Fix

**All Fixes Complete When**:

- [ ] All 21 tasks marked complete
- [ ] Code style review score ≥ 8.5/10
- [ ] Code logic review score ≥ 8.5/10
- [ ] Zero critical/blocking issues remain
- [ ] Integration tests pass
- [ ] No new TypeScript errors introduced

---

## Notes for Developers

### Code Review Pattern Violations

**Common Issues to Avoid**:

1. ❌ Runtime symbol resolution (`Symbol.for()`) instead of imported tokens
2. ❌ Exposing writable signals directly (use `.asReadonly()`)
3. ❌ Silent error handling without user/webview notification
4. ❌ Type erasure with `Record<string, unknown>` instead of discriminated unions
5. ❌ Missing input validation for user-provided values

**Patterns to Follow**:

1. ✅ Import DI tokens from `tokens.ts`
2. ✅ Private writable signals + public readonly signals
3. ✅ Send error responses to webview on handler failures
4. ✅ Use discriminated unions for type-safe state
5. ✅ Validate all inputs, especially view names and step data

### Reference Files for Patterns

**Signal Pattern**: `libs/frontend/core/src/lib/services/app-state.service.ts`
**DI Token Usage**: `libs/backend/vscode-core/src/di/tokens.ts`
**Error Handling**: `libs/backend/vscode-core/src/lib/services/webview-message-handler.service.ts`
**Type Safety**: `libs/shared/src/lib/types/*`

---

**Document Version**: 1.0
**Created**: 2025-12-15
**Last Updated**: 2025-12-15
