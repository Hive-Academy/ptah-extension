# TASK_2025_084: SDK Streaming Architecture - Critical Fixes

## Status: PENDING

## Parent Task

- **TASK_2025_082**: SDK Streaming Architecture Migration (COMPLETED)

## Background

TASK_2025_082 successfully migrated the SDK streaming architecture from backend tree-building to flat events with frontend render-time tree construction. Code reviews identified critical issues that need to be addressed for production readiness.

## Problem Statement

The current implementation works for the happy path but has:

1. **Incomplete implementation** - Tool delta events use placeholder IDs that don't match tool start
2. **Safety vulnerabilities** - Unbounded recursion can crash the renderer
3. **Performance issues** - O(n²) complexity degrades with conversation length
4. **Race conditions** - Concurrent operations can corrupt message boundaries
5. **Contract violations** - Tool input stored in wrong field

## Critical Issues (Priority 1 - Must Fix)

### Issue 0: toolCallId Mismatch - Tool Inputs Always Empty (BLOCKER)

- **File**: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:489`
- **Problem**: `tool_delta` events use placeholder `tool-block-${blockIndex}` while `tool_start` events use real SDK `contentBlock.id`
- **Impact**: **Tool inputs will ALWAYS be empty** - accumulator stores with placeholder key, tree builder looks up with real key
- **Root Cause**: Comment says "Placeholder - real ID from tool_start" but no tracking was implemented
- **Data Flow**:

  ```
  Backend tool_start:  toolCallId = "toolu_01XYZ..."  (real SDK ID)
  Backend tool_delta:  toolCallId = "tool-block-0"   (placeholder)

  Frontend stores:     toolInputAccumulators["tool-block-0-input"] = "{ ... }"
  Frontend looks for:  toolInputAccumulators["toolu_01XYZ...-input"] = undefined!
  ```

- **Fix**: Track `contentBlock.id` from `content_block_start` events and use for subsequent deltas:

  ```typescript
  // Add to SdkMessageTransformer class
  private toolCallIdByBlockIndex: Map<number, string> = new Map();

  // In content_block_start handler for tool_use:
  this.toolCallIdByBlockIndex.set(blockIndex, contentBlock.id);

  // In input_json_delta handler:
  const realToolCallId = this.toolCallIdByBlockIndex.get(blockIndex) || `tool-block-${blockIndex}`;
  const toolDeltaEvent: ToolDeltaEvent = {
    // ...
    toolCallId: realToolCallId,  // Use real ID, not placeholder
  };
  ```

### Issue 1: Unbounded Recursion / No Cycle Detection

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:273-303`
- **Problem**: `buildToolChildren` recursively calls `buildMessageNode` with no depth limit
- **Impact**: Circular `parentToolUseId` references cause stack overflow, crashing renderer
- **Fix**:
  ```typescript
  private buildToolChildren(
    toolCallId: string,
    state: StreamingState,
    depth = 0
  ): ExecutionNode[] {
    const MAX_DEPTH = 10;
    if (depth >= MAX_DEPTH) {
      console.warn('[ExecutionTreeBuilderService] Max depth exceeded', { toolCallId, depth });
      return [];
    }
    // ... existing logic with depth + 1 passed to recursive calls
  }
  ```

### Issue 2: O(n²) Performance in Tree Building

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:48-82`
- **Problem**: `buildTree` iterates `messageEventIds`, each call scans ALL events in Map
- **Impact**: 100 messages × 1000 events = 100,000 iterations. Violates < 5ms requirement
- **Fix**: Pre-index events by `messageId` in StreamingState:
  ```typescript
  interface StreamingState {
    // ... existing fields
    eventsByMessage: Map<string, FlatStreamEventUnion[]>; // Pre-indexed
  }
  ```
  Update `processStreamEvent` to populate index, update tree builder to use it.

### Issue 3: Race Condition Between Finalize and Stream

- **File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:127-213`
- **Problem**: `finalizeCurrentMessage` reads `streamingState` while `processStreamEvent` writes
- **Impact**: New events leak into previous message's finalized tree
- **Fix**: Deep-copy `streamingState` before tree building:
  ```typescript
  const stateCopy = this.deepCopyStreamingState(streamingState);
  const finalTree = this.treeBuilder.buildTree(stateCopy);
  ```

