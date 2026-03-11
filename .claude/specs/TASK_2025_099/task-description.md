# Requirements Document - TASK_2025_099

## Introduction

This document defines the requirements for implementing real-time subagent text streaming by integrating SDK hooks (`SubagentStart`/`SubagentStop`) with the existing `AgentSessionWatcherService`. The business value is enabling users to see subagent progress in real-time during complex multi-agent workflows, improving transparency and user experience during orchestrated task execution.

**Context**: The Ptah extension uses Claude Agent SDK which launches subagents via the Task tool. Currently, subagent text content is NOT streamed to the UI because the watcher service is never activated. This task connects the existing 90% complete infrastructure to SDK lifecycle hooks.

---

## Requirements

### Requirement 1: SDK Subagent Hook Integration

**User Story:** As a developer using Ptah with multi-agent workflows, I want subagent text to stream in real-time as agents work, so that I can monitor progress and understand what each agent is doing.

#### Acceptance Criteria

1. WHEN a `SubagentStart` hook event is received from SDK THEN the system SHALL call `AgentSessionWatcherService.startWatching()` with the agent's context
2. WHEN a `SubagentStop` hook event is received from SDK THEN the system SHALL call `AgentSessionWatcherService.stopWatching()` for that specific agent
3. WHEN `SubagentStart` fires THEN the watcher SHALL begin monitoring for agent JSONL files within 100ms
4. WHEN multiple agents start concurrently THEN each agent SHALL have an independent watch entry tracked by agent_id
5. WHEN agent_id is provided in `SubagentStart` THEN the watcher SHALL use pattern `agent-{agent_id}.jsonl` for early file detection

---

### Requirement 2: Multiple Parallel Subagent Support

**User Story:** As a power user running complex orchestrations, I want the system to handle many concurrent subagents without hardcoded limits, so that my workflows are not artificially constrained.

#### Acceptance Criteria

1. WHEN N subagents start simultaneously THEN the system SHALL track all N agents independently using a Map data structure
2. WHEN adding a new agent watch THEN there SHALL be no hardcoded upper limit on concurrent agents
3. WHEN 10+ agents are running concurrently THEN directory watching SHALL remain efficient (single watcher, O(1) event handling)
4. WHEN any agent completes THEN only that agent's watch SHALL be cleaned up (other watches continue)
5. WHEN the last agent completes THEN the directory watcher SHALL stop to conserve resources

---

### Requirement 3: Early Detection via Pattern Matching

**User Story:** As a user watching agent progress, I want streaming to begin as soon as possible after an agent starts, so that I see content immediately rather than waiting until the agent completes.

#### Acceptance Criteria

1. WHEN `SubagentStart` fires THEN the watcher SHALL immediately begin monitoring for agent files (before `transcript_path` is known)
2. WHEN an agent file is created matching pattern `agent-{agent_id}.jsonl` THEN it SHALL be detected and matched to the pending watch within 200ms
3. WHEN file detection occurs before watch registration THEN the pending file SHALL be cached and matched when watch starts (within 30 seconds)
4. WHEN the agent_id from `SubagentStart` matches a detected file THEN streaming SHALL begin immediately
5. WHEN no agent_id is available THEN the watcher SHALL fall back to session_id matching with time correlation

---

### Requirement 4: Main Agent to Subagent Correlation

**User Story:** As a user viewing the execution tree, I want subagent summaries to appear under the correct parent Task tool call, so that the UI hierarchy matches the actual execution flow.

#### Acceptance Criteria

1. WHEN a Task tool_use is detected in the main stream THEN the system SHALL record the tool_use_id for later correlation
2. WHEN `SubagentStop` fires with `tool_use_id` THEN the system SHALL associate all streaming chunks with that parent tool call
3. WHEN emitting summary chunks THEN each chunk SHALL include the `toolUseId` for frontend correlation
4. WHEN multiple Task tools run in parallel THEN each SHALL maintain its own correlation independently
5. WHEN a Task tool completes THEN all associated agent chunks SHALL have been routed to the correct UI node

---

### Requirement 5: Real-time Text Streaming

**User Story:** As a developer monitoring agent work, I want to see text content appear progressively as the agent writes, so that I can follow the agent's reasoning and progress.

#### Acceptance Criteria

1. WHEN new text blocks appear in agent JSONL file THEN they SHALL be emitted as `summary-chunk` events within 200ms
2. WHEN text is extracted THEN only `text` type blocks from `assistant` messages SHALL be included (not tool_use blocks)
3. WHEN chunks are emitted THEN they SHALL contain `toolUseId` and `summaryDelta` fields
4. WHEN the webview receives `AGENT_SUMMARY_CHUNK` THEN it SHALL append the delta to the appropriate ExecutionNode
5. WHEN streaming is active THEN file tailing SHALL poll at 200ms intervals for new content

---

## Non-Functional Requirements

### Performance Requirements

- **Detection Latency**: Agent file detection within 200ms of file creation
- **Streaming Latency**: New text blocks emitted within 200ms of file write
- **Memory Overhead**: Less than 10MB additional memory for 10 concurrent agents
- **CPU Impact**: Directory watcher SHALL use native fs.watch (not polling) for efficiency
- **Scaling**: System SHALL handle 20+ concurrent agents without performance degradation

### Scalability Requirements

- **No Hardcoded Limits**: Agent count limited only by system resources
- **Dynamic Resource Management**: Directory watcher lifecycle tied to active watch count
- **Efficient Cleanup**: Agent cleanup O(1) using Map-based tracking
- **Shared Watcher**: Single directory watcher serves all concurrent agents

