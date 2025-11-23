# Streaming Architecture Philosophy

**Last Updated**: 2025-11-23
**Context**: Post-RPC Migration, EventBus Deletion (TASK_2025_021 Phase 0)

---

## Core Principle: The Extension's Purpose

> **"The whole purpose of this extension is to make a beautiful GUI for Claude's message stream."**

Every architectural decision in Ptah must serve this singular mission: **render Claude CLI's message stream as a cohesive, real-time, unified experience**. Tools, thinking, agents, text — all are **content blocks within messages**, not separate event types.

---

## Message-Centric vs Event-Centric Architecture

### ✅ CORRECT: Message-Centric (Current Implementation)

**Philosophy**: Messages are sacred, immutable containers of content blocks.

```
Claude CLI stdout (JSONL stream)
  ↓
JSONLStreamParser (lines 355-363: preserves tool_use in content array)
  ↓
ClaudeContentChunk { blocks: ContentBlock[] }
  ↓ Simple postMessage forwarding
Frontend receives unified chunks
  ↓
ChatMessageContentComponent renders all blocks together
  ↓
User sees: Text + Thinking + Tools in natural order
```

**Key Insight**: `message.content` is an **array of ContentBlock objects**, where each block has a discriminated union type:

```typescript
// From libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (lines 345-366)
if (msg.message?.content) {
  for (const block of msg.message.content) {
    if (block.type === 'text' && block.text) {
      blocks.push({
        type: 'text',
        text: block.text,
        index: msg.index,
      });
    } else if (block.type === 'tool_use' && block.id && block.name) {
      // Include tool_use blocks in contentBlocks (NOT separate TOOL_START events)
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) || {},
        index: msg.index,
      });
    }
  }
}
```

**Benefits**:

- **3 hops**: CLI → Parser → RPC → Frontend (direct path)
- **Zero caching**: No intermediate state stores
- **Real-time streaming**: Chunks arrive immediately
- **Unified rendering**: All blocks rendered in single component
- **No duplication**: Each block appears exactly once
- **Natural ordering**: Blocks render in Claude's intended sequence

---

### ❌ WRONG: Event-Centric (EventBus - DELETED)

**Philosophy**: Split unified messages into 94 separate event types.

```
Claude CLI stdout (JSONL stream)
  ↓
JSONLStreamParser
  ↓ (MISTAKE: Split here)
EventBus publishes separate events:
  - MESSAGE_RECEIVED (text only)
  - THINKING_STARTED (thinking only)
  - TOOL_EXECUTION_STARTED (tools only)
  - AGENT_ACTIVITY (agent tools only)
  ↓ 15+ message hops through orchestration layers
SessionManager caches messages (cache layer 1)
SessionProxy caches again (cache layer 2)
Frontend ChatService caches third time (cache layer 3)
  ↓ Event subscribers reconstruct messages from fragments
ChatMessageContentComponent tries to render
  ↓ PROBLEMS:
User sees: Duplicated text, missing tools, out-of-order blocks
```

**Why It Failed**:

1. **Message Duplication**: Same content stored 3x in different caches
2. **Event Ordering Issues**: Separate subscriptions race, blocks arrive out-of-order
3. **UI Hallucination**: Events lost or duplicated, UI shows incorrect state
4. **No Streaming**: Buffering at each hop destroys real-time feel
5. **Complexity Explosion**: 14,000 lines of code to manage event taxonomy
6. **Lost Context**: Content blocks separated from their parent message

**Real Example** (from deleted code):

```typescript
// EventBus split a single message into 4+ separate events:
eventBus.publish('MESSAGE_RECEIVED', { text: 'Hello' }); // Text separated
eventBus.publish('THINKING_STARTED', { content: '...' }); // Thinking separated
eventBus.publish('TOOL_START', { name: 'Read', args: {...} }); // Tool separated
eventBus.publish('AGENT_ACTIVITY', { toolName: 'Task' }); // Agent separated
// Frontend must subscribe to 4 events and reconstruct the unified message!
```