### Issue 4: Tool Input Field Mismatch

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:234-263`
- **Problem**: Accumulated tool input stored in `content` field instead of `toolInput`
- **Impact**: UI components expect structured data in `toolInput`, find nothing
- **Fix**:

  ```typescript
  const inputKey = `${toolStart.toolCallId}-input`;
  const inputString = state.toolInputAccumulators.get(inputKey) || '';
  let toolInput: Record<string, unknown> | undefined;
  try {
    toolInput = inputString ? JSON.parse(inputString) : undefined;
  } catch {
    toolInput = { raw: inputString };
  }

  return createExecutionNode({
    // ...
    content: null,
    toolInput, // Parsed JSON in correct field
  });
  ```

## Serious Issues (Priority 2 - Should Fix)

### Issue 5: Silent Failure in Tree Building

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:295-298`
- **Problem**: `buildMessageNode` returns null, child silently dropped with no logging
- **Fix**: Add warning log when node is dropped

### Issue 6: Accumulator Key Fragility

- **File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:73-76`
- **Problem**: Undefined `blockIndex` creates orphan key `${messageId}-block-undefined`
- **Fix**: Default `event.blockIndex ?? 0` before key construction

### Issue 7: No Event Ordering Guarantees

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:51-58`
- **Problem**: Network reordering could show tool results before tool starts
- **Fix**: Sort events by timestamp before building tree

### Issue 8: Magic String Coupling

- **Files**: `streaming-handler.service.ts:94` AND `execution-tree-builder.service.ts:239`
- **Problem**: Key format `${toolCallId}-input` duplicated in 2 files
- **Fix**: Extract to shared constants in `chat.types.ts`:
  ```typescript
  export const AccumulatorKeys = {
    toolInput: (toolCallId: string) => `${toolCallId}-input`,
    textBlock: (messageId: string, blockIndex: number) => `${messageId}-block-${blockIndex}`,
  };
  ```

### Issue 9: Missing Cleanup on Tab Deletion

- **File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:44-51`
- **Problem**: Events keep arriving after tab closed, wasting CPU
- **Fix**: Track active session IDs, early-exit for deleted sessions

### Issue 10: Inconsistent Timestamps

- **File**: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts:150`
- **Problem**: Using `Date.now()` (build time) instead of `event.timestamp` (event time)
- **Fix**: Use `event.timestamp` for `startTime` field

### Issue 11: Code Duplication in Delta Handling

- **File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:72-98`
- **Problem**: Delta handling repeated 3 times for text/thinking/tool
- **Fix**: Extract `accumulateDelta(map, key, delta)` helper method

## Acceptance Criteria

1. **Safety**: No stack overflow possible regardless of SDK input
2. **Performance**: Tree building < 5ms for 100 messages with 1000 events
3. **Correctness**: Tool input accessible via `toolInput` field
4. **Reliability**: No race conditions between finalize and stream
5. **Code Quality**: No magic string coupling, no code duplication
6. **Build**: `npm run typecheck:all` passes with 0 errors
7. **Tests**: All existing tests pass

## Files to Modify

| File                                                                          | Changes                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                   | **Issue 0**: Add toolCallIdByBlockIndex tracking, use real IDs for tool_delta |
| `libs/frontend/chat/src/lib/services/chat.types.ts`                           | Add `eventsByMessage` index, add `AccumulatorKeys` constants                  |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` | Pre-index events, deep-copy on finalize, extract delta helper                 |
| `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`       | Add depth limit, use pre-indexed events, fix toolInput field                  |

## Estimated Scope

- **Batch 0**: Blocker fix (Issue 0 - toolCallId mismatch) - ~15 lines changed
- **Batch 1**: Critical fixes (Issues 1-4) - ~150 lines changed
- **Batch 2**: Serious fixes (Issues 5-11) - ~80 lines changed
- **Total**: ~245 lines across 4 files

## Review References

- Code Logic Review: TASK_2025_082 agent `af0a053`
- Code Style Review: TASK_2025_082 agent `a71a2ec`
- Both reviews scored 6.5/10 with verdict NEEDS_REVISION
