# Task Context - TASK_2025_082

## User Intent

Clean migration of SDK streaming architecture:

1. Don't leave behind backward compatible debt - remove old patterns completely
2. Keep advanced tree building in the UI without losing current ExecutionNode logic

## Conversation Summary

### Problem Discovery

User reported streaming issues shown in screenshots:

- `wrong-message-chunks.png` - Text chunks appearing as separate lines instead of updating in place
- `wrong-subagent-and-user-duplicate-message.png` - Multiple empty agent boxes, user message duplication

### Deep Analysis Performed

Studied official Claude Agent SDK demos (`simple-chatapp`, `research-agent`) and compared with our implementation.

### Key Findings

**Official Demo Architecture**:

- Uses FLAT message array, not tree structure
- Backend waits for complete `assistant` messages from SDK
- Broadcasts flat events: `assistant_message`, `tool_use`, `result`
- Frontend appends to message array - no complex merging

**Our Architecture (problematic)**:

- Process `stream_event` (message_start, content_block_delta, etc.) to build tree during streaming
- Complex state management: `messageStates` Map, `messageUuidStack` array
- `mergeExecutionNode` tries to merge incoming nodes into tree
- State corruption when sub-agent messages interleave with parent messages

### Root Cause Identified

We conflated TWO separate concerns:

1. **Streaming** (partial content arriving over time) - should just accumulate text
2. **Hierarchy** (sub-agent relationships) - should be built at display time

### User's Requirements

1. **Keep rich UI** - Tool inputs/outputs, sub-agent nesting, execution visualization
2. **Tree is UI concern** - Backend should send flat events with relationship IDs
3. **Frontend builds tree at render time** - Not during streaming

### The Correct Architecture

```
BACKEND (Transport)          FRONTEND (Display)
──────────────────           ──────────────────
SDK Events                   Flat Storage
    │                            │
    ▼                            ▼
Flat Events with IDs ────► Store as flat Map
    │                            │
    └──────────────────────► Build tree at render
                                 │
                                 ▼
                            ExecutionNode tree
                            (for UI components)
```

### What Must NOT Change

- Rich ExecutionNode visualization (tool inputs/outputs, sub-agent nesting)
- Current UI components that render ExecutionNode tree
- TypeWriter streaming effect

### What Must Change

1. Backend: Send flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
2. Frontend: Store flat, build tree at render time
3. Remove: Complex mergeExecutionNode logic, per-message state tracking in backend

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-17
- Type: REFACTORING
- Complexity: Complex

## Execution Strategy

REFACTORING - Architectural migration with zero backward compatibility debt

## Files Likely Affected

### Backend (to simplify)

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` - Emit flat events
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` - Simplify streaming

### Frontend (to restructure)

- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` - Flat storage
- `libs/frontend/chat/src/lib/services/chat-store/*.ts` - Update to use flat model
- `libs/frontend/chat/src/lib/components/` - Build tree at render time

### Shared Types (to update)

- `libs/shared/src/lib/types/execution-node.types.ts` - May need flat event types

## Related Tasks

- TASK_2025_081: Previous partial fixes (now superseded)
- TASK_2025_023: Original ExecutionNode UI rebuild

## Success Criteria

1. Single streaming bubble during response (text accumulates, not duplicates)
2. Tool inputs/outputs display correctly with collapsible sections
3. Sub-agents nest visually under parent Task tool
4. No backward compatibility debt - clean patterns only
5. Build passes, no lint errors
6. Simpler code with fewer edge cases
