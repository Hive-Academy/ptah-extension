# Development Tasks - TASK_2025_034

**Total Tasks**: 6 | **Batches**: 4 | **Status**: 2/4 complete

**Task Summary**: Move permission request UI from fixed bottom position to be embedded directly inside tool-call-item cards for better context and cleaner UX.

---

## Task Table

| Batch | ID  | Task                                       | Assignee           | Status      |
| ----- | --- | ------------------------------------------ | ------------------ | ----------- |
| 1     | 1.1 | Add permission lookup to ChatStore         | frontend-developer | COMPLETE    |
| 2     | 2.1 | Add permission lookup to MessageBubble     | frontend-developer | COMPLETE    |
| 2     | 2.2 | Forward permission lookup in ExecutionNode | frontend-developer | COMPLETE    |
| 3     | 3.1 | Add permission input to ToolCallItem       | frontend-developer | IN PROGRESS |
| 3     | 3.2 | Wire permission response back to ChatStore | frontend-developer | IN PROGRESS |
| 4     | 4.1 | Remove fixed permission cards (cleanup)    | frontend-developer | PENDING     |

---

## Batch 1: Data Layer (ChatStore) COMPLETE

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: None
**Commit**: f861391

### Task 1.1: Add permission lookup to ChatStore COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: implementation-plan.md:74-108
**Insert Location**: After line ~147 (where \_permissionRequests is defined)

**Quality Requirements**:

- Computed signal must use efficient Map lookup (O(1) performance)
- Method must handle null/undefined toolCallId gracefully
- JSDoc comments must explain purpose and usage

**Implementation Details**:

**Imports**: None needed (PermissionRequest already imported)

**Code to Add**:

```typescript
/**
 * Computed lookup: toolUseId → PermissionRequest
 * Enables O(1) lookup for embedding permissions in tool cards
 */
readonly permissionRequestsByToolId = computed(() => {
  const requests = this._permissionRequests();
  const map = new Map<string, PermissionRequest>();

  requests.forEach(req => {
    if (req.toolUseId) {
      map.set(req.toolUseId, req);
    }
  });

  return map;
});

/**
 * Get permission request for a specific tool by its toolCallId
 * @param toolCallId The tool's unique identifier (from ExecutionNode.toolCallId)
 * @returns PermissionRequest if one exists for this tool, null otherwise
 */
getPermissionForTool(toolCallId: string | undefined): PermissionRequest | null {
  if (!toolCallId) return null;
  return this.permissionRequestsByToolId().get(toolCallId) ?? null;
}
```

**Acceptance Criteria**:

- [x] `permissionRequestsByToolId` computed signal exists
- [x] `getPermissionForTool()` method returns correct permission
- [x] Returns null for unknown tool IDs
- [x] Returns null if toolCallId is undefined

---

**Batch 1 Verification**: COMPLETE

- [x] All files exist at paths
- [x] Build passes: TypeScript compilation successful
- [x] Method getPermissionForTool accessible from component
- [x] Git commit: f861391

---

## Batch 2: Component Propagation (MessageBubble + ExecutionNode) COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (ChatStore lookup)
**Commit**: (pending - deferred to Batch 3 due to expected type errors)

### Task 2.1: Add permission lookup to MessageBubble COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html
**Spec Reference**: implementation-plan.md:120-149
**Dependencies**: Task 1.1 (ChatStore.getPermissionForTool)

**Quality Requirements**:

- ChatStore must be properly injected
- Function must be bound correctly to preserve `this` context
- Template must pass function to ExecutionNode without invoking it

**Implementation Details**:

**TypeScript Changes** (message-bubble.component.ts):

```typescript
// Add to imports
import { ChatStore } from '../../services/chat.store';

// In component class (after line ~49 where vscode is injected)
private readonly chatStore = inject(ChatStore);

/**
 * Permission lookup function to pass to execution tree
 * Enables tool cards to check if they have pending permissions
 */
protected getPermissionForTool = (toolCallId: string): PermissionRequest | null => {
  return this.chatStore.getPermissionForTool(toolCallId);
};
```

**Template Changes** (message-bubble.component.html):

Find the line with `<ptah-execution-node` (around line 50-60) and update:

```html
<!-- Before -->
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" />

<!-- After -->
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" />
```

**Acceptance Criteria**:

- [x] ChatStore injected in MessageBubbleComponent
- [x] `getPermissionForTool` function defined and bound
- [x] Function passed to ExecutionNodeComponent
- [x] Template compiles without errors

---

### Task 2.2: Forward permission lookup in ExecutionNode COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts
**Spec Reference**: implementation-plan.md:159-186
**Dependencies**: Task 2.1 (MessageBubble passes lookup)

