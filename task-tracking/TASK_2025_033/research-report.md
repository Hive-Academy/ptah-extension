# TASK_2025_033: Unified Agent Bubble Visual Hierarchy

## Research Report - Architecture Analysis

### Executive Summary

The goal is to make streaming agent visualization match the superior visual hierarchy of non-streaming (session replay) mode. Currently, agents appear as nested cards during streaming but as separate top-level chat bubbles when loaded from history.

---

## Current Architecture Analysis

### 1. Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW COMPARISON                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STREAMING MODE:                                                            │
│  ───────────────                                                            │
│  Claude CLI → JSONL chunks → JsonlMessageProcessor → ChatStore              │
│                                   │                       │                 │
│                                   ▼                       ▼                 │
│                           currentExecutionTree    (single streaming msg)    │
│                                   │                                         │
│                                   ▼                                         │
│                           ExecutionNodeComponent (recursive)                │
│                                   │                                         │
│                                   ├── TextNode                              │
│                                   ├── ToolNode                              │
│                                   └── AgentCard (NESTED inside parent!)     │
│                                                                             │
│  SESSION REPLAY MODE:                                                       │
│  ────────────────────                                                       │
│  JSONL Files → SessionReplayService → ChatStore._messages                   │
│                       │                     │                               │
│                       ▼                     ▼                               │
│               Multiple ExecutionChatMessage objects                         │
│                       │                                                     │
│                       ├── User message                                      │
│                       ├── Assistant message (text, tools)                   │
│                       └── Agent message (SEPARATE bubble with AgentInfo!)   │
│                                   │                                         │
│                                   ▼                                         │
│                           AgentExecutionComponent                           │
│                           ├── Summary Section                               │
│                           └── Execution Section                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. Component Hierarchy

#### Streaming Mode (Current)

```
chat-view.component.html
└── @for (message of chatStore.messages())
    └── ptah-message-bubble [message]="message"
└── @if (chatStore.isStreaming())
    └── ptah-message-bubble [message]="streamingMessage()" [isStreaming]="true"
        └── (role === 'assistant')
            └── ptah-execution-node [node]="executionTree"
                └── @switch (node.type)
                    └── @case ('agent')
                        └── ptah-agent-card [node]="node"  ← NESTED!
                            └── <ng-content /> (children via ExecutionNode)
```

#### Non-Streaming Mode (Target)

```
chat-view.component.html
└── @for (message of chatStore.messages())
    └── ptah-message-bubble [message]="message"
        └── @if (message.agentInfo)  ← SEPARATE BUBBLE!
            └── ptah-agent-execution [agentInfo]="message.agentInfo"
                └── Summary Section (collapsible)
                └── Execution Section (collapsible, with tool count)
```

### 3. Key Files and Responsibilities

| File                               | Responsibility                                   | Lines |
| ---------------------------------- | ------------------------------------------------ | ----- |
| `jsonl-processor.service.ts`       | Process JSONL chunks, build ExecutionNode tree   | 846   |
| `session-replay.service.ts`        | Replay session files, create AgentInfo bubbles   | 824   |
| `chat.store.ts`                    | State management, coordinates services           | 981   |
| `message-bubble.component.ts/html` | Render chat bubbles (3 modes)                    | 178   |
| `execution-node.component.ts`      | Recursive tree rendering                         | 127   |
| `agent-execution.component.ts`     | Dual-section agent display (Summary + Execution) | 201   |
| `agent-card.component.ts`          | Simple collapsible agent card                    | 161   |
| `tab-manager.service.ts`           | Tab state management                             | 467   |
| `execution-node.types.ts`          | ExecutionNode, AgentInfo types                   | 597   |

### 4. Key Differences Analysis

| Aspect               | Streaming                          | Session Replay                       |
| -------------------- | ---------------------------------- | ------------------------------------ |
| **Agent Position**   | Nested inside parent ExecutionNode | Separate ExecutionChatMessage        |
| **Visual Component** | `AgentCardComponent`               | `AgentExecutionComponent`            |
| **Sections**         | None (flat children)               | Summary + Execution                  |
| **Tool Count**       | Not shown                          | "(47 tools)" in header               |
| **Collapse State**   | Expand/collapse whole card         | Independent section collapse         |
| **AgentInfo**        | Not used                           | Required for rendering               |
| **Message List**     | Single streaming message           | Multiple messages (agent = separate) |

### 5. Root Cause

The fundamental difference is **when and how agent messages are created**:

**Streaming:**

