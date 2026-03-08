# Simplified Architecture Proposal: Type-Safe SDK Integration

**Date**: 2025-12-18
**Status**: PROPOSAL

---

## Problem Analysis

### Current Issues

1. **No SDK type imports** - We use `dynamic import()` for runtime but never `import type` for types
2. **8 transformation layers** - Too many intermediate representations
3. **18 type casts** - Each layer loses/regains type safety
4. **Flat → Tree conversion** - Expensive operation on every event

### Root Cause: Misconception About ESM

```typescript
// Current (WRONG assumption):
// "ESM types won't work in CommonJS"
// So we use: { type: string; [key: string]: any }

// Reality (CORRECT):
// import type is erased at compile time - NO runtime issues!
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
// ↑ This works perfectly in CommonJS because types are compile-time only
```

---

## Solution Part 1: Import SDK Types Directly

### The Fix

```typescript
// libs/backend/agent-sdk/src/lib/types/sdk-imports.ts

// Type-only imports - erased at compile time, no ESM issues
import type { SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKUserMessageReplay, SDKResultMessage, SDKSystemMessage, SDKPartialAssistantMessage, SDKCompactBoundaryMessage, SDKStatusMessage, SDKHookResponseMessage, SDKToolProgressMessage, NonNullableUsage, ModelUsage } from '@anthropic-ai/claude-agent-sdk';

// Re-export for internal use
export type { SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKUserMessageReplay, SDKResultMessage, SDKSystemMessage, SDKPartialAssistantMessage };

// Runtime import helper (for actual SDK usage)
export async function importSdk() {
  return await import('@anthropic-ai/claude-agent-sdk');
}
```

### Benefits

- ✅ Full type safety from SDK discriminated unions
- ✅ No `.d.ts` file copying needed
- ✅ Auto-updates with SDK version upgrades
- ✅ IDE autocomplete works perfectly
- ✅ Compile-time errors instead of runtime errors

---

## Solution Part 2: Simplified Pipeline Architecture

### Current Pipeline (8 Layers)

```
SDK → StreamTransformer → SdkMessageTransformer → RPC → ChatStore →
StreamingHandler → ExecutionTreeBuilder → ChatStore → UI
```

### Proposed Pipeline (4 Layers)

```
SDK → SdkNormalizer → RPC → TreeAccumulator → UI
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Node.js)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────┐                                                 │
│  │   Claude Agent SDK     │                                                 │
│  │  AsyncIterable<        │                                                 │
│  │    SDKMessage          │  ← TYPED! (via import type)                    │
│  │  >                     │                                                 │
│  └───────────┬────────────┘                                                 │
│              │                                                              │
│              ▼                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ SdkNormalizer (SINGLE transformer)                                     ││
│  │                                                                         ││
│  │ Input:  SDKMessage (typed discriminated union)                         ││
│  │ Output: TreeReadyEvent (ready for direct tree insertion)               ││
│  │                                                                         ││
│  │ Responsibilities:                                                       ││
│  │ • Extract session ID from system.init → callback                       ││
│  │ • Extract stats from result → callback                                 ││
│  │ • Convert stream_event to TreeReadyEvent                               ││
│  │ • Type guards for all SDK message types                                ││
│  │                                                                         ││
│  │ NO: flat event accumulation (moved to frontend)                        ││
│  │ NO: multiple transformation passes                                     ││
│  └───────────┬────────────────────────────────────────────────────────────┘│
│              │                                                              │
│              │ RPC (typed payload)                                          │
│              ▼                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                          FRONTEND (Angular 20+)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│              │                                                              │
│              ▼                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ TreeAccumulator (SINGLE service)                                       ││
│  │                                                                         ││
│  │ Input:  TreeReadyEvent                                                  ││
│  │ Output: Signal<ExecutionNode>                                           ││
│  │                                                                         ││
│  │ Responsibilities:                                                       ││
│  │ • Maintain tree structure directly (no intermediate flat storage)      ││
│  │ • Accumulate text deltas into node.content                             ││
│  │ • Accumulate tool input deltas into node.toolInput                     ││
│  │ • Handle message_complete to finalize nodes                            ││
│  │ • Expose Signal<ExecutionNode> for UI                                  ││
│  │                                                                         ││
│  │ NO: flat-to-tree conversion (tree is primary structure)               ││
│  │ NO: separate streaming handler                                         ││
│  └───────────┬────────────────────────────────────────────────────────────┘│
│              │                                                              │
│              ▼                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ UI Components (Direct tree rendering)                                  ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## New Type Definitions

### TreeReadyEvent (Single Output Type)

```typescript
// libs/shared/src/lib/types/tree-ready-event.types.ts

