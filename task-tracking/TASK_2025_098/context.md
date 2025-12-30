# TASK_2025_098: SDK Session Compaction Implementation

## User Intent

Enable SDK built-in session compaction for long-running conversations to prevent context window exhaustion. Also removed the incorrect 5-minute timeout that was prematurely ending sessions.

## Related Fix (Completed)

**Session Timeout Removal**: Removed the hardcoded 5-minute `MESSAGE_TIMEOUT_MS` from `sdk-agent-adapter.ts`. Per Agent SDK best practices, sessions should run indefinitely until user/app ends them or SDK limits are reached.

**File Changed**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

## Research Findings (December 2025)

### Key Finding: SDK Has Built-in Automatic Compaction

The Claude Agent SDK handles compaction automatically - no need for custom implementation.

### How SDK Compaction Works

1. **Threshold Check**: SDK monitors total tokens after each response
2. **Auto-trigger**: When threshold exceeded (default: 100,000 tokens), compaction activates
3. **Summary Generation**: Claude creates a structured summary preserving:
   - Task overview & success criteria
   - Current state & completed work
   - Important decisions & failed approaches
   - Next steps & blockers
4. **Context Replacement**: Full history replaced with summary
5. **Conversation Continues**: Seamlessly from the summary

### Configuration Options

```typescript
// In SDK query options
compactionControl: {
  enabled: true,                    // Enable automatic compaction
  contextTokenThreshold: 100000,    // Trigger threshold (adjust as needed)
  model?: string,                   // Model for summary generation
  summaryPrompt?: string            // Custom summary prompt (optional)
}
```

### Two Complementary Approaches Available

| Approach                                   | Where                                           | Best For                                      |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------- |
| **Client-side Compaction** (SDK)           | SDK `tool_runner`                               | Long conversations, extensive back-and-forth  |
| **Server-side Context Editing** (API Beta) | API with `context-management-2025-06-27` header | Tool result clearing, thinking block clearing |

### Server-Side Tool Result Clearing (Beta)

```typescript
// Clears old tool results to save tokens
betas: ["context-management-2025-06-27"],
context_management: {
  edits: [{
    type: "clear_tool_uses_20250919",
    trigger: { type: "input_tokens", value: 30000 },
    keep: { type: "tool_uses", value: 3 }  // Keep last 3 tool uses
  }]
}
```

### Performance Impact (from Anthropic)

| Strategy                 | Improvement                     |
| ------------------------ | ------------------------------- |
| Context editing alone    | **29%** over baseline           |
| Context editing + memory | **39%** over baseline           |
| Token reduction          | **84%** in 100-turn evaluations |

### PreCompact Hook for UI Notification

```typescript
hooks: {
  PreCompact: [
    {
      hooks: [
        async (input) => {
          // input.hook_event_name === 'PreCompact'
          // input.trigger === 'manual' | 'auto'
          // Emit event to webview: "Context being optimized..."
          eventBus.emit('session.compacting', { sessionId, trigger: input.trigger });
          return { continue: true };
        },
      ],
    },
  ];
}
```

### Extended Context (Beta)

For large codebases, 1M token context available:

```typescript
betas: ['context-1m-2025-08-07'];
```

## Implementation Requirements

### Phase 1: Enable SDK Compaction (Required)

1. Add `compactionControl` to SDK query options in `SdkAgentAdapter`
2. Configure default threshold (recommend 100,000 tokens)
3. Make threshold configurable via VS Code settings

### Phase 2: UI Notification (Recommended)

1. Implement `PreCompact` hook handler
2. Emit compaction event to webview
3. Show toast/indicator when compaction happens
4. Track compaction count in session metadata

### Phase 3: Server-Side Context Editing (Optional)

1. Add beta header `context-management-2025-06-27`
2. Configure tool result clearing for file-heavy sessions
3. Exclude critical tools from clearing (e.g., web_search)

### Phase 4: Settings UI (Optional)

1. Add compaction threshold setting
2. Add toggle for auto-compaction on/off
3. Add option for 1M context beta

## Files to Modify

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Add compactionControl
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` - Emit compaction events
- `libs/frontend/chat/src/lib/services/chat-store.service.ts` - Handle compaction notifications
- `apps/ptah-extension-vscode/package.json` - Add settings for threshold

## Sources

- [Agent SDK Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions.md)
- [Context Windows Documentation](https://platform.claude.com/docs/en/build-with-claude/context-windows.md)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript.md)
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Managing Context on the Claude Developer Platform](https://anthropic.com/news/context-management)

## Status

**Created**: 2025-12-29
**Status**: Planned (Not Started)
**Priority**: Medium
**Depends On**: None (research complete)
