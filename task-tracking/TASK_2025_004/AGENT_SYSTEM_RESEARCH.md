# Claude Code Agent/Task System - Complete Research & Implementation Plan

**Date**: 2025-11-17
**Status**: 🔍 Research Complete - Ready for Implementation Planning
**Purpose**: Enable Ptah extension to visualize and stream Claude Code subagent/task execution

---

## 📋 Executive Summary

Claude Code's agent system is **the most powerful and missing feature** in current VS Code extensions. This document provides complete research findings and an implementation roadmap for streaming subagent activity to Ptah's UI.

### Key Discoveries

1. ✅ **Task Tool Identified**: Task tool spawns subagents with isolated contexts
2. ✅ **JSONL Events Captured**: All agent activity flows through stream-json output
3. ✅ **Hook System Documented**: SubagentStop and PreToolUse/PostToolUse hooks track execution
4. ✅ **Agent Transcripts Located**: Each agent saves to `agent-{agentId}.jsonl` files
5. ✅ **Implementation Path Clear**: Multiple strategies available for integration

---

## 🏗️ How Claude Code Agents Work

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Main Agent (Primary Context Window)                        │
│  ├─ User messages                                           │
│  ├─ Tool calls (Bash, Read, Edit, Write, etc.)             │
│  └─ Task tool invocations ──────┐                          │
└─────────────────────────────────│───────────────────────────┘
                                  │
                 ┌────────────────▼───────────────────────────┐
                 │  Task Tool (Agent Spawner)                 │
                 │  • Creates subagent with new context       │
                 │  • Assigns unique agentId                  │
                 │  • Inherits parent tools (except Task)     │
                 │  • Saves to agent-{agentId}.jsonl         │
                 └──┬──────────────┬──────────────────────────┘
                    │              │
        ┌───────────▼──┐    ┌─────▼────────┐
        │ Subagent 1    │    │ Subagent 2   │
        │ context_1     │    │ context_2    │
        │ tools: all-Task│   │ isolated ctx │
        └───────────────┘    └──────────────┘
```

### Task Tool Parameters

From captured JSONL output:

```json
{
  "type": "tool_use",
  "id": "toolu_01W3kWVhFcrUhcdi8hfKrNwa",
  "name": "Task",
  "input": {
    "subagent_type": "Explore",
    "description": "Analyze Ptah project structure",
    "prompt": "Analyze the Ptah VS Code extension project structure...",
    "model": "haiku" // Optional: defaults to parent model
  }
}
```

**Task Tool Input Schema:**

- `subagent_type`: Agent role (general-purpose, Explore, Plan, code-reviewer, etc.)
- `description`: Short summary of the task (used for planning/routing)
- `prompt`: Complete instructions for the subagent
- `model` (optional): Model to use (sonnet, haiku, opus, or full name)

### Subagent Types (Built-in)

From `claude --help` output, available agents:

```
"agents": [
  "general-purpose",      // Default flexible agent
  "statusline-setup",     // VS Code statusline configuration
  "Explore",             // Fast codebase exploration
  "Plan",                // Planning and design
  "workflow-orchestrator", // Git and workflow management
  "ui-ux-designer",      // UI/UX design specialist
  "team-leader",         // Task decomposition
  "software-architect",  // System design
  "senior-tester",       // Quality assurance
  "researcher-expert",   // Deep technical research
  "project-manager",     // Requirements analysis
  "modernization-detector", // Tech modernization
  "frontend-developer",  // Frontend implementation
  "code-reviewer",       // Code quality
  "business-analyst",    // Scope validation
  "backend-developer"    // Backend implementation
]
```

### Custom Agents via CLI Flag

```bash
claude --agents '{
  "my-custom-agent": {
    "description": "Custom agent for special tasks",
    "prompt": "You are a specialized agent for...",
    "tools": ["Read", "Grep", "Bash"],  // Optional tool restrictions
    "model": "sonnet"                    // Optional model override
  }
}'
```

---

## 📡 JSONL Stream Events for Agents

### 1. Task Tool Invocation

**Main agent invokes Task:**

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_...",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01W3kWVhFcrUhcdi8hfKrNwa",
        "name": "Task",
        "input": {
          "subagent_type": "Explore",
          "description": "Analyze project structure",
          "prompt": "..."
        }
      }
    ],
    "stop_reason": "tool_use"
  },
  "session_id": "18a850a6-2d32-4599-a778-f6f185b79edf",
  "parent_tool_use_id": null // Main agent has no parent
}
```

