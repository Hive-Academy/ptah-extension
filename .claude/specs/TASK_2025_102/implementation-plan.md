# Implementation Plan - TASK_2025_102: "Deny with Message" Permission Option

## Codebase Investigation Summary

### Libraries Discovered

| Library                       | Purpose                 | Key Exports                                                     |
| ----------------------------- | ----------------------- | --------------------------------------------------------------- |
| `@ptah-extension/shared`      | Type system foundation  | PermissionRequest, PermissionResponse, PermissionResponseSchema |
| `@ptah-extension/ui`          | UI components           | NativePopoverComponent, KeyboardNavigationService               |
| `@ptah-extension/agent-sdk`   | SDK permission handling | SdkPermissionHandler (backend)                                  |
| `@ptah-extension/vscode-core` | Message routing         | WebviewMessageHandlerService                                    |
| `@ptah-extension/chat`        | Permission UI           | PermissionRequestCardComponent, PermissionHandlerService        |

### Patterns Identified

**Pattern 1: Permission Response Flow**

- **Evidence**: `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts:250-254`
- **Flow**: Frontend emits `MESSAGE_TYPES.SDK_PERMISSION_RESPONSE` -> Backend routes to `SdkPermissionHandler.handleResponse()`

**Pattern 2: NativePopoverComponent Usage**

- **Evidence**: `libs/frontend/chat/src/lib/components/molecules/autopilot-popover.component.ts:41-48`
- **Components**: `NativePopoverComponent`, `KeyboardNavigationService` from `@ptah-extension/ui`
- **Conventions**: Signal-based state, `[isOpen]` input, `(closed)` output, `trigger` and `content` content projection

**Pattern 3: Lucide Icon Imports**

- **Evidence**: `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts:11`
- **Import**: `import { Send } from 'lucide-angular'`

**Pattern 4: SDK Permission Result Mapping**

- **Evidence**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:458-468`
- **Current Behavior**: Returns `{ behavior: 'deny', message: ... }` WITHOUT `interrupt: true`

### Integration Points

| Service                        | Location                                                         | Purpose                              |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------ |
| `PermissionHandlerService`     | `libs/frontend/chat/...permission-handler.service.ts`            | Frontend permission state management |
| `SdkPermissionHandler`         | `libs/backend/agent-sdk/...sdk-permission-handler.ts`            | Backend SDK permission callback      |
| `WebviewMessageHandlerService` | `libs/backend/vscode-core/...webview-message-handler.service.ts` | Message routing                      |

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Extend existing permission request card with inline popover for deny-with-message input.

**Rationale**:

1. Requirements spec calls for a 4th button ("Deny with Message") in the existing permission card
2. NativePopoverComponent provides a proven, accessible popover pattern already used in autopilot-popover
3. Signal-based state management aligns with Angular 20+ patterns used throughout the codebase

**Evidence**:

- Similar popover pattern: `autopilot-popover.component.ts:41-48`
- Permission card location: `permission-request-card.component.ts:54-134`

---

## Component Specifications

### Component 1: PermissionResponse Type Extension

**Purpose**: Add `'deny_with_message'` decision type to the PermissionResponse interface and Zod schema.

**Pattern**: Extending union types with Zod schema validation
**Evidence**: `libs/shared/src/lib/types/permission.types.ts:52-59`, `libs/shared/src/lib/types/permission.types.ts:131-136`

**Changes Required**:

```typescript
// File: libs/shared/src/lib/types/permission.types.ts

// Line 52: Update PermissionResponse.decision union type
readonly decision: 'allow' | 'deny' | 'always_allow' | 'deny_with_message';

// Line 133: Update Zod schema
decision: z.enum(['allow', 'deny', 'always_allow', 'deny_with_message']),
```

**Quality Requirements**:

- TypeScript union type ensures compile-time safety
- Zod schema ensures runtime validation
- Backward compatible (existing decisions still valid)

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts` (MODIFY)

---

