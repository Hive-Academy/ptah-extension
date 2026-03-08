# Requirements Document - TASK_2025_157: Async Agent Orchestration Integration

## Introduction

Ptah is an AI coding orchestra for VS Code powered by Claude Agent SDK. Currently, Claude Agent SDK can only delegate work to the VS Code Language Model API via synchronous `ptah.ai.chat()` and `ptah.ai.invokeAgent()` calls -- the caller blocks until the delegated task completes. This limits Ptah to a single-threaded work model where Claude must wait for each sub-task to finish before proceeding.

This feature introduces **headless CLI agent support** by running Gemini CLI and Codex CLI as background processes that Claude Agent SDK can spawn, monitor, steer, and collect results from via new MCP tools. This enables a **fire-and-check** async delegation pattern: Claude spawns a CLI agent with a task, continues its own work, and periodically checks the agent's progress -- transforming Ptah from a single-agent orchestrator into a true multi-agent system.

### Business Value

- **Parallel Productivity**: Claude can delegate independent subtasks to Gemini/Codex CLI agents while continuing its own work, reducing total wall-clock time for complex features by 40-60%.
- **Model Diversity**: Users get access to multiple AI models (Gemini, GPT) without needing API keys -- leveraging the free-tier CLI tools they already have installed and authenticated.
- **Competitive Differentiation**: No other VS Code AI extension orchestrates multiple CLI-based AI agents as background workers. This positions Ptah as the only true multi-agent coding IDE.
- **Cost Efficiency**: Gemini CLI and Codex CLI are free to use within their rate limits, enabling users to offload routine tasks (reviews, test generation, documentation) to free agents while Claude handles architecture and complex implementation.

### Background

In TASK_2025_156, we attempted to reuse CLI OAuth tokens for direct API calls. This approach failed:

- Gemini CLI tokens returned 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT
- Codex CLI tokens (ChatGPT) are incompatible with the OpenAI API
- All Google GenAI, OpenAI SDK providers, image generation, and CLI auth code were removed

The current state: VS Code LM API is the only supported provider. The new approach treats CLIs as **opaque headless processes** rather than API credential sources.

## Requirements

### Requirement 1: CLI Agent Process Manager

**User Story:** As a developer using Ptah, I want Claude Agent SDK to spawn Gemini CLI or Codex CLI as headless background processes, so that multiple AI agents can work on different parts of my project simultaneously.

#### Acceptance Criteria

1. WHEN a CLI agent is spawned with a task description and working directory THEN the system SHALL launch the CLI binary as a child process in non-interactive/headless mode with stdout/stderr capture
2. WHEN a CLI agent process is spawned THEN the system SHALL assign a unique agent ID (branded type `AgentId`) and track the process handle, status, output buffer, start time, and task description
3. WHEN a CLI agent process exits (code 0) THEN the system SHALL mark the agent status as `completed` and capture the full output
4. WHEN a CLI agent process exits with a non-zero code THEN the system SHALL mark the agent status as `failed` and capture the error output
5. WHEN a CLI agent process exceeds its configured timeout (default: 10 minutes, max: 30 minutes) THEN the system SHALL terminate the process and mark the agent status as `timeout`
6. WHEN the VS Code extension deactivates THEN the system SHALL terminate all running agent processes gracefully (SIGTERM, then SIGKILL after 5s)
7. WHEN a CLI agent is spawned THEN the system SHALL pass the workspace root as the working directory so the agent has full project context
8. WHEN spawning a Gemini CLI agent THEN the system SHALL use `gemini` CLI with appropriate flags for non-interactive mode (e.g., `gemini -p "task" --non-interactive` or equivalent headless invocation)
9. WHEN spawning a Codex CLI agent THEN the system SHALL use `codex` CLI with appropriate flags for non-interactive mode (e.g., `codex --quiet "task"` or equivalent headless invocation)
10. WHEN the maximum concurrent agent limit (default: 3) is reached THEN the system SHALL reject new spawn requests with a clear error message indicating the limit

#### Library Placement

