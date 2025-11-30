# TASK_2025_033: Unified Agent Bubble Visual Hierarchy

## Implementation Plan

### Overview

**Goal:** Make streaming agent visualization match the superior visual hierarchy of non-streaming (session replay) mode by creating separate chat bubbles for agents during streaming.

**Key Insight:** Session replay creates separate `ExecutionChatMessage` objects with `agentInfo` for each agent, rendered via `AgentExecutionComponent`. Streaming currently nests agents inside the parent tree, rendered via `AgentCardComponent`. We need streaming to follow the same pattern as replay.

---

## Phase 1: Type & Interface Updates

### Task 1.1: Extend AgentInfo Interface

**File:** `libs/shared/src/lib/types/execution-node.types.ts`

**Changes:**

```typescript
export interface AgentInfo {
  // Existing fields (keep all)
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly agentModel?: string;
  readonly summaryContent?: string;
  readonly hasSummary?: boolean;
  readonly hasExecution?: boolean;
  readonly isInterrupted?: boolean;

  // NEW: Streaming state
  /** True while agent is actively streaming */
  readonly isStreaming?: boolean;

  /** Links to parent Task tool_use ID for message updates */
  readonly toolUseId?: string;
}
```

**Update Zod schema:**

```typescript
export const AgentInfoSchema = z.object({
  agentType: z.string(),
  agentDescription: z.string().optional(),
  agentModel: z.string().optional(),
  summaryContent: z.string().optional(),
  hasSummary: z.boolean().optional(),
  hasExecution: z.boolean().optional(),
  isInterrupted: z.boolean().optional(),
  // NEW
  isStreaming: z.boolean().optional(),
  toolUseId: z.string().optional(),
});
```

### Task 1.2: Extend ProcessingResult Interface

**File:** `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts`

**Add new types:**

```typescript
/**
 * Signal to create a new agent bubble in the message list
 */
export interface AgentBubbleStarted {
  /** Message ID for the agent bubble */
  id: string;
  /** Task tool_use ID (for linking nested content) */
  toolUseId: string;
  /** Agent type (e.g., 'Explore', 'Plan') */
  agentType: string;
  /** Agent description from Task input */
  agentDescription?: string;
  /** Model used by agent */
  agentModel?: string;
}

/**
 * Signal to update an existing agent bubble
 */
export interface AgentBubbleUpdate {
  /** Task tool_use ID identifying which agent to update */
  toolUseId: string;
  /** Updated execution tree for the agent */
  tree: ExecutionNode;
  /** Text delta to append to summary (if any) */
  summaryDelta?: string;
}

/**
 * Signal that an agent has completed execution
 */
export interface AgentBubbleCompleted {
  /** Task tool_use ID identifying which agent completed */
  toolUseId: string;
  /** Final summary content (if available) */
  finalSummary?: string;
}

/**
 * Result from processing a JSONL chunk
 */
export interface ProcessingResult {
  /** Updated execution tree (if changed) */
  tree: ExecutionNode | null;
  /** Whether streaming should be marked as complete */
  streamComplete: boolean;
  /** Whether a new message tree was started */
  newMessageStarted: boolean;
  /** ID of the new message (if newMessageStarted is true) */
  messageId?: string;

  // NEW: Agent bubble lifecycle signals
  /** Create a new agent bubble in message list */
  agentBubbleStarted?: AgentBubbleStarted;
  /** Update an existing agent bubble */
  agentBubbleUpdate?: AgentBubbleUpdate;
  /** Mark an agent bubble as complete */
  agentBubbleCompleted?: AgentBubbleCompleted;
}
```

### Task 1.3: Add Streaming Agents Map Type

**File:** `libs/frontend/chat/src/lib/services/chat.types.ts`

**Add:**

```typescript
/**
 * Map of active streaming agents by their toolUseId
 * Used to track and update agent bubbles during streaming
 */
export type StreamingAgentsMap = Map<
  string,
  {
    messageId: string;
    tree: ExecutionNode;
  }
>;
```

---

## Phase 2: JsonlMessageProcessor Refactor

### Task 2.1: Refactor handleAssistantMessage for Agent Detection

**File:** `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts`

**Current behavior (lines 217-267):**

