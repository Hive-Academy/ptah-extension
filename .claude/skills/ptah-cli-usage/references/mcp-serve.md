# `ptah mcp-serve` — serve Ptah's tools to another MCP client

Covers the second stdio surface: the Model Context Protocol server that
lets an external host drive Ptah, its advertised tools, `--allow-tools`,
cost attribution, cancellation and drain.

---

## 1. What it is

`ptah mcp-serve` is a second JSON-RPC stdio surface alongside `ptah
interact`. It speaks the Model Context Protocol (`initialize`,
`tools/list`, `tools/call`, `notifications/cancelled`) instead of
Ptah-flavored `task.*` / `session.*` methods, so any MCP-compliant host
can drive Ptah's agent surface without bespoke integration. This inverts
Ptah's position: instead of Ptah calling out to other tools, external
orchestrators delegate work into Ptah's multi-CLI dispatch and Team
Leader harness.

**Transport**: stdin/stdout, same NDJSON JSON-RPC 2.0 framing as
`interact`. There is no HTTP listener — the host owns the process.

Command file: `apps/ptah-cli/src/cli/commands/mcp-serve.ts`. Transport
lib: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/`.

---

## 2. `.mcp.json` example

External MCP hosts add a server block like this:

```json
{
  "mcpServers": {
    "ptah": {
      "command": "npx",
      "args": ["-y", "@hive-academy/ptah-cli", "--auto-approve", "mcp-serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

`--auto-approve` is recommended because the host has no UI surface to
render Ptah's permission prompts. Without it, any `tools/call` that
triggers an approval-gated operation will hang for 5 minutes and then
exit `auth_required` (`3`).

`--auto-approve` is a **global** flag, so it goes **before** `mcp-serve`
in the args array. `PTAH_AUTO_APPROVE=true` in the child env is the
equivalent and avoids the ordering question entirely.

`--allow-tools` is a subcommand-local option and goes **after**
`mcp-serve`.

---

## 3. The 7 MVP tools (advertised on `tools/list`)

Source of truth: `MCP_MVP_TOOL_NAMES` and `buildMcpMvpTools()` in
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/tool-builders.ts`.
The MCP-wire names drop the `ptah_` prefix the internal HTTP server uses,
because MCP hosts namespace tools by server name on the wire
(`ptah:agent_spawn`), so the prefix would be redundant.

| Tool             | Required input keys      | Optional input keys                                         | Returns                                                       |
| ---------------- | ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `agent_spawn`    | `task` (string)          | `cli`, `ptahCliId`, `workingDirectory`, `model`, plus a few | `SpawnAgentResult { agentId, cli, status, … }`                |
| `agent_status`   | —                        | `agentId`                                                   | `AgentProcessInfo` (single) or full list                      |
| `agent_read`     | `agentId`                | `tail` (number)                                             | Buffered stdout/stderr + exit code if finished                |
| `agent_steer`    | `agentId`, `instruction` | —                                                           | `{ steered: true }` once the steering message is forwarded    |
| `agent_stop`     | `agentId`                | —                                                           | Final `AgentProcessInfo` after termination                    |
| `agent_list`     | —                        | —                                                           | Detected CLIs + configured Ptah CLI agents                    |
| `session_submit` | `task` (string)          | `cwd`, `allowSubagents` (default `true`), `profile`         | Aggregated text + `structuredContent { tabId, sessionId, … }` |

Notes:

- `session_submit` is unique to the stdio surface — it builds a Team
  Leader prompt from the supplied `task`, runs it through the agent SDK
  session, and aggregates the result. Mid-flight progress streams as
  `notifications/message` / `notifications/progress` frames keyed off
  `_meta.progressToken` when supplied. Source:
  `apps/ptah-cli/src/services/mcp/session-submit.service.ts`.
- The tools are advertised in the order listed above; external hosts that
  fingerprint the catalog see stable output across boots.
- This is a **narrower** surface than the internal `ptah_*` catalog
  (`references/internal-mcp.md`).

---

## 4. `--allow-tools <csv>`

Narrows the advertised set. Tools omitted from the allowlist are NOT
visible to `tools/list` and return `mcp_tool_not_found` on `tools/call`.

```bash
ptah --auto-approve mcp-serve --allow-tools agent_list,agent_spawn,agent_read
```

With the flag omitted, the full 7-tool MVP set is advertised. On boot the
command writes `[ptah-mcp] ready (tools=…)` to stderr — `mvp:7` when no
allowlist was given.

---

## 5. Cost attribution

Every `ptah mcp-serve` boot mints a `mcp_host_session_id = ulid()` and
exports it via the `PTAH_MCP_HOST_SESSION_ID` environment variable.
Downstream services read the variable to tag their notifications:

- Per-turn cost ticks emit `notifications/message` with
  `{ kind: 'session.cost', mcpHostSessionId, sessionId, turnId, deltaUsd,
totalUsd, inputTokens, outputTokens }`.
- At tool-call settlement the dispatcher emits ONE final
  `notifications/message` with
  `{ kind: 'mcp.session.summary', mcpHostSessionId, sessionId, tabId,
totalUsd, totalTokens, inputTokens, outputTokens, toolCallCount }`
  BEFORE the `tools/call` result lands on the wire.

Both come from `session-submit.service.ts`.

External hosts that aggregate spend across long-running Ptah usage should
key on `mcpHostSessionId` (stable for the life of the `mcp-serve`
process) and accumulate `totalUsd` from the summary frames. Mid-flight
`session.cost` frames are for live UIs and may duplicate the final
summary.

---

## 6. Cancellation and drain

**Mid-flight cancellation**: send a
`notifications/cancelled { requestId: <id-of-the-tools/call> }`
notification. The dispatcher matches the requestId against its in-flight
map, invokes `chat:abort` on the in-process transport, and resolves the
original `tools/call` with `isError: true` and
`structuredContent.ptah_code: 'mcp_tool_cancelled'` within ~1 second.

**Process drain**: `mcp-serve` exits on three triggers:

- `stdin` EOF → exit `0` (normal MCP host disconnect)
- `SIGINT` → exit `130`
- `SIGTERM` → exit `143`

All three race against a 5-second drain cap: outstanding `tools/call`
AbortControllers fire, the stdio transport stops, the formatter closes,
and stdout fully flushes. Hosts that re-launch `ptah mcp-serve` on every
`.mcp.json` reload do NOT need to send an explicit shutdown — closing
stdin is sufficient.

---

## 7. Introspection

`mcp-serve` also registers `session.describe` and `session.methods`. Use
`session.describe` to read the live method + tool catalog without parsing
`tools/list`; in this mode the result carries `mode: "mcp-serve"`,
`schemaVersion: "0.2"` and `capabilities: ["mcp"]`. See
`references/jsonrpc.md` § 5.

---

## 8. Troubleshooting

| Symptom                                                       | Likely cause                                                                                     | Fix                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Host hangs on `tools/call` for ~5 minutes, then exit code `3` | Missing `--auto-approve`; an approval-gated operation is blocked because hosts have no UI.       | Add `--auto-approve` before `mcp-serve` (or `PTAH_AUTO_APPROVE=true` to the env).  |
| `tools/list` returns fewer than 7 tools                       | `--allow-tools <csv>` narrowed the advertised set.                                               | Drop the flag or expand the CSV to include the missing names.                      |
| `tools/call` returns `mcp_tool_not_found`                     | Tool name typo, or the name was excluded by `--allow-tools`.                                     | Check `tools/list` output OR `session.describe` to see the live catalog.           |
| `tools/call` returns `mcp_invalid_tool_args`                  | Zod validation failed; `structuredContent.issues` carries the field-level diagnostics.           | Inspect `issues.fieldErrors` and fix the offending key.                            |
| `tools/call` returns `sdk_init_failed`                        | `tools/call` arrived while `withEngine` was still bootstrapping. Rare; happens during cold boot. | Retry after `notifications/initialized` lands. The handshake completes in < 3s.    |
| First `tools/call` is slow (~1-3s)                            | Lazy `PtahAPIBuilder` walk on first dispatch; subsequent calls reuse the cached dispatcher.      | Expected. Send a no-op `tools/list` after `initialized` if predictability matters. |
| `mcp.session.summary` never arrives                           | The `tools/call` errored before listeners attached, OR the host disconnected mid-flight.         | Check stderr for `[ptah-mcp] drain error: …` lines.                                |

MCP tool-level errors travel inside `result` per spec — an
`isError: true` envelope with a `structuredContent.ptah_code`, NOT a
JSON-RPC `error` object. Parse both shapes.