- `JsonlMessageProcessor.handleAssistantMessage()` creates an agent NODE inside the current tree
- Agent is a child of the current message, not a separate message
- `ExecutionNodeComponent` renders it via recursive `@case ('agent')` → `AgentCardComponent`

**Session Replay:**

- `SessionReplayService.createAgentBubble()` creates a separate `ExecutionChatMessage`
- Agent has `agentInfo` property set
- `MessageBubbleComponent` renders it via `@if (message().agentInfo)` → `AgentExecutionComponent`

---

## Proposed Solution Architecture

### Option A: Unified Agent Messages (Recommended)

**Principle:** When an agent spawns during streaming, create a SEPARATE `ExecutionChatMessage` immediately, just like session replay does.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PROPOSED UNIFIED ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STREAMING (NEW):                                                           │
│  ────────────────                                                           │
│  JSONL chunk (Task tool_use) detected                                       │
│       │                                                                     │
│       ▼                                                                     │
│  JsonlMessageProcessor returns:                                             │
│       {                                                                     │
│         tree: parentTree (without agent nested),                            │
│         agentBubble: { id, agentType, agentDescription, tree }              │
│       }                                                                     │
│       │                                                                     │
│       ▼                                                                     │
│  ChatStore creates NEW ExecutionChatMessage with agentInfo                  │
│       │                                                                     │
│       ▼                                                                     │
│  TabManager.updateTab({ messages: [...msgs, agentMessage] })                │
│       │                                                                     │
│       ▼                                                                     │
│  MessageBubbleComponent renders via agentInfo path                          │
│       │                                                                     │
│       ▼                                                                     │
│  AgentExecutionComponent (same as replay!)                                  │
│       ├── Summary Section (streaming text)                                  │
│       └── Execution Section (streaming tool count)                          │
│                                                                             │
│  RESULT: Identical visual hierarchy in both modes!                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPONENT RENDERING FLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  chat-view.component.html:                                                  │
│  ─────────────────────────                                                  │
│                                                                             │
│  @for (message of chatStore.messages(); track message.id)                   │
│      │                                                                      │
│      └── ptah-message-bubble [message]="message"                            │
│                │                                                            │
│                ├── @if (message.agentInfo)  ← AGENT BUBBLE (streaming OR loaded)
│                │       └── ptah-agent-execution                             │
│                │               ├── Summary Section                          │
│                │               └── Execution Section                        │
│                │                                                            │
│                ├── @else if (message.role === 'assistant')  ← REGULAR ASSISTANT
│                │       └── ptah-execution-node                              │
│                │                                                            │
│                └── @else  ← USER MESSAGE                                    │
│                        └── markdown content                                 │
│                                                                             │
│  @if (chatStore.streamingAgentTree(); as agentTree)  ← STREAMING AGENT      │
│      └── ptah-agent-execution-streaming                                     │
│              ├── Summary Section (live text)                                │
│              └── Execution Section (live tools)                             │
│                                                                             │
│  @if (chatStore.isStreaming() && chatStore.currentExecutionTree())          │
│      └── ptah-message-bubble [isStreaming]="true"  ← MAIN THREAD STREAMING  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Changes Required

### 1. Types Changes (`execution-node.types.ts`)

```typescript
// Add streaming-specific fields to AgentInfo
export interface AgentInfo {
  // Existing fields...
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly agentModel?: string;
  readonly summaryContent?: string;
  readonly hasSummary?: boolean;
  readonly hasExecution?: boolean;
  readonly isInterrupted?: boolean;

  // NEW: Streaming state fields
  readonly isStreaming?: boolean; // True while agent is actively streaming
  readonly toolUseId?: string; // Links to parent Task tool_use for updates
}
```

### 2. ProcessingResult Changes (`jsonl-processor.service.ts`)

```typescript
export interface ProcessingResult {
  tree: ExecutionNode | null;
  streamComplete: boolean;
  newMessageStarted: boolean;
  messageId?: string;

  // NEW: Agent bubble management
  /** Signal to create a new agent bubble in message list */
  agentBubbleStarted?: {
    id: string;
    toolUseId: string; // Task tool_use ID for updates
    agentType: string;
    agentDescription?: string;
    agentModel?: string;
  };

  /** Signal to update an existing agent bubble */
  agentBubbleUpdate?: {
    toolUseId: string; // Which agent to update
    tree: ExecutionNode; // Updated execution tree
    summaryDelta?: string; // Text delta for summary
  };

  /** Signal that agent has completed */
  agentBubbleCompleted?: {
    toolUseId: string;
  };
}
```

