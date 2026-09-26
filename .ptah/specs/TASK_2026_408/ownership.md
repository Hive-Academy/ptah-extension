# Ownership: translation proxy vs native Codex adapter vs CLI workspace proxy (TASK_2026_408)

Three paths can put a Codex (or other non-Anthropic) model behind a Ptah session. They are distinct entry surfaces with different responsibilities, not three independent engines. B owns a separate Codex loop. C delegates to a Ptah host session, and when that session's workspace provider is backed by a translation proxy, C inherits A's limits as well as its own.

| Path | Entry points | Host loop | Skills / commands source | Main limits |
| --- | --- | --- | --- | --- |
| A. Translation proxy | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts`; Codex subclass `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts` | Claude Agent SDK session built by `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`; the proxy only translates each Messages call | Project and local `.claude/` only; user tier dropped on localhost base URLs | Stateless upstream turns, fields stripped, reactive-only overflow handling |
| B. Native Codex adapter | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`; harness-sync target `libs/backend/harness-sync/src/lib/targets/rival-targets.ts` (`createCodexTarget`) | Codex SDK thread (`runStreamed`); Codex owns the loop | Skills `{ws}/.agents/skills`; commands unsupported; agents `{ws}/.codex/agents/*.toml`; harness-sync MCP `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`) | No steer or interrupt; curated static model list |
| C. CLI workspace proxy | `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` | Ptah `chat:start` turn via `ChatBridge`, driven by a flattened text prompt. With no `ptahCliId`, the host runs the workspace provider's SDK session (path A when that provider is proxied) | Whatever the Ptah session loads; caller `/commands` arrive as plain text | Caller tools, tool results and commands not honoured (TASK_2026_564_87a6) |

## A. Translation proxy (host-managed loop)

Which lane runs depends on `resolveUpstreamProtocol` (`translation-proxy-base.ts:643-647`, default `chat/completions`; Codex always `responses`, `codex-translation-proxy.ts:130-132`). A native `messages` lane relays bytes unchanged (`translation-proxy-base.ts:694-715`). The limits below apply to the translated lanes.

- User tier dropped: `settingSources` is `['project', 'local']` when `includesUserSettingSource(ANTHROPIC_BASE_URL)` is false (`sdk-query-options-builder.ts:1233-1237`). One `info` log discloses it at build time (`:1129-1133`, commit b0632f949).
- Stateless: every Responses request sends `store: false` and replays full history (`responses-request-translator.ts:154`). Reasoning items are not carried over between turns. Options are in `phase-3-options.md`.
- Stripped fields: `thinking`, `metadata` and `cache_control` on both lanes (`request-translator.ts:48-49`, `responses-request-translator.ts:128`). The Responses lane also sends no `tool_choice` (`responses-request-translator.ts:15`); the Chat Completions lane translates it (`request-translator.ts:82-85`).
- Chat Completions lane: no tool-name guard (the guard wraps only the Responses branch, `translation-proxy-base.ts:551-565` vs `:598-601`). Images in tool results are dropped: only text blocks survive (`request-translator.ts:281-305`).
- Images in tool results on the Responses lane: kept only where the provider opts in. The base default is `false` and images become text placeholders (`translation-proxy-base.ts:567-569`, `:726-728`, `responses-tool-output-images.ts`). Only Codex overrides it (`codex-translation-proxy.ts:148`).
- `[DONE]`-only streams: the stream translator finishes them as `end_turn` (or `tool_use`) (`responses-stream-translator.ts:314`, `:770`). The non-streaming collector rejects the same input (`responses-stream-collector.ts:134`). Kept because OpenAI-compatible gateways rely on it (plan R4).
- Overflow detection: the message patterns are Assumption A1 until live probe P7 is authorized (`responses-error-mapping.ts:62-72`, plan R5). Two inputs map to the host's prompt-too-long contract when they carry a `context_length_exceeded` code or a matching message: an upstream HTTP error body with status 400 or 413 (`responses-error-mapping.ts:189-211`; other statuses keep the existing error path), and a Responses error or `response.failed` event (`:217-222`). The proxy only returns that contract. Whether anything is compacted is decided by the CLI's reactive compaction, subject to host policy (`libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts`). The SDK integration spec requires a real auto-compaction for two cases: an upstream HTTP 400 overflow (S6a), and a streamed `response.failed` overflow that arrives before any client output (S6b). Both run against a MOCKED upstream (see the section below).
- Streamed errors: the Responses streaming path holds back the `200` headers and `message_start` until the first client-visible output. An error that arrives first goes out as a plain HTTP error with the mapped status (for example 400 `prompt is too long`). An error that arrives after output was streamed goes out as a single SSE `error` event. The installed CLI treats that SSE error as retryable and does not compact, so an overflow reported after partial output is a known limit.
- No pre-send token or window check in the proxy. Overflow handling is reactive only. Proactive compaction policy belongs to TASK_2026_561_9e57.