/**
 * TreeReadyEvent - The ONLY event type sent from backend to frontend.
 * Designed to be directly insertable into the execution tree.
 */
export type TreeReadyEvent =
  // Session lifecycle
  | SessionInitEvent
  | SessionStatsEvent

  // Message lifecycle
  | MessageStartEvent
  | MessageCompleteEvent

  // Content blocks
  | TextBlockEvent
  | ThinkingBlockEvent
  | ToolBlockEvent
  | AgentBlockEvent;

// Each event type is tree-node-ready (no further transformation needed)

export interface SessionInitEvent {
  readonly eventType: 'session_init';
  readonly sessionId: string;
  readonly model: string;
  readonly tools: string[];
}

export interface SessionStatsEvent {
  readonly eventType: 'session_stats';
  readonly sessionId: string;
  readonly cost: number;
  readonly tokens: { input: number; output: number };
  readonly duration: number;
}

export interface MessageStartEvent {
  readonly eventType: 'message_start';
  readonly sessionId: string;
  readonly messageId: string;
  readonly role: 'user' | 'assistant';
  readonly parentToolUseId: string | null;
}

export interface MessageCompleteEvent {
  readonly eventType: 'message_complete';
  readonly sessionId: string;
  readonly messageId: string;
}

// Content block types - DIRECTLY map to ExecutionNode
export interface TextBlockEvent {
  readonly eventType: 'text_block';
  readonly sessionId: string;
  readonly messageId: string;
  readonly blockId: string;
  readonly content: string; // Full text (accumulated on backend)
  readonly isDelta: boolean; // true = append, false = replace
}

export interface ThinkingBlockEvent {
  readonly eventType: 'thinking_block';
  readonly sessionId: string;
  readonly messageId: string;
  readonly blockId: string;
  readonly content: string;
  readonly isDelta: boolean;
}

export interface ToolBlockEvent {
  readonly eventType: 'tool_block';
  readonly sessionId: string;
  readonly messageId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: 'started' | 'input_ready' | 'executing' | 'complete' | 'error';
  readonly toolInput?: Record<string, unknown>; // Parsed JSON (backend handles parsing!)
  readonly toolResult?: string;
  readonly error?: string;
}

export interface AgentBlockEvent {
  readonly eventType: 'agent_block';
  readonly sessionId: string;
  readonly messageId: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly description: string;
  readonly status: 'started' | 'complete';
}
```

### Key Design Decisions

1. **Backend parses JSON** - `toolInput` is already `Record<string, unknown>`, not string
2. **Backend accumulates deltas** - Frontend receives full/accumulated content
3. **isDelta flag** - Tells frontend whether to append or replace
4. **Status enum** - Tool lifecycle is explicit, not inferred
5. **No nested types** - Every event is flat, ready for tree insertion

---

## SdkNormalizer Implementation

```typescript
// libs/backend/agent-sdk/src/lib/sdk-normalizer.ts

