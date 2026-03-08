# Development Tasks - TASK_2025_102

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- [x] PermissionResponse.decision type at permission.types.ts:52 - supports 'allow' | 'deny' | 'always_allow'
- [x] PermissionResponseSchema Zod schema at permission.types.ts:131-136
- [x] NativePopoverComponent API verified at libs/frontend/ui/src/lib/native/popover/native-popover.component.ts
- [x] PermissionRequestCardComponent at libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts
- [x] SdkPermissionHandler.handleResponse at sdk-permission-handler.ts:478-524
- [x] ISdkPermissionHandler interface at permission.types.ts:67-83

### Risks Identified

| Risk                                            | Severity | Mitigation            |
| ----------------------------------------------- | -------- | --------------------- |
| Backend deny response missing `interrupt: true` | HIGH     | Task 4.1 fixes this   |
| No cleanupPendingPermissions method             | MEDIUM   | Task 4.2 adds this    |
| Export barrel needs update                      | LOW      | Task 3.3 handles this |

### Edge Cases to Handle

- [x] Empty message submission -> Task 3.1 uses default "User denied without explanation"
- [x] Popover close via Escape -> NativePopoverComponent handles natively
- [x] Popover close via backdrop click -> NativePopoverComponent handles natively
- [x] Late permission response after abort -> handleResponse already checks pendingRequests.has()

---

## Batch 1: Shared Types ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: 5017b5e

### Task 1.1: Add 'deny_with_message' to PermissionResponse type ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts
**Spec Reference**: implementation-plan.md:76-86
**Pattern to Follow**: permission.types.ts:52

**Quality Requirements**:

- Add 'deny_with_message' to union type at line 52
- Update Zod schema at line 133 to include 'deny_with_message'
- Maintain backwards compatibility

**Implementation Details**:

- Location: Line 52 - change `'allow' | 'deny' | 'always_allow'` to `'allow' | 'deny' | 'always_allow' | 'deny_with_message'`
- Location: Line 133 - change `z.enum(['allow', 'deny', 'always_allow'])` to `z.enum(['allow', 'deny', 'always_allow', 'deny_with_message'])`

**Verification**: PASSED - Both TypeScript type and Zod schema updated correctly

---

### Task 1.2: Add cleanupPendingPermissions to ISdkPermissionHandler interface ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts
**Spec Reference**: implementation-plan.md:536-545
**Pattern to Follow**: permission.types.ts:67-83

**Quality Requirements**:

- Add method signature matching implementation plan
- Include JSDoc comment explaining purpose
- No breaking changes to existing interface

**Implementation Details**:

- Add after line 83 (after handleQuestionResponse method):

```typescript
/**
 * Cleanup pending permission requests for a session
 * Called when session is aborted
 */
cleanupPendingPermissions(sessionId?: string): void;
```

**Verification**: PASSED - Method signature with optional sessionId parameter and JSDoc added correctly

---

**Batch 1 Verification**:

- [x] TypeScript compiles without errors
- [x] Zod schema validates new decision type
- [x] Build passes: `npx nx build shared`
- [ ] code-logic-reviewer approved (skipped - type-only changes)

---

## Batch 2: Backend Changes ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 complete
**Commit**: 5017b5e

### Task 2.1: Update SdkPermissionHandler to set interrupt flag correctly ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
**Spec Reference**: implementation-plan.md:386-467
**Pattern to Follow**: sdk-permission-handler.ts:434-467 (requestUserPermission return statements)

**Quality Requirements**:

- Timeout returns `interrupt: true`
- Hard deny ('deny' decision) returns `interrupt: true`
- Deny with message ('deny_with_message' decision) returns `interrupt: false`
- Allow/always_allow unchanged
- Add logging for decision type and interrupt flag

**Validation Notes**:

- This fixes the bug where deny doesn't stop execution
- SDK's PermissionResult type at claude-sdk.types.ts supports `interrupt?: boolean`

**Implementation Details**:

- Update return statement for timeout (around line 439-443) to add `interrupt: true`
- Update return statement for deny (around line 464-467) to:
  - Check if `response.decision === 'deny_with_message'` -> `interrupt: false`
  - Otherwise (hard deny) -> `interrupt: true`
- Add info-level logging for each path with decision type

---

### Task 2.2: Implement cleanupPendingPermissions method ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
**Spec Reference**: implementation-plan.md:486-532
**Pattern to Follow**: sdk-permission-handler.ts:835-863 (dispose method)

**Quality Requirements**:

- Clear all pending permission requests with deny response
- Clear all pending question requests with null response
- Clear pending request context map
- Add logging for cleanup start and completion
- Handle case where sessionId is optional (cleanup all if not provided)

**Validation Notes**:

- This fixes the "Operation aborted" unhandled promise rejection bug
- Method must resolve all pending promises to prevent hanging

**Implementation Details**:

- Add method after dispose() (around line 864)
- Similar to dispose() but for session abort scenario
- Resolve permissions with `{ id: requestId, decision: 'deny', reason: 'Session aborted' }`
- Resolve questions with `null`

---

**Batch 2 Verification**:

- Build passes: `npx nx build agent-sdk`
- TypeScript compiles without errors
- code-logic-reviewer approved
- No unhandled promise rejections on abort

---

## Batch 3: Frontend Changes ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete
**Commit**: 9aabef8