- Detects Task tool_use in message content
- Creates agent node and appends to current tree
- Registers agent in SessionManager

**New behavior:**

- Detect Task tool_use
- Return `agentBubbleStarted` signal instead of appending to tree
- Do NOT add agent to current tree (agent is separate message)

**Changes:**

```typescript
private handleAssistantMessage(
  chunk: JSONLMessage,
  currentTree: ExecutionNode | null
): ProcessingResult {
  // ... existing nested check ...

  let tree = currentTree;
  let newMessageStarted = false;
  let messageId: string | undefined;
  let agentBubbleStarted: AgentBubbleStarted | undefined;

  // ... ensure tree exists ...

  // Handle content blocks
  if (chunk.message?.content) {
    for (const block of chunk.message.content) {
      if (block.type === 'text' && block.text) {
        tree = this.treeBuilder.appendText(tree, block.text);
      } else if (block.type === 'tool_use' && block.name) {
        const inputObj = block.input as Record<string, unknown> | undefined;

        // Check if this is a Task tool (agent spawn)
        if (block.name === 'Task' && inputObj?.['subagent_type'] && block.id) {
          // NEW: Signal to create separate agent bubble
          agentBubbleStarted = {
            id: block.id,
            toolUseId: block.id,
            agentType: inputObj['subagent_type'] as string,
            agentDescription: inputObj['description'] as string,
            agentModel: inputObj['model'] as string,
          };

          // Register agent placeholder in SessionManager
          const placeholderNode = createExecutionNode({
            id: block.id,
            type: 'agent',
            status: 'streaming',
            agentType: inputObj['subagent_type'] as string,
          });
          this.sessionManager.registerAgent(block.id, placeholderNode);

          // DO NOT append agent to tree - it's a separate message now
          console.log(
            '[JsonlMessageProcessor] Agent spawn detected, signaling bubble creation:',
            block.id,
            inputObj['subagent_type']
          );
        } else {
          // Regular tool use - append to tree
          tree = this.treeBuilder.appendToolUse(tree, block);
          if (block.id) {
            const toolNode = this.findToolNodeInTree(tree, block.id);
            if (toolNode) {
              this.sessionManager.registerTool(block.id, toolNode);
            }
          }
        }
      }
    }
  }

  return {
    tree,
    streamComplete: false,
    newMessageStarted,
    messageId,
    agentBubbleStarted, // NEW
  };
}
```

### Task 2.2: Refactor handleNestedAssistantMessage to Signal Updates

**File:** `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts`

**Current behavior (lines 281-446):**

- Gets parent agent from SessionManager
- Updates agent's children array
- Replaces agent in tree

**New behavior:**

- Build the agent's tree independently
- Return `agentBubbleUpdate` signal
- Do NOT modify the main tree (agent has its own message)

**Changes:**

```typescript
private handleNestedAssistantMessage(
  chunk: JSONLMessage,
  currentTree: ExecutionNode | null,
  parentToolUseId: string
): ProcessingResult {
  let parentAgent = this.sessionManager.getAgent(parentToolUseId);

  if (!parentAgent) {
    console.warn('[JsonlMessageProcessor] Parent agent not found:', parentToolUseId);
    return { tree: currentTree, streamComplete: false, newMessageStarted: false };
  }

  let updatedAgent = parentAgent;
  let summaryDelta: string | undefined;

  // Handle text content - this becomes summary
  if (chunk.message?.content) {
    for (const block of chunk.message.content) {
      if (block.type === 'text' && block.text) {
        summaryDelta = block.text;

        const textNode = createExecutionNode({
          id: this.treeBuilder.generateId(),
          type: 'text',
          status: 'complete',
          content: block.text,
        });

        updatedAgent = {
          ...updatedAgent,
          children: [...updatedAgent.children, textNode],
        };
      } else if (block.type === 'tool_use' && block.name) {
        const toolNode = createExecutionNode({
          id: block.id || this.treeBuilder.generateId(),
          type: 'tool',
          status: 'pending',
          toolName: block.name,
          toolInput: block.input,
          toolCallId: block.id,
          isCollapsed: true,
        });

        if (block.id) {
          this.sessionManager.registerTool(block.id, toolNode);
        }

        updatedAgent = {
          ...updatedAgent,
          children: [...updatedAgent.children, toolNode],
        };
      }
    }
  }

  // Handle text delta (streaming)
  if (chunk.delta) {
    summaryDelta = chunk.delta;
    // ... handle streaming text node (existing logic) ...
  }

  // Update SessionManager
  this.sessionManager.registerAgent(parentToolUseId, updatedAgent);

  // Build agent execution tree for the bubble
  const agentTree = createExecutionNode({
    id: parentToolUseId,
    type: 'message',
    status: 'streaming',
    children: updatedAgent.children,
  });

  // Return update signal instead of modifying main tree
  return {
    tree: currentTree, // Main tree unchanged
    streamComplete: false,
    newMessageStarted: false,
    agentBubbleUpdate: {
      toolUseId: parentToolUseId,
      tree: agentTree,
      summaryDelta,
    },
  };
}
```