import type { SDKMessage, SDKSystemMessage, SDKPartialAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { TreeReadyEvent, ToolBlockEvent } from '@ptah-extension/shared';

/**
 * Type guards for SDK messages - compile-time AND runtime safety
 */
function isSystemInit(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init';
}

function isStreamEvent(msg: SDKMessage): msg is SDKPartialAssistantMessage {
  return msg.type === 'stream_event';
}

function isResult(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

/**
 * SdkNormalizer - Single transformation from SDK to TreeReadyEvent
 */
@injectable()
export class SdkNormalizer {
  // Accumulate text/tool input on backend (not frontend!)
  private textAccumulators = new Map<string, string>();
  private toolInputAccumulators = new Map<string, string>();
  private currentMessageId: string | null = null;
  private toolCallIdMap = new Map<number, string>(); // index → toolCallId

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Transform SDK message to TreeReadyEvent(s)
   * Returns empty array for messages we don't forward to frontend
   */
  *transform(
    sdkMessage: SDKMessage, // ← TYPED! Not any
    sessionId: string
  ): Generator<TreeReadyEvent> {
    // 1. System init - extract session info via callback
    if (isSystemInit(sdkMessage)) {
      yield {
        eventType: 'session_init',
        sessionId: sdkMessage.session_id,
        model: sdkMessage.model,
        tools: sdkMessage.tools,
      };
      return;
    }

    // 2. Result - extract stats via callback
    if (isResult(sdkMessage)) {
      yield {
        eventType: 'session_stats',
        sessionId,
        cost: sdkMessage.total_cost_usd,
        tokens: {
          input: sdkMessage.usage.input_tokens,
          output: sdkMessage.usage.output_tokens,
        },
        duration: sdkMessage.duration_ms,
      };
      return;
    }

    // 3. Stream events - the main content
    if (isStreamEvent(sdkMessage)) {
      yield* this.transformStreamEvent(sdkMessage, sessionId);
    }
  }

  private *transformStreamEvent(msg: SDKPartialAssistantMessage, sessionId: string): Generator<TreeReadyEvent> {
    const event = msg.event;

    switch (event.type) {
      case 'message_start':
        this.currentMessageId = event.message.id;
        yield {
          eventType: 'message_start',
          sessionId,
          messageId: event.message.id,
          role: 'assistant',
          parentToolUseId: msg.parent_tool_use_id,
        };
        break;

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          // Capture real tool call ID
          this.toolCallIdMap.set(event.index, event.content_block.id);
          yield {
            eventType: 'tool_block',
            sessionId,
            messageId: this.currentMessageId!,
            toolCallId: event.content_block.id,
            toolName: event.content_block.name,
            status: 'started',
          };
        }
        break;

      case 'content_block_delta':
        yield* this.transformDelta(event, sessionId);
        break;

      case 'content_block_stop':
        // Finalize tool input if this was a tool block
        const toolCallId = this.toolCallIdMap.get(event.index);
        if (toolCallId) {
          const inputJson = this.toolInputAccumulators.get(toolCallId);
          if (inputJson) {
            // Parse JSON on backend - frontend never sees raw JSON!
            const toolInput = this.safeParseJson(inputJson, toolCallId);
            yield {
              eventType: 'tool_block',
              sessionId,
              messageId: this.currentMessageId!,
              toolCallId,
              toolName: '', // Already sent in started event
              status: 'input_ready',
              toolInput,
            };
          }
        }
        break;

      case 'message_stop':
        yield {
          eventType: 'message_complete',
          sessionId,
          messageId: this.currentMessageId!,
        };
        this.resetAccumulators();
        break;
    }
  }

  private *transformDelta(event: { type: 'content_block_delta'; index: number; delta: any }, sessionId: string): Generator<TreeReadyEvent> {
    const delta = event.delta;

    switch (delta.type) {
      case 'text_delta':
        const textKey = `${this.currentMessageId}:text:${event.index}`;
        const accumulated = (this.textAccumulators.get(textKey) || '') + delta.text;
        this.textAccumulators.set(textKey, accumulated);

        yield {
          eventType: 'text_block',
          sessionId,
          messageId: this.currentMessageId!,
          blockId: textKey,
          content: delta.text, // Send delta only
          isDelta: true,
        };
        break;

      case 'input_json_delta':
        const toolCallId = this.toolCallIdMap.get(event.index);
        if (toolCallId) {
          const current = this.toolInputAccumulators.get(toolCallId) || '';
          this.toolInputAccumulators.set(toolCallId, current + delta.partial_json);
        }
        // Don't yield - wait for content_block_stop to parse complete JSON
        break;

      case 'thinking_delta':
        const thinkingKey = `${this.currentMessageId}:thinking:${event.index}`;
        yield {
          eventType: 'thinking_block',
          sessionId,
          messageId: this.currentMessageId!,
          blockId: thinkingKey,
          content: delta.thinking,
          isDelta: true,
        };
        break;
    }
  }

  /**
   * Parse JSON safely - logs error but doesn't throw
   * Returns parsed object or { __parseError: string, __raw: string }
   */
  private safeParseJson(json: string, toolCallId: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
      this.logger.warn('[SdkNormalizer] Tool input not an object', { toolCallId, parsed });
      return { __parseError: 'Not an object', __raw: json };
    } catch (error) {
      this.logger.error('[SdkNormalizer] Tool input parse failed', { toolCallId, json, error });
      return { __parseError: String(error), __raw: json };
    }
  }

  private resetAccumulators(): void {
    this.textAccumulators.clear();
    this.toolInputAccumulators.clear();
    this.toolCallIdMap.clear();
    this.currentMessageId = null;
  }
}
```

---

## TreeAccumulator (Frontend)

```typescript
// libs/frontend/chat/src/lib/services/tree-accumulator.service.ts

