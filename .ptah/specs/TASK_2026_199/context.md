# Context — TASK_2026_199

## Defect 1 — `antigravity` detected but not spawnable via MCP

`ptah_agent_list` reported `antigravity: installed` and `CliType` already had
seven members, but three surfaces still enumerated the old three-value set, so
`ptah_agent_spawn { cli: "antigravity" }` failed input validation before the
request ever reached `AgentProcessManager`:

| site                                    | old value                               |
| --------------------------------------- | --------------------------------------- |
| `tool-description.builder.ts:513`       | `enum: ['codex','copilot','cursor']`    |
| `agent-tool.dispatcher.ts:49`           | `z.enum(['codex','copilot','cursor'])`  |
| `agent-process-manager.service.ts:1200` | `new Set(['codex','copilot','cursor'])` |

The third also silently dropped antigravity/opencode/pi out of
`getPreferredCli()`, so choosing one of them in the preferred-agent order fell
through to auto-detect.

**Fix shape.** `SYSTEM_CLI_TYPES` in `libs/shared/src/lib/types/agent-process.types.ts`
is now the single source of truth. `CliType` is derived from it
(`SystemCliType | 'ptah-cli'`), and all three surfaces consume the same const.
Adding a seventh adapter means adding one literal in one file.

`ptah-cli` is deliberately excluded from `SYSTEM_CLI_TYPES`: those agents are
user-configured Anthropic-compatible providers routed by `ptahCliId`, not a
binary name, and the spawn schema must keep rejecting `cli: "ptah-cli"`.

## Defect 2 — the adapter was behind the CLI it drives

The adapter's header asserted `agy` has **no** structured output mode and
classified stdout with a `NARRATION_PREFIX` regex ("i will…", "let me…",
"reading…") to guess `thinking` vs `text`.

`agy` 1.1.11 supports `--output-format stream-json`. The real event schema was
captured from the binary before any parser was written — see
[`stream-json-capture.md`](./stream-json-capture.md). Key findings that shaped
the implementation:

- `conversation_id` is on the `init` event, so the mtime-scanning
  `resolveSessionId()` (which raced between concurrent agents) is gone.
- `text_delta` is incremental, so no last-seen-text diffing is needed.
- Tool failures carry their error text inline in `tool_info.output` with no
  error flag and no exit code → `tool-result`, never `tool-result-error`.
- Reasoning text is never streamed (only `usage.thinking_tokens`) → no
  `thinking` segments at all, and `NARRATION_PREFIX` is deleted rather than
  kept as a fallback classifier.

## Scope boundaries held

- Codex/Copilot/Cursor adapters untouched apart from nothing — the shared-const
  refactor did not require editing them.
- `--mode accept-edits|plan` was **not** wired. See the report for why.
