# Batch 10d.L2 report

## Changes

- `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.ts:14,103,120`: the strict Ptah server schema and builder now require/send `default_tools_approval_mode: 'approve'`. Disabled user servers remain `{ enabled: false }`; `approval_policy`, sandbox and profile fingerprint inputs were untouched.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.ts:90-94`: a failed tool with a null or absent output displays its bounded `errorText`; blank or missing text displays `Tool call failed` instead of `null`. Other output serialization remains unchanged.

## Decisions

- The protocol schema defines `default_tools_approval_mode` on `AppConfig` at `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:7246,7258-7266` and references `AppToolApproval`. Its enum at `:7701-7708` permits exactly `auto`, `prompt`, `writes`, and `approve`. Per-server syntax is demonstrated by `libs/backend/codex-runtime/tools/evidence-harness.ts:1425,2014-2018`, which sends and reads `mcp_servers.marker.default_tools_approval_mode="prompt"`.
- Chose `approve` to request running Ptah MCP tools without asking. **The schema does not describe the values' behavior or declare the `mcp_servers` config table, so it does not prove that `approve` suppresses prompts for an MCP server.** This is an explicit inference from the enum name and harness key shape; a real Codex lane run is needed to confirm it.
- `buildCodexThreadConfig` calls the lane builder at `libs/backend/codex-runtime/src/lib/codex-mcp-config.ts:177-198`; `CodexRuntime.open` calls it at `codex-runtime.ts:91`. `RuntimeContext.open` places its output in `config` at `codex-context.ts:231-245` and sends the same parsed params to `thread/resume` at `:246-250` or `thread/start` at `:251`. Thus resume receives the same approval setting.
- The App Server MCP item permits null `result` and an `error` at `codex-app-server-protocol.schema.json:22678-22686,22721-22729`; `McpToolCallError.message` is required at `:15485-15494`. The translator exposes it as bounded `errorText` at `codex-event-translator.ts:395-413` and the runtime event declares that field at `codex-runtime.types.ts:237-245`.

## Specs

- `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.spec.ts:46-97,169-179`: exact Ptah config includes `approve`, user servers remain disabled, no Ptah omits `mcp_servers`, and schema rejects `prompt` for Ptah.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.spec.ts:120-160`: failed MCP calls with null results display the App Server error or the fixed fallback.

## Not done

- No tests, typecheck, lint, build, Nx, npm, diagnostics, live Codex process, or network call was run, as required. The coordinator must verify the behavior under a real lane. Scoped diff and byte inspection confirmed only the intended source/spec edits, LF line endings, and UTF-8 without BOM.
