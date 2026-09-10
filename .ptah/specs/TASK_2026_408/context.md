# User intent

File a backlog task for later; do not implement now. Address the Codex proxy audit covering cached input, context management, and skill/command invocation.

## Evidence from read-only inspection

These observations are code-level, not live integration results. Revalidate against current code before implementation. Distinguish the Codex translation proxy from the native Codex adapter and the CLI workspace proxy.

- `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts:145,449,493`: streaming message_start reports zero input tokens; response.completed stores input usage but final message_delta emits only output tokens. Cached input breakdown is not forwarded.
- `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts:192`: subscription SSE collected for non-streaming callers already subtracts cached tokens and reports cache_read_input_tokens; preserve this behavior. Regression coverage at responses-stream-collector.spec.ts:82.
- `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:825`: ordinary non-streaming Responses JSON omits cached input breakdown. Routing and forced subscription streaming are at :450.
- `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:81,123`: stateless full-history translation with store:false; request contract lacks native response continuation, encrypted reasoning replay, and Codex compaction fields. Anthropic cache_control and thinking are stripped. This alone does not prove upstream caching is disabled or that native continuation is required.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:788,898`: host SDK resume and known-model context-window override exist. Unknown windows retain SDK defaults. Do not misreport this as no context management.
- `responses-request-translator.ts:241` preserves generic tool definitions; actual Skill/command loading and execution belong to the host. sdk-query-options-builder.ts:826 conditionally loads user settings and always project/local settings.
- `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:197` exposes skill__ placeholders with empty argument schemas. Discovery alone is not evidence of executable skills; trace the complete execution path before declaring a defect.

## Scope

1. Repair input/cache usage translation consistently across streaming, subscription SSE collection, and ordinary non-streaming Responses paths. Match Anthropic usage semantics without double counting; verify the installed host SDK actually consumes final usage updates.
2. Validate context accounting, model-window selection, automatic/manual compaction, and resume under the proxied provider. Preserve recent native-adapter/session-recovery fixes. Investigate reasoning continuity and support a deliberate, tested policy; do not automatically bolt native Codex sessions onto the host-managed loop.
3. Trace and test installed skill invocation and slash-command invocation end to end through the intended host. Cover arguments, content loading, tool results, permissions, and unknown commands. Repair confirmed gaps; do not expose discoverable but unexecutable placeholder tools.
4. Document ownership and limitations clearly: translation proxy versus native Codex adapter versus CLI workspace proxy.

## Acceptance criteria

- Streaming and non-streaming requests report equal semantic input/output/cache totals for equivalent upstream usage; cached input is not billed or counted twice.
- Regression tests cover cache hit, zero cache, absent details, multiple tool turns, and terminal error/incomplete streams; preserve existing collector tests.
- An integration test through the installed SDK proves input/cache usage reaches host context accounting, not merely that a translator emits fields.
- Known and unknown model-window behavior is explicit and tested. Long multi-turn sessions compact and resume without losing the actionable summary or breaking tool call/result pairing.
- Skill and slash-command execution tests prove actual behavior and argument forwarding, not only discovery. Unsupported paths are rejected or disclosed rather than silently pretending to execute.
- Run scoped diagnostics and relevant Nx tests; record exact test counts and distinguish mocked coverage from live-provider checks. Live credentialed checks require appropriate authorization.

## Boundaries

No implementation, provider requests, commits, or architectural migration authorized by filing this task. Native reasoning/continuation support is an investigation and design decision, not a preselected solution. Keep shared translation changes compatible with other providers using the same modules.
