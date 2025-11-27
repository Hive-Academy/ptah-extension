# ChatStore Refactoring Plan

**Date**: 2025-11-26
**Current State**: 1,678 lines, 7+ responsibilities (God Service)
**Target State**: ~200-300 lines coordinator + 4 focused services

---

## Current Problem

The `ChatStore` violates Single Responsibility Principle with these mixed concerns:

1. **State Management** - Signals for sessions, messages, streaming state
2. **Session Operations** - Load, switch, clear sessions
3. **Conversation Actions** - Send messages, start/continue conversations
4. **JSONL Processing** - Parse and route incoming JSONL chunks
5. **Tree Building** - Construct ExecutionNode trees from chunks
6. **Session Replay** - Reconstruct history from JSONL files (300+ lines!)
7. **Service Initialization** - Dependency injection, service readiness

This makes:

- Testing difficult (too many dependencies)
- Bugs hard to trace (interleaved responsibilities)
- Features hard to add (need to understand entire file)

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ChatStore (Coordinator)                     │
│                         ~200-300 lines                           │
├─────────────────────────────────────────────────────────────────┤
│ - State signals (sessions, messages, streaming)                  │
│ - Public API (loadSessions, switchSession, sendMessage)          │
│ - Coordinates between services                                   │
│ - NO business logic - just orchestration                         │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ SessionManager  │  │ JsonlProcessor  │  │ TreeBuilder     │
│   ~150 lines    │  │   ~200 lines    │  │   ~300 lines    │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ - loadSessions  │  │ - processChunk  │  │ - buildTree     │
│ - switchSession │  │ - routeMessage  │  │ - appendNode    │
│ - rebuildMaps   │  │ - validateChunk │  │ - replaceNode   │
│ - sessionState  │  │ - context track │  │ - finalizeTree  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ SessionReplayer │
                     │   ~400 lines    │
                     ├─────────────────┤
                     │ - replaySession │
                     │ - classifyMsgs  │
                     │ - processAgents │
                     │ - extractContent│
                     └─────────────────┘
```

---

## Service Definitions

### 1. ChatStore (Coordinator) - `chat.store.ts`

**Purpose**: State management and service coordination only

**Responsibilities**:

- Hold all state signals (\_sessions, \_messages, \_isStreaming, etc.)
- Expose public readonly signals
- Expose public async actions that delegate to services
- Coordinate between services (pass data, handle results)

**Public API**:

```typescript
// State (readonly signals)
sessions: Signal<ChatSessionSummary[]>
messages: Signal<ExecutionChatMessage[]>
currentSession: Signal<ChatSessionSummary | null>
isStreaming: Signal<boolean>

// Actions
loadSessions(): Promise<void>
switchSession(sessionId: string): Promise<void>
sendMessage(content: string, files?: string[]): Promise<void>
abortCurrentMessage(): Promise<void>
clearCurrentSession(): void

// For VSCodeService message routing
processJsonlChunk(chunk: JSONLMessage): void
```

**Does NOT contain**:

- JSONL parsing logic
- Tree building logic
- Session replay logic
- Agent/tool routing logic

---

### 2. SessionManager - `session-manager.service.ts`

**Purpose**: Session lifecycle and state bridging

**Responsibilities**:

- Load session list from backend
- Switch between sessions
- Track session state (fresh, loaded, streaming, resuming)
- Rebuild node maps when loading sessions (bridge loading ↔ streaming)
- Determine if session should start new or continue

**Public API**:

```typescript
interface SessionState {
  status: 'fresh' | 'loaded' | 'streaming' | 'resuming';
  sessionId: string | null;
  isExistingSession: boolean;
}

loadSessions(workspacePath: string): Promise<ChatSessionSummary[]>
loadSession(sessionId: string, workspacePath: string): Promise<SessionLoadResult>
getSessionState(): SessionState
shouldContinueSession(): boolean

// Bridge between loading and streaming
rebuildNodeMaps(messages: ExecutionChatMessage[]): NodeMaps
registerAgent(toolCallId: string, node: ExecutionNode): void
registerTool(toolCallId: string, node: ExecutionNode): void
getAgent(toolCallId: string): ExecutionNode | undefined
getTool(toolCallId: string): ExecutionNode | undefined
```

---

### 3. JsonlMessageProcessor - `jsonl-processor.service.ts`

**Purpose**: Process incoming JSONL chunks and route to appropriate handlers

**Responsibilities**:

- Validate incoming JSONL chunks
- Route messages by type (system, assistant, tool, result)
- Route by context (main thread vs agent)
- Track message context (which agent, which tool)
- Emit processed results

**Public API**:

```typescript
interface ProcessedChunk {
  type: 'system-init' | 'text' | 'thinking' | 'tool-start' | 'tool-result' |
        'agent-spawn' | 'agent-message' | 'stream-complete';
  payload: unknown;
  context: {
    parentAgentId?: string;
    toolCallId?: string;
  };
}

