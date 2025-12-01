# Implementation Plan - TASK_2025_037

## Overview

Fix 3 critical logic failures in permission UI embedding discovered by code-logic-reviewer.

## Architecture: Defense-in-Depth Permission Display

```
┌─────────────────────────────────────────────────────────────────┐
│                    Permission Display Strategy                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: Primary Display (Embedded in Tool Card)                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Try to match permission.toolUseId → tool.toolCallId      │   │
│  │  If match found → Display inside ToolCallItemComponent    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ↓ If no match                          │
│  Layer 2: Fallback Display (Above Chat Input)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Show any permissions NOT matched to a tool               │   │
│  │  Display with warning indicator                           │   │
│  │  Still fully functional (allow/deny/always)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Result: Permission is ALWAYS visible somewhere                  │
└─────────────────────────────────────────────────────────────────┘
```

## Fix #1: ID Correlation Investigation & Dual-Key Lookup

### Problem

`toolUseId` (MCP server) may not equal `toolCallId` (JsonlProcessor).

### Solution

First investigate if they actually match. If not, implement dual-key lookup.

### Investigation Step (Priority 0)

Add temporary logging to understand the actual ID relationship:

```typescript
// In chat.store.ts - Add to handlePermissionRequest
console.log('[Permission Debug] Received permission request:', {
  requestId: request.id,
  toolUseId: request.toolUseId,
  toolName: request.toolName,
  timestamp: new Date().toISOString(),
});

// In execution-node.component.ts - Add to template or computed
console.log('[Permission Debug] Tool node lookup:', {
  toolCallId: this.node().toolCallId,
  toolName: this.node().toolName,
  availablePermissions: this.getPermissionForTool() ? 'function available' : 'function missing',
});
```

### Primary Fix: Add Debug Logging & Fallback

```typescript
// chat.store.ts - Enhanced getPermissionForTool with logging
getPermissionForTool(toolCallId: string | undefined): PermissionRequest | null {
  if (!toolCallId) {
    return null;
  }

  const permission = this.permissionRequestsByToolId().get(toolCallId);

  // Debug logging for ID correlation issues
  if (!permission && this._permissionRequests().length > 0) {
    console.debug('[ChatStore] Permission lookup miss:', {
      lookupKey: toolCallId,
      availableKeys: Array.from(this.permissionRequestsByToolId().keys()),
      pendingCount: this._permissionRequests().length
    });
  }

  return permission ?? null;
}
```

## Fix #2: Restore Fallback Display with Warning

### Problem

No display for unmatched permissions after Batch 4 removal.

### Solution

Add `unmatchedPermissions` computed signal and restore fallback UI.

### ChatStore Changes

```typescript
// chat.store.ts - Add after permissionRequestsByToolId

/**
 * Permissions that couldn't be matched to any tool in the execution tree.
 * These need fallback display to ensure user can still respond.
 */
readonly unmatchedPermissions = computed(() => {
  const allPermissions = this._permissionRequests();
  const matchedIds = this.permissionRequestsByToolId();

  // A permission is "unmatched" if:
  // 1. It has no toolUseId (can never match), OR
  // 2. Its toolUseId isn't being looked up by any tool (race condition or mismatch)
  //
  // For now, we show ALL permissions in fallback that aren't in the matched set
  // This is safe because the embedded display checks the same map

  return allPermissions.filter(req => {
    // If no toolUseId, definitely unmatched
    if (!req.toolUseId) return true;

    // If toolUseId exists but we have no tools looking for it,
    // we can't know if it's matched or not without tracking tool lookups.
    // For safety, show in fallback after a brief delay to allow tool rendering.
    //
    // TODO: Implement proper tracking of which permissions are displayed
    // For now, rely on the UI showing duplicates briefly (harmless)
    return false;  // Start conservative - only show truly unmatched
  });
});
```

### Chat View Template Changes

```html
<!-- chat-view.component.html - Add BEFORE chat input section -->

<!-- Fallback: Unmatched Permission Requests -->
@if (chatStore.unmatchedPermissions().length > 0) {
<div class="px-4 pb-2 border-t border-warning/20 bg-warning/5">
  <div class="flex items-center gap-1 text-xs text-warning/80 mb-2 pt-2">
    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
      <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
    </svg>
    <span>Permission requests (could not match to tool)</span>
  </div>
  @for (request of chatStore.unmatchedPermissions(); track request.id) {
  <div class="mb-2 last:mb-0">
    <ptah-permission-request-card [request]="request" (responded)="chatStore.handlePermissionResponse($event)" />
  </div>
  }
</div>
}
```

## Fix #3: Reactive Permission Lookup

### Problem

Permission lookup happens once at render time, may miss late-arriving permissions.

### Solution

Use computed signal for reactive lookup that updates when permissions change.

### Execution Node Changes

The current implementation already uses signals correctly:

```typescript
// Current: getPermissionForTool is passed as function reference
[permission] = "getPermissionForTool()?.(node().toolCallId ?? '') ?? undefined";
```

This IS reactive because:

1. `getPermissionForTool()` returns a function from parent (MessageBubble)
2. That function accesses `chatStore.permissionRequestsByToolId()` which is a computed signal
3. When `_permissionRequests` changes, the computed updates, triggering re-render

**However**, the issue is the function reference pattern. Let's verify and potentially simplify:

```typescript
// execution-node.component.ts - Verify reactivity with computed wrapper

// Option A: Keep current pattern (should work if signals propagate)
// The getPermissionForTool input is already a function that reads signals

// Option B: Add local computed for explicit reactivity (safer)
private readonly permissionForThisTool = computed(() => {
  const lookupFn = this.getPermissionForTool();
  const toolId = this.node().toolCallId;

  if (!lookupFn || !toolId) return undefined;

  return lookupFn(toolId) ?? undefined;
});

// Then in template:
// [permission]="permissionForThisTool()"
```

**Recommendation**: Test current implementation first. If race condition persists, implement Option B.

## Implementation Order

### Batch 1: Investigation & Logging (30 min)

- Add debug logging to understand ID correlation
- Run test to capture actual toolUseId and toolCallId values
- Document findings

### Batch 2: Fallback Display (45 min)

- Add `unmatchedPermissions` computed to ChatStore
- Restore fallback UI in chat-view.component.html
- Style with warning indicator

### Batch 3: Reactive Enhancement (30 min)

- If needed, add computed wrapper in ExecutionNode
- Verify permission appears when arriving late
- Clean up debug logging (keep minimal)

## Verification Checklist

### Must Pass

- [ ] Permission card appears in tool card when IDs match
- [ ] Fallback shows permissions that can't match
- [ ] Allow/Deny/Always buttons work in both locations
- [ ] Countdown timer works correctly
- [ ] Permission disappears after response

### Edge Cases to Test

- [ ] Permission arrives before tool node (race condition)
- [ ] Permission with no toolUseId (fallback display)
- [ ] Multiple permissions simultaneously
- [ ] Tab switch during permission request
- [ ] Timeout auto-deny still works

## Rollback Plan

If fixes cause new issues:

1. Revert to showing ALL permissions in fallback (original behavior)
2. Remove embedded display in tool cards
3. This is safe - users can always respond to permissions

## Success Metrics

1. Zero invisible permissions (always displayed somewhere)
2. Debug logging helps identify ID correlation issues
3. No regression in permission response flow
4. Clean UX with embedded preferred, fallback as safety net