### Component 2: DenyMessagePopoverComponent (NEW)

**Purpose**: Inline popover with text input and send button for deny-with-message functionality.

**Pattern**: Signal-based standalone component using NativePopoverComponent
**Evidence**:

- Popover pattern: `autopilot-popover.component.ts:36-310`
- Icon import: `chat-input.component.ts:11` (Send icon)

**Component Specification**:

```typescript
// File: libs/frontend/chat/src/lib/components/molecules/deny-message-popover.component.ts

import { Component, input, output, signal, ChangeDetectionStrategy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Send, MessageSquare } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';

/**
 * DenyMessagePopoverComponent - Popover for deny-with-message input
 *
 * Complexity Level: 2 (Signal-based with focus management)
 * Patterns: NativePopoverComponent, signal inputs/outputs
 *
 * Accessibility:
 * - Input has aria-label="Message to Claude"
 * - Focus moves to input on open
 * - Focus returns to trigger on close
 * - Escape closes popover
 */
@Component({
  selector: 'ptah-deny-message-popover',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-popover [isOpen]="isOpen()" [placement]="'top'" [hasBackdrop]="true" [backdropClass]="'transparent'" (closed)="handleClose()" (opened)="handleOpened()">
      <!-- Trigger Button -->
      <button trigger class="btn btn-xs btn-warning btn-outline gap-0.5 px-2" type="button" aria-label="Deny with a message to Claude" [disabled]="disabled()">
        <lucide-angular [img]="MessageSquareIcon" class="w-3 h-3" />
        Deny...
      </button>

      <!-- Popover Content -->
      <div content class="p-2 w-64">
        <div class="flex gap-1.5 items-center">
          <input #messageInput type="text" class="input input-xs input-bordered flex-1 text-xs" placeholder="Explain why or suggest alternatives..." aria-label="Message to Claude" [(ngModel)]="messageText" (keydown.enter)="handleSubmit()" (keydown.escape)="handleClose()" />
          <button class="btn btn-xs btn-warning gap-0.5" type="button" (click)="handleSubmit()" aria-label="Send message and deny">
            <lucide-angular [img]="SendIcon" class="w-3 h-3" />
          </button>
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class DenyMessagePopoverComponent implements AfterViewInit {
  // Inputs
  readonly isOpen = input.required<boolean>();
  readonly disabled = input<boolean>(false);

  // Outputs
  readonly messageSent = output<string>();
  readonly closed = output<void>();

  // Icons
  protected readonly SendIcon = Send;
  protected readonly MessageSquareIcon = MessageSquare;

  // Local state
  protected messageText = '';

  @ViewChild('messageInput') messageInput!: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void {
    // Focus management handled by effect when isOpen changes
  }

  /**
   * Handle popover opened - focus input
   */
  handleOpened(): void {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      this.messageInput?.nativeElement?.focus();
    }, 50);
  }

  /**
   * Handle submit - emit message and close
   */
  handleSubmit(): void {
    // Use default message if empty
    const message = this.messageText.trim() || 'User denied without explanation';
    this.messageSent.emit(message);
    this.messageText = '';
  }

  /**
   * Handle close - clear and emit
   */
  handleClose(): void {
    this.messageText = '';
    this.closed.emit();
  }
}
```

**Quality Requirements**:

- Functional: Opens on button click, closes on backdrop/escape/submit
- Functional: Input receives focus on open
- Functional: Enter key submits message
- Non-Functional: Uses DaisyUI btn-warning classes matching existing Deny button style
- Pattern Compliance: Uses NativePopoverComponent (verified at `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts`)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\deny-message-popover.component.ts` (CREATE)

---

### Component 3: PermissionRequestCardComponent Updates

**Purpose**: Add 4th "Deny..." button that opens DenyMessagePopoverComponent.

**Pattern**: Composing molecules with signal-based state
**Evidence**: `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts:102-133`

**Changes Required**:

```typescript
// File: libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts

// Add imports
import { DenyMessagePopoverComponent } from './deny-message-popover.component';

// Update imports array
imports: [LucideAngularModule, DenyMessagePopoverComponent],

// Add signal for popover state
private readonly _isDenyPopoverOpen = signal(false);
readonly isDenyPopoverOpen = this._isDenyPopoverOpen.asReadonly();

// Add template for 4th button (after Deny button in action buttons row)
// Line ~131 (after existing Deny button)
<ptah-deny-message-popover
  [isOpen]="isDenyPopoverOpen()"
  [disabled]="false"
  (messageSent)="handleDenyWithMessage($event)"
  (closed)="closeDenyPopover()"
>
</ptah-deny-message-popover>

// Replace existing Deny button trigger with popover trigger
// The DenyMessagePopoverComponent provides its own trigger button

// Add methods
openDenyPopover(): void {
  this._isDenyPopoverOpen.set(true);
}

closeDenyPopover(): void {
  this._isDenyPopoverOpen.set(false);
}

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

**Full Template Button Row Update**:

```html
<!-- Action buttons - compact row -->
<div class="flex gap-1.5 px-2 py-1.5 border-t border-base-300/30 bg-base-100/20">
  <button class="btn btn-xs btn-success gap-0.5 px-2" (click)="respond('allow')" type="button" aria-label="Allow this request once">
    <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
    Allow
  </button>
  <button class="btn btn-xs btn-info gap-0.5 px-2" (click)="respond('always_allow')" type="button" aria-label="Always allow this type of request">
    <lucide-angular [img]="CheckCircleIcon" class="w-3 h-3" />
    Always
  </button>
  <button class="btn btn-xs btn-error btn-outline gap-0.5 px-2" (click)="respond('deny')" type="button" aria-label="Deny this request and stop execution">
    <lucide-angular [img]="XIcon" class="w-3 h-3" />
    Deny
  </button>
  <!-- NEW: Deny with Message popover -->
  <ptah-deny-message-popover [isOpen]="isDenyPopoverOpen()" (messageSent)="handleDenyWithMessage($event)" (closed)="closeDenyPopover()" />
</div>
```

**Quality Requirements**:

- Functional: 4th button appears after existing Deny button
- Functional: Clicking opens popover, submitting closes and sends response
- Pattern Compliance: Follows atomic design (molecule using molecule)

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts` (MODIFY)

---

### Component 4: SdkPermissionHandler Backend Updates

**Purpose**: Correctly map `deny` and `deny_with_message` decisions to SDK PermissionResult with proper `interrupt` flag.

**Pattern**: Switch statement on decision type
**Evidence**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:458-468`

**Changes Required**:

```typescript
// File: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts

// Update requestUserPermission method (lines 458-468)
// Replace existing deny block:

// Current (INCORRECT):
if (!response) {
  // Timeout - auto-deny
  return {
    behavior: 'deny' as const,
    message: 'Permission request timed out',
  };
}

// User approved (allow or always_allow)
if (isApproved) {
  return {
    behavior: 'allow' as const,
    updatedInput: response.modifiedInput ?? input,
  };
}

// User denied
return {
  behavior: 'deny' as const,
  message: response.reason || 'User denied permission',
};

// NEW (CORRECT with interrupt flag):

if (!response) {
  // Timeout - auto-deny with interrupt (stops execution)
  this.logger.warn(`[SdkPermissionHandler] Permission request ${requestId} timed out after ${PERMISSION_TIMEOUT_MS}ms`);
  return {
    behavior: 'deny' as const,
    message: 'Permission request timed out',
    interrupt: true, // Stop execution on timeout
  };
}

// User approved (allow or always_allow)
if (isApproved) {
  this.logger.info(`[SdkPermissionHandler] Permission request ${requestId} approved for tool ${toolName} (decision: ${response.decision})`);
  return {
    behavior: 'allow' as const,
    updatedInput: response.modifiedInput ?? input,
  };
}

// User denied - distinguish between hard deny and deny-with-message
if (response.decision === 'deny_with_message') {
  // Deny with message - provide feedback but don't interrupt execution
  this.logger.info(`[SdkPermissionHandler] Permission request ${requestId} denied with message for tool ${toolName}: ${response.reason}`);
  return {
    behavior: 'deny' as const,
    message: response.reason || 'User denied without explanation',
    interrupt: false, // Continue execution, just skip this tool
  };
}

// Hard deny - stop execution
this.logger.info(`[SdkPermissionHandler] Permission request ${requestId} denied for tool ${toolName}: ${response.reason || 'No reason provided'}`);
return {
  behavior: 'deny' as const,
  message: response.reason || 'User denied permission',
  interrupt: true, // Stop execution
};
```