### 3. JsonlMessageProcessor Changes

**Current behavior:**

- `handleAssistantMessage()` with Task tool_use → Appends agent node to tree
- `handleNestedAssistantMessage()` → Updates agent node children

**New behavior:**

- `handleAssistantMessage()` with Task tool_use → Returns `agentBubbleStarted`
- `handleNestedAssistantMessage()` → Returns `agentBubbleUpdate`
- Agent tool_result → Returns `agentBubbleCompleted`

### 4. ChatStore Changes

**New signals:**

```typescript
// Map of toolUseId → streaming agent tree
private readonly _streamingAgents = signal<Map<string, ExecutionNode>>(new Map());

// Currently active streaming agent (for display)
readonly streamingAgentTree = computed(() => {
  const agents = this._streamingAgents();
  // Return the most recent active agent
  // ...
});
```

**Modified `processJsonlChunk()`:**

```typescript
processJsonlChunk(chunk: JSONLMessage): void {
  const result = this.jsonlProcessor.processChunk(chunk, currentTree);

  // Handle agent bubble creation
  if (result.agentBubbleStarted) {
    const { id, toolUseId, agentType, agentDescription, agentModel } = result.agentBubbleStarted;

    // Create agent message with AgentInfo
    const agentMessage = createExecutionChatMessage({
      id,
      role: 'assistant',
      agentInfo: {
        agentType,
        agentDescription,
        agentModel,
        isStreaming: true,
        toolUseId,
        hasSummary: true,
        hasExecution: true,
      },
      executionTree: createExecutionNode({ id, type: 'message', status: 'streaming' }),
    });

    // Add to messages
    this.tabManager.updateTab(activeTabId, {
      messages: [...activeTab.messages, agentMessage],
    });

    // Track in streaming agents map
    this._streamingAgents.update(map => {
      const newMap = new Map(map);
      newMap.set(toolUseId, agentMessage.executionTree!);
      return newMap;
    });
  }

  // Handle agent bubble updates
  if (result.agentBubbleUpdate) {
    const { toolUseId, tree, summaryDelta } = result.agentBubbleUpdate;

    // Update the agent message in the list
    this.tabManager.updateTab(activeTabId, {
      messages: activeTab.messages.map(msg => {
        if (msg.agentInfo?.toolUseId === toolUseId) {
          return {
            ...msg,
            executionTree: tree,
            agentInfo: summaryDelta ? {
              ...msg.agentInfo,
              summaryContent: (msg.agentInfo.summaryContent || '') + summaryDelta,
            } : msg.agentInfo,
          };
        }
        return msg;
      }),
    });
  }

  // Handle agent completion
  if (result.agentBubbleCompleted) {
    const { toolUseId } = result.agentBubbleCompleted;

    // Mark agent as complete
    this.tabManager.updateTab(activeTabId, {
      messages: activeTab.messages.map(msg => {
        if (msg.agentInfo?.toolUseId === toolUseId) {
          return {
            ...msg,
            agentInfo: {
              ...msg.agentInfo,
              isStreaming: false,
            },
          };
        }
        return msg;
      }),
    });

    // Remove from streaming map
    this._streamingAgents.update(map => {
      const newMap = new Map(map);
      newMap.delete(toolUseId);
      return newMap;
    });
  }

  // ... existing tree update logic
}
```

### 5. AgentExecutionComponent Changes

Enhance to support streaming state:

```typescript
@Component({
  selector: 'ptah-agent-execution',
  template: `
    <div class="flex flex-col gap-2">
      <!-- Summary Section -->
      @if (agentInfo().hasSummary || agentInfo().summaryContent) {
        <div class="border border-base-300/50 rounded-lg overflow-hidden">
          <button ...>
            <span>Summary</span>
            @if (agentInfo().isStreaming && !agentInfo().summaryContent) {
              <lucide-angular [img]="LoaderIcon" class="animate-spin" />
            }
          </button>
          @if (!summaryCollapsed()) {
            <div class="px-2.5 py-2">
              @if (agentInfo().summaryContent) {
                <ptah-agent-summary [content]="agentInfo().summaryContent!" />
                @if (agentInfo().isStreaming) {
                  <ptah-typing-cursor />
                }
              } @else {
                <span>Loading summary...</span>
              }
            </div>
          }
        </div>
      }

      <!-- Execution Section -->
      @if (agentInfo().hasExecution || hasExecutionNodes()) {
        <div class="border border-base-300/50 rounded-lg overflow-hidden">
          <button ...>
            <span>
              Execution
              @if (agentInfo().isStreaming) {
                ({{ executionTree()?.children?.length || 0 }} tools running...)
              } @else {
                ({{ executionTree()?.children?.length || 0 }} tools)
              }
            </span>
          </button>
          <!-- ... execution content -->
        </div>
      }

      <!-- Streaming indicator when no content yet -->
      @if (agentInfo().isStreaming && !hasContent()) {
        <div class="flex items-center gap-2 text-xs">
          <lucide-angular [img]="LoaderIcon" class="animate-spin" />
          <span>Agent execution in progress...</span>
        </div>
      }
    </div>
  `
})
```