### 2. Subagent Activity

**Subagent tool calls have `parent_tool_use_id`:**

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-haiku-4-5-20251001", // Subagent may use different model
    "id": "msg_...",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01YCFLFHrGzZubdPuY4oGwaa",
        "name": "Bash",
        "input": { "command": "ls -la" }
      }
    ],
    "stop_reason": "tool_use"
  },
  "parent_tool_use_id": "toolu_01W3kWVhFcrUhcdi8hfKrNwa", // ✅ Links to Task tool!
  "session_id": "18a850a6-2d32-4599-a778-f6f185b79edf"
}
```

**Critical Discovery**: Every subagent message includes `parent_tool_use_id` that links back to the original Task tool call!

### 3. Subagent Completion

**No explicit "subagent_complete" event in JSONL stream**, but we can infer completion when:

1. A tool result for the Task tool is emitted
2. No more messages with that `parent_tool_use_id` appear
3. (Alternative) Use SubagentStop hook (see Hooks section)

### 4. Agent Transcript Files

**Location**: `~/.claude/projects/{project-hash}/agent-{agentId}.jsonl`

Each subagent saves its complete conversation to a separate JSONL file. This includes:

- All messages (user, assistant, system)
- Tool calls and results
- Thinking processes
- Final summary

**Format**: Same JSONL format as main session, but isolated context.

---

## 🎣 Hook System for Agent Tracking

### SubagentStop Hook

**Fires when**: Subagent (Task tool call) finishes responding

**Input Schema:**

```json
{
  "session_id": "string",
  "transcript_path": "string",
  "permission_mode": "string",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": true
}
```

**Control Options:**

- `"decision": "block"` - Prevent stoppage
- `"reason": "..."` - Explanation for blocking

**Limitation**: ⚠️ All subagents share same `session_id`, making it impossible to identify WHICH subagent completed without parsing the transcript.

### PreToolUse Hook

**Fires when**: Before any tool execution (including Task tool)

**Input Schema:**

```json
{
  "session_id": "string",
  "hook_event_name": "PreToolUse",
  "tool_name": "Task",
  "tool_input": {
    "subagent_type": "Explore",
    "description": "...",
    "prompt": "..."
  }
}
```

**Use Case**: Intercept Task tool calls to track subagent starts.

### PostToolUse Hook

**Fires when**: After tool execution completes

**Input Schema:**

```json
{
  "session_id": "string",
  "hook_event_name": "PostToolUse",
  "tool_name": "Task",
  "tool_input": {...},
  "tool_response": {
    // Subagent's final output
  }
}
```

**Use Case**: Capture subagent results and completion.

---

## 🎯 Implementation Strategies for Ptah

### Strategy 1: JSONL Stream Parsing (RECOMMENDED)

**Approach**: Enhance existing JSONLStreamParser to track `parent_tool_use_id`

**Advantages**:

- ✅ Real-time tracking (no polling needed)
- ✅ No external dependencies (hooks)
- ✅ Works with existing streaming infrastructure
- ✅ Complete agent activity visibility

**Implementation**:

```typescript
// Add to JSONLStreamParser.ts

export interface JSONLTaskMessage {
  readonly type: 'tool';
  readonly subtype: 'start';
  readonly tool_call_id: string;
  readonly tool: 'Task';
  readonly args: {
    readonly subagent_type: string;
    readonly description: string;
    readonly prompt: string;
    readonly model?: string;
  };
}

export interface ClaudeAgentEvent {
  readonly type: 'agent_start' | 'agent_activity' | 'agent_complete';
  readonly agentId: string;  // tool_call_id of Task tool
  readonly parentToolCallId: string | null;
  readonly subagentType: string;
  readonly description: string;
  readonly timestamp: number;
  readonly toolName?: string;  // For agent_activity events
  readonly content?: string;   // For agent text output
}

// In JSONLStreamParser callbacks
onTool?: (event: ClaudeToolEvent) => void;
onAgent?: (event: ClaudeAgentEvent) => void;  // NEW

// In handleToolMessage()
if (msg.tool === 'Task' && msg.subtype === 'start') {
  const agentEvent: ClaudeAgentEvent = {
    type: 'agent_start',
    agentId: msg.tool_call_id,
    parentToolCallId: null,
    subagentType: msg.args.subagent_type,
    description: msg.args.description,
    timestamp: Date.now(),
  };
  this.callbacks.onAgent?.(agentEvent);
}

