# TASK_2025_157: Async Agent Orchestration Integration

## User Request

Add headless CLI agent support (Gemini CLI, Codex CLI) to the llm-abstraction library and MCP server. Instead of using CLI OAuth tokens for API calls (proven scope-insufficient in TASK_2025_156), run CLIs as headless background processes that Claude Agent SDK can delegate tasks to via MCP tools.

## Key Requirements

1. **MCP Tools**: `ptah.agent.spawn`, `ptah.agent.status`, `ptah.agent.read`, `ptah.agent.steer`, `ptah.agent.stop`
2. **Pattern**: Fire-and-Check + Shared Workspace using task-tracking folder
3. **CLI Detection**: Auto-detect installed CLIs (Gemini CLI, Codex CLI)
4. **User Choice**: Let user decide which CLI(s) to use when multiple available
5. **Orchestration Integration**: Work with existing orchestration skill and task-tracking folder
6. **Library Placement**: New capabilities go into llm-abstraction library

## Background Context

- TASK_2025_156 proved CLI OAuth tokens can't be reused for direct API calls (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT)
- All Google GenAI, OpenAI SDK providers, image generation, and CLI auth code were removed
- Current state: VS Code LM API is the only supported provider
- Build passes with 14/14 projects
- 71 uncommitted files from cleanup still pending commit

## Strategy

- **Type**: FEATURE
- **Flow**: PM -> Architect -> Team-Leader -> QA
- **Complexity**: Complex

## Created

2026-02-21