---

## The ContentBlocks Type System (TASK_2025_009)

**Foundation**: Discriminated union preserves message structure.

```typescript
// From libs/shared/src/lib/types/content-block.types.ts
export type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock | ToolResultContentBlock;

export interface TextContentBlock {
  type: 'text';
  text: string;
  index?: number;
}

export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
  index?: number;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  index?: number;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
  index?: number;
}
```

**Why This Works**:

- **Type Safety**: TypeScript discriminates on `type` field
- **Natural Ordering**: Array preserves Claude's intended block sequence
- **Extensibility**: New block types added without breaking existing code
- **No Splitting**: All block types coexist in single array

---

## Architecture Comparison: Flow Diagrams

### EventBus Architecture (WRONG) ❌

```
┌─────────────────────────────────────────────────────────────────┐
│ Claude CLI Process                                               │
│ └─> stdout: {"type":"assistant","message":{"content":[          │
│       {"type":"text","text":"Hello"},                            │
│       {"type":"tool_use","name":"Read","input":{...}}            │
│     ]}}                                                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ JSONL Line
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ JSONLStreamParser                                                │
│ └─> MISTAKE: Splits unified message into separate events        │
└──┬──────────┬──────────┬──────────┬────────────┬────────────┬──┘
   │          │          │          │            │            │
   ↓          ↓          ↓          ↓            ↓            ↓
 TEXT    THINKING    TOOL_START  TOOL_RESULT  AGENT    PERMISSION
 event     event       event       event      event      event
   │          │          │          │            │            │
   └──────────┴──────────┴──────────┴────────────┴────────────┘
                            │ EventBus publishes 94 message types
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ MessageHandlerService (800 lines)                               │
│ └─> Subscribes to 94 event types                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Routes to orchestration services
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ChatOrchestrationService (1,620 lines)                          │
│ └─> Business logic + event transformation                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Stores in session manager
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ SessionManager (896 lines) + SessionProxy (359 lines)           │
│ └─> Cache layer 1 + Cache layer 2                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Publishes more events for frontend
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Frontend ChatService (500 lines)                                │
│ └─> Cache layer 3, reconstructs messages from event fragments   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Updates component state
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ChatMessageContentComponent                                     │
│ └─> Tries to render fragmented, duplicated, out-of-order blocks │
└─────────────────────────────────────────────────────────────────┘

Total: 15+ message hops, 14,000 lines, 3 caching layers
Result: Duplicated messages, UI hallucination, lost real-time streaming
```

### Message-Centric Architecture (CORRECT) ✅

```
┌─────────────────────────────────────────────────────────────────┐
│ Claude CLI Process                                               │
│ └─> stdout: {"type":"assistant","message":{"content":[          │
│       {"type":"text","text":"Hello"},                            │
│       {"type":"tool_use","name":"Read","input":{...}}            │
│     ]}}                                                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ JSONL Line
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ JSONLStreamParser (lines 355-363)                               │
│ └─> PRESERVES unified message structure:                        │
│     ClaudeContentChunk {                                         │
│       type: 'content',                                           │
│       blocks: [                                                  │
│         { type: 'text', text: 'Hello' },                         │
│         { type: 'tool_use', name: 'Read', input: {...} }        │
│       ]                                                          │
│     }                                                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Single ClaudeContentChunk event
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Backend RpcHandler (~200 lines)                                 │
│ └─> Simple postMessage forwarding:                              │
│     onContent: (chunk) => postMessage('content-chunk', chunk)    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ postMessage to webview
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Frontend VSCodeService                                          │
│ └─> Listens for 'content-chunk', updates ChatStoreService       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Signal update
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ ChatMessageContentComponent                                     │
│ └─> Iterates contentBlocks array, renders all types together:   │
│     @for (block of message().contentBlocks; track block.type) { │
│       @switch (block.type) {                                     │
│         @case ('text') { <div>{{ block.text }}</div> }          │
│         @case ('tool_use') { <ptah-tool-use-block /> }          │
│       }                                                          │
│     }                                                             │
└─────────────────────────────────────────────────────────────────┘

Total: 3 message hops, ~650 lines, 0 caching layers
Result: Unified messages, real-time streaming, correct ordering
```

---

## Real-Time Streaming Requirements

**Streaming UX** = word-by-word typing effect, tool usage appearing live, thinking blocks updating in real-time.

### What Streaming Requires

1. **No Buffering**: Chunks must flow through pipeline without delays
2. **Preserved Ordering**: Blocks must arrive in Claude's intended sequence
3. **Incremental Rendering**: UI updates as each chunk arrives
4. **No Transformation**: Don't parse/reconstruct chunks, forward as-is

### How EventBus Broke Streaming

```typescript
// EventBus pattern (WRONG):
eventBus.publish('MESSAGE_CHUNK', chunk); // Event goes into queue
await orchestrationService.process(chunk); // Processing delay
await sessionManager.cache(chunk); // Caching delay
await sessionProxy.transform(chunk); // Transformation delay
eventBus.publish('FRONTEND_UPDATE', data); // Another event delay

// Total delay: 50-200ms per chunk = visible lag, no real-time feel
```

### How Message-Centric Enables Streaming

```typescript
// Direct forwarding (CORRECT):
onContent: (chunk) => postMessage('content-chunk', chunk); // < 5ms

// Total delay: < 5ms per chunk = instant, real-time streaming
```

---

## Agent Detection Special Case

**Critical Distinction**: Not all tools with `parent_tool_use_id` are agents!

```typescript
// From jsonl-stream-parser.ts (lines 384-395)
private correlateAgentActivity(parentToolUseId: string, msg: JSONLAssistantMessage): void {
  const agent = this.activeAgents.get(parentToolUseId);
  if (!agent) {
    // NOT an error - regular tools can have parent_tool_use_id without being agents
    // Only Task tools create agents tracked in activeAgents map
    // Silently skip correlation if parent is not an active agent
    return;
  }
  // ... emit agent activity event
}
```

**Agent Rules**:

1. **Task tool creates agent**: `onToolMessage()` detects `toolName === 'Task'`, adds to `activeAgents` Map
2. **Regular tools with parent**: Just nested tool calls, NOT agents
3. **Agent activity**: Only emitted if `parent_tool_use_id` exists in `activeAgents` Map

**Why This Matters**: EventBus treated ALL tools with `parent_tool_use_id` as agents, causing false agent activity events.

---

## Decision Checklist

Before implementing ANY streaming feature, ask yourself:

### ✅ Message-Centric Signals (CORRECT)

- [ ] Does this preserve the unified `contentBlocks` array?
- [ ] Does this forward chunks without transforming them?
- [ ] Does this maintain block ordering from Claude CLI?
- [ ] Does this avoid splitting blocks into separate streams/events?
- [ ] Does this render all block types in a single component?

### ❌ Event-Centric Red Flags (WRONG)

- [ ] Am I creating separate handlers for text vs thinking vs tools?
- [ ] Am I splitting `ClaudeContentChunk` into multiple events?
- [ ] Am I adding a caching layer between parser and frontend?
- [ ] Am I buffering chunks before forwarding?
- [ ] Am I creating "message lifecycle" events (start, progress, end)?

**If you answered YES to ANY red flag question, STOP. You're recreating EventBus.**

---

## Summary

**The Right Way**:

- Messages are sacred containers of content blocks
- Parser preserves structure, frontend renders structure
- Direct forwarding, no transformation
- Real-time streaming via simple postMessage
- ~650 lines of code, 3 hops, 0 caches

**The Wrong Way** (EventBus):

- Messages split into 94 event types
- Parser destroys structure, frontend reconstructs
- Complex orchestration, multiple transformations
- Broken streaming via buffered event queues
- 14,000 lines of code, 15+ hops, 3 caches

**Remember**: "The whole purpose of this extension is to make a beautiful GUI for Claude's message stream." Keep messages unified, streaming direct, and UI real-time.