- **New service**: `AgentProcessManager` in `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- **New types**: `AgentId`, `AgentStatus`, `AgentProcessInfo`, `SpawnAgentRequest`, `AgentOutput` in `libs/shared/src/lib/types/agent-process.types.ts`
- **DI token**: `AGENT_PROCESS_MANAGER` added to `libs/backend/vscode-core/src/di/tokens.ts`

---

### Requirement 2: CLI Detection and Configuration

**User Story:** As a developer using Ptah, I want the extension to auto-detect which CLI agents I have installed, so that I can immediately use them without manual configuration.

#### Acceptance Criteria

1. WHEN the extension activates THEN the system SHALL detect installed CLIs by running `which gemini` and `which codex` (or `where` on Windows) and cache the results
2. WHEN a CLI is detected as installed THEN the system SHALL verify it is functional by running a lightweight version/help command (e.g., `gemini --version`, `codex --version`)
3. WHEN CLI detection completes THEN the system SHALL expose the results via the `ptah.agent` namespace so Claude Agent SDK knows which agents are available
4. WHEN both Gemini CLI and Codex CLI are installed AND a spawn request does not specify a preferred CLI THEN the system SHALL use a configurable default preference (VS Code setting `ptah.agentOrchestration.defaultCli`)
5. WHEN neither CLI is installed THEN the system SHALL return an empty list from `ptah.agent.list()` and spawn requests SHALL fail with a descriptive error recommending installation
6. WHEN a user changes the default CLI preference in VS Code settings THEN the system SHALL update the preference immediately without requiring extension restart
7. WHEN detecting CLIs THEN the system SHALL also detect and report the CLI version for diagnostic purposes

#### Library Placement

- **New service**: `CliDetectionService` in `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`
- **Configuration**: VS Code settings schema in `package.json` under `ptah.agentOrchestration.*`

---

### Requirement 3: MCP Tools for Agent Lifecycle Management

**User Story:** As Claude Agent SDK orchestrating a multi-agent workflow, I want MCP tools to spawn, monitor, steer, and stop CLI agents, so that I can delegate tasks and coordinate multiple agents working in parallel.

#### Acceptance Criteria

**ptah_agent_spawn**

1. WHEN `ptah_agent_spawn` is called with `{ task, cli?, workingDirectory?, timeout? }` THEN the system SHALL launch the specified (or default) CLI agent and return `{ agentId, cli, status: "running", startedAt }`
2. WHEN spawning an agent THEN the tool SHALL accept an optional `files` array listing files the agent should focus on, appended to the task prompt
3. WHEN the specified CLI is not installed THEN the tool SHALL return an error with installation instructions

**ptah_agent_status** 4. WHEN `ptah_agent_status` is called with `{ agentId }` THEN the system SHALL return `{ agentId, status, cli, task, startedAt, duration, exitCode? }` 5. WHEN `ptah_agent_status` is called without an agentId THEN the system SHALL return status for all tracked agents

**ptah_agent_read** 6. WHEN `ptah_agent_read` is called with `{ agentId, tail? }` THEN the system SHALL return the agent's stdout/stderr output, optionally limited to the last N lines 7. WHEN reading output from a running agent THEN the tool SHALL return whatever output has been captured so far (streaming buffer)

**ptah_agent_steer** 8. WHEN `ptah_agent_steer` is called with `{ agentId, instruction }` THEN the system SHALL write the instruction to the agent's stdin (if the CLI supports interactive steering) 9. WHEN the agent's CLI does not support stdin interaction THEN the tool SHALL return an error indicating steering is not supported for this CLI type

**ptah_agent_stop** 10. WHEN `ptah_agent_stop` is called with `{ agentId }` THEN the system SHALL send SIGTERM to the process, wait 5 seconds, then SIGKILL if still running, and mark the agent as `stopped` 11. WHEN `ptah_agent_stop` is called with an already-completed agent THEN the tool SHALL return the final status without error

#### MCP Tool Registration

Each tool SHALL be registered as a first-class MCP tool (like `ptah_workspace_analyze`) with:

- Tool description builder function in `tool-description.builder.ts`
- Direct handler in `protocol-handlers.ts` (no sandbox execution)
- Input schema with typed parameters

#### Library Placement

- **Tool definitions**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- **Tool handlers**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`
- **Types**: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (new `AgentNamespace` interface)

---

### Requirement 4: Ptah API Namespace for Agent Management

**User Story:** As a developer writing `execute_code` scripts via the Ptah MCP server, I want a `ptah.agent` namespace to manage CLI agents programmatically, so that I can build complex multi-agent workflows in code.

#### Acceptance Criteria

