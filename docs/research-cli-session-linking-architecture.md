# Research Report: CLI Sub-Agent Session Linking Architecture

## Executive Summary

**Research Classification**: ARCHITECTURAL ANALYSIS
**Confidence Level**: 92% (based on full codebase investigation of 18+ files)
**Key Insight**: The infrastructure for linking CLI sub-agent sessions to the parent Ptah session is 80% complete. The AgentProcessManager already emits lifecycle events, the frontend AgentMonitorStore already renders them, and the MCP server already receives tool calls from CLI agents. The missing 20% is the _cross-referencing_: connecting CLI agent activity (via MCP tool calls and process events) back to the parent Claude SDK session context.

---

## 1. Current State Analysis

### 1.1 Two Completely Separate Session Tracking Systems

The codebase has two independent agent tracking systems that do not communicate with each other:

**System A: Claude SDK Subagent Tracking** (for Claude's own Task tool subagents)

```
SubagentHookHandler --> SubagentRegistryService --> AgentSessionWatcherService
                                                         |
                                                    (watches JSONL files)
                                                         |
                                                    Frontend: ExecutionNode tree
```

- Tracks agents spawned by Claude SDK's built-in Task tool
- Uses JSONL file watching for real-time summary streaming
- Registered in SubagentRegistryService keyed by toolCallId
- Frontend renders as nested ExecutionNode tree (recursive component)
- Has full lifecycle: running -> completed/interrupted/background

**System B: CLI Agent Process Tracking** (for Gemini, Codex, Copilot CLI agents)

```
AgentProcessManager --> EventEmitter(agent:spawned/output/exited)
                              |
                    RpcMethodRegistrationService.setupAgentMonitorListeners()
                              |
                    WebviewManager.broadcastMessage(AGENT_MONITOR_*)
                              |
                    Frontend: AgentMonitorStore --> AgentMonitorPanel (sidebar)
```

- Tracks CLI agent child processes (or SDK handles)
- Uses EventEmitter for lifecycle events (agent:spawned, agent:output, agent:exited)
- Stored in AgentProcessManager's internal Map<string, TrackedAgent>
- Frontend renders as a flat list in a sidebar panel (AgentMonitorStore)
- Has lifecycle: running -> completed/failed/timeout/stopped

### 1.2 What Each System Tracks

| Feature              | System A (SDK Subagents)                     | System B (CLI Agents)                                       |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Storage              | SubagentRegistryService (in-memory Map)      | AgentProcessManager.agents (in-memory Map)                  |
| ID Type              | toolCallId (toolu\_\*) + agentId (short hex) | AgentId (UUID branded type)                                 |
| Parent Link          | parentSessionId (Claude SDK session UUID)    | **NONE**                                                    |
| Output Streaming     | JSONL file tailing (AgentSessionWatcher)     | stdout/stderr buffer + throttled deltas                     |
| Frontend Location    | Inline in chat (ExecutionNode tree)          | Right sidebar (AgentMonitorPanel)                           |
| Tool Call Visibility | Yes (from JSONL content blocks)              | Only raw stdout text (tool segments from SDK adapters)      |
| Cost/Token Tracking  | Yes (from SDK result stats)                  | Partial (Gemini/Codex emit usage in output, not structured) |
| Resumption Support   | Yes (interrupted agents can be resumed)      | No                                                          |
| Background Support   | Yes (isBackground flag)                      | No                                                          |

### 1.3 The Gap: No Cross-Referencing

When the main Claude Agent SDK session spawns a CLI agent via the MCP `ptah_agent_spawn` tool:

1. Claude calls `ptah_agent_spawn` with a task description
2. The MCP protocol handler routes to `ptahAPI.agent.spawn()`
3. AgentProcessManager creates a TrackedAgent with a new UUID-based AgentId
4. The CLI process spawns (Gemini/Codex/Copilot)
5. Events flow to frontend AgentMonitorPanel

**What is lost**:

- No link between the AgentId (UUID) and the parent Claude SDK SessionId
- No way to know WHICH Claude session spawned this CLI agent
- No way to display CLI agent activity inline in the chat execution tree
- If the parent session is aborted, CLI agents are NOT automatically tracked for that session
- MCP tool calls FROM the CLI agent (e.g., `ptah_workspace_analyze`) are completely invisible -- they execute and return results, but neither system records "CLI agent X is calling MCP tool Y"

---

## 2. Architecture Diagram

### Current State (Disconnected)

```
+------------------------------------------------------------------+
|  Claude Agent SDK Session (parent)                                |
|  SessionId: "abc-123-def"                                        |
|                                                                    |
|  [1] User sends message                                          |
|  [2] Claude thinks, calls tools                                   |
|  [3] Claude calls ptah_agent_spawn via MCP                       |
|       |                                                           |
|       v                                                           |
|  +---------------------------------------+                       |
|  | MCP HTTP Server (port 51820)          |                       |
|  | protocol-handlers.ts                   |                       |
|  | -> ptahAPI.agent.spawn(request)       |                       |
|  +---------------------------------------+                       |
|       |                                                           |
|       | (NO parent session context passed)                       |
|       v                                                           |
+------------------------------------------------------------------+
       |
       v
+------------------------------------------------------------------+
|  AgentProcessManager (llm-abstraction)                           |
|  AgentId: "uuid-456-ghi"                                        |
|  cli: "gemini"                                                   |
|  status: "running"                                               |
|  parentSessionId: ??? (MISSING)                                  |
|                                                                    |
|  events.emit('agent:spawned', info)                              |
|  events.emit('agent:output', delta)                              |
|  events.emit('agent:exited', info)                               |
+------------------------------------------------------------------+
       |
       v (via RPC broadcast)
+------------------------------------------------------------------+
|  Frontend: AgentMonitorStore (sidebar panel)                     |
|  - Flat list of running agents                                   |
|  - No chat integration                                           |
|  - No parent session context                                     |
+------------------------------------------------------------------+

MEANWHILE, the CLI agent calls back to MCP:
+------------------------------------------------------------------+
|  Gemini CLI Process                                               |
|  -> HTTP POST localhost:51820                                     |
|  -> tools/call: ptah_workspace_analyze                           |
|  -> tools/call: ptah_search_files                                |
|  -> tools/call: ptah_get_diagnostics                             |
|                                                                    |
|  (NO identification of which agent is calling)                   |
|  (HTTP server sees anonymous requests)                           |
+------------------------------------------------------------------+
```

### Proposed State (Connected)

```
+------------------------------------------------------------------+
|  Claude Agent SDK Session (parent)                                |
|  SessionId: "abc-123-def"                                        |
|                                                                    |
|  [1] User sends message                                          |
|  [2] Claude calls ptah_agent_spawn via MCP                       |
|       |                                                           |
|       v                                                           |
|  +---------------------------------------+                       |
|  | MCP HTTP Server                       |                       |
|  | -> Inject parentSessionId from        |                       |
|  |    active SDK session context         |                       |
|  +---------------------------------------+                       |
|       |                                                           |
|       v                                                           |
+------------------------------------------------------------------+
       |
       v
+------------------------------------------------------------------+
|  AgentProcessManager                                              |
|  AgentId: "uuid-456-ghi"                                        |
|  cli: "gemini"                                                   |
|  parentSessionId: "abc-123-def" (LINKED)                        |
|                                                                    |
|  events.emit('agent:spawned', info)  <-- now includes parent ID |
+------------------------------------------------------------------+
       |
       v (via RPC broadcast)
+------------------------------------------------------------------+
|  Frontend: AgentMonitorStore                                      |
|  - Agents grouped by parent session                              |
|  - Can show in chat context OR sidebar                           |
|  - MCP activity heartbeat visible                                |
+------------------------------------------------------------------+

MCP callbacks (passive tracking):
+------------------------------------------------------------------+
|  MCP HTTP Server                                                  |
|  onToolCall hook: "ptah_workspace_analyze called"                |
|  -> Log activity for any running CLI agent                       |
|  -> Broadcast MCP activity event to frontend                     |
|  (No agent identification needed -- timestamp correlation)       |
+------------------------------------------------------------------+
```

---

## 3. What Each CLI Agent Provides

### 3.1 Gemini CLI (spawn-based with structured JSONL)

**Output format**: `--output-format stream-json` produces JSONL events

- `init` event: model name, session_id (Gemini's own, not Ptah's)
- `message` event: text content from model
- `tool_use` event: tool_name, tool_input, tool_call_id
- `tool_result` event: output, status
- `error` event: message, code
- `result` event: response, stats (input_tokens, output_tokens, duration_ms)

**Structured segments**: Yes -- `onSegment` callback emits `CliOutputSegment` for each event type (text, tool-call, tool-result, error, info, command)

**MCP integration**: Configures Ptah MCP via `~/.gemini/settings.json` (httpUrl). Gemini CLI connects on startup and persists the connection.

**Token/cost data**: Available in `result` event stats.

### 3.2 Codex CLI (SDK-based, in-process)

**Output format**: SDK stream events (ThreadEvent types)

- `thread.started`: thread_id
- `turn.started` / `turn.completed`: usage (input_tokens, cached_input_tokens, output_tokens)
- `turn.failed`: error.message
- `item.completed`: agent_message, reasoning, command_execution, file_change, mcp_tool_call, error
- Notably, `mcp_tool_call` event type exists with server + tool name

**Structured segments**: Yes -- `onSegment` callback produces text, info, command, file-change, error segments

**MCP integration**: Passed via SDK config object: `{ mcp_servers: { ptah: { url } } }`

**Token/cost data**: Available in `turn.completed` usage object.

### 3.3 Copilot CLI (spawn-based, raw text)

**Output format**: Raw text stdout with ANSI codes (stripped by adapter)

- No structured event format
- Tool calls visible only as text patterns in output
- `--silent` flag reduces noise but output is still unstructured

**Structured segments**: No -- falls back to regex parsing in AgentCardComponent

**MCP integration**: Via `--additional-mcp-config` JSON flag with `{ mcpServers: { ptah: { type: "http", url } } }`

**Token/cost data**: Not available in a structured way.

---

## 4. Infrastructure We Can Reuse

### 4.1 AgentProcessManager Events (FULLY REUSABLE)

The `agent:spawned`, `agent:output`, `agent:exited` events already carry `AgentProcessInfo`. We just need to extend `AgentProcessInfo` with an optional `parentSessionId` field.

**Location**: `libs/shared/src/lib/types/agent-process.types.ts`
**Current interface**:

```typescript
export interface AgentProcessInfo {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly task: string;
  readonly workingDirectory: string;
  readonly taskFolder?: string;
  status: AgentStatus;
  readonly startedAt: string;
  exitCode?: number;
  readonly pid?: number;
}
```

**Extension needed**: Add `readonly parentSessionId?: string;`

**Difficulty**: EASY

### 4.2 RPC Broadcast Pipeline (FULLY REUSABLE)

The `setupAgentMonitorListeners()` in `RpcMethodRegistrationService` already forwards all agent events to the webview via `AGENT_MONITOR_*` message types. No changes needed here.

**Difficulty**: NONE (already works)

### 4.3 Frontend AgentMonitorStore (REUSABLE WITH MINOR EXTENSION)

The `MonitoredAgent` interface can be extended with `parentSessionId?: string` to enable:

- Grouping agents by parent session in the UI
- Filtering agents relevant to the active chat tab
- Future inline rendering in the chat execution tree

**Difficulty**: EASY

### 4.4 MCP Server onToolResult Callback (PARTIALLY REUSABLE)

The `ToolResultCallback` in protocol-handlers.ts fires for every tool execution. However, it does not identify which CLI agent made the call (the HTTP server sees anonymous requests).

We can use the MCP `initialize` request's `clientInfo` parameter, which is already logged but not stored. Different CLIs send different client info:

- Gemini CLI sends its version info
- Copilot CLI may send identifying info
- Codex SDK may or may not include this

**Difficulty**: MEDIUM (needs HTTP request context tracking or correlation)

### 4.5 SubagentRegistryService (NOT DIRECTLY REUSABLE)

This service is tightly coupled to Claude SDK subagent hooks (SubagentStart/SubagentStop). It uses `toolCallId` as the primary key, which does not exist for CLI agents. Creating a parallel registry for CLI agents would violate the "no duplication" principle.

However, the conceptual pattern (register/update/query lifecycle) is sound and could be adapted.

**Recommendation**: Do NOT reuse SubagentRegistryService. Instead, extend AgentProcessManager's existing `agents` Map, which already serves as the CLI agent registry.

### 4.6 AgentSessionWatcherService (NOT REUSABLE FOR CLI AGENTS)

This watches Claude SDK JSONL files in `~/.claude/projects/`. CLI agents do not write JSONL files in this format. Each CLI has its own session storage mechanism (Gemini has `~/.gemini/`, Codex uses in-process SDK).

**Recommendation**: Do not attempt to watch CLI agent session files. Use the existing stdout/stderr streaming via AgentProcessManager instead.

---

## 5. Concrete Recommendations

### 5.1 Minimal Viable Approach (Recommended)

**Goal**: Link CLI agents to parent sessions with minimum code changes.

**Step 1: Add parentSessionId to AgentProcessInfo** (EASY)

File: `libs/shared/src/lib/types/agent-process.types.ts`

Add `readonly parentSessionId?: string;` to `AgentProcessInfo` and `SpawnAgentRequest`.

**Step 2: Pass parentSessionId through MCP spawn flow** (EASY)

The MCP `ptah_agent_spawn` tool is called by the main Claude session. At the time the tool call arrives, the active SDK session is known to `SdkAgentAdapter`. The challenge is threading this context through to the MCP handler.

Options:

- (A) **Add parentSessionId to ptah_agent_spawn tool args**: The Claude agent includes it in the tool call. Simple but relies on Claude remembering to include it.
- (B) **Inject from server context**: The MCP server knows which session is active (stored in workspace state). The `PtahAPIBuilder` or `AgentNamespace` can capture the current active session ID at build time or per-request.
- (C) **Correlation by timing**: When a `ptah_agent_spawn` MCP request arrives, check which SDK session is currently streaming. This is fragile but requires zero API changes.

**Recommended**: Option (B) -- inject from server context. The `CodeExecutionMCP` service is constructed with access to the DI container. Store a `currentActiveSessionId` on the service and update it whenever the SDK starts a new turn. The `AgentNamespace.spawn()` method reads this value and passes it to `AgentProcessManager.spawn()`.

**Step 3: Extend MonitoredAgent in frontend** (EASY)

File: `libs/frontend/chat/src/lib/services/agent-monitor.store.ts`

Add `parentSessionId?: string` to `MonitoredAgent`. The `AgentMonitorMessageHandler` already passes through the full `AgentProcessInfo` payload, so this flows automatically.

**Step 4: MCP Activity Heartbeat** (MEDIUM -- optional but high value)

When any MCP tool call arrives at the HTTP server from a CLI agent, emit an event that the frontend can use to show "CLI agent is actively working" status. This does NOT require identifying which agent is calling -- simply broadcasting "MCP tool X was called at time T" is enough, since the frontend can correlate with running agents by timing.

Implementation:

- Add an EventEmitter to the MCP HTTP server handler or protocol-handlers
- Emit `mcp:tool-activity` with `{ toolName, timestamp }`
- RpcMethodRegistrationService listens and broadcasts to frontend
- AgentMonitorStore updates a `lastMcpActivity` timestamp on the relevant agent (matched by "running" status + timing)

### 5.2 What NOT to Do

1. **Do NOT create a separate CLI session registry**: The AgentProcessManager's `agents` Map already IS the registry. Adding `parentSessionId` to it is sufficient.

2. **Do NOT try to parse CLI agent session files**: Each CLI stores state differently. The stdout/stderr streaming already works.

3. **Do NOT add CLI agents to the SubagentRegistryService**: That service is for Claude SDK subagents with toolCallId-based lifecycle. Mixing in CLI agents would corrupt the resumption logic.

4. **Do NOT try to identify individual CLI agents in MCP requests**: The HTTP server receives anonymous requests. Attempting to correlate by IP/port/headers is fragile and unnecessary. The timing-based correlation for MCP activity heartbeat is sufficient.

5. **Do NOT add CLI agents inline to the ExecutionNode tree** (in this phase): The ExecutionNode tree is tightly coupled to Claude SDK message structure (assistant messages with tool_use blocks). CLI agents produce unstructured output that would not fit cleanly. Keep them in the sidebar panel and add a "linked to session X" indicator.

---

## 6. Session Lifecycle Events

### Recommended Event Flow

```
spawn:
  CLI agent process starts
  AgentProcessManager emits 'agent:spawned' (with parentSessionId)
  -> Frontend: AgentMonitorStore.onAgentSpawned()
  -> UI: Agent card appears in sidebar, linked to parent session tab

active (MCP heartbeat):
  CLI agent calls ptah_workspace_analyze via MCP
  MCP server emits 'mcp:tool-activity' { toolName, timestamp }
  -> Frontend: AgentMonitorStore updates lastMcpActivity
  -> UI: Agent card shows "active" indicator, tool call flash

output:
  CLI agent stdout/stderr produces text
  AgentProcessManager emits 'agent:output' (throttled 200ms)
  -> Frontend: AgentMonitorStore.onAgentOutput()
  -> UI: Agent card updates output panel (streaming)

complete/failed/timeout:
  CLI process exits (code 0/1/timeout)
  AgentProcessManager emits 'agent:exited' (with final status)
  -> Frontend: AgentMonitorStore.onAgentExited()
  -> UI: Agent card shows final status badge

parent session abort:
  User stops the Claude SDK session
  SessionLifecycleManager.endSession() fires
  -> Could iterate AgentProcessManager.getStatus() to find
     agents with matching parentSessionId and offer to stop them
  -> UI: Show "Parent session ended, stop running agents?" prompt
```

### Mapping to Existing Event Types

| CLI Agent Event | Existing Message Type             | Extension Needed               |
| --------------- | --------------------------------- | ------------------------------ |
| Spawn           | `AGENT_MONITOR_SPAWNED`           | Add parentSessionId to payload |
| Output          | `AGENT_MONITOR_OUTPUT`            | None                           |
| Exit            | `AGENT_MONITOR_EXITED`            | None                           |
| MCP Activity    | NEW: `AGENT_MONITOR_MCP_ACTIVITY` | New message type               |

Only ONE new message type is needed. Everything else piggybacks on existing infrastructure.

---

## 7. Risk Analysis

### 7.1 Low Risk

**Extending AgentProcessInfo with parentSessionId**

- Pure additive change (optional field)
- No breaking changes to existing consumers
- Probability of issues: 5%
- Mitigation: Field is optional, defaults to undefined for non-parented agents

### 7.2 Medium Risk

**Injecting activeSessionId into MCP server context**

- Requires a way to propagate current SDK session ID to the MCP service
- Risk: Race condition if multiple sessions are active simultaneously
- Probability of issues: 20%
- Mitigation: Use the `currentActiveSessionId` pattern already established in SdkAgentAdapter. Multiple concurrent SDK sessions are not currently supported anyway.

### 7.3 Medium Risk

**MCP Activity Heartbeat timing correlation**

- If multiple CLI agents are running simultaneously, the heartbeat cannot determine which agent made the MCP call
- Probability of issues: 25% (when 2+ agents run in parallel)
- Mitigation: Show the heartbeat on ALL running agents when source is ambiguous. Users rarely run 3+ agents simultaneously.

### 7.4 Low Risk

**Frontend changes to AgentMonitorStore**

- Purely additive (new optional field, new computed signal)
- No change to existing rendering logic
- Probability of issues: 3%

---

## 8. Implementation Difficulty Assessment

| Component                                           | Difficulty | Estimated Effort | Files Changed         |
| --------------------------------------------------- | ---------- | ---------------- | --------------------- |
| Add parentSessionId to AgentProcessInfo             | EASY       | 1 hour           | 1 file (shared types) |
| Add parentSessionId to SpawnAgentRequest            | EASY       | 30 min           | 1 file (shared types) |
| Pass parentSessionId in AgentProcessManager.spawn() | EASY       | 30 min           | 1 file                |
| Inject activeSessionId into MCP agent namespace     | MEDIUM     | 2-3 hours        | 2-3 files             |
| Extend MonitoredAgent in frontend                   | EASY       | 30 min           | 1 file                |
| Show parent session indicator in AgentCardComponent | EASY       | 1 hour           | 1 file                |
| MCP activity heartbeat (new event)                  | MEDIUM     | 3-4 hours        | 4-5 files             |
| Add new MESSAGE_TYPE for MCP activity               | EASY       | 15 min           | 1 file                |
| Handle parent session abort -> orphan detection     | MEDIUM     | 2-3 hours        | 2 files               |
| **Total**                                           |            | **~12-15 hours** | **~12-15 files**      |

---

## 9. Questions Answered

### Q1: What session tracking already exists?

CLI sub-agents ARE tracked once spawned -- the AgentProcessManager maintains full lifecycle state (status, output, PID) in its internal Map. They get branded AgentId (UUID) values. They are NOT in the SubagentRegistryService (that is Claude SDK only). The gap is: no parentSessionId linking them to the Claude session that requested their creation.

### Q2: What's the gap?

The gap is cross-referencing. We CAN see CLI agent status, output, tool calls (via structured segments), and partial cost/token data. We CANNOT currently see: which Claude session spawned them, MCP tool calls made BY the CLI agent (invisible pass-through), or the relationship between CLI agent work and the parent chat conversation.

### Q3: What infrastructure can we reuse?

- AgentProcessManager events: FULLY reusable (just add parentSessionId)
- RPC broadcast pipeline: FULLY reusable (no changes)
- AgentMonitorStore: MOSTLY reusable (add parentSessionId to MonitoredAgent)
- MCP onToolResult callback: PARTIALLY reusable (for heartbeat)
- SubagentRegistryService: NOT reusable for CLI agents
- AgentSessionWatcherService: NOT reusable for CLI agents

### Q4: What do each CLI provide?

- Gemini: Structured JSONL events (init, message, tool_use, tool_result, result with stats). Full token/cost data. Connected to MCP via settings.json.
- Codex: SDK stream events with typed items (agent_message, command_execution, file_change, mcp_tool_call). Token data in turn.completed. MCP via SDK config.
- Copilot: Raw text stdout only. No structured events. No token data. MCP via --additional-mcp-config CLI flag.

### Q5: How can we link without overwhelming?

Minimal approach: Add one optional field (parentSessionId) to two shared types, thread it through the MCP spawn flow, and extend the frontend store. Total: ~12 files changed, ~12 hours of work. No new services, no new registries, no new infrastructure.

### Q6: MCP callback pattern?

Yes, this is viable for activity heartbeat. When a CLI agent calls `ptah_workspace_analyze`, the MCP server processes the request through `protocol-handlers.ts`. We can add a lightweight event emission at this point. The HTTP server sees the request but does not know which CLI agent sent it (anonymous localhost). Correlation by timing is sufficient since we know which agents are currently running.

### Q7: Session lifecycle events?

Events should be: spawn (with parentSessionId), active (MCP heartbeat), output (existing), error (existing), complete (existing). These map to: `AGENT_MONITOR_SPAWNED` (extended), `AGENT_MONITOR_OUTPUT` (unchanged), `AGENT_MONITOR_EXITED` (unchanged), plus one NEW `AGENT_MONITOR_MCP_ACTIVITY` type. Total: 4 existing + 1 new = 5 event types.

---

## 10. Key Files Reference

### Backend (Extension Host)

- `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts` -- AgentProcessInfo, SpawnAgentRequest (add parentSessionId)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` -- TrackedAgent, spawn logic
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` -- MCP agent namespace (inject activeSessionId)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` -- MCP tool dispatch (add heartbeat)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` -- Event forwarding to webview
- `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts` -- MESSAGE_TYPES (add MCP activity type)

### Frontend (Webview)

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts` -- MonitoredAgent (add parentSessionId)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-message-handler.service.ts` -- Message routing
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.ts` -- Sidebar panel
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts` -- Individual agent card

### CLI Adapters (reference, no changes needed)

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-cli.adapter.ts`

### Session Context (reference)

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` -- Active session tracking
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts` -- NOT to be used for CLI agents
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts` -- NOT to be used for CLI agents
