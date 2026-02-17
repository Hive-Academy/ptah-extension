# Skill Loading UI Issue - Fix Plan

**Date**: 2026-02-15
**Session**: `74ac83d2-65d4-40a1-a1af-dd83f3687793`

---

## Root Cause Analysis

When Claude invokes a `Skill` tool, the Agent SDK loads the skill file and injects it as a **user message** into the conversation. Example from session.jsonl:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Base directory for this skill: d:\\projects\\ptah-extension\\...\n\n# Nx Workspace Architect\n\n[5000+ lines of skill documentation]"
      }
    ]
  },
  "isMeta": true, // <-- This flag indicates it's metadata, not user input
  "sourceToolUseID": "Skill_0"
}
```

**The Problem**: These `isMeta: true` messages are being rendered as regular chat bubbles in the UI, making the conversation unreadable.

---

## Solution: Filter Meta Messages from UI Rendering

### Option 1: Frontend Filter (Quick Fix) ⭐ RECOMMENDED

Filter out `isMeta` messages when rendering the chat history.

**File**: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts`

**Change**:

```typescript
// Around line 200+ (where execution nodes are registered)
private registerExecutionNode(event: SomeEventType) {
  // Skip meta messages from being rendered
  if (event.isMeta === true) {
    console.debug('[StreamingHandler] Skipping meta message (skill content)');
    return;
  }

  // ... rest of execution node registration
}
```

**Also in**: `libs/frontend/chat/src/lib/services/chat-store.service.ts`

When loading conversation history or processing new messages:

```typescript
// Filter out meta messages when building message list
const filteredMessages = messages.filter((msg) => !msg.isMeta);
```

---

### Option 2: Mark Skill Content as Internal (Better Long-term)

Mark skill-loading messages as `isInternal: true` at the source so they never reach the UI.

**File**: `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts` (or wherever skills are loaded)

**Change**: When reading skill files and injecting them into the conversation:

```typescript
// When creating the user message with skill content
const skillMessage = {
  role: 'user',
  content: [{ type: 'text', text: skillContent }],
  isMeta: true,
  isInternal: true, // <-- Add this flag
};
```

**Then in**: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts`

Filter messages before sending to the webview:

```typescript
// Don't send internal messages to the UI
if (message.isInternal) {
  return; // Skip streaming this message to the webview
}
```

---

### Option 3: Detect Skill Messages by Pattern (Fallback)

If `isMeta` isn't reliable, detect skill messages by content pattern.

**Pattern**: Messages that start with `"Base directory for this skill:"` are always skill files.

```typescript
const isSkillMessage = (content: string): boolean => {
  return content.startsWith('Base directory for this skill:') || content.includes('SKILL.md') || content.includes('# Nx Workspace Architect');
};

// Filter in message renderer
if (isSkillMessage(message.content)) {
  return; // Don't render
}
```

---

## Recommended Implementation Plan

### Phase 1: Quick Fix (Today) ✅

1. **Update `StreamingHandlerService`** to filter `isMeta: true` messages

   - File: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts`
   - Skip creating execution nodes for meta messages

2. **Update `ChatStore`** to filter meta messages from history

   - File: `libs/frontend/chat/src/lib/services/chat-store.service.ts`
   - Filter when loading messages from session.jsonl

3. **Test**: Re-run the session and verify skill files don't appear in UI

### Phase 2: Long-term Fix (Next Sprint)

4. **Mark skill content as internal at source**

   - File: `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts`
   - Add `isInternal: true` flag when injecting skill content

5. **Filter internal messages in stream processor**

   - File: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts`
   - Don't send `isInternal` messages to webview

6. **Create integration test**
   - Invoke a skill and verify UI doesn't show skill.md content
   - Verify skill still works correctly behind the scenes

---

## Files to Modify

| File                                                                       | Purpose                               | Priority |
| -------------------------------------------------------------------------- | ------------------------------------- | -------- |
| `libs/frontend/chat/src/lib/services/streaming-handler.service.ts`         | Filter meta messages during streaming | P0       |
| `libs/frontend/chat/src/lib/services/chat-store.service.ts`                | Filter meta messages from history     | P0       |
| `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts`         | Mark skill content as internal        | P1       |
| `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts` | Filter internal messages              | P1       |
| `libs/shared/src/lib/types/rpc.types.ts`                                   | Add `isInternal` to message type      | P1       |

---

## Type Definitions

Add to shared types:

```typescript
// libs/shared/src/lib/types/rpc.types.ts

export interface BaseMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  isMeta?: boolean; // Existing: Indicates metadata (not user input)
  isInternal?: boolean; // NEW: Should not be rendered in UI
  sourceToolUseID?: string;
}
```

---

## Testing Checklist

- [ ] Skill invocation doesn't show skill.md content in UI
- [ ] Skill still executes correctly (agent receives the skill content)
- [ ] Message history loads without skill files
- [ ] Sub-agent invocations still work
- [ ] Regular Read/Glob/Grep tool calls still appear in UI
- [ ] Final assistant message appears correctly (not hidden)

---

## Verification Steps

1. **Reproduce the issue**:

   - Start a new session
   - Send message: "Can you analyze my workspace using the orchestration skill?"
   - Observe: Skill files appear as message bubbles

2. **Apply frontend fix**:

   - Filter `isMeta: true` messages in StreamingHandler
   - Restart extension and retry
   - Verify: Skill files no longer appear

3. **Apply backend fix**:
   - Mark skill content as `isInternal`
   - Verify messages never reach the webview
   - Check session.jsonl to confirm messages are still saved (for context)

---

## Additional Notes

### Why `isMeta` exists

The `isMeta: true` flag indicates the message is metadata injected by the system, not actual user input. Examples:

- Skill file content
- Tool results
- System-generated context

These should **not** be displayed to the user as chat bubbles, but they **are** part of the conversation context that Claude sees.

### Why we still save them

Even though we hide them from the UI, we keep them in the session.jsonl because:

- Claude needs them to understand the skill's instructions
- Session replay requires the full conversation
- Debugging requires seeing what context was provided

### Performance Impact

Filtering ~5000 lines of skill content from the UI will:

- Reduce DOM nodes significantly
- Improve rendering performance
- Reduce memory usage
- Make the chat more readable

---

## Related Issues

This fix also resolves:

- **Sub-agent not found warnings**: The warnings are logged but don't break functionality
- **Message disappeared**: The final message is likely being hidden if it has `isMeta: true`

---

## Decision

**Approved Approach**: Option 1 (Frontend Filter) + Option 2 (Backend Internal Flag)

**Rationale**:

- Frontend filter is a quick fix that works immediately
- Backend flag provides a proper long-term solution
- Both layers ensure robustness (defense in depth)

**Implementation Order**:

1. Frontend filter (immediate relief)
2. Backend internal flag (proper solution)
3. Integration tests (prevent regression)