1. WHEN the `ptah.agent` namespace is accessed THEN it SHALL expose: `spawn()`, `status()`, `read()`, `steer()`, `stop()`, `list()`, `waitFor()`
2. WHEN `ptah.agent.list()` is called THEN it SHALL return available CLI agents with their installation status and version
3. WHEN `ptah.agent.waitFor(agentId, options?)` is called THEN it SHALL poll the agent status at a configurable interval (default: 2s) until the agent completes, fails, or the timeout expires
4. WHEN `ptah.agent.spawn()` is called via `execute_code` THEN the behavior SHALL be identical to calling the `ptah_agent_spawn` MCP tool directly
5. WHEN the `ptah` API help system is queried with `ptah.help('agent')` THEN it SHALL return documentation for all agent management methods

#### Library Placement

- **Namespace builder**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
- **Namespace types**: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (add `AgentNamespace` to `PtahAPI`)
- **Registration**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

---

### Requirement 5: Task-Tracking Folder as Shared Workspace

**User Story:** As Claude Agent SDK orchestrating a workflow, I want CLI agents to read and write files in the task-tracking folder, so that agents can receive detailed task instructions and produce deliverable files that I can review.

#### Acceptance Criteria

1. WHEN spawning an agent with a task THEN the system SHALL support an optional `taskFolder` parameter pointing to a task-tracking subfolder (e.g., `task-tracking/TASK_2025_157`)
2. WHEN a `taskFolder` is specified THEN the system SHALL include the folder path in the agent's task prompt so the agent knows where to read instructions and write outputs
3. WHEN a `taskFolder` is specified THEN the system SHALL append instructions to the agent's task prompt directing it to write deliverable files (implementation plans, code reviews, test results) into the task folder
4. WHEN an agent completes AND a `taskFolder` was specified THEN the system SHALL check the task folder for new or modified files and include a file manifest in the agent's completion status
5. WHEN Claude reads agent output THEN it SHALL be able to find deliverable files at known paths within the task folder (convention over configuration)

#### File Conventions

Agents SHALL be instructed to follow these output conventions:

- `{taskFolder}/agent-output-{agentId}.md` - Agent's main deliverable document
- `{taskFolder}/agent-{agentId}-files.txt` - List of files the agent created or modified
- These are suggestions in the prompt; agents may produce different outputs depending on the CLI's capabilities

---

### Requirement 6: System Prompt and Tool Documentation

**User Story:** As Claude Agent SDK, I want comprehensive documentation in the system prompt about agent management capabilities, so that I naturally discover and use multi-agent delegation in my workflows.

#### Acceptance Criteria

1. WHEN the MCP tool list is returned THEN each agent tool (`ptah_agent_spawn`, `ptah_agent_status`, `ptah_agent_read`, `ptah_agent_steer`, `ptah_agent_stop`) SHALL have descriptive tool descriptions explaining when and how to use them
2. WHEN the `execute_code` tool description is generated THEN it SHALL include the `ptah.agent` namespace in the API reference with usage examples
3. WHEN the PTAH_SYSTEM_PROMPT constant is generated THEN it SHALL include a section on multi-agent delegation patterns with examples of the fire-and-check workflow
4. WHEN the system prompt describes agent tools THEN it SHALL include workflow examples such as:
   - Spawning an agent for code review while Claude implements a feature
   - Spawning an agent for test generation while Claude writes implementation
   - Checking agent status and incorporating results
5. WHEN the help system is queried with `ptah.help('agent')` THEN it SHALL return a complete guide to agent management methods with code examples

---

## Non-Functional Requirements

### Performance Requirements

- **Agent Spawn Latency**: CLI agent process SHALL launch within 2 seconds of `ptah_agent_spawn` being called
- **Status Check Latency**: `ptah_agent_status` SHALL return within 50ms (in-memory lookup, no I/O)
- **Output Read Latency**: `ptah_agent_read` SHALL return within 100ms for output buffers up to 1MB
- **Memory Overhead**: Each tracked agent SHALL consume no more than 10MB of memory for output buffering (older output lines discarded with FIFO when buffer limit reached)
- **Concurrent Agents**: System SHALL support at least 3 concurrent CLI agent processes without degraded performance

### Security Requirements

- **Process Isolation**: CLI agents SHALL run as child processes of the VS Code extension host with the same user permissions -- no privilege escalation
- **Input Sanitization**: Task descriptions passed to CLI agents SHALL be sanitized to prevent shell injection (no backtick or `$()` expansion in arguments)
- **Working Directory Restriction**: Agent working directories SHALL be validated to be within the VS Code workspace root or its subdirectories
- **No Credential Exposure**: The system SHALL NOT pass any API keys, tokens, or secrets to CLI agent processes -- they use their own authentication
- **Output Sanitization**: Agent output SHALL be sanitized before display to prevent XSS in the webview

### Reliability Requirements