/**
 * TreeAccumulator - Builds execution tree directly from TreeReadyEvents
 * No intermediate flat storage - tree is the primary data structure
 */
@Injectable({ providedIn: 'root' })
export class TreeAccumulator {
  // Tree structure per session
  private trees = new Map<string, WritableSignal<ExecutionNode[]>>();

  // Node lookup for O(1) updates
  private nodeMap = new Map<string, ExecutionNode>();

  /**
   * Process incoming event - directly updates tree
   */
  processEvent(event: TreeReadyEvent): void {
    switch (event.eventType) {
      case 'message_start':
        this.startMessage(event);
        break;
      case 'message_complete':
        this.completeMessage(event);
        break;
      case 'text_block':
        this.updateTextBlock(event);
        break;
      case 'thinking_block':
        this.updateThinkingBlock(event);
        break;
      case 'tool_block':
        this.updateToolBlock(event);
        break;
      case 'agent_block':
        this.updateAgentBlock(event);
        break;
    }
  }

  private startMessage(event: MessageStartEvent): void {
    const tree = this.getOrCreateTree(event.sessionId);

    const node: ExecutionNode = {
      id: event.messageId,
      type: 'message',
      status: 'streaming',
      role: event.role,
      parentToolUseId: event.parentToolUseId,
      children: [],
      content: '',
      isCollapsed: false,
    };

    this.nodeMap.set(event.messageId, node);

    // Insert into tree
    if (event.parentToolUseId) {
      // Nested under tool
      const parentTool = this.nodeMap.get(event.parentToolUseId);
      if (parentTool) {
        parentTool.children.push(node);
      }
    } else {
      // Root message
      tree.update((nodes) => [...nodes, node]);
    }
  }

  private updateTextBlock(event: TextBlockEvent): void {
    const messageNode = this.nodeMap.get(event.messageId);
    if (!messageNode) return;

    let textNode = messageNode.children.find((c) => c.type === 'text' && c.id === event.blockId);

    if (!textNode) {
      textNode = {
        id: event.blockId,
        type: 'text',
        status: 'streaming',
        content: '',
        children: [],
        isCollapsed: false,
      };
      messageNode.children.push(textNode);
      this.nodeMap.set(event.blockId, textNode);
    }

    // Append or replace
    if (event.isDelta) {
      textNode.content += event.content;
    } else {
      textNode.content = event.content;
    }

    // Trigger signal update
    this.notifyTreeChange(event.sessionId);
  }