### Task 2.3: Handle Agent Completion

**File:** `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts`

**Add to handleUserMessage (tool_result handling):**

```typescript
// When processing tool_result for a Task tool, signal agent completion
if (block.tool_use_id) {
  const parentAgent = this.sessionManager.getAgent(block.tool_use_id);
  if (parentAgent) {
    // This is the result for a Task (agent) tool
    agentBubbleCompleted = {
      toolUseId: block.tool_use_id,
      finalSummary: typeof toolOutput === 'string' ? toolOutput : undefined,
    };
  }
}
```

---

## Phase 3: ChatStore Integration

### Task 3.1: Add Streaming Agents Signal

**File:** `libs/frontend/chat/src/lib/services/chat.store.ts`

**Add new private signal:**

```typescript
// Track streaming agent bubbles by toolUseId
private readonly _streamingAgents = signal<Map<string, string>>(new Map());
// Map: toolUseId → messageId
```

### Task 3.2: Modify processJsonlChunk for Agent Bubbles

**File:** `libs/frontend/chat/src/lib/services/chat.store.ts`

**Enhance processJsonlChunk:**

```typescript
processJsonlChunk(chunk: JSONLMessage, fromSessionId?: string): void {
  try {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;

    const activeTab = this.tabManager.activeTab();

    // ... existing session validation ...

    const result = this.jsonlProcessor.processChunk(
      chunk,
      activeTab?.executionTree ?? null
    );

    // === NEW: Handle agent bubble creation ===
    if (result.agentBubbleStarted) {
      this.handleAgentBubbleStarted(activeTabId, activeTab!, result.agentBubbleStarted);
    }

    // === NEW: Handle agent bubble updates ===
    if (result.agentBubbleUpdate) {
      this.handleAgentBubbleUpdate(activeTabId, activeTab!, result.agentBubbleUpdate);
    }

    // === NEW: Handle agent bubble completion ===
    if (result.agentBubbleCompleted) {
      this.handleAgentBubbleCompleted(activeTabId, activeTab!, result.agentBubbleCompleted);
    }

    // Handle main tree updates (existing logic)
    if (result.newMessageStarted) {
      this.currentMessageId = result.messageId ?? null;
    }

    if (result.tree !== activeTab?.executionTree) {
      this.tabManager.updateTab(activeTabId, {
        executionTree: result.tree,
      });
    }

    if (result.streamComplete) {
      this.finalizeCurrentMessage();
    }
  } catch (error) {
    console.error('[ChatStore] Error processing JSONL chunk:', error, chunk);
  }
}
```

### Task 3.3: Implement Agent Bubble Handlers

**File:** `libs/frontend/chat/src/lib/services/chat.store.ts`

**Add new methods:**