- **Graceful Cleanup**: Extension deactivation SHALL terminate all running agents within 10 seconds
- **Zombie Prevention**: The system SHALL monitor child processes and clean up orphaned processes on startup
- **Error Recovery**: If a CLI agent crashes, the system SHALL capture the exit code and last output, mark the agent as failed, and allow the orchestrator to retry or reassign
- **State Persistence**: Agent tracking state SHALL NOT be persisted across VS Code restarts (agents are ephemeral by design)

### Scalability Requirements

- **Agent Limit**: Configurable max concurrent agents (default: 3) to prevent resource exhaustion
- **Output Buffer**: Rolling buffer with configurable size (default: 1MB per agent) to prevent memory leaks from verbose agent output
- **Future CLI Support**: Architecture SHALL allow adding new CLI agents (e.g., Claude CLI, Aider CLI) by implementing a simple `CliAdapter` interface without modifying core process management

## Success Metrics

| Metric                              | Target                                               | Measurement Method                                            |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Agent Spawn Success Rate            | > 95% for installed CLIs                             | Count successful spawns / total spawn attempts                |
| Agent Task Completion Rate          | > 80% (non-timeout)                                  | Count completed agents / total spawned agents                 |
| E2E Latency (spawn to status check) | < 3 seconds                                          | Measure time from spawn call to first successful status check |
| CLI Detection Accuracy              | 100% for installed CLIs                              | Verify detection matches manual `which` checks                |
| Concurrent Agent Stability          | 3 agents, 10 min runtime, 0 crashes                  | Stress test with 3 simultaneous agents                        |
| System Prompt Adoption              | Claude uses agent tools in > 50% of multi-file tasks | Analyze tool call logs for agent namespace usage              |

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                     | Impact Level | Involvement                   | Success Criteria                                |
| ------------------------------- | ------------ | ----------------------------- | ----------------------------------------------- |
| End Users (Developers)          | High         | Testing, feedback             | Can spawn and monitor CLI agents from Ptah chat |
| Claude Agent SDK (Orchestrator) | High         | Primary consumer of MCP tools | Successfully delegates subtasks to CLI agents   |
| Extension Maintainers           | Medium       | Implementation, maintenance   | Clean architecture following existing patterns  |

### Secondary Stakeholders

| Stakeholder                           | Impact Level | Involvement                   | Success Criteria                                            |
| ------------------------------------- | ------------ | ----------------------------- | ----------------------------------------------------------- |
| CLI Tool Maintainers (Google, OpenAI) | Low          | Indirect -- CLI compatibility | Ptah respects CLI conventions and doesn't abuse rate limits |
| VS Code Marketplace Users             | Medium       | Discovery, adoption           | Feature is well-documented and easy to use                  |

## Risk Assessment

| Risk                                                                    | Probability | Impact | Score | Mitigation Strategy                                                                                                       |
| ----------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| CLI headless mode flags change between versions                         | Medium      | High   | 6     | Abstract CLI invocation behind `CliAdapter` interface; version-specific flag mapping; fallback to `--help` parsing        |
| CLI rate limiting disrupts agent tasks                                  | Medium      | Medium | 4     | Document rate limits; implement backoff; expose rate limit errors to orchestrator                                         |
| Agent output parsing unreliable (CLIs output ANSI codes, progress bars) | High        | Medium | 6     | Strip ANSI escape codes; capture raw output; let orchestrator interpret results                                           |
| Windows process management differs from Unix (signals, pipes)           | Medium      | High   | 6     | Use Node.js `child_process` with `{shell: true}` on Windows; test on both platforms; use `taskkill` instead of SIGTERM    |
| CLI agents modify workspace files unexpectedly                          | Medium      | High   | 6     | Document that agents have full workspace access; recommend using git branches; consider `--dry-run` flags where available |
| Memory leak from long-running agent output buffers                      | Low         | Medium | 3     | Implement rolling buffer with size limit; monitor memory usage; auto-cleanup completed agents after configurable TTL      |

## Dependencies

### Internal Dependencies

| Dependency          | Library           | Purpose                                       |
| ------------------- | ----------------- | --------------------------------------------- |
| `TOKENS` namespace  | `vscode-core`     | DI token for `AGENT_PROCESS_MANAGER`          |
| `Logger`            | `vscode-core`     | Structured logging for agent lifecycle events |
| `PtahAPI` interface | `vscode-lm-tools` | Adding `agent` namespace to API surface       |
| `MCPToolDefinition` | `vscode-lm-tools` | Tool definition pattern for new MCP tools     |
| `shared` types      | `shared`          | Branded `AgentId` type, agent status enums    |

