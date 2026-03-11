# Research Report: Claude Agent SDK Tool Input/Output Types

**Research Classification**: TYPE_SYSTEM_ANALYSIS
**Confidence Level**: 95% (based on SDK source code and codebase analysis)
**Date**: 2025-12-28
**Task**: TASK_2025_092

## Executive Intelligence Brief

**Key Insight**: The SDK **does** provide properly typed tool inputs as `Record<string, unknown>` objects, NOT strings. The JSON parsing in `execution-tree-builder.service.ts` is ONLY required during streaming because the SDK sends partial JSON as `input_json_delta` string chunks that must be accumulated before parsing.

## Strategic Findings

### Finding 1: SDK Type Definitions Are Well-Typed

**Source**: `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`

The SDK provides properly typed structures:

```typescript
// Tool use content block - input is ALREADY PARSED object
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>; // Already parsed, not a string!
}

// Tool result content block
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<TextBlock | { type: 'image'; source: unknown }>;
  is_error?: boolean;
}
```

**Evidence Strength**: HIGH - Verified directly from SDK type definitions

### Finding 2: The Streaming Problem - `input_json_delta`

**Source**: SDK types and `sdk-message-transformer.ts` (lines 370-390)

During streaming, tool inputs arrive as **partial JSON strings** via `input_json_delta`:

```typescript
export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string; // Partial JSON fragment, e.g., '{"file_path": "d:\\proje'
}
```

This is the **root cause** of why JSON parsing is needed:

1. **Streaming**: SDK sends `content_block_delta` with `delta.type === 'input_json_delta'`
2. **Delta contains**: `delta.partial_json` - a STRING fragment
3. **Accumulation required**: Fragments must be concatenated: `'{"file' + '_path": "' + 'd:\\project"}'`
4. **Parsing required**: Final accumulated string must be parsed with `JSON.parse()`

### Finding 3: Complete Messages Have Parsed Objects

**Source**: `sdk-message-transformer.ts` (lines 523-565)

For complete `assistant` messages (non-streaming), the SDK provides already-parsed objects:

```typescript
// From transformAssistantToFlatEvents()
if (isToolUseBlock(block)) {
  const toolStartEvent: ToolStartEvent = {
    // ...
    toolInput: block.input, // Already Record<string, unknown>!
    // ...
  };
}
```

The `block.input` is **already a parsed object** - no JSON parsing needed!

### Finding 4: Historical Session Data Also Provides Parsed Objects

**Source**: `session-history-reader.service.ts` (lines 580-595)

When reading JSONL files for session history, the data is pre-parsed:

```typescript
// ContentBlock interface in session-history-reader
interface ContentBlock {
  type: string;
  input?: Record<string, unknown>; // Already parsed from JSONL!
}

// When creating ToolStartEvent:
events.push({
  toolInput: block.input, // Already Record<string, unknown>
  // ...
});
```

## Data Flow Analysis

### Path A: Live Streaming (JSON Parsing REQUIRED)

```
SDK Stream Event (input_json_delta)
    ↓ partial_json: '{"file_path": "d:\\'
sdk-message-transformer.ts (ToolDeltaEvent)
    ↓ delta: '{"file_path": "d:\\'
streaming-handler.service.ts (accumulateDelta)
    ↓ toolInputAccumulators.set(key, accumulated + delta)
execution-tree-builder.service.ts (parseToolInput)
    ↓ JSON.parse(accumulatedString) → toolInput object
ExecutionNode.toolInput: Record<string, unknown>
```

### Path B: Complete SDK Messages (NO JSON Parsing Needed)

```
SDK Assistant Message
    ↓ message.content[].input: Record<string, unknown>
sdk-message-transformer.ts (transformAssistantToFlatEvents)
    ↓ ToolStartEvent.toolInput: block.input
streaming-handler.service.ts (stores event)
    ↓ state.events.set(event.id, event)
execution-tree-builder.service.ts (buildToolNode)
    ↓ Uses event.toolInput directly (already parsed!)
ExecutionNode.toolInput: Record<string, unknown>
```

### Path C: Historical Session Data (NO JSON Parsing Needed)

```
JSONL File (already JSON parsed per line)
    ↓ JSON.parse(line) → ContentBlock with input: Record<string, unknown>
session-history-reader.service.ts (createToolStart)
    ↓ ToolStartEvent.toolInput: block.input
RPC Response → WebView
    ↓ streaming-handler.service.ts processes events
ExecutionNode.toolInput: Record<string, unknown>
```

## Why Current Approach is Correct

The current approach in `execution-tree-builder.service.ts` is **correct and necessary** for streaming:

```typescript
// From execution-tree-builder.service.ts lines 348-375
let toolInput: Record<string, unknown> | undefined;
if (inputString && resultEvent) {
  // Tool completed - safe to parse full JSON
  const result = this.parseToolInput(inputString);
  if (result.success) {
    toolInput = result.data;
  } else {
    // Preserve parse error for debugging
    toolInput = { __parseError: result.error, __raw: result.raw };
  }
} else if (inputString) {
  // Tool still streaming - don't parse yet
  toolInput = { __streaming: true, __rawSnippet: inputString.substring(0, 50) + '...' };
}
```

**Key Design Decision**: Only parse JSON when `resultEvent` exists (tool is complete).

## Comparative Analysis

| Data Source              | Input Format     | JSON Parse Needed | Where Parsing Happens     |
| ------------------------ | ---------------- | ----------------- | ------------------------- |
| SDK stream_event (delta) | String fragments | YES               | execution-tree-builder    |
| SDK assistant (complete) | Parsed object    | NO                | Already in SDK            |
| Historical JSONL         | Parsed object    | NO                | Already in session-reader |

## Recommended Improvements