  private updateToolBlock(event: ToolBlockEvent): void {
    const messageNode = this.nodeMap.get(event.messageId);
    if (!messageNode) return;

    let toolNode = this.nodeMap.get(event.toolCallId);

    if (!toolNode) {
      toolNode = {
        id: event.toolCallId,
        type: 'tool',
        status: 'pending',
        toolName: event.toolName,
        toolInput: undefined,
        toolResult: undefined,
        children: [],
        isCollapsed: false,
      };
      messageNode.children.push(toolNode);
      this.nodeMap.set(event.toolCallId, toolNode);
    }

    // Update based on status
    switch (event.status) {
      case 'started':
        toolNode.status = 'pending';
        toolNode.toolName = event.toolName;
        break;
      case 'input_ready':
        toolNode.toolInput = event.toolInput; // Already parsed!
        break;
      case 'executing':
        toolNode.status = 'running';
        break;
      case 'complete':
        toolNode.status = 'complete';
        toolNode.toolResult = event.toolResult;
        break;
      case 'error':
        toolNode.status = 'error';
        toolNode.error = event.error;
        break;
    }

    this.notifyTreeChange(event.sessionId);
  }

  // ... similar methods for thinking, agent, message_complete
}
```

---

## Migration Path

### Phase 1: Add Type Imports (1 day)

1. Create `libs/backend/agent-sdk/src/lib/types/sdk-imports.ts`
2. Add `import type` for all SDK types
3. Update `sdk-message-transformer.ts` to use typed SDKMessage
4. Add type guards for each message type
5. **Result**: Compile-time errors instead of runtime errors

### Phase 2: Backend JSON Parsing (1 day)

1. Move tool input JSON parsing from frontend to backend
2. Move text accumulation from frontend to backend
3. Send complete/accumulated content to frontend
4. **Result**: Frontend never sees raw JSON, no parse errors

### Phase 3: Simplify Event Types (2 days)

1. Create `TreeReadyEvent` discriminated union
2. Implement `SdkNormalizer` (replaces StreamTransformer + SdkMessageTransformer)
3. Update RPC to use typed `TreeReadyEvent` payload
4. **Result**: 2 layers instead of 3 on backend

### Phase 4: TreeAccumulator (2 days)

1. Create `TreeAccumulator` service
2. Remove `StreamingHandlerService`
3. Remove `ExecutionTreeBuilderService`
4. Update `ChatStore` to use `TreeAccumulator`
5. **Result**: 1 service instead of 3 on frontend

### Phase 5: Cleanup (1 day)

1. Delete deprecated files
2. Update tests
3. Update documentation

---

## Expected Outcomes

| Metric               | Before       | After       | Improvement      |
| -------------------- | ------------ | ----------- | ---------------- |
| Pipeline Layers      | 8            | 4           | 50% reduction    |
| Type Casts           | 18           | 0           | 100% elimination |
| `any` usages         | 7            | 0           | 100% elimination |
| Services (backend)   | 3            | 1           | 67% reduction    |
| Services (frontend)  | 3            | 1           | 67% reduction    |
| JSON parse locations | 1 (frontend) | 1 (backend) | Safer location   |
| Code lines           | ~2000        | ~800        | 60% reduction    |

---

## Summary

### Answer to Question 1: Copy SDK Types?

**No need to copy!** Use `import type` directly:

```typescript
import type { SDKMessage } from './types/sdk-types/claude-sdk.types';
```

Type imports are erased at compile time - no ESM/CommonJS conflict.

### Answer to Question 2: Simplify Architecture?

**Yes, significantly!**

1. **Backend**: Single `SdkNormalizer` replaces 2 transformers
2. **Frontend**: Single `TreeAccumulator` replaces 3 services
3. **Event type**: `TreeReadyEvent` is tree-node-ready, no conversion needed
4. **JSON parsing**: Backend parses, frontend just renders
5. **Delta accumulation**: Backend accumulates, frontend just appends

The key insight: **Make events tree-node-ready on the backend** so frontend just inserts them.
