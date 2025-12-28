# TASK_2025_034: Implementation Plan

## Overview

Embed permission request UI inside tool-call-item cards instead of displaying as fixed floating cards above the chat input.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ChatStore                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ _permissionRequests: Signal<PermissionRequest[]>            │ │
│  │                                                              │ │
│  │ permissionRequestsByToolId: computed Map<toolId, Request>   │ │  ← NEW
│  │                                                              │ │
│  │ getPermissionForTool(toolId): PermissionRequest | null      │ │  ← NEW
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MessageBubbleComponent                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ chatStore = inject(ChatStore)                               │ │
│  │                                                              │ │
│  │ getPermissionForTool = (id) => chatStore.getPermission(id) │ │  ← NEW
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Template:                                                       │
│  <ptah-execution-node                                           │
│    [getPermissionForTool]="getPermissionForTool"                │  ← NEW
│  />                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ExecutionNodeComponent                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ getPermissionForTool = input<(id) => Request | null>()     │ │  ← NEW
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Template:                                                       │
│  <ptah-tool-call-item                                           │
│    [permission]="getPermissionForTool()?.(node().toolCallId)"   │  ← NEW
│  />                                                              │
│                                                                  │
│  <!-- Recursive children also get the lookup -->                │
│  <ptah-execution-node                                           │
│    [getPermissionForTool]="getPermissionForTool()"              │  ← FORWARD
│  />                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ToolCallItemComponent                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ permission = input<PermissionRequest | undefined>()        │ │  ← NEW
│  │ permissionResponded = output<PermissionResponse>()         │ │  ← NEW
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Template:                                                       │
│  @if (permission()) {                                           │  ← NEW
│    <ptah-permission-request-card                                │
│      [request]="permission()!"                                  │
│      (responded)="onPermissionResponse($event)"                 │
│    />                                                            │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Task Breakdown

### Task 1: Add Permission Lookup to ChatStore

**File:** `libs/frontend/chat/src/lib/services/chat.store.ts`

**Changes:**

```typescript
// After line ~142 (where _permissionRequests is defined)

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

**Acceptance Criteria:**

- [ ] `permissionRequestsByToolId` computed signal exists
- [ ] `getPermissionForTool()` method returns correct permission
- [ ] Returns null for unknown tool IDs
- [ ] Returns null if toolCallId is undefined

---

### Task 2: Add Permission Lookup to MessageBubbleComponent

**File:** `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`

**Changes:**

```typescript
// Imports
import { ChatStore } from '../../services/chat.store';

// In component class
private readonly chatStore = inject(ChatStore);

/**
 * Permission lookup function to pass to execution tree
 * Enables tool cards to check if they have pending permissions
 */
protected getPermissionForTool = (toolCallId: string): PermissionRequest | null => {
  return this.chatStore.getPermissionForTool(toolCallId);
};
```

**File:** `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`

**Changes:**

```html
<!-- Update execution-node rendering -->
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" />
```

**Acceptance Criteria:**

- [ ] ChatStore injected in MessageBubbleComponent
- [ ] `getPermissionForTool` function defined and bound
- [ ] Function passed to ExecutionNodeComponent

---

### Task 3: Forward Permission Lookup in ExecutionNodeComponent

**File:** `libs/frontend/chat/src/lib/components/atoms/execution-node.component.ts`

**Changes:**

```typescript
// Add import
import type { PermissionRequest } from '@ptah-extension/shared';

// Add input
readonly getPermissionForTool = input<((toolCallId: string) => PermissionRequest | null) | undefined>();

// In template - when rendering tool-call-item
// Change from:
// <ptah-tool-call-item [node]="node()" ... />
// To:
// <ptah-tool-call-item
//   [node]="node()"
//   [permission]="getPermissionForTool()?.(node().toolCallId ?? '')"
//   ...
// />

// For recursive children, forward the lookup:
// <ptah-execution-node
//   [getPermissionForTool]="getPermissionForTool()"
//   ...
// />
```

**Acceptance Criteria:**

- [ ] `getPermissionForTool` input added
- [ ] Permission passed to tool-call-item
- [ ] Lookup forwarded to recursive children

---

### Task 4: Add Permission Input to ToolCallItemComponent

**File:** `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts`

**Changes:**

```typescript
// Add imports
import type { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { PermissionRequestCardComponent } from './permission-request-card.component';

// Add to imports array
imports: [
  // ... existing imports
  PermissionRequestCardComponent,
],

// Add input/output
readonly permission = input<PermissionRequest | undefined>();
readonly permissionResponded = output<PermissionResponse>();

// Add handler method
protected handlePermissionResponse(response: PermissionResponse): void {
  this.permissionResponded.emit(response);
}
```

**Template addition (after error section, before closing `</div>`):**

```html
<!-- Permission request section (if tool requires permission) -->
@if (permission()) {
<div class="mt-2 pt-2 border-t border-base-300/30">
  <ptah-permission-request-card [request]="permission()!" (responded)="handlePermissionResponse($event)" />
</div>
}
```

**Acceptance Criteria:**

- [ ] `permission` input added
- [ ] `permissionResponded` output added
- [ ] PermissionRequestCardComponent imported
- [ ] Template renders permission card when permission exists

---

### Task 5: Wire Permission Response Back to ChatStore

**File:** `libs/frontend/chat/src/lib/components/atoms/execution-node.component.ts`

**Changes:**

```typescript
// Add output
readonly permissionResponded = output<PermissionResponse>();

// In template - update tool-call-item
<ptah-tool-call-item
  [node]="node()"
  [permission]="getPermissionForTool()?.(node().toolCallId ?? '')"
  (permissionResponded)="permissionResponded.emit($event)"
/>
```

**File:** `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`

**Changes:**

```typescript
// Add method to handle permission response
protected onPermissionResponse(response: PermissionResponse): void {
  this.chatStore.handlePermissionResponse(response);
}
```

**File:** `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`

**Changes:**

```html
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" (permissionResponded)="onPermissionResponse($event)" />
```

**Acceptance Criteria:**

- [ ] Permission response bubbles up from tool-call-item
- [ ] ExecutionNode forwards response to parent
- [ ] MessageBubble calls ChatStore.handlePermissionResponse()

---

### Task 6: Keep Fallback Display (Optional)

**File:** `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

**Decision Point:** Keep or remove the fixed permission cards?

**Option A - Remove (Clean):**

```html
<!-- Remove lines 107-115 -->
<!-- Permission Request Cards section -->
```

**Option B - Keep as Fallback (Safe):**

```html
<!-- Only show permissions that couldn't be matched to tools -->
@for (request of chatStore.unmatchedPermissionRequests(); track request.id) {
<div class="px-4 pb-2">
  <ptah-permission-request-card ... />
</div>
}
```

For Option B, add to ChatStore:

```typescript
readonly unmatchedPermissionRequests = computed(() => {
  return this._permissionRequests().filter(req => !req.toolUseId);
});
```

**Recommendation:** Start with Option A (remove), add fallback if needed.

---

## Verification Checklist

### Unit Tests

- [ ] ChatStore.getPermissionForTool returns correct permission
- [ ] ChatStore.getPermissionForTool returns null for unknown IDs
- [ ] permissionRequestsByToolId computed correctly

### Integration Tests

- [ ] Permission card appears inside tool when permission requested
- [ ] Allow button works and removes permission
- [ ] Deny button works and removes permission
- [ ] Always Allow button works and removes permission
- [ ] Countdown timer displays and updates
- [ ] Auto-deny on timeout removes permission

### Manual Testing

- [ ] Open streaming session
- [ ] Trigger tool that requires permission (e.g., Bash command)
- [ ] Verify permission card appears inside tool card
- [ ] Click Allow - tool executes
- [ ] Verify permission card disappears
- [ ] Test with multiple simultaneous permissions
- [ ] Test tab switching during permission request (should stay with correct tool)

## Rollback Plan

If issues arise:

1. Revert all changes
2. Permission cards will display at bottom (original behavior)
3. No data loss or corruption possible