**Quality Requirements**:

- Functional: Hard deny sets `interrupt: true`
- Functional: Deny-with-message sets `interrupt: false`
- Functional: Timeout sets `interrupt: true`
- Non-Functional: Logging includes decision type for debugging

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts` (MODIFY)

---

### Component 5: Session Abort Cleanup (Requirement 4)

**Purpose**: Clean up pending permission requests when a session is aborted to prevent unhandled promise rejections.

**Pattern**: Centralized cleanup method called on session abort
**Evidence**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:163` (pendingRequests Map)

**Changes Required**:

```typescript
// File: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts

// Add new method after dispose():

/**
 * Cleanup pending permission requests for a specific session
 * Called when a session is aborted to prevent unhandled promise rejections
 *
 * TASK_2025_102: Implements session abort cleanup requirement
 *
 * @param sessionId - The session ID to cleanup (optional, cleanup all if not provided)
 */
cleanupPendingPermissions(sessionId?: string): void {
  this.logger.info(
    `[SdkPermissionHandler] Cleaning up pending permissions`,
    { sessionId: sessionId ?? 'all', pendingCount: this.pendingRequests.size }
  );

  // Resolve all pending requests with deny + interrupt
  for (const [requestId, pending] of this.pendingRequests.entries()) {
    clearTimeout(pending.timer);
    // Resolve with deny to unblock the waiting promise
    pending.resolve({
      id: requestId,
      decision: 'deny',
      reason: 'Session aborted',
    });
  }
  this.pendingRequests.clear();

  // Also clear pending question requests
  for (const [requestId, pending] of this.pendingQuestionRequests.entries()) {
    clearTimeout(pending.timer);
    pending.resolve(null); // Questions resolve to null on abort
  }
  this.pendingQuestionRequests.clear();

  // Clear request context map
  this.pendingRequestContext.clear();

  this.logger.info(
    `[SdkPermissionHandler] Pending permissions cleanup complete`
  );
}
```

**Add to ISdkPermissionHandler interface**:

```typescript
// File: libs/shared/src/lib/types/permission.types.ts

// Add to ISdkPermissionHandler interface (line ~67):
/**
 * Cleanup pending permission requests for a session
 * Called when session is aborted
 */
cleanupPendingPermissions(sessionId?: string): void;
```

**Quality Requirements**:

- Functional: All pending requests resolved on abort
- Functional: No unhandled promise rejections in console
- Functional: Late responses after abort are discarded (handleResponse already checks pendingRequests.has())

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts` (MODIFY)

---

### Component 6: Export New Component

**Purpose**: Export DenyMessagePopoverComponent from chat library barrel.

**Pattern**: Barrel exports
**Evidence**: `libs/frontend/chat/src/index.ts`

**Changes Required**:

```typescript
// File: libs/frontend/chat/src/lib/components/molecules/index.ts (if exists)
// OR add to existing barrel export pattern

export { DenyMessagePopoverComponent } from './deny-message-popover.component';
```

**Files Affected**:

- Determine actual barrel file location and add export (MODIFY)

---

## Integration Architecture

### Data Flow

```
User clicks "Deny..." button
    |
    v
DenyMessagePopoverComponent opens
    |
