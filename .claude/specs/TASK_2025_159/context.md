# TASK_2025_159: CLI Agent MCP Server Access (Premium-Gated)

## User Request

Enable all three CLI subagents (Copilot, Gemini, Codex) to use the Ptah HTTP MCP server (ptah_workspace_analyze, ptah_search_files, ptah_get_diagnostics, LSP tools, agent orchestration tools) — gated to premium users only.

## Strategy: FEATURE (Partial Flow)

Requirements are clear from prior conversation and research. Skip PM, go Architect -> Team-Leader -> Developers -> QA.

## Priority Focus

1. **Copilot** (critical) — discovers MCP through VS Code IDE bridge, gets "Permission denied" in headless mode. Needs direct HTTP bypass validated end-to-end.
2. **Gemini** — needs `.gemini/settings.json` with `trust: true` for MCP config.
3. **Codex** — needs `.codex/config.toml` with server config.

## Current State

- Ptah HTTP MCP server: localhost:51820 (configurable via `ptah.mcpPort`)
- Claude SDK: already premium-gated MCP access in `sdk-query-options-builder.ts`
- Copilot adapter: has `--additional-mcp-config` + `--disable-mcp-server ptah` code, but still permission denied
- Gemini adapter: receives `mcpPort` in `CliCommandOptions` but never uses it
- Codex adapter: no MCP config at all
- `CliCommandOptions.mcpPort`: already added, passed from `AgentProcessManager`

## Research Findings (from background agent)

- Copilot ACP mode: NOT viable yet (GitHub Issue #1040 — MCP servers don't load in ACP sessions)
- Copilot `--additional-mcp-config`: correct approach, needs format validation
- Gemini: `httpUrl` key in `.gemini/settings.json` with `trust: true` bypasses all confirmation
- Codex: `config.toml` with `[mcp_servers.ptah]` section
- `readOnlyHint` annotations on 9 read-only tools: quick win for IDE bridge path
- Premium gating pattern: mirror `sdk-query-options-builder.ts` `buildMcpServers()` logic

## Key Files

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (premium gating reference)

## Constraints

- Premium-only (same pattern as Claude SDK MCP gating)
- mcpPort only passed when isPremium AND mcpServerRunning
- Windows compatible (cross-spawn, .cmd handling)
- Direct HTTP to localhost:51820 (bypass VS Code IDE bridge)