processChunk(chunk: JSONLMessage, nodeMaps: NodeMaps): ProcessedChunk | null
validateChunk(chunk: JSONLMessage): boolean
```

**Does NOT contain**:

- Tree building (just routing)
- State management (stateless processor)

---

### 4. ExecutionTreeBuilder - `tree-builder.service.ts`

**Purpose**: Build and manipulate ExecutionNode trees

**Responsibilities**:

- Create new message trees
- Append nodes (text, thinking, tool, agent)
- Update nodes (text delta, tool result)
- Replace nodes in tree (immutable updates)
- Finalize trees when streaming completes

**Public API**:

```typescript
createMessageTree(messageId: string): ExecutionNode
appendText(tree: ExecutionNode, content: string): ExecutionNode
appendTextDelta(tree: ExecutionNode, delta: string): ExecutionNode
appendThinking(tree: ExecutionNode, content: string): ExecutionNode
appendToolUse(tree: ExecutionNode, block: ToolUseBlock): ExecutionNode
appendAgent(tree: ExecutionNode, agentInfo: AgentInfo): ExecutionNode
updateToolResult(tree: ExecutionNode, toolId: string, result: unknown): ExecutionNode
replaceNode(tree: ExecutionNode, nodeId: string, newNode: ExecutionNode): ExecutionNode
finalizeTree(tree: ExecutionNode): ExecutionNode
```

---

### 5. SessionReplayService - `session-replay.service.ts`

**Purpose**: Reconstruct chat history from JSONL session files

**Responsibilities**:

- Parse raw JSONL messages into ExecutionChatMessage format
- Group and classify agent sessions
- Link tool_use to tool_result
- Filter warmup/internal agents
- Build execution trees from historical data

**Public API**:

```typescript
replaySession(
  mainMessages: JSONLMessage[],
  agentSessions: AgentSession[]
): ExecutionChatMessage[]

// Internal helpers (could be private)
classifyAgentMessages(messages: JSONLMessage[]): ClassifiedMessages
processAgentExecutionMessages(messages: JSONLMessage[]): ExecutionNode[]
extractTextContent(content: unknown): string
```

---

## Shared Types - `chat.types.ts`

```typescript
// Node maps shared between services
interface NodeMaps {
  agents: Map<string, ExecutionNode>;
  tools: Map<string, ExecutionNode>;
}

// Session load result
interface SessionLoadResult {
  messages: ExecutionChatMessage[];
  nodeMaps: NodeMaps;
}

// Agent session from backend
interface AgentSession {
  agentId: string;
  messages: JSONLMessage[];
}

// Classified agent messages
interface ClassifiedMessages {
  summaryContent: string | null;
  executionMessages: JSONLMessage[];
}
```

---

## Migration Strategy

### Phase 1: Extract Types (No behavior change)

1. Create `chat.types.ts` with shared interfaces
2. Import types in ChatStore
3. **Test**: Verify build passes, no behavior change

### Phase 2: Extract TreeBuilder (Low risk)

1. Create `tree-builder.service.ts`
2. Move tree manipulation methods
3. Update ChatStore to use TreeBuilder
4. **Test**: Verify streaming still works

### Phase 3: Extract SessionReplayService (Medium risk)

1. Create `session-replay.service.ts`
2. Move replay methods (biggest chunk - 400+ lines)
3. Update ChatStore to use SessionReplayService
4. **Test**: Verify session loading still works

### Phase 4: Extract SessionManager (Medium risk)

1. Create `session-manager.service.ts`
2. Move session operations and node map management
3. Update ChatStore to use SessionManager
4. **Test**: Verify session switching and resume works

### Phase 5: Extract JsonlProcessor (Higher risk)

1. Create `jsonl-processor.service.ts`
2. Move chunk processing and routing
3. Update ChatStore to use JsonlProcessor
4. **Test**: Verify streaming routing works

### Phase 6: Cleanup ChatStore

1. Remove all extracted code
2. ChatStore becomes pure coordinator
3. **Test**: Full integration test

---

## File Structure After Refactoring

```
libs/frontend/chat/src/lib/services/
├── chat.store.ts              # Coordinator (~200-300 lines)
├── chat.types.ts              # Shared types (~100 lines)
├── session-manager.service.ts # Session lifecycle (~150 lines)
├── jsonl-processor.service.ts # Message routing (~200 lines)
├── tree-builder.service.ts    # Tree manipulation (~300 lines)
├── session-replay.service.ts  # History replay (~400 lines)
└── index.ts                   # Public exports
```

**Total**: ~1,350 lines across 6 files (vs 1,678 in one file)
**Benefit**: Each file has single responsibility, testable in isolation

---

## Testing Strategy

Each extracted service can be tested independently:

```typescript
// tree-builder.service.spec.ts
describe('ExecutionTreeBuilder', () => {
  it('should create empty message tree', () => {
    const tree = builder.createMessageTree('msg-1');
    expect(tree.id).toBe('msg-1');
    expect(tree.children).toEqual([]);
  });

  it('should append text node', () => {
    const tree = builder.createMessageTree('msg-1');
    const updated = builder.appendText(tree, 'Hello');
    expect(updated.children).toHaveLength(1);
    expect(updated.children[0].content).toBe('Hello');
  });
});
```

---

## Decision Points

Before implementing, confirm:

1. **Service injection**: Use Angular DI or simple class instantiation?
2. **State ownership**: Should SessionManager own node maps or ChatStore?
3. **Event pattern**: Should services emit events or return results?
4. **Immutability**: Keep current immutable tree pattern or use mutable with signals?

---

## Next Steps

1. Review this plan
2. Decide on approach (full refactor vs incremental)
3. Start with Phase 1 (types extraction) - lowest risk
4. Progress through phases with testing at each step

---

**Document Status**: Ready for review