User types message, clicks Send
    |
    v
DenyMessagePopoverComponent emits (messageSent)
    |
    v
PermissionRequestCardComponent.handleDenyWithMessage()
    |
    v
responded.emit({ decision: 'deny_with_message', reason: message })
    |
    v
PermissionHandlerService.handlePermissionResponse()
    |
    v
VSCodeService.postMessage(SDK_PERMISSION_RESPONSE)
    |
    v
WebviewMessageHandlerService.handleSdkPermissionResponse()
    |
    v
SdkPermissionHandler.handleResponse()
    |
    v
SDK receives { behavior: 'deny', message: <user_message>, interrupt: false }
    |
    v
Claude continues execution with feedback
```

### SDK PermissionResult Mapping

| UI Decision       | SDK behavior | SDK interrupt | SDK message                    |
| ----------------- | ------------ | ------------- | ------------------------------ |
| allow             | 'allow'      | N/A           | N/A                            |
| always_allow      | 'allow'      | N/A           | N/A                            |
| deny              | 'deny'       | true          | 'User denied permission'       |
| deny_with_message | 'deny'       | false         | <user provided message>        |
| timeout           | 'deny'       | true          | 'Permission request timed out' |

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

1. **FR-1**: User can click "Deny..." button to open popover
2. **FR-2**: Popover contains text input and send button
3. **FR-3**: Empty message uses default "User denied without explanation"
4. **FR-4**: Hard "Deny" stops Claude execution (`interrupt: true`)
5. **FR-5**: "Deny with Message" allows Claude to continue (`interrupt: false`)
6. **FR-6**: Session abort cleans up pending permissions

### Non-Functional Requirements

1. **NFR-1**: Popover opens within 16ms (one frame)
2. **NFR-2**: Backend response within 100ms of user action
3. **NFR-3**: Input receives focus on popover open (accessibility)
4. **NFR-4**: Escape key closes popover without action

### Pattern Compliance

1. **PC-1**: Uses NativePopoverComponent (verified at `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts`)
2. **PC-2**: Uses Angular signals for state management (verified pattern in autopilot-popover)
3. **PC-3**: Uses DaisyUI classes for styling (verified in permission-request-card)
4. **PC-4**: Follows atomic design (molecule composes molecule)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer (primary), backend-developer (secondary)

**Rationale**:

1. 70% frontend work: New Angular component, template updates, signal-based state
2. 30% backend work: SDK permission handler logic updates
3. Both can be done in parallel once shared types are updated

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Shared types update: 30 min
- DenyMessagePopoverComponent: 1.5 hours
- PermissionRequestCardComponent updates: 1 hour
- SdkPermissionHandler updates: 1 hour
- Cleanup method: 30 min
- Testing & verification: 1.5 hours

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\deny-message-popover.component.ts`

**MODIFY**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts`

### Critical Verification Points

**Before Implementation, Developers Must Verify**:

1. **All imports exist in codebase**:

   - `NativePopoverComponent` from `@ptah-extension/ui` (verified: `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts`)
   - `Send`, `MessageSquare` from `lucide-angular` (verified: `chat-input.component.ts:11`)
   - `FormsModule` from `@angular/forms` (standard Angular)

2. **All patterns verified from examples**:

   - Popover usage: `autopilot-popover.component.ts:41-48`
   - Permission response flow: `permission-handler.service.ts:241-254`
   - SDK result mapping: `sdk-permission-handler.ts:458-468`

3. **Library documentation consulted**:

   - `libs/frontend/ui/CLAUDE.md` - NativePopoverComponent usage
   - `libs/backend/agent-sdk/CLAUDE.md` - SDK permission handling
   - `libs/shared/CLAUDE.md` - Type definitions

4. **No hallucinated APIs**:
   - All decorators verified: Angular component decorators (standard)
   - All base components verified: NativePopoverComponent (file verified)
   - All types verified: PermissionResponse (file verified)

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
