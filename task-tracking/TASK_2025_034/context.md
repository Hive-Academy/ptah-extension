# TASK_2025_034: Permission UI Embedding in Tool Cards

## Context

**Created:** 2025-11-30
**Status:** Planned
**Type:** Feature Enhancement / UX Improvement
**Complexity:** Medium (~2 hours)
**Dependencies:** TASK_2025_033 may introduce changes to tool-call-item structure

## User Intent

Move permission request UI from the bottom fixed position (above chat input) to be embedded directly inside the tool-call-item card that's requesting the permission. This provides better context and cleaner UX.

## Problem Statement

**Current Behavior:**

```
[Messages with tools...]
───────────────────────
[Permission Card] ← Disconnected, floating above input
[Chat Input]
```

Permission requests appear as floating cards above the chat input, disconnected from the actual tool that's requesting permission. When multiple permissions stack, it's hard to understand context.

**Desired Behavior:**

```
[Messages...]
  └── Bash tool [🔒 Permission Required]
      ├── Execute: `cd /d D:\projects && dir`
      ├── [✓ Allow] [✓✓ Always] [✕ Deny]
      └── Expires: 4m 35s
[Chat Input]
```

Permission UI appears directly inside the tool card, providing immediate context about what's being requested.

## Technical Analysis

### Data Matching Strategy

**Key Insight:** `PermissionRequest.toolUseId` should match `ExecutionNode.toolCallId`

Both are set from different code paths:

- `toolCallId`: Set in JsonlMessageProcessor when tool starts
- `toolUseId`: Set by MCP server in permission:request message

### Component Chain

```
ChatViewComponent
  └── MessageBubbleComponent [permissionLookup]
        └── ExecutionNodeComponent [permissionLookup]
              └── ToolCallItemComponent [permission]
                    └── @if (permission()) { PermissionRequestCard }
```

### Files to Modify

| File                               | Change                                                            | Complexity |
| ---------------------------------- | ----------------------------------------------------------------- | ---------- |
| `chat.store.ts`                    | Add `permissionRequestsByToolId` computed lookup                  | Easy       |
| `message-bubble.component.ts/html` | Pass permission lookup function                                   | Medium     |
| `execution-node.component.ts`      | Forward permission lookup to tool-call-item                       | Medium     |
| `tool-call-item.component.ts`      | Add `[permission]` input, render embedded card                    | Medium     |
| `chat-view.component.html`         | Remove fixed permission cards (optional - could keep as fallback) | Easy       |

## Implementation Plan

### Phase 1: Data Layer (ChatStore)

Add computed lookup for permission requests by tool ID:

```typescript
// In chat.store.ts
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

// Helper method
getPermissionForTool(toolCallId: string | undefined): PermissionRequest | null {
  if (!toolCallId) return null;
  return this.permissionRequestsByToolId().get(toolCallId) ?? null;
}
```

### Phase 2: Component Propagation

Pass permission lookup through component tree:

**message-bubble.component.ts:**

```typescript
// Inject ChatStore
private readonly chatStore = inject(ChatStore);

// Create lookup function for children
protected getPermissionForTool = (toolId: string) =>
  this.chatStore.getPermissionForTool(toolId);
```

**message-bubble.component.html:**

```html
<ptah-execution-node [node]="message().executionTree!" [isStreaming]="isStreaming()" [getPermissionForTool]="getPermissionForTool" />
```

**execution-node.component.ts:**

```typescript
readonly getPermissionForTool = input<(toolId: string) => PermissionRequest | null>();

// Template: Forward to tool-call-item
[permission]="getPermissionForTool()?.(node().toolCallId)"
```

### Phase 3: Tool Card Integration

**tool-call-item.component.ts:**

```typescript
// Add input
readonly permission = input<PermissionRequest | undefined>();

// Add output for response
readonly permissionResponded = output<PermissionResponse>();

// Template addition
@if (permission()) {
  <div class="mt-2 border-t border-base-300/30 pt-2">
    <ptah-permission-request-card
      [request]="permission()!"
      (responded)="handlePermissionResponse($event)"
    />
  </div>
}
```

### Phase 4: Cleanup (Optional)

Either:

- **A) Remove** fixed permission cards from chat-view.component.html
- **B) Keep** as fallback for permissions that can't be matched to tools

## Considerations

### Edge Cases

1. **Permission without toolUseId**: Falls back to global display
2. **Multiple permissions for same tool**: Show most recent (unlikely scenario)
3. **Tool card collapsed**: Auto-expand when permission arrives?
4. **Permission timeout**: Card disappears, tool shows error state

### Visual Integration

The existing `PermissionRequestCardComponent` has already been styled to match tool-call-item patterns (commit c2cb79c):

- Tool-specific icons and colors
- Markdown-formatted command display
- Semantic button styling

This makes embedding seamless - the permission card will naturally fit inside tool cards.

## Dependencies

- **TASK_2025_031** (Tool Component Refactoring): If tool-call-item is decomposed, permission embedding might need adjustment
- **TASK_2025_033** (Agent Bubble Hierarchy): May affect how execution nodes are rendered

## Success Criteria

1. Permission requests appear inside the tool card that's requesting them
2. Allow/Deny/Always buttons work correctly
3. Auto-deny on timeout still functions
4. Countdown timer displays correctly
5. No regressions in existing streaming behavior
6. Session replay with permissions works (if applicable)

## Estimated Effort

- Phase 1 (Data Layer): 30 minutes
- Phase 2 (Component Propagation): 45 minutes
- Phase 3 (Tool Card Integration): 30 minutes
- Phase 4 (Cleanup/Testing): 15 minutes
- **Total: ~2 hours**

## Risk Assessment

| Risk                               | Probability | Impact | Mitigation                                    |
| ---------------------------------- | ----------- | ------ | --------------------------------------------- |
| toolUseId mismatch                 | Low         | Medium | Add debug logging, fallback to global display |
| Component prop drilling complexity | Medium      | Low    | Well-documented, follows existing patterns    |
| State cleanup issues               | Low         | Low    | Existing ChatStore cleanup logic handles this |
