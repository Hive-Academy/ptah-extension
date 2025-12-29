# Task Context - TASK_2025_096

## User Intent

Fix critical streaming bug where UI stops and ignores subsequent stream chunks after tool calls.

## Problem Description

When Claude uses tools (like Glob, Read, Write), the UI would:

1. **Bug 1**: Only show the FIRST message bubble, losing subsequent messages
2. **Bug 2**: Show tool calls but text content would disappear from earlier bubbles

### Root Causes Identified

**Bug 1 - Multi-message loss:**

- `currentExecutionTree` in `chat.store.ts` returned only `rootNodes[0]`
- When SDK sends multiple assistant messages in one turn (after tool results), only the first was rendered
- Example: Message 1 has tool calls → Message 2 has follow-up text → Message 2 was LOST

**Bug 2 - Text clearing:**

- Duplicate `message_start` events cleared all `textAccumulators` for that messageId
- When SDK sends multiple "complete" messages with same messageId:
  - Text-containing message would add text
  - Tool-only message (arriving after) would clear the text
- Only the last message bubble showed text

## Technical Context

- Branch: `feature/sdk-only-migration`
- Created: 2025-12-29
- Type: BUGFIX
- Complexity: Medium
- Related: TASK_2025_095 (type migration was in progress)

## Fixes Implemented

### Fix 1: Multi-Message Rendering

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

```typescript
// ADDED: Return ALL root nodes, not just first
readonly currentExecutionTrees = computed((): ExecutionNode[] => {
  const tab = this.tabManager.activeTab();
  if (!tab?.streamingState) return [];
  return this.treeBuilder.buildRootNodes(tab.streamingState);
});

// DEPRECATED: Keep for backwards compat
readonly currentExecutionTree = computed((): ExecutionNode | null => {
  const trees = this.currentExecutionTrees();
  return trees.length > 0 ? trees[0] : null;
});
```

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

```typescript
// Changed from singular to plural
readonly streamingMessages = computed((): ExecutionChatMessage[] => {
  const trees = this.chatStore.currentExecutionTrees();
  if (trees.length === 0) return [];
  return trees.map((tree) =>
    createExecutionChatMessage({...})
  );
});
```

**File**: `chat-view.component.html`

```html
<!-- Changed from @if to @for -->
@for (msg of streamingMessages(); track msg.id) {
<ptah-message-bubble [message]="msg" [isStreaming]="chatStore.isStreaming()" />
}
```

### Fix 2: Text Preservation

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

**message_start handler** - Removed accumulator clearing:

```typescript
if (sessionMessageIds.has(event.messageId)) {
  // Duplicate message_start - just log and continue
  // Text replacement is handled in text_delta based on event.source
  console.debug('[StreamingHandlerService] Duplicate message_start...');
  // Don't return - continue processing
} else {
  sessionMessageIds.add(event.messageId);
  state.messageEventIds.push(event.messageId);
}
```

**text_delta handler** - Smart replace vs append:

```typescript
// For 'complete' or 'history' sources: REPLACE text
// For 'stream' sources: APPEND delta
if (event.source === 'complete' || event.source === 'history') {
  state.textAccumulators.set(blockKey, event.delta);
} else {
  this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
}
```

Same fix applied to `thinking_delta` handler.

## Key Insight

Different messages have different accumulator keys: `${messageId}-block-${blockIndex}`

So replacement only affects the exact same message+block combination - no data loss between different messages.

## Commits Created

1. `4ce6782` - refactor(webview): complete type migration to tool type guards (TASK_2025_095)
2. `25eece7` - fix(webview): fix streaming multi-message rendering and text preservation (TASK_2025_096)
3. `b82c1c6` - docs(docs): update task tracking for TASK_2025_094 and TASK_2025_095

## Files Modified

**TASK_2025_096 Streaming Fixes:**

- `libs/frontend/chat/src/lib/services/chat.store.ts` - Added `currentExecutionTrees`
- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` - Text preservation fix
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` - Diagnostic logging
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` - `streamingMessages` array
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - `@for` loop

**TASK_2025_095 Type Migration (also committed):**

- `libs/shared/src/lib/type-guards/tool-input-guards.ts` - Comprehensive tool types
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/frontend/chat/src/lib/components/molecules/code-output.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/todo-list-display.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-input-display.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-output-display.component.ts`
- `libs/frontend/chat/src/lib/settings/auth-config.component.html`
- `libs/frontend/chat/src/lib/settings/auth-config.component.ts`

## Testing Needed

The fixes are implemented and build passes. User should test:

1. **Multi-message rendering**: When Claude uses tools, ALL message bubbles should appear
2. **Text preservation**: Text content should be visible in ALL bubbles, not just the last one

## Next Steps

1. Test the extension with real Claude tool usage
2. If bugs persist, check the log file for diagnostic messages
3. If working correctly, push changes and optionally create PR

## Remaining Unstaged Files

- `vscode-app-1766939225426.log` - Debug log file (don't commit)
- `claude-agentsdk-types.md` - Research notes (optional to commit)
