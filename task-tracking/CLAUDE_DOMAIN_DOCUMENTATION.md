## Deep Dive: How Claude Domain Library Reads Subagent Executions from JSONL Sessions

### Architecture Overview

The system uses a **multi-layer architecture** to load session data and reconstruct subagent (Task tool) executions:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                       │
│  ┌─────────────────┐    ┌──────────────────────┐    ┌───────────────────┐  │
│  │   ChatStore     │───►│  ClaudeRpcService    │───►│ SessionReplayService│ │
│  │ switchSession() │    │  session:load RPC    │    │ replaySession()   │  │
│  └─────────────────┘    └──────────────────────┘    └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ RPC
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                        │
│  ┌──────────────────────────────┐    ┌─────────────────────────────────┐   │
│  │ RpcMethodRegistrationService │───►│   SessionDiscoveryService       │   │
│  │   session:load handler       │    │   loadSession()                 │   │
│  └──────────────────────────────┘    │   findLinkedAgentSessions()     │   │
│                                      └─────────────────────────────────┘   │
│                                                     │                       │
│  ┌──────────────────────────────┐                  │                       │
│  │   JsonlSessionParser         │◄─────────────────┘                       │
│  │   (claude-domain library)    │                                          │
│  └──────────────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 1: Backend Discovery - Finding Agent Sessions

The **`SessionDiscoveryService`** ([session-discovery.service.ts](https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/backend/vscode-core/src/services/session-discovery.service.ts)) is responsible for:

#### 1.1 Loading the Main Session

```typescript
// libs/backend/vscode-core/src/services/session-discovery. service.ts:169-211
async loadSession(sessionId: string, workspacePath: string): Promise<SessionData> {
  const sessionsDir = await this.findSessionsDirectory(workspacePath);
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  // Read and parse main session JSONL file
  const content = await fs.readFile(sessionFile, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());
  const mainMessages = lines.map((line) => JSON.parse(line)).filter(Boolean);

  // Find all agent sessions that belong to this main session
  const agentSessions = await this.findLinkedAgentSessions(sessionsDir, sessionId);

  return { sessionId, messages: mainMessages, agentSessions };
}
```

#### 1.2 Finding Linked Agent Sessions

The key method **`findLinkedAgentSessions`** scans for `agent-*.jsonl` files and matches them to the parent session:

```typescript
// libs/backend/vscode-core/src/services/session-discovery.service.ts:389-446
async findLinkedAgentSessions(
  sessionsDir:  string,
  mainSessionId: string
): Promise<LinkedAgentSession[]> {
  const files = await fs.readdir(sessionsDir);
  const agentFiles = files.filter((f) => f.startsWith('agent-'));  // ← Filter agent files
  const linkedAgents:  LinkedAgentSession[] = [];

  for (const agentFile of agentFiles) {
    const agentPath = path.join(sessionsDir, agentFile);
    const content = await fs.readFile(agentPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    const firstMsg = JSON.parse(lines[0]);

    // Agent sessions have sessionId pointing to parent main session
    if (firstMsg.sessionId === mainSessionId) {  // ← Key linking logic
      const agentId = firstMsg.agentId || agentFile.replace('agent-', '').replace('.jsonl', '');
      const messages = lines.map((line) => JSON.parse(line)).filter(Boolean);
      linkedAgents.push({ agentId, messages });
    }
  }
  return linkedAgents;
}
```

**Key Insight**: Agent files are linked to parent sessions via the `sessionId` field in their first message.

---

### Phase 2: The JSONL File Format

#### Main Session File (`{uuid}.jsonl`)

```jsonl
{"type":"summary","summary":"Implement feature X","leafUuid":"msg-123"}
{"uuid":"msg-1","sessionId":"abc-123","timestamp":"... ","message":{"role":"user","content":"..."}}
{"uuid":"msg-2","sessionId":"abc-123","timestamp":"...","message":{"role":"assistant","content":[
  {"type":"text","text":"I'll help you... "},
  {"type":"tool_use","id":"toolu_01ABC","name":"Task","input":{"subagent_type":"code","description":"..."}}
]}}
```