### Improvement 1: Leverage `ToolStartEvent.toolInput` When Available

The `ToolStartEvent` type already has optional `toolInput`:

```typescript
// From execution-node.types.ts
export interface ToolStartEvent extends FlatStreamEvent {
  readonly eventType: 'tool_start';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolInput?: Record<string, unknown>; // SDK provides this!
  readonly isTaskTool: boolean;
}
```

**Current Issue**: During streaming, `sdk-message-transformer.ts` doesn't populate `toolInput` on `tool_start` events because the SDK's `content_block_start` event doesn't contain the full input yet.

**Recommendation**: For complete messages (Path B and C), the `toolInput` is already provided. The execution-tree-builder should check if `ToolStartEvent.toolInput` exists BEFORE attempting to parse from accumulators:

```typescript
// Proposed optimization in buildToolNode():
let toolInput: Record<string, unknown> | undefined;

// FIRST: Check if SDK already provided parsed input
if (toolStart.toolInput && Object.keys(toolStart.toolInput).length > 0) {
  toolInput = toolStart.toolInput;
} else {
  // FALLBACK: Parse from accumulated string (streaming path)
  const inputString = state.toolInputAccumulators.get(inputKey) || '';
  if (inputString && resultEvent) {
    const result = this.parseToolInput(inputString);
    // ... existing parsing logic
  }
}
```

### Improvement 2: Enhance Type Safety in Shared Library

Add well-typed tool input interfaces to `@ptah-extension/shared`:

```typescript
// Proposed: libs/shared/src/lib/types/tool-input.types.ts

/** Read tool input */
export interface ReadToolInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

/** Write tool input */
export interface WriteToolInput {
  file_path: string;
  content: string;
}

/** Bash tool input */
export interface BashToolInput {
  command: string;
  timeout?: number;
  description?: string;
}

/** Task tool input (agent spawn) */
export interface TaskToolInput {
  subagent_type: string;
  description?: string;
  prompt?: string;
}

/** Union of known tool inputs */
export type KnownToolInput = ReadToolInput | WriteToolInput | BashToolInput | TaskToolInput;

/** Type guard for tool inputs */
export function isReadToolInput(input: unknown): input is ReadToolInput {
  return typeof input === 'object' && input !== null && 'file_path' in input;
}
```

### Improvement 3: Move Parsing Logic to Backend

The JSON parsing could be moved from frontend `execution-tree-builder.service.ts` to backend `sdk-message-transformer.ts`, where:

1. Backend accumulates `input_json_delta` fragments
2. Backend parses complete JSON when `content_block_stop` arrives
3. Backend emits `ToolStartEvent.toolInput` with parsed object

**Trade-offs**:

- **Pro**: Frontend receives already-parsed data, simpler tree builder
- **Con**: Requires maintaining accumulator state in backend transformer
- **Con**: Additional complexity in backend with minimal benefit

**Recommendation**: Keep current architecture - frontend parsing is fine.

## Knowledge Graph

```
@anthropic-ai/claude-agent-sdk
    ├── SDKPartialAssistantMessage (streaming)
    │   └── event: RawMessageStreamEvent
    │       └── content_block_delta
    │           └── delta: InputJsonDelta
    │               └── partial_json: string  ← NEEDS PARSING
    │
    └── SDKAssistantMessage (complete)
        └── message: APIAssistantMessage
            └── content: ContentBlock[]
                └── ToolUseBlock
                    └── input: Record<string, unknown>  ← ALREADY PARSED

FlatStreamEventUnion (Ptah shared types)
    └── ToolStartEvent
        └── toolInput?: Record<string, unknown>  ← Optional, populated by SDK or parsing

ExecutionNode (Ptah shared types)
    └── toolInput?: Record<string, unknown>  ← Final parsed object
```

## Decision Support Dashboard

| Question                       | Answer                     | Confidence |
| ------------------------------ | -------------------------- | ---------- |
| Does SDK provide proper types? | YES                        | 95%        |
| Is JSON parsing necessary?     | For streaming ONLY         | 95%        |
| Is current approach correct?   | YES                        | 90%        |
| Should we refactor?            | Minor optimization only    | 85%        |
| Can we avoid ALL parsing?      | NO (streaming requires it) | 95%        |

## Summary

1. **SDK types ARE well-defined** - `ToolUseBlock.input` is `Record<string, unknown>`, not string
2. **JSON parsing IS required for streaming** - `input_json_delta` sends partial JSON strings
3. **Current architecture is correct** - parsing only when tool is complete
4. **Optimization possible** - Check `ToolStartEvent.toolInput` before parsing accumulators
5. **Type safety improvement** - Add typed tool input interfaces to shared library

## Files Analyzed

| File                                                                          | Purpose               | Key Finding                                           |
| ----------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`  | SDK types             | Provides parsed objects for complete messages         |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`          | Local SDK type copy   | Matches SDK, includes `InputJsonDelta`                |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                   | SDK→Ptah transformer  | Handles both streaming deltas and complete messages   |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`            | JSONL history reader  | Provides pre-parsed tool inputs                       |
| `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`       | Frontend tree builder | Parses accumulated JSON for streaming                 |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` | Event accumulator     | Accumulates `tool_delta` into `toolInputAccumulators` |
| `libs/shared/src/lib/types/execution-node.types.ts`                           | Shared types          | `ToolStartEvent.toolInput` is optional parsed object  |

## Conclusion

**The "weird parsing" IS necessary for streaming, but NOT for complete messages or historical data.**

The SDK design is intentional:

- **Streaming**: Send partial JSON for real-time UI updates (low latency)
- **Complete**: Send parsed objects for reliability

Current architecture correctly handles both paths. Minor optimization possible but not critical.