```typescript
/**
 * Handle creation of a new agent bubble
 */
private handleAgentBubbleStarted(
  tabId: string,
  tab: TabState,
  agentStart: AgentBubbleStarted
): void {
  const { id, toolUseId, agentType, agentDescription, agentModel } = agentStart;

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
    executionTree: createExecutionNode({
      id,
      type: 'message',
      status: 'streaming',
    }),
    sessionId: tab.claudeSessionId ?? undefined,
  });

  // Add to messages
  this.tabManager.updateTab(tabId, {
    messages: [...tab.messages, agentMessage],
  });

  // Track in streaming agents map
  this._streamingAgents.update(map => {
    const newMap = new Map(map);
    newMap.set(toolUseId, id);
    return newMap;
  });

  console.log('[ChatStore] Agent bubble created:', toolUseId, agentType);
}

/**
 * Handle update to an existing agent bubble
 */
private handleAgentBubbleUpdate(
  tabId: string,
  tab: TabState,
  update: AgentBubbleUpdate
): void {
  const { toolUseId, tree, summaryDelta } = update;

  // Find and update the agent message
  const updatedMessages = tab.messages.map(msg => {
    if (msg.agentInfo?.toolUseId === toolUseId) {
      return {
        ...msg,
        executionTree: tree,
        agentInfo: {
          ...msg.agentInfo!,
          summaryContent: summaryDelta
            ? (msg.agentInfo!.summaryContent || '') + summaryDelta
            : msg.agentInfo!.summaryContent,
        },
      };
    }
    return msg;
  });

  this.tabManager.updateTab(tabId, { messages: updatedMessages });
}

/**
 * Handle completion of an agent bubble
 */
private handleAgentBubbleCompleted(
  tabId: string,
  tab: TabState,
  completion: AgentBubbleCompleted
): void {
  const { toolUseId, finalSummary } = completion;

  // Mark agent as complete
  const updatedMessages = tab.messages.map(msg => {
    if (msg.agentInfo?.toolUseId === toolUseId) {
      return {
        ...msg,
        agentInfo: {
          ...msg.agentInfo!,
          isStreaming: false,
          summaryContent: finalSummary || msg.agentInfo!.summaryContent,
        },
      };
    }
    return msg;
  });

  this.tabManager.updateTab(tabId, { messages: updatedMessages });

  // Remove from streaming map
  this._streamingAgents.update(map => {
    const newMap = new Map(map);
    newMap.delete(toolUseId);
    return newMap;
  });

  console.log('[ChatStore] Agent bubble completed:', toolUseId);
}
```

---

## Phase 4: Component Updates

### Task 4.1: Enhance AgentExecutionComponent for Streaming

**File:** `libs/frontend/chat/src/lib/components/organisms/agent-execution.component.ts`

**Changes:**

1. Add computed signal for streaming state
2. Update template for streaming indicators
3. Show live tool count

```typescript
// Add computed
readonly isStreaming = computed(() => this.agentInfo().isStreaming === true);

readonly toolCount = computed(() => {
  const tree = this.executionTree();
  return tree?.children?.filter(c => c.type === 'tool').length ?? 0;
});

// Update template sections:

// Summary header:
<span class="text-[11px] font-medium text-base-content/70">
  Summary
  @if (isStreaming() && !agentInfo().summaryContent) {
    <lucide-angular [img]="LoaderIcon" class="w-3 h-3 animate-spin ml-1" />
  }
</span>

// Execution header:
<span class="text-[11px] font-medium text-base-content/70">
  Execution
  @if (isStreaming()) {
    <span class="text-base-content/40 ml-1">({{ toolCount() }} tools running...)</span>
  } @else if (toolCount() > 0) {
    <span class="text-base-content/40 ml-1">({{ toolCount() }} tools)</span>
  }
</span>

// Add streaming indicator in empty state:
@if (isStreaming() && !hasContent()) {
  <div class="flex items-center gap-2 text-[11px] text-base-content/40 italic px-2 py-3">
    <lucide-angular [img]="LoaderIcon" class="w-3.5 h-3.5 animate-spin" />
    <span>Agent execution in progress...</span>
  </div>
}
```

### Task 4.2: Update MessageBubbleComponent Streaming Badge

**File:** `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`

**Add streaming badge to agent header (line ~30):**

```html
@if (message().agentInfo?.isStreaming) {
<span class="badge badge-xs badge-info gap-1">
  <span class="loading loading-spinner loading-xs"></span>
  Streaming
</span>
}
```

### Task 4.3: Ensure Typing Cursor in Summary Section

**File:** `libs/frontend/chat/src/lib/components/organisms/agent-execution.component.ts`

**Import and add cursor:**