// Track active agents
private activeAgents = new Map<string, {
  subagentType: string;
  description: string;
  startTime: number;
}>();
```

**Add to shared types (claude-domain.types.ts)**:

```typescript
export interface ClaudeAgentStartEvent {
  readonly type: 'agent_start';
  readonly agentId: string;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly timestamp: number;
}

export interface ClaudeAgentActivityEvent {
  readonly type: 'agent_activity';
  readonly agentId: string;
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ClaudeAgentCompleteEvent {
  readonly type: 'agent_complete';
  readonly agentId: string;
  readonly duration: number;
  readonly result?: string;
  readonly timestamp: number;
}

export type ClaudeAgentEvent = ClaudeAgentStartEvent | ClaudeAgentActivityEvent | ClaudeAgentCompleteEvent;
```

**Add EventBus events**:

```typescript
// In claude-domain.events.ts

export interface ClaudeAgentStartedEvent {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentStartEvent;
}

export interface ClaudeAgentActivityEventPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentActivityEvent;
}

export interface ClaudeAgentCompletedEvent {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentCompleteEvent;
}

// Add to ClaudeDomainEventPublisher
emitAgentStarted(sessionId: SessionId, agent: ClaudeAgentStartEvent): void {
  this.eventBus.publish('claude:agentStarted', { sessionId, agent });
}

emitAgentActivity(sessionId: SessionId, agent: ClaudeAgentActivityEvent): void {
  this.eventBus.publish('claude:agentActivity', { sessionId, agent });
}

emitAgentCompleted(sessionId: SessionId, agent: ClaudeAgentCompleteEvent): void {
  this.eventBus.publish('claude:agentCompleted', { sessionId, agent });
}
```

**Update ClaudeCliLauncher**:

```typescript
// In createStreamingPipeline callbacks