### External Dependencies

| Dependency              | Version  | Purpose                              |
| ----------------------- | -------- | ------------------------------------ |
| Node.js `child_process` | Built-in | Spawning CLI agent processes         |
| Gemini CLI              | Latest   | Google Gemini agent (user-installed) |
| Codex CLI               | Latest   | OpenAI Codex agent (user-installed)  |

## Out of Scope

The following items are explicitly excluded from this task:

1. **No OAuth Token Reuse**: We do NOT attempt to extract or reuse CLI OAuth tokens for direct API calls (proven impossible in TASK_2025_156)
2. **No Direct API Calls**: We do NOT make API calls to Google or OpenAI APIs -- we run the CLIs as processes
3. **No CLI Installation**: We do NOT install or update CLI tools -- we only detect what the user has installed
4. **No Agent-to-Agent Communication**: Agents cannot communicate directly with each other -- only through the shared task-tracking folder
5. **No Real-Time Streaming**: Agent output is buffered and polled, not streamed in real-time to the webview
6. **No Custom Agent Prompts**: We pass the task description to the CLI; we do NOT inject system prompts or custom instructions beyond the task and file context
7. **No Agent Authentication Management**: We do NOT manage CLI authentication -- users must authenticate with their CLIs independently (e.g., `gemini auth login`, `codex auth`)
8. **No Backward Compatibility with Removed Providers**: The removed Google GenAI, OpenAI SDK providers are NOT restored -- this is a completely new approach
9. **No Webview UI for Agent Management**: No dedicated UI panel for viewing/managing agents in this phase -- all interaction is via Claude Agent SDK through MCP tools
10. **No Persistent Agent State**: Agent tracking is ephemeral -- restarting VS Code clears all agent state

## Implementation Phases (Suggested)

### Phase 1: Foundation (Core Infrastructure)

- Shared types (`AgentId`, `AgentStatus`, `AgentProcessInfo`)
- `CliDetectionService` with cross-platform CLI detection
- `AgentProcessManager` with spawn, status, read, stop capabilities
- DI registration and token setup

### Phase 2: MCP Tool Integration

- Tool description builders for all 5 agent tools
- Protocol handler routing for agent tool calls
- `AgentNamespace` interface and builder for `ptah.agent`
- PtahAPI builder integration (namespace 16)

### Phase 3: Orchestration Integration

- Task folder shared workspace support
- System prompt updates with multi-agent delegation patterns
- Help system documentation for `ptah.help('agent')`
- Steering support for CLIs that accept stdin

### Phase 4: Testing and Hardening

- Unit tests for `AgentProcessManager`, `CliDetectionService`
- Integration tests with mock CLI processes
- Cross-platform testing (Windows + macOS/Linux)
- Edge case handling (timeouts, crashes, concurrent limits)

## Technical Notes

### CLI Headless Mode Research Required

Before implementation, the architect/researcher must verify:

- **Gemini CLI**: Exact flags for non-interactive/headless mode, stdin support for steering, output format
- **Codex CLI**: Exact flags for quiet/non-interactive mode, stdin support, output format
- **Both**: How they handle workspace context, file references, and task completion signals

### Existing Patterns to Follow

The implementation SHALL follow established codebase patterns:

- **MCP tool registration**: Follow the pattern in `tool-description.builder.ts` and `protocol-handlers.ts`
- **Namespace builders**: Follow the pattern in `llm-namespace.builder.ts` and other namespace builders
- **DI registration**: Follow the pattern in `vscode-core/src/di/tokens.ts` with token definitions in the `TOKENS` namespace
- **Branded types**: Follow the `SessionId`/`MessageId` pattern in `shared/src/lib/types/branded.types.ts`
- **Service architecture**: Injectable singleton services with constructor-injected dependencies via tsyringe

### CliAdapter Interface (Extensibility)

```typescript
interface CliAdapter {
  readonly name: string; // 'gemini' | 'codex'
  readonly displayName: string; // 'Gemini CLI' | 'Codex CLI'
  detect(): Promise<CliDetectionResult>;
  buildCommand(task: string, options: CliCommandOptions): CliCommand;
  supportsSteer(): boolean;
  parseOutput(raw: string): string; // Strip ANSI codes, progress bars, etc.
}
```

This interface ensures adding future CLIs (Claude CLI, Aider, etc.) requires only implementing a new adapter, not modifying core infrastructure.