### 6. MessageBubbleComponent Changes

Already supports `agentInfo` path - no changes needed! The template already has:

```html
@if (message().agentInfo) {
<!-- Agent message rendering with AgentExecutionComponent -->
}
```

### 7. SessionReplayService Changes

Minor alignment to ensure consistency:

- Add `toolUseId` to AgentInfo when creating agent bubbles
- Ensure same structure as streaming creates

---

## Migration Strategy

### Phase 1: Type & Interface Updates

1. Add `isStreaming` and `toolUseId` to `AgentInfo`
2. Add agent bubble signals to `ProcessingResult`
3. No behavioral changes yet

### Phase 2: JsonlMessageProcessor Refactor

1. Modify `handleAssistantMessage()` to detect Task tool_use and return `agentBubbleStarted`
2. Modify `handleNestedAssistantMessage()` to return `agentBubbleUpdate`
3. Add handler for agent completion (tool_result for Task)
4. Keep backward compatibility with feature flag

### Phase 3: ChatStore Integration

1. Add `_streamingAgents` signal
2. Modify `processJsonlChunk()` to handle new result types
3. Create/update agent messages in tab's message list

### Phase 4: Component Updates

1. Enhance `AgentExecutionComponent` for streaming state
2. Ensure `MessageBubbleComponent` passes streaming state
3. Add streaming indicators (spinners, "running..." text)

### Phase 5: Testing & Cleanup

1. Test streaming agents appear as separate bubbles
2. Test visual parity with session replay
3. Remove feature flag, clean up old code paths

---

## Risk Assessment

| Risk                              | Likelihood | Impact | Mitigation                          |
| --------------------------------- | ---------- | ------ | ----------------------------------- |
| Breaking existing streaming       | Medium     | High   | Feature flag, gradual rollout       |
| Message ordering issues           | Low        | Medium | Use timestamps, maintain order      |
| Performance (many agent messages) | Low        | Low    | Virtual scrolling already in place  |
| Agent ID linking breaks           | Medium     | High   | Thorough testing with nested agents |
| Session replay regression         | Low        | Medium | Keep SessionReplayService unchanged |

---

## Success Criteria

1. ✅ Streaming agents appear as separate chat bubbles (not nested)
2. ✅ Agent bubbles have Summary + Execution sections during streaming
3. ✅ Tool count updates live ("3 tools running...")
4. ✅ Visual parity with session replay mode
5. ✅ No regression in session loading
6. ✅ Permissions still work correctly
7. ✅ Nested agents (agents inside agents) work correctly

---

## Appendix: Current Code References

### JsonlMessageProcessor - Agent Handling (lines 225-265)

```typescript
// Check if this is a Task tool (agent spawn)
if (block.name === 'Task' && inputObj?.['subagent_type'] && block.id) {
  const agentInfo: AgentSpawnInfo = {
    toolUseId: block.id,
    subagentType: inputObj['subagent_type'] as string,
    // ...
  };
  tree = this.treeBuilder.appendAgent(tree, agentInfo);
  // Registers agent in SessionManager
}
```

### SessionReplayService - Agent Bubble Creation (lines 507-582)

```typescript
private createAgentBubble(...): ExecutionChatMessage {
  const agentInfo: AgentInfo = {
    agentType,
    agentDescription,
    agentModel,
    summaryContent: summaryContent || undefined,
    hasSummary: !!summaryContent,
    hasExecution: executionNodes.length > 0,
    isInterrupted,
  };

  return createExecutionChatMessage({
    id: block.id || this.generateId(),
    role: 'assistant',
    executionTree: agentExecutionTree,
    agentInfo,
  });
}
```

### MessageBubbleComponent - AgentInfo Path (lines 1-66)

```html
@if (message().agentInfo) {
<!-- Agent message (compact VS Code-like layout with dual sections) -->
<div class="chat chat-start gap-0.5">
  <!-- Colored avatar, header, AgentExecutionComponent -->
</div>
}
```
