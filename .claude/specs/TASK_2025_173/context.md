# TASK_2025_173: Per-CLI Rendering Pipelines for Agent Monitor Panel

## User Request

Design and implement per-CLI rendering pipelines for the agent monitor panel. Currently all 4 CLI types (Ptah CLI, Copilot, Gemini CLI, Codex) use the same generic agent card. Each CLI has unique JSON schemas and streaming types that need dedicated mapping from streaming content to Angular component display.

## Requirements

1. **Ptah CLI** — Reuse the same rich rendering pipeline as main Claude chat agent (Write tool with file paths, TodoWrite with progress bar, MCP tools with badges, expandable I/O)
2. **Copilot CLI** — Own rendering pipeline tailored to Copilot's streaming format
3. **Gemini CLI** — Own rendering pipeline tailored to Gemini's streaming format
4. **Codex CLI** — Own rendering pipeline (SDK-based, not CLI spawn)

## Strategy

- Type: FEATURE
- Workflow: Full (PM → Research → Architect → Team-Leader → QA)
- Complexity: Complex

## Status

- Phase: Research (understanding current codebase state)