```typescript
import { TypingCursorComponent } from '../atoms/typing-cursor.component';

// In imports array:
imports: [/* existing */, TypingCursorComponent],

// In summary content section:
@if (agentInfo().summaryContent) {
  <ptah-agent-summary [content]="agentInfo().summaryContent!" />
  @if (isStreaming()) {
    <ptah-typing-cursor colorClass="text-base-content/50" />
  }
}
```

---

## Phase 5: SessionReplayService Alignment

### Task 5.1: Add toolUseId to AgentInfo in Replay

**File:** `libs/frontend/chat/src/lib/services/session-replay.service.ts`

**Update createAgentBubble (around line 566):**

```typescript
const agentInfo: AgentInfo = {
  agentType,
  agentDescription,
  agentModel,
  summaryContent: summaryContent || undefined,
  hasSummary: !!summaryContent,
  hasExecution: executionNodes.length > 0,
  isInterrupted,
  // NEW: Add toolUseId for consistency
  toolUseId: block.id,
  isStreaming: false, // Replay is never streaming
};
```

---

## Phase 6: Testing & Validation

### Task 6.1: Unit Tests

**Files to create/update:**

- `libs/frontend/chat/src/lib/services/jsonl-processor.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat.store.spec.ts`

**Test cases:**

1. Task tool_use returns `agentBubbleStarted`
2. Nested assistant message returns `agentBubbleUpdate`
3. Task tool_result returns `agentBubbleCompleted`
4. Agent messages added to tab.messages correctly
5. Summary content accumulates during streaming
6. isStreaming flag toggles correctly

### Task 6.2: Integration Tests

**Manual testing scenarios:**

1. Send prompt that triggers Explore agent → Verify separate bubble
2. Agent executes multiple tools → Verify tool count updates
3. Agent completes → Verify streaming badge removed
4. Load same session from history → Verify identical visual
5. Nested agents (agent spawns agent) → Verify both appear correctly
6. Permission request during agent → Verify permission card appears

### Task 6.3: Visual Regression

**Compare screenshots:**

- Streaming agent bubble vs Loaded agent bubble
- Should be visually identical (minus streaming indicators)

---

## Rollout Plan

### Step 1: Feature Flag (Optional)

```typescript
// In chat.store.ts
private readonly UNIFIED_AGENT_BUBBLES = true; // Feature flag

processJsonlChunk(...) {
  if (this.UNIFIED_AGENT_BUBBLES && result.agentBubbleStarted) {
    // New behavior
  } else {
    // Old behavior (keep agent in tree)
  }
}
```

### Step 2: Gradual Testing

1. Enable flag in development
2. Test all agent scenarios
3. Enable flag in production

### Step 3: Cleanup

1. Remove feature flag
2. Remove old agent-in-tree code paths
3. Update documentation

---

## Files Changed Summary

| File                                                                            | Change Type    | Lines Est. |
| ------------------------------------------------------------------------------- | -------------- | ---------- |
| `libs/shared/src/lib/types/execution-node.types.ts`                             | Modify         | +10        |
| `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts`                | Major refactor | +80, -40   |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                             | Add handlers   | +100       |
| `libs/frontend/chat/src/lib/services/chat.types.ts`                             | Add type       | +5         |
| `libs/frontend/chat/src/lib/services/session-replay.service.ts`                 | Minor          | +5         |
| `libs/frontend/chat/src/lib/components/organisms/agent-execution.component.ts`  | Enhance        | +30        |
| `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html` | Badge          | +5         |

**Total estimated changes:** ~280 lines

---

## Success Metrics

1. **Visual Parity:** Streaming agents look identical to loaded agents
2. **No Regressions:** Session loading works as before
3. **Performance:** No noticeable lag with agent bubbles
4. **User Feedback:** Improved clarity and organization

---

## Dependencies

- No external dependencies
- No backend changes required
- No new packages

---

## Timeline Estimate

| Phase   | Tasks                 | Estimate |
| ------- | --------------------- | -------- |
| Phase 1 | Types                 | 0.5 day  |
| Phase 2 | JsonlMessageProcessor | 1 day    |
| Phase 3 | ChatStore             | 0.5 day  |
| Phase 4 | Components            | 0.5 day  |
| Phase 5 | SessionReplay         | 0.25 day |
| Phase 6 | Testing               | 1 day    |

**Total: ~4 days**