## B. Native Codex adapter

- No steer, no interrupt: `capabilities()` returns `{ steer: false, interrupt: false, continuation: true }`. A message is delivered as the next full turn (`codex-cli.adapter.ts:488-494`).
- Curated static model list: `listModels()` always returns `SUPPORTED_MODELS` (6 IDs, `codex-cli.adapter.ts:507-514`, `:538`), with no API call. It is separate from the provider-entry list in `libs/shared/src/lib/providers/entries/codex-provider-entry.ts` (8 IDs after Batch 7). The two can drift.
- Commands unsupported: Codex reads prompts only from the home directory (openai/codex#9848), so harness-sync writes none (`rival-targets.ts:13`, `:22-24`, `:90`).
- `{ws}/.agents/skills` is shared with the Antigravity target (`rival-targets.ts:62-64`, `:174-176`).
- MCP destination for servers installed by harness-sync: `$CODEX_HOME/config.toml` when `CODEX_HOME` is set and not blank, otherwise `~/.codex/config.toml` (`libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:51-58`, used by `codex-toml-mcp-facet.ts:113`, facet built at `rival-targets.ts:122`). This is not the only MCP source: the adapter also passes Ptah's own server through the SDK `mcp_servers` config (`codex-cli.adapter.ts:610-612`).

## C. CLI workspace proxy

Limits per TASK_2026_564_87a6. That task owns the fixes.

- Caller `tools[]` are merged with workspace tools only for notifications (`proxy.tool_invoked`). They are never forwarded: `chat:start` gets `options: {}` (`anthropic-proxy.service.ts:392-414`, `:494-499`).
- The prompt is flattened to role-tagged text (`anthropic-proxy.service.ts:434`, `:673-698`), so `/commands` are not recognized as commands.
- `tool_result` blocks are dropped: only blocks with a string `text` survive flattening (`anthropic-proxy.service.ts:700-718`).
- `autoApprove` is declared on the config (`anthropic-proxy.service.ts:94`) but not read by the service.
- Exception: a valid `X-Ptah-Mcp-Servers` header is parsed and forwarded as a structured `mcpServersOverride` on `chat:start` (`anthropic-proxy.service.ts:423-433`, `:500-501`). The host consumes it (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:536-537`, `:571`). This route is separate from `tools[]`.
- Host session: `chat:start` carries no `ptahCliId`, so the host skips the native CLI branch (`chat-session.service.ts:447`) and starts an SDK session for the workspace provider (`:555`). Path A limits apply on top when that provider is proxied.
- `skill__` placeholder tools (`workspace-mcp-collector.ts:204`) are advertised but not executable.

## Observed through the installed SDK (Batch 9)

Spec: `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`. Real parts: the pinned `@anthropic-ai/claude-agent-sdk` 0.3.278, its CLI binary and `CodexTranslationProxy`. MOCKED part: the upstream Responses server. No live provider was called. Details: `integration-observations.md`.

| Scenario | Observed |
| --- | --- |
| S1 Skill tool | The CLI calls `Skill` with the arguments; the skill body and arguments reach the next upstream request, paired by `call_id`. |
| S2 Slash command | `/fixture-cmd hello world` is expanded locally by the CLI before the upstream request. |
| S3 Unknown slash command (A3) | `/no-such-cmd x` is forwarded to the model as literal text. It is not rejected locally and never expanded. |
| S4 Unknown tool | The CLI answers the call with `Error: ... No such tool available ...` in `function_call_output`. |
| S5 Long MCP tool name | Upstream sees only the alias; the handler gets the original arguments; replayed history uses the same alias; an image tool result goes upstream as `input_image` (Codex). |
| S6a / S6b Overflow (A5) | HTTP 400 overflow, and streamed `response.failed` overflow before output: the CLI auto-compacts (`compact_boundary`, `trigger: 'auto'`) and the turn ends with `success`. |

Path A limit from S3: a mistyped slash command costs one model turn, because the CLI sends it as a prompt.