### Task 3.1: Create DenyMessagePopoverComponent ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\deny-message-popover.component.ts (CREATE)
**Spec Reference**: implementation-plan.md:100-256
**Pattern to Follow**: autopilot-popover.component.ts:36-310

**Quality Requirements**:

- Standalone component with OnPush change detection
- Uses NativePopoverComponent from @ptah-extension/ui
- Signal-based state management
- Proper accessibility (aria-label on input)
- Focus management (input receives focus on open)
- DaisyUI btn-warning classes matching Deny button style
- Keyboard support (Enter to submit, Escape to close via NativePopoverComponent)

**Validation Notes**:

- Empty message should use default "User denied without explanation"
- Popover should open with trigger button (not separate trigger)

**Implementation Details**:

- Imports: `input, output, signal, ViewChild, ElementRef, AfterViewInit` from @angular/core
- Imports: `FormsModule` from @angular/forms
- Imports: `LucideAngularModule, Send, MessageSquare` from lucide-angular
- Imports: `NativePopoverComponent` from @ptah-extension/ui
- Input: `isOpen = input.required<boolean>()`, `disabled = input<boolean>(false)`
- Output: `messageSent = output<string>()`, `closed = output<void>()`
- Local state: `messageText = ''` (not signal, ngModel binding)
- Template: NativePopoverComponent with trigger button and content with input + send button
- handleOpened(): Focus input with small delay
- handleSubmit(): Emit trimmed message or default, clear text
- handleClose(): Clear text, emit closed

---

### Task 3.2: Update PermissionRequestCardComponent with 4th button ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts
**Spec Reference**: implementation-plan.md:259-374
**Pattern to Follow**: permission-request-card.component.ts:102-133 (action buttons)

**Quality Requirements**:

- Import DenyMessagePopoverComponent
- Add signal for popover state: `_isDenyPopoverOpen = signal(false)`
- Add 4th button using DenyMessagePopoverComponent after existing Deny button
- Update respond() method to accept 'deny_with_message' decision
- Handle deny with message callback

**Validation Notes**:

- The DenyMessagePopoverComponent provides its own trigger button (Deny... with icon)
- Parent just needs to manage isOpen state and handle messageSent event

**Implementation Details**:

- Add import: `import { DenyMessagePopoverComponent } from './deny-message-popover.component';`
- Add to imports array: `DenyMessagePopoverComponent`
- Add state: `private readonly _isDenyPopoverOpen = signal(false);`
- Add getter: `readonly isDenyPopoverOpen = this._isDenyPopoverOpen.asReadonly();`
- Add methods: `openDenyPopover()`, `closeDenyPopover()`, `handleDenyWithMessage(message: string)`
- Update template: Add `<ptah-deny-message-popover>` after existing Deny button
- Update respond() type: `decision: 'allow' | 'deny' | 'always_allow' | 'deny_with_message'`

---

### Task 3.3: Export DenyMessagePopoverComponent from barrel ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts
**Spec Reference**: implementation-plan.md:567-580
**Pattern to Follow**: index.ts:32-38 (molecules exports)

**Quality Requirements**:

- Add export in MOLECULES section
- Maintain alphabetical/logical ordering with other exports

**Implementation Details**:

- Add line after permission-badge export (around line 39):

```typescript
export * from './molecules/deny-message-popover.component';
```

---

### Task 3.4: Update PermissionResponse type usage in respond method ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts
**Spec Reference**: implementation-plan.md:314-319
**Pattern to Follow**: permission-request-card.component.ts:391-407 (respond method)

**Quality Requirements**:

- Update respond method parameter type to include 'deny_with_message'
- Ensure TypeScript compiles correctly with new type

**Validation Notes**:

- The PermissionResponse import comes from @ptah-extension/shared
- After Batch 1, the shared type will include 'deny_with_message'

**Implementation Details**:

- Line 391-394: Update type signature from `'allow' | 'deny' | 'always_allow'` to `'allow' | 'deny' | 'always_allow' | 'deny_with_message'`

---

### Task 3.5: Add handleDenyWithMessage method to PermissionRequestCardComponent ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts
**Spec Reference**: implementation-plan.md:303-319
**Pattern to Follow**: permission-request-card.component.ts:391-407 (respond method)

**Quality Requirements**:

- Clear timer before responding
- Close popover
- Emit response with 'deny_with_message' decision and reason

**Implementation Details**:

- Add method after respond() method:

```typescript
handleDenyWithMessage(message: string): void {
  // Clear timer before responding
  if (this.timerInterval) {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
  }

  // Close popover
  this._isDenyPopoverOpen.set(false);

  // Emit response with deny_with_message decision
  this.responded.emit({
    id: this.request().id,
    decision: 'deny_with_message',
    reason: message,
  });
}
```

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- TypeScript compiles without errors
- code-logic-reviewer approved
- 4th button appears in permission request card
- Popover opens and closes correctly

---

## Execution Order

1. **Batch 1** (Shared Types) - Must complete first, provides types for other batches
2. **Batch 2** (Backend) - Can run after Batch 1
3. **Batch 3** (Frontend) - Can run after Batch 1, parallel with Batch 2

## Files Affected Summary

**CREATE**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\deny-message-popover.component.ts

**MODIFY**:

- D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts
- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts
