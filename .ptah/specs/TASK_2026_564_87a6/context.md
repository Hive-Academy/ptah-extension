# User intent

File a backlog task. Do not implement it in the TASK_2026_408 phase 1-2 PR. Split out of TASK_2026_408 scope item 3 (skills and slash commands end to end): this task covers path C only, the CLI workspace proxy in `apps/ptah-cli/src/services/proxy/`.

## Evidence (read-only audit, 2026-09-26 — re-check line numbers before work)

- `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` ~386-417: merges the caller `tools[]` and the workspace `skill__` / `mcp__` tools, but uses the merged list only for notifications and `tool_count`.
- `anthropic-proxy.service.ts` ~489-494: `chat:start` gets `options: {}` with no tools. The caller tools never reach the model.
- `proxy.tool_invoked` fires for tools that nobody invoked.
- `anthropic-proxy.service.ts` ~668-693: the prompt is flattened into `<system>` / `<user>` tags, so a caller `/command` is never recognized as a slash command.
- `anthropic-sse-translator.ts` ~165-175: host `tool_use` blocks reach the caller, but the matching `tool_result` is dropped.
- `AnthropicProxyConfig.autoApprove` is never read.
- `workspace-mcp-collector.ts` ~197: `skill__` placeholders have empty argument schemas. They are discoverable but not executable.

## Scope

1. Remove the dead `skill__` / `mcp__` placeholder tools, or make them executable. Do not advertise tools that nothing can run.
2. Disclose dropped caller `tools[]` and `/commands` to the caller (error, warning header, or documented limit). Do not silently ignore them.
3. Fire `proxy.tool_invoked` only for real invocations.
4. Decide what to do with host `tool_use` blocks without `tool_result` in the caller stream.
5. Read or remove `AnthropicProxyConfig.autoApprove`.

## Acceptance criteria

- No advertised tool is unexecutable.
- A caller that sends `tools[]` or a `/command` gets an explicit rejection or disclosure.
- Tests cover each item. Record exact counts in `test-report.md`.

## Related

- TASK_2026_408 (translation proxy fixes, ownership doc for the three paths).
