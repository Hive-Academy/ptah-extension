I'll analyze the code in these key areas to understand how tool calls are handled during session history loading. Let me search through the relevant services. Now let me search for the specific services and methods mentioned in the request to get a clearer picture of the current implementation: Let me search for the specific files and services mentioned in your question: Let me search for the relevant services by looking at the chat service structure: Based on my analysis of the codebase, I can now provide you with detailed insights on the tool call display issue when loading session history. Let me search for the specific methods you mentioned to understand the complete flow. Based on my analysis of the codebase, I can now provide a comprehensive answer about the tool call display issue when loading previous sessions. Let me examine the key differences between live streaming and session history loading.

## Analysis: Tool Calls Not Displayed in Session History

After reviewing the code, I've identified the key services and their interactions:

### 1. **Session Loading Flow (ChatStore.switchSession)**

```typescript name=libs/frontend/chat/src/lib/services/chat.store.ts url=https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/frontend/chat/src/lib/services/chat.store.ts#L444-L528
async switchSession(sessionId: string): Promise<void> {
  // ... service checks ...

  // Load messages for this session via RPC
  const result = await this.claudeRpcService.call<{
    sessionId: string;
    messages:  JSONLMessage[];
    agentSessions?:  Array<{ agentId: string; messages: JSONLMessage[] }>;
  }>('session:load', { sessionId, workspacePath });

  if (result.success && result.data) {
    // Use SessionReplayService to process JSONL messages
    const { messages, nodeMaps } = this.sessionReplay.replaySession(
      result.data.messages,
      result.data.agentSessions ??  []
    );

    // Update tab with loaded messages
    this.tabManager. updateTab(activeTabId, {
      messages,
      executionTree: null,
      status: 'loaded',
      title,
    });

    // Update SessionManager with node maps and state
    this.sessionManager.setNodeMaps(nodeMaps);
    // ...
  }
}
```

**Key observation**: Session loading uses `SessionReplayService. replaySession()` - **NOT** the `processStreamEvent` pattern. There are no `tool_start` or `tool_result` events being created or replayed.

### 2. **SessionReplayService - How Tools Are Processed**

Looking at `SessionReplayService. replaySession()`, tools are processed directly from JSONL content blocks:

```typescript name=libs/frontend/chat/src/lib/services/session-replay.service. ts url=https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/frontend/chat/src/lib/services/session-replay.service.ts#L212-L258
} else if (block.type === 'tool_use') {
  if (block.name === 'Task' && block.input) {
    // Task tool = Agent spawn - add INLINE to assistant tree
    const agentNode = this.createInlineAgentNode(block, agentId, ... );
    currentAssistantTree = {
      ...currentAssistantTree,
      children: [...currentAssistantTree. children, agentNode],
    };
  } else {
    // Regular tool - add to assistant tree
    // Look up the tool result by tool_use_id
    const toolResult = block.id ? allToolResults.get(block.id) : undefined;

    const toolNode = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'tool',
      status: toolResult?.isError ? 'error' : 'complete',
      toolName: block.name,
      toolInput: block.input,
      toolOutput: toolResult?.content,  // <-- Tool output linked here!
      toolCallId: block.id,
      isCollapsed: true,
    });

    if (block.id) {
      nodeMaps.tools.set(block.id, toolNode);
    }

    currentAssistantTree = {
      ...currentAssistantTree,
      children: [... currentAssistantTree.children, toolNode],
    };
  }
}
```

### 3. **Critical Finding: Tool Results Extraction**

The `extractAllToolResults` method extracts tool results from user messages:

```typescript name=libs/frontend/chat/src/lib/services/session-replay.service.ts url=https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/frontend/chat/src/lib/services/session-replay. service.ts#L470-L510
private extractAllToolResults(
  mainMessages: JSONLMessage[]
): Map<string, { content: string; isError: boolean }> {
  const toolResults = new Map<string, { content:  string; isError: boolean }>();

  for (const msg of mainMessages) {
    if (msg.type === 'user' && msg.message?. content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Extract content...
          toolResults.set(block.tool_use_id, { content: resultText, isError });
        }
      }
    }
  }
  return toolResults;
}
```

### 4. **Key Differences Between Live Streaming and History Loading**

| Aspect                | Live Streaming (`JsonlMessageProcessor`)                         | Session History (`SessionReplayService`)              |
| --------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| **Tool Registration** | Tools registered in `SessionManager._toolNodeMap` as they stream | Tools registered in `nodeMaps.tools` after processing |
| **Tool Results**      | Received via separate `user` messages with `tool_result` blocks  | Linked via `extractAllToolResults()` pre-scan         |
| **State Updates**     | Incremental tree updates via `processChunk()`                    | Single batch reconstruction                           |
| **Node Maps**         | Populated during streaming                                       | Populated at the end, then set via `setNodeMaps()`    |

### 5. **Potential Issue Areas**

Based on the code analysis, the likely issues are:

#### A. **Tool Results Not Being Found**

In `extractAllToolResults()`, the extraction only looks at `user` type messages:

```typescript
if (msg.type === 'user' && msg.message?.content)
```

If tool results are in a different message format in the JSONL files, they won't be extracted.

#### B. **Agent Session Tools Missing Results**

For agent sessions, the `buildInterleavedAgentChildren()` method also extracts tool results, but only from within the agent's messages:

```typescript name=libs/frontend/chat/src/lib/services/session-replay.service.ts url=https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/frontend/chat/src/lib/services/session-replay.service.ts#L590-L668
private buildInterleavedAgentChildren(
  messages: JSONLMessage[],
  nodeMaps: NodeMaps
): readonly ExecutionNode[] {
  // First pass: collect all tool results by their tool_use_id
  const toolResults = new Map<string, { content: string; isError:  boolean }>();

  for (const msg of messages) {
    if (msg.type === 'user' && msg. message?.content) {
      // ...  extract tool results ...
    }
  }

  // Second pass: process messages creating tools
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message. content) {
        // ...
        else if (block.type === 'tool_use') {
          const toolResult = block.id ? toolResults.get(block.id) : undefined;
          // toolResult might be undefined if not found!
        }
      }
    }
  }
}
```

#### C. **No StreamingHandlerService or SessionLoaderService Exist**

Important: The codebase does **NOT** have services named `StreamingHandlerService`, `SessionLoaderService`, or `SessionHistoryReaderService`. The actual services are:

- `JsonlMessageProcessor` - handles live streaming
- `SessionReplayService` - handles session history loading
- `SessionManager` - manages node maps and session state
- `ChatStore` - coordinates everything

There is **no `processStreamEvent`** or `replayToStreamEvents` method - these don't exist in the current codebase.

### 6. **Recommended Debug Steps**

To fix the tool display issue, check:

1. **JSONL file format** - Are tool_result blocks in `user` type messages?
2. **Tool ID correlation** - Are `tool_use_id` in tool_result matching `block.id` in tool_use?
3. **Add logging** in `extractAllToolResults()`:

   ```typescript
   console.log('[SessionReplayService] Tool results found:', {
     toolUseId: block.tool_use_id,
     hasContent: !!resultText,
   });
   ```

4. **Check agent sessions** - Are agent tools being extracted correctly in `buildInterleavedAgentChildren()`?

The main fix would likely need to ensure the tool result extraction catches all cases and properly links `tool_use_id` values between tool_use and tool_result blocks.

---

**Note**: The search results may be incomplete. For more results, you can [search on GitHub](https://github.com/search? q=repo%3AHive-Academy%2Fptah-extension+processStreamEvent&type=code).
