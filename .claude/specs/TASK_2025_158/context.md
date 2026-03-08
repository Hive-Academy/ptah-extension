# TASK_2025_158: Codex SDK Integration for Agent Orchestration

## User Request

Replace the current Codex CLI adapter (`codex --quiet` child process spawning) with the Codex SDK (`@openai/codex-sdk`) for the agent orchestration system (TASK_2025_157). This is NOT a top-level IAIProvider — it stays within the MCP-based agent orchestration (fire-and-check pattern via `ptah_agent_spawn`, `ptah_agent_status`, etc.).

Similar to how Gemini CLI works as a headless agent, but using the SDK instead of spawning a child process.

## IMPORTANT SCOPE CONSTRAINTS

- **NOT** an IAIProvider implementation
- **NOT** a top-level provider (no provider switching, no `ptah.provider` setting)
- **IS** a replacement for `child_process.spawn('codex', ['--quiet', task])` inside the agent orchestration system
- **STAYS** within `libs/backend/llm-abstraction/` alongside existing CLI adapters
- The architect should decide whether to keep the CliAdapter interface or create a new adapter type

## Strategy

**Type**: FEATURE
**Flow**: Architect → Team-Leader → Developers → QA
**Rationale**: Research is complete, requirements are clear from SDK docs.

## Key Technical Context

### Codex SDK API (`@openai/codex-sdk`)

- **Client**: `new Codex({ env, config })`
- **Threads**: `codex.startThread({ workingDirectory, skipGitRepoCheck })` / `codex.resumeThread(threadId)`
- **Execution**: `thread.run(input, { outputSchema })` (buffered) / `thread.runStreamed(input, { outputSchema })` (async generator)
- **Input**: String or `[{ type: "text", text }, { type: "local_image", path }]`
- **Events**: `item.completed` (with `item`), `turn.completed` (with `usage`)
- **Response**: `{ finalResponse, items }` on turn objects
- **Sessions**: Persisted in `~/.codex/sessions`, resumable

### Current Codex CLI Adapter (to be replaced/updated)

`libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`

- Fire-and-forget: `codex --quiet "task"` via child_process.spawn
- Uses `CliAdapter` interface
- Part of the agent orchestration system (TASK_2025_157)

### Agent Orchestration System (TASK_2025_157)

- `AgentProcessManager` spawns CLI agents, tracks processes, captures output
- MCP tools: `ptah_agent_spawn`, `ptah_agent_status`, `ptah_agent_read`, `ptah_agent_steer`, `ptah_agent_stop`
- `CliDetectionService` detects installed CLIs
- `CliAdapter` interface: `detect()`, `buildCommand()`, `supportsSteer()`, `parseOutput()`
- Currently spawns via `child_process.spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })`

### Key Files

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` — current CLI adapter
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts` — CliAdapter interface
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.utils.ts` — shared utilities
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` — Gemini adapter (reference)
- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` — process spawning
- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` — CLI detection
- `libs/shared/src/lib/types/agent-process.types.ts` — AgentId, CliType, AgentProcessInfo, etc.

### References

- SDK docs: https://developers.openai.com/codex/sdk
- SDK source: https://github.com/openai/codex/tree/main/sdk/typescript

## Dependencies

- TASK_2025_157 (Agent Orchestration) — in progress, provides CLI adapter infrastructure

## Created

2026-02-22