**Quality Requirements**:

- Input must be optional (undefined-safe)
- Permission must be passed to tool-call-item
- Lookup must be forwarded to recursive children
- Template syntax must use optional chaining

**Implementation Details**:

**Imports to Add**:

```typescript
// Add to imports (around line 13)
import type { PermissionRequest } from '@ptah-extension/shared';
```

**Input to Add** (after line ~45 where other inputs are defined in the component class):

```typescript
/**
 * Permission lookup function forwarded from parent
 * Enables tool cards to check if they have pending permissions
 */
readonly getPermissionForTool = input<
  ((toolCallId: string) => PermissionRequest | null) | undefined
>();
```

**Template Changes**:

1. **Tool Case** - Find `@case ('tool')` section (around line 80-100), update `<ptah-tool-call-item>`:

```html
<!-- Before -->
<ptah-tool-call-item [node]="node()">
  <!-- After -->
  <ptah-tool-call-item [node]="node()" [permission]="getPermissionForTool()?.(node().toolCallId ?? '')"></ptah-tool-call-item
></ptah-tool-call-item>
```

2. **Recursive Children** - Find recursive `<ptah-execution-node>` calls (inside tool-call-item and agent-invocation), forward the lookup:

```html
<!-- Before -->
<ptah-execution-node [node]="child" [isStreaming]="isStreaming()" />

<!-- After -->
<ptah-execution-node [node]="child" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool()" />
```

**Acceptance Criteria**:

- [x] `getPermissionForTool` input added
- [x] Permission passed to tool-call-item with optional chaining
- [x] Lookup forwarded to ALL recursive children (including InlineAgentBubbleComponent)
- [x] Template compiles without errors (expected NG8002 for permission input - resolved in Batch 3)

---

**Batch 2 Verification**:

- [x] All files exist at paths
- [x] Permission lookup threaded through component tree
- [x] TypeScript types correct (NG8002 expected - permission input added in Batch 3)
- [x] Template syntax valid
- [x] ALL recursive ExecutionNodeComponent calls updated:
  - [x] tool → children (line 78)
  - [x] agent → InlineAgentBubbleComponent (line 84)
  - [x] message → children (line 92)
  - [x] InlineAgentBubbleComponent → children (line 107)

---

## Batch 3: Tool Integration (ToolCallItem + Response Wiring) IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 2 (ExecutionNode forwards permission)

### Task 3.1: Add permission input to ToolCallItem IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tool-call-item.component.ts
**Spec Reference**: implementation-plan.md:197-241
**Dependencies**: Task 2.2 (ExecutionNode passes permission)

**Quality Requirements**:

- PermissionRequestCardComponent must be imported
- Input/output must handle undefined permissions
- Template must render permission card only when permission exists
- Card must be visually integrated (border separator)

**Implementation Details**:

**Imports to Add**:

```typescript
// Add to imports (around line 1-9)
import { output } from '@angular/core';
import type { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { PermissionRequestCardComponent } from './permission-request-card.component';
```

**Component Array Update**:

```typescript
// Add to imports array (around line 46-50)
imports: [
  ToolCallHeaderComponent,
  ToolInputDisplayComponent,
  ToolOutputDisplayComponent,
  PermissionRequestCardComponent, // ADD THIS
],
```

**Input/Output to Add** (after line ~75 where node input is defined):

```typescript
/**
 * Permission request for this tool (if any)
 */
readonly permission = input<PermissionRequest | undefined>();

/**
 * Emits when user responds to permission request
 */
readonly permissionResponded = output<PermissionResponse>();
```

**Handler Method to Add** (in component class):

```typescript
/**
 * Handle permission response from embedded card
 * Bubbles response up to parent for ChatStore handling
 */
protected handlePermissionResponse(response: PermissionResponse): void {
  this.permissionResponded.emit(response);
}
```

**Template Addition** (in template string, after the closing `</div>` of ToolOutputDisplayComponent section, before final `</div>`):

```html
<!-- Permission request section (if tool requires permission) -->
@if (permission()) {
<div class="mt-2 pt-2 border-t border-base-300/30">
  <ptah-permission-request-card [request]="permission()!" (responded)="handlePermissionResponse($event)" />
</div>
}
```

**Acceptance Criteria**:

- [ ] `permission` input added
- [ ] `permissionResponded` output added
- [ ] PermissionRequestCardComponent imported
- [ ] Template renders permission card when permission exists
- [ ] Border separator provides visual integration

---

### Task 3.2: Wire permission response back to ChatStore IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html
**Spec Reference**: implementation-plan.md:245-279
**Dependencies**: Task 3.1 (ToolCallItem emits response)

**Quality Requirements**:

- Output must bubble up through component tree
- ExecutionNode must forward response to parent
- MessageBubble must call ChatStore.handlePermissionResponse()
- No response data should be lost or transformed

**Implementation Details**:

**ExecutionNode Changes** (execution-node.component.ts):

Add output after inputs (around line 60):

```typescript
/**
 * Emits when user responds to permission request
 * Bubbles up from tool-call-item through component tree
 */
readonly permissionResponded = output<PermissionResponse>();
```

Template changes - update `<ptah-tool-call-item>` in @case ('tool') section:

```html
<!-- Before -->
<ptah-tool-call-item [node]="node()" [permission]="getPermissionForTool()?.(node().toolCallId ?? '')">
  <!-- After -->
  <ptah-tool-call-item [node]="node()" [permission]="getPermissionForTool()?.(node().toolCallId ?? '')" (permissionResponded)="permissionResponded.emit($event)"></ptah-tool-call-item
></ptah-tool-call-item>
```

Also forward from recursive children - update recursive `<ptah-execution-node>` calls:

```html
<!-- Before -->
<ptah-execution-node [node]="child" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool()" />

<!-- After -->
<ptah-execution-node [node]="child" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool()" (permissionResponded)="permissionResponded.emit($event)" />
```

**MessageBubble Changes** (message-bubble.component.ts):

Add handler method (in component class):

```typescript
/**
 * Handle permission response from execution tree
 * Delegates to ChatStore for state management
 */
protected onPermissionResponse(response: PermissionResponse): void {
  this.chatStore.handlePermissionResponse(response);
}
```

**MessageBubble Template Changes** (message-bubble.component.html):

```html
<!-- Before -->
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" />

<!-- After -->
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" (permissionResponded)="onPermissionResponse($event)" />
```

**Acceptance Criteria**:

- [ ] Permission response bubbles up from tool-call-item
- [ ] ExecutionNode forwards response to parent
- [ ] MessageBubble calls ChatStore.handlePermissionResponse()
- [ ] All recursive children forward responses
- [ ] Response data preserved through component tree

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- No TypeScript errors
- Permission request/response flow complete

---

## Batch 4: Cleanup (Remove Fixed Permission Display) PENDING

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 3 (embedded permissions working)

### Task 4.1: Remove fixed permission cards (cleanup) PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
**Spec Reference**: implementation-plan.md:288-322
**Dependencies**: Batch 3 complete (embedded permissions working)

**Quality Requirements**:

- Clean removal with no template syntax errors
- No broken references
- Verify permissions display correctly in tool cards before removing

**Implementation Details**:

**Lines to Remove** (around lines 107-115):

```html
<!-- DELETE THIS ENTIRE SECTION -->
<!-- Permission Request Cards (above input) -->
@for (request of chatStore.permissionRequests(); track request.id) {
<div class="px-4 pb-2">
  <ptah-permission-request-card [request]="request" (responded)="chatStore.handlePermissionResponse($event)" />
</div>
}
```

**Result**: Permission cards now ONLY appear embedded inside tool-call-item cards that are requesting them.

**Acceptance Criteria**:

- [ ] Fixed permission section removed
- [ ] Template compiles without errors
- [ ] No visual artifacts where section was removed
- [ ] Permissions only display embedded in tool cards

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- Visual verification: permissions appear inside tool cards
- No regressions in existing streaming behavior

---

## Overall Verification Checklist

### Unit Tests (Optional - if time permits)

- [ ] ChatStore.getPermissionForTool returns correct permission
- [ ] ChatStore.getPermissionForTool returns null for unknown IDs
- [ ] permissionRequestsByToolId computed correctly

### Manual Testing (REQUIRED)

- [ ] Start streaming session
- [ ] Trigger tool that requires permission (e.g., Bash command)
- [ ] Verify permission card appears INSIDE tool card (not at bottom)
- [ ] Click Allow - tool executes, card disappears
- [ ] Test Deny button - card disappears, tool shows error
- [ ] Test Always Allow button - works correctly
- [ ] Countdown timer displays and updates correctly
- [ ] Test with multiple simultaneous permissions (multiple tools)
- [ ] Test tab switching during permission request (card stays with tool)
- [ ] Verify no fixed cards appear at bottom anymore

### Rollback Plan

If issues arise:

1. Revert all changes in reverse order (Batch 4 → Batch 3 → Batch 2 → Batch 1)
2. Permission cards will display at bottom (original behavior)
3. No data loss or corruption possible

---

## Notes

- All tasks use frontend-developer (Angular component work)
- Natural dependency flow: Store → Propagation → Integration → Cleanup
- Each batch is independently verifiable
- Clean separation between data layer, component propagation, and cleanup