### Reliability Requirements

- **Graceful Degradation**: If agent file not found, watch SHALL timeout after 60 seconds without error
- **Error Isolation**: One agent's error SHALL NOT affect other agents' streaming
- **Resource Cleanup**: All watches and intervals SHALL be cleaned up on extension deactivation
- **Edge Case Handling**: Handle files created before watch starts (pending file cache)

### Maintainability Requirements

- **Logging**: All lifecycle events (start, stop, match, emit) SHALL be logged at debug level
- **Error Context**: Errors SHALL include agent_id, session_id, and file path for debugging
- **Testability**: Core logic SHALL be unit testable without file system access

---

## Out of Scope

The following items are explicitly NOT part of this task:

1. **Frontend UI changes** - The frontend handler already exists and handles `AGENT_SUMMARY_CHUNK`
2. **RPC handler changes** - The RPC listener for `summary-chunk` events already exists
3. **New message types** - Existing `AGENT_SUMMARY_CHUNK` message type is sufficient
4. **Session persistence** - Subagent streaming is ephemeral (display only during execution)
5. **Backward compatibility** - No legacy implementations to maintain
6. **Agent JSONL format changes** - Working with existing Claude CLI file format
7. **ExecutionNode modifications** - Frontend already handles chunk routing

---

## Dependencies

### Internal Dependencies

| Component                         | Location                                       | Status | Notes                                              |
| --------------------------------- | ---------------------------------------------- | ------ | -------------------------------------------------- |
| AgentSessionWatcherService        | `libs/backend/vscode-core/src/services/`       | Exists | 90% complete, needs hook integration               |
| SdkAgentAdapter                   | `libs/backend/agent-sdk/src/lib/`              | Exists | Needs hooks configuration in `buildQueryOptions()` |
| RpcMethodRegistrationService      | `apps/ptah-extension-vscode/src/services/rpc/` | Exists | Already listens to `summary-chunk` events          |
| MESSAGE_TYPES.AGENT_SUMMARY_CHUNK | `libs/shared/src/lib/types/message.types.ts`   | Exists | Defined as `'agent:summary-chunk'`                 |

### External Dependencies

| Component        | Package                          | Version | Notes                                         |
| ---------------- | -------------------------------- | ------- | --------------------------------------------- |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` | ^0.2.0  | Provides `SubagentStart`/`SubagentStop` hooks |
| Node.js fs.watch | built-in                         | -       | Directory watching                            |

### SDK Hook Types Reference

```typescript
// From Claude Agent SDK documentation

// SubagentStart - fires when subagent initializes
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
  agent_id: string; // Unique subagent identifier
  agent_type: string; // e.g., "software-architect"
};

// SubagentStop - fires when subagent completes
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string; // Path to JSONL (available at completion)
};

// BaseHookInput (common fields)
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
};
```

---

## Risk Assessment

### Technical Risks

| Risk                                         | Probability | Impact | Mitigation                                 |
| -------------------------------------------- | ----------- | ------ | ------------------------------------------ |
| SDK hook timing differs from documentation   | Medium      | High   | Test with real SDK, add defensive timing   |
| agent_id not available in SubagentStart      | Low         | High   | Fall back to session_id + time correlation |
| fs.watch unreliable on Windows               | Medium      | Medium | Already have scan fallback logic           |
| High-frequency file writes overwhelm watcher | Low         | Medium | Debounce file read (200ms polling already) |

### Integration Risks

| Risk                                              | Probability | Impact | Mitigation                                  |
| ------------------------------------------------- | ----------- | ------ | ------------------------------------------- |
| buildQueryOptions changes break existing behavior | Low         | High   | Add hooks without modifying other options   |
| Hook callback ordering assumptions                | Medium      | Medium | Log all events, verify order in tests       |
| Workspace path mismatch in sessions dir           | Low         | Medium | Existing path resolution logic handles this |

---

## Success Metrics

| Metric                   | Target               | Measurement Method                                       |
| ------------------------ | -------------------- | -------------------------------------------------------- |
| Detection Latency        | < 200ms              | Log timestamp diff between SubagentStart and first chunk |
| Streaming Latency        | < 200ms              | Log timestamp diff between file write and chunk emit     |
| Concurrent Agent Support | 10+                  | Integration test with parallel Task tools                |
| Memory Overhead          | < 10MB for 10 agents | Memory profiling during test                             |
| Zero Frontend Changes    | 0 files              | Git diff on frontend libraries                           |

---

## Implementation Notes for Architect

1. **Hook Registration Point**: `SdkAgentAdapter.buildQueryOptions()` must add `hooks` configuration to SDK query options

2. **Hook Callback Structure**: SDK expects callbacks in format:

   ```typescript
   hooks: {
     SubagentStart: [{ hooks: [callback] }],
     SubagentStop: [{ hooks: [callback] }]
   }
   ```

3. **Watcher Injection**: `AgentSessionWatcherService` is already injectable via `TOKENS.AGENT_SESSION_WATCHER_SERVICE`

4. **Correlation Strategy**: Use `agent_id` as primary key in `activeWatches` Map, with `tool_use_id` from `SubagentStop` for UI routing

5. **Existing Pattern**: `AgentSessionWatcherService.startWatching()` signature is:
   ```typescript
   startWatching(toolUseId: string, sessionId: string, workspacePath: string): Promise<void>
   ```
   May need adjustment to accept `agent_id` instead of/in addition to `toolUseId`