#### Agent Session File (`agent-{id}.jsonl`)

```jsonl
{"agentId":"abc12345","sessionId":"parent-uuid","isSidechain":true,"slug":"code_analysis",... }
{"type":"assistant","message":{"content":[{"type":"text","text":"I'll analyze... "}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_02ABC","name":"Glob","input":{}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_02ABC","content":"... "}]}}
```

**Key Fields for Linking**:

| Field          | Location                   | Purpose                                                  |
| -------------- | -------------------------- | -------------------------------------------------------- |
| `tool_use. id` | Main session's `Task` tool | ID of Task tool that spawned agent                       |
| `sessionId`    | First line of agent file   | Links back to parent main session                        |
| `agentId`      | Agent file first line      | 8-char identifier for agent                              |
| `isSidechain`  | Agent file                 | Indicates this is a sub-agent session                    |
| `slug`         | Agent messages             | Session-scoped identifier (used to filter warmup agents) |

---

### Phase 3: Frontend Replay - `SessionReplayService`

The **`SessionReplayService`** ([session-replay.service.ts](https://github.com/Hive-Academy/ptah-extension/blob/e669f6e9cf26031e4bbfe112d3d274be04a4fa53/libs/frontend/chat/src/lib/services/session-replay.service.ts)) handles the complex task of reconstructing the UI representation:

#### 3.1 Multi-Phase Processing

```typescript
// libs/frontend/chat/src/lib/services/session-replay.service.ts:66-104
replaySession(
  mainMessages: JSONLMessage[],
  agentSessions: AgentSessionData[]
): { messages: ExecutionChatMessage[]; nodeMaps: NodeMaps } {

  // PHASE 1: Build agent data map by agentId (filters warmup agents - no slug)
  const agentDataMap = this.buildAgentDataMap(agentSessions);

  // PHASE 2: Extract Task tool_use info from main session
  const taskToolUses = this.extractTaskToolUses(mainMessages);

  // PHASE 3: Correlate agents to Tasks via TIMESTAMP PROXIMITY
  const taskToAgentMap = this.correlateAgentsToTasks(taskToolUses, agentDataMap);

  // PHASE 4: Extract tool results for completion detection
  const taskToolResults = this.extractTaskToolResults(mainMessages);
  const allToolResults = this.extractAllToolResults(mainMessages);

  // PHASE 5: Process main messages, injecting agent nodes INLINE
  // ...  (creates ExecutionChatMessage[])
}
```

#### 3.2 Agent-to-Task Correlation via Timestamp

Since there's no direct ID linking between a `Task` tool_use and its agent file, the system uses **timestamp proximity**:

```typescript
// libs/frontend/chat/src/lib/services/session-replay.service. ts:387-442
private correlateAgentsToTasks(
  taskToolUses: Array<{ toolUseId: string; timestamp: number; subagentType: string }>,
  agentDataMap:  Map<string, { agentId: string; timestamp: number; ...  }>
): Map<string, string> {  // Returns toolUseId → agentId

  const taskToAgentMap = new Map<string, string>();
  const usedAgents = new Set<string>();

  // Sort both by timestamp
  const sortedTasks = [...taskToolUses].sort((a, b) => a.timestamp - b. timestamp);
  const sortedAgents = [...agentDataMap. values()].sort((a, b) => a.timestamp - b.timestamp);

  // Match each task to the closest agent that starts after it
  for (const task of sortedTasks) {
    for (const agent of sortedAgents) {
      if (usedAgents.has(agent.agentId)) continue;

      const timeDiff = agent.timestamp - task.timestamp;
      // Allow agents that start within 60 seconds after the task
      if (timeDiff >= -1000 && timeDiff < 60000) {
        taskToAgentMap.set(task.toolUseId, agent. agentId);
        usedAgents.add(agent.agentId);
        break;
      }
    }
  }
  return taskToAgentMap;
}
```

#### 3.3 Creating Inline Agent Nodes

Agents are rendered as **inline nodes** within the assistant message tree (not separate bubbles):

```typescript
// libs/frontend/chat/src/lib/services/session-replay.service.ts:522-578
private createInlineAgentNode(
  block: any,  // Task tool_use block from main session
  agentId: string | null,
  agentDataMap: Map<string, {... }>,
  taskToolResults: Set<string>,
  nodeMaps: NodeMaps
): ExecutionNode {

  const agentData = agentId ? agentDataMap.get(agentId) : null;
  const agentMessages = agentData?.executionMessages || [];

  // Build INTERLEAVED children (text + tools in chronological order)
  const interleavedChildren = this.buildInterleavedAgentChildren(agentMessages, nodeMaps);

  const agentNode = createExecutionNode({
    id: block.id,
    type: 'agent',
    status: 'complete',
    agentType: block.input?. ['subagent_type'],
    agentDescription: block.input?.['description'],
    agentModel: block.input?.['model'],
    children: interleavedChildren,  // ← Agent's tool calls and text responses
  });

  nodeMaps.agents.set(block.id, agentNode);  // Register for streaming bridge
  return agentNode;
}
```

#### 3.4 Building Interleaved Agent Children

The agent's internal execution (text + tool calls) is processed chronologically:

```typescript
// libs/frontend/chat/src/lib/services/session-replay.service.ts:590-668
private buildInterleavedAgentChildren(
  messages: JSONLMessage[],
  nodeMaps: NodeMaps
): readonly ExecutionNode[] {

  // First pass: collect all tool results
  const toolResults = new Map<string, { content: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          toolResults.set(block.tool_use_id, { content: block.content, isError: block.is_error });
        }
      }
    }
  }

  // Second pass: create interleaved text + tool nodes
  const children: ExecutionNode[] = [];
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message. content) {
        if (block.type === 'text') {
          children.push(createExecutionNode({ type: 'text', content: block.text }));
        } else if (block.type === 'tool_use') {
          const toolResult = toolResults.get(block. id);
          children.push(createExecutionNode({
            type: 'tool',
            toolName: block.name,
            toolInput: block.input,
            toolOutput: toolResult?.content,  // ← Linked result
            status: toolResult?.isError ? 'error' : 'complete',
          }));
        }
      }
    }
  }
  return children;
}
```

---

### Key Observations

1. **No Direct Agent ID Linking**: The JSONL format doesn't directly link `Task` tool_use IDs to agent file IDs. The system relies on **timestamp proximity** to correlate them.

2. **Warmup Agent Filtering**: Agents without a `slug` field are considered "warmup" agents and are filtered out:

   ```typescript
   if (!slug) continue; // Filter out warmup agents
   ```

3. **Interleaved Representation**: Agent children are displayed as a chronological timeline of text + tool calls, matching the streaming behavior.

4. **NodeMaps for Streaming Bridge**: The `nodeMaps` structure enables streaming messages to connect to historical agent/tool nodes when resuming a session.

5. **Two-Pass Tool Result Linking**: Tool results are collected first, then linked to their corresponding tool_use blocks in a second pass.

---

### File Structure Reference

| Component                    | Path                                                                     | Responsibility                                   |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `JsonlSessionParser`         | `libs/backend/claude-domain/src/session/jsonl-session-parser.ts`         | Parse JSONL files for metadata and messages      |
| `SessionDiscoveryService`    | `libs/backend/vscode-core/src/services/session-discovery.service.ts`     | Find sessions and linked agent files             |
| `SessionReplayService`       | `libs/frontend/chat/src/lib/services/session-replay.service.ts`          | Reconstruct UI from JSONL data                   |
| `AgentSessionWatcherService` | `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` | Real-time agent file monitoring during streaming |

This analysis should give you a comprehensive understanding of how subagent executions are read and reconstructed. Would you like me to dive deeper into any specific aspect?