onTool: (toolEvent) => {
  // Existing tool event handling
  this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);

  // NEW: Track Task tool invocations
  if (toolEvent.type === 'start' && toolEvent.tool === 'Task') {
    const agentStartEvent: ClaudeAgentStartEvent = {
      type: 'agent_start',
      agentId: toolEvent.toolCallId,
      subagentType: toolEvent.args.subagent_type as string,
      description: toolEvent.args.description as string,
      prompt: toolEvent.args.prompt as string,
      model: toolEvent.args.model as string | undefined,
      timestamp: Date.now(),
    };
    this.deps.eventPublisher.emitAgentStarted(sessionId, agentStartEvent);
  }

  // Track Task tool completion
  if (toolEvent.type === 'result' && activeAgents.has(toolEvent.toolCallId)) {
    const agent = activeAgents.get(toolEvent.toolCallId)!;
    const agentCompleteEvent: ClaudeAgentCompleteEvent = {
      type: 'agent_complete',
      agentId: toolEvent.toolCallId,
      duration: Date.now() - agent.startTime,
      result: toolEvent.output as string,
      timestamp: Date.now(),
    };
    this.deps.eventPublisher.emitAgentCompleted(sessionId, agentCompleteEvent);
    activeAgents.delete(toolEvent.toolCallId);
  }

  outputStream.push({ type: 'tool', data: toolEvent });
},
```

### Strategy 2: Hook Integration (ALTERNATIVE)

**Approach**: Use Claude Code hooks to intercept agent events

**Advantages**:

- ✅ Official API for tracking
- ✅ Can block/modify agent behavior
- ✅ Access to transcript paths

**Disadvantages**:

- ❌ Requires separate hook scripts (Python/Bash/Node.js)
- ❌ Hooks run as separate processes (communication overhead)
- ❌ Cannot identify specific subagent in SubagentStop hook
- ❌ More complex setup for users

**Implementation**: Not recommended for Ptah due to complexity.

### Strategy 3: Transcript File Monitoring (FALLBACK)

**Approach**: Watch `~/.claude/projects/*/agent-*.jsonl` files for changes

**Advantages**:

- ✅ Complete agent conversation history
- ✅ Can resume monitoring across sessions

**Disadvantages**:

- ❌ File system polling (performance impact)
- ❌ Not real-time (delay between write and detection)
- ❌ Complex file path resolution
- ❌ Duplicate work (already streaming JSONL)

**Implementation**: Only use as fallback if JSONL stream fails.

---

## 🎨 UI Design for Agent Visualization

### Agent Tree View

```
📜 Chat Session: "Build auth system"
├─ 👤 User: "Build complete auth with JWT"
├─ 🤖 Main Agent
│  ├─ 💭 Thinking: "I'll delegate frontend to ui-ux-designer..."
│  ├─ 🔧 Task (frontend-developer) ───┐
│  └─ 🔧 Task (backend-developer) ────┤
│                                      │
├─ 🎨 Subagent: frontend-developer ◄──┘
│  ├─ 📝 Description: "Build React login UI"
│  ├─ ⏱️  Duration: 45s
│  ├─ 🔧 Read: LoginForm.tsx
│  ├─ ✏️  Write: LoginForm.tsx (modified)
│  └─ ✅ Complete
│
└─ 💻 Subagent: backend-developer ◄────┘
   ├─ 📝 Description: "Implement JWT auth API"
   ├─ ⏱️  Duration: 1m 23s
   ├─ 🔧 Read: authController.ts
   ├─ ✏️  Write: authController.ts (modified)
   ├─ 🔧 Bash: npm install jsonwebtoken
   └─ ✅ Complete
```

### Agent Status Badge

```
┌─────────────────────────────────────────┐
│ 🤖 Active Subagents (2)                 │
├─────────────────────────────────────────┤
│ 🎨 frontend-developer    ⏱️ 45s  ✅     │
│ 💻 backend-developer     ⏱️ 1m23s ✅    │
└─────────────────────────────────────────┘
```

### Agent Timeline

```
Timeline View:
────●─────────●────────────────●──────●────▶
    │         │                │      │
    │         │                │      └─ backend-developer complete (1m23s)
    │         │                └──────── frontend-developer complete (45s)
    │         └───────────────────────── backend-developer started
    └─────────────────────────────────── frontend-developer started
```

---

## 📊 Data Flow Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Claude CLI Process                                           │
│  ├─ Main Agent                                               │
│  │  ├─ User message                                          │
│  │  └─ Task tool → Subagent 1                               │
│  └─ Subagent 1 (parent_tool_use_id: Task.id)                │
│     ├─ Bash tool                                             │
│     └─ Write tool                                            │
└──────────────│───────────────────────────────────────────────┘
               │ JSONL stream via stdout
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ClaudeCliLauncher (claude-domain)                           │
│  └─ JSONLStreamParser                                        │
│     ├─ Detects Task tool (type:'tool', tool:'Task')         │
│     ├─ Tracks parent_tool_use_id for subagent messages      │
│     └─ Emits agent events via callbacks                     │
└──────────────│───────────────────────────────────────────────┘
               │ Agent events
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ClaudeDomainEventPublisher (claude-domain)                  │
│  ├─ emitAgentStarted(sessionId, agentEvent)                 │
│  ├─ emitAgentActivity(sessionId, agentEvent)                │
│  └─ emitAgentCompleted(sessionId, agentEvent)               │
└──────────────│───────────────────────────────────────────────┘
               │ EventBus publish
               ▼
┌──────────────────────────────────────────────────────────────┐
│  MessageHandlerService (claude-domain)                       │
│  └─ Subscribes to claude:agentStarted/Activity/Completed    │
│     └─ Publishes to frontend via chat:agentEvent            │
└──────────────│───────────────────────────────────────────────┘
               │ Webview postMessage
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Angular Webview (ptah-extension-webview)                    │
│  ├─ AgentTreeComponent (visual tree)                        │
│  ├─ AgentTimelineComponent (timeline view)                  │
│  └─ AgentStatusBadge (active agent count)                   │
└──────────────────────────────────────────────────────────────┘
```

---

## ✅ Implementation Checklist

### Phase 1: Type System (Week 1)

- [ ] Add `ClaudeAgentEvent` types to `shared/claude-domain.types.ts`
- [ ] Add `MESSAGE_TYPES` for agent events in `shared/message-registry.ts`
- [ ] Add EventBus event types for agent tracking
- [ ] Update MessagePayloadMap with agent event payloads

### Phase 2: Backend Integration (Week 1-2)

- [ ] Enhance `JSONLStreamParser` to detect Task tool usage
- [ ] Add `parent_tool_use_id` tracking to parser state
- [ ] Implement agent lifecycle detection (start/activity/complete)
- [ ] Add agent event callbacks to `JSONLParserCallbacks`
- [ ] Update `ClaudeDomainEventPublisher` with agent event emitters
- [ ] Modify `ClaudeCliLauncher` to wire agent callbacks
- [ ] Add agent event subscriptions to `MessageHandlerService`
- [ ] Test with real Claude CLI Task tool invocations

### Phase 3: Frontend Components (Week 2-3)

- [ ] Create `AgentTreeComponent` (libs/frontend/chat or new libs/frontend/agents)
- [ ] Create `AgentTimelineComponent` for temporal visualization
- [ ] Create `AgentStatusBadge` for active agent count
- [ ] Add agent events handling to `ChatService`
- [ ] Create agent state management (signals for agent list)
- [ ] Integrate agent tree into chat view
- [ ] Add agent filtering/search capabilities

### Phase 4: UI/UX Polish (Week 3-4)

- [ ] Design agent icons for each subagent type
- [ ] Implement collapsible agent tree nodes
- [ ] Add agent duration tracking and display
- [ ] Create agent detail panel (show prompt, tools used, results)
- [ ] Add agent highlighting in message stream
- [ ] Implement agent transcript export
- [ ] Add agent performance metrics

### Phase 5: Testing & Documentation (Week 4)

- [ ] Unit tests for JSONLStreamParser agent detection
- [ ] Integration tests for agent event flow
- [ ] E2E tests with real Task tool scenarios
- [ ] Performance testing with multiple concurrent agents
- [ ] Document agent visualization features in README
- [ ] Create user guide for agent tracking

---

## 🔬 Testing Scenarios

### Scenario 1: Single Subagent

```bash
echo "Use the Explore subagent to analyze this codebase" | \
  claude -p --output-format stream-json --verbose
```

**Expected Events**:

1. `claude:agentStarted` - Explore subagent
2. `claude:agentActivity` - Multiple tool calls (Bash, Read, Grep)
3. `claude:agentCompleted` - Final summary

### Scenario 2: Parallel Subagents

```bash
echo "Have frontend-developer build the UI while backend-developer creates the API" | \
  claude -p --output-format stream-json --verbose
```

**Expected Events**:

1. `claude:agentStarted` - frontend-developer
2. `claude:agentStarted` - backend-developer
3. Interleaved `claude:agentActivity` from both agents
4. `claude:agentCompleted` - frontend-developer
5. `claude:agentCompleted` - backend-developer

### Scenario 3: Custom Agent

```bash
claude --agents '{"test-agent": {"description": "Test agent", "prompt": "You are a test agent"}}' \
  -p --output-format stream-json --verbose "Use test-agent to say hello"
```

**Expected Events**:

1. `claude:agentStarted` - test-agent (custom)
2. `claude:agentActivity` - Any tool usage
3. `claude:agentCompleted` - Result

---

## 🎁 Competitive Advantage

### Why This Matters

**No other VS Code extension has agent visualization**:

- ❌ Official Claude Code VSCode extension - No agent UI
- ❌ Cline/Claude Dev - No subagent tracking
- ❌ Continue.dev - No agent delegation support
- ❌ Cursor - Proprietary agent system (different architecture)

**Ptah will be THE FIRST** to visualize Claude Code's powerful agent orchestration system.

### User Benefits

1. **Transparency**: See exactly what each agent is doing
2. **Performance**: Understand parallel execution patterns
3. **Debugging**: Track which agent caused issues
4. **Learning**: Understand how Claude delegates work
5. **Control**: Eventually allow users to configure agent delegation

---

## 📚 References

- Claude Code Documentation: https://code.claude.com/docs
- Task Tool Guide: https://claudelog.com/mechanics/task-agent-tools/
- Hooks Reference: https://code.claude.com/docs/en/hooks
- Community Examples: https://github.com/disler/claude-code-hooks-multi-agent-observability

---

## 🚀 Next Steps

1. **Review this document** with team
2. **Validate technical approach** with prototype
3. **Create detailed sprint plan** for 4-week implementation
4. **Assign components** to developers
5. **Set up testing environment** with Claude CLI
6. **Begin Phase 1** (Type System) implementation

---

**Recommendation**: Proceed with **Strategy 1 (JSONL Stream Parsing)** as it provides real-time tracking with minimal complexity and leverages existing infrastructure.
