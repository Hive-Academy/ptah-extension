---
title: Driving Ptah via MCP
description: Expose Ptah as a stdio MCP server with `ptah mcp-serve` so external MCP hosts can drive its agent surface.
---

The Ptah CLI ships a `ptah mcp-serve` command that turns Ptah **into** a Model Context Protocol server. An external MCP-aware host — Claude Code, Cursor, the Codex CLI, or any other MCP client — launches `ptah mcp-serve` as a child process and drives Ptah's agent surface through the host's existing MCP integration, with no bespoke wiring.

:::note[This is the reverse of the built-in MCP server]
The [Built-in MCP Server](/mcp-and-skills/built-in-mcp-server/) makes Ptah an MCP **client host** — it serves the `ptah_*` tool catalog over HTTP/SSE to models running _inside_ the desktop app. `ptah mcp-serve` is the opposite direction: Ptah is the **server**, speaking MCP over stdio to an _external_ host that drives it. The two are unrelated surfaces — pick the built-in server when you want a model inside Ptah to call tools; pick `mcp-serve` when you want another agent to delegate work to Ptah.
:::

## When to use it

- An external coding agent (Claude Code, Cursor, Codex CLI) should be able to **delegate a whole task** to Ptah's Team Leader.
- You want to expose Ptah's CLI-agent spawn/steer/stop surface to another orchestrator over a standard protocol.
- You're building an MCP host and want Ptah as one of its connected servers.

For headless scripting against Ptah's own JSON-RPC surface (rather than the MCP standard), use [`ptah interact`](/providers/ptah-cli/) instead.

## The command

```bash
ptah mcp-serve
```

`mcp-serve` speaks JSON-RPC 2.0 over newline-delimited JSON on stdin/stdout, using the MCP method namespace (`initialize`, `tools/list`, `tools/call`, `notifications/cancelled`) rather than Ptah's own `task.*` / `session.*` methods.

**stdout is reserved for the MCP wire.** All boot and teardown logging goes to **stderr** with a `[ptah-mcp]` prefix. `--verbose` does not relax this — stdout stays pristine so the host's parser never chokes.

### Flags

| Flag                  | Description                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `--allow-tools <csv>` | Comma-separated tool allowlist override. Defaults to the full 7-tool MVP catalog. |

`mcp-serve` also honors the global CLI flags — most relevantly `--cwd <dir>` (working directory for the agent), `--auto-approve`, `--verbose`, and `--quiet`. See [CLI Flags](/reference/cli-flags/) for the full list.

:::caution[Always pass `--auto-approve`]
External MCP hosts have no UI to render Ptah's permission prompts. Without `--auto-approve`, any approval-gated `tools/call` waits 5 minutes and then exits with code `3` (`auth_required`). Launch `mcp-serve` with `--auto-approve` (or set `PTAH_AUTO_APPROVE=true`) for unattended host-driven use.
:::

## Host configuration

Point your MCP host at `ptah mcp-serve`. A typical `.mcp.json` entry:

```json title=".mcp.json"
{
  "mcpServers": {
    "ptah": {
      "command": "npx",
      "args": ["-y", "@hive-academy/ptah-cli", "mcp-serve", "--auto-approve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Because the host namespaces tools by server name (e.g. `ptah:agent_spawn`), the tool names on the wire **drop** the `ptah_` prefix used by the built-in HTTP server.

## MVP tool catalog

`tools/list` advertises seven tools. Six are agent-process controls; `session_submit` delegates a full task to Ptah's Team Leader.

| Tool             | What it does                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `agent_list`     | List detected CLIs and configured Ptah CLI agents.                                                 |
| `agent_spawn`    | Spawn a CLI agent and return its handle.                                                           |
| `agent_status`   | Report a spawned agent's status.                                                                   |
| `agent_read`     | Read a spawned agent's buffered stdout/stderr and exit code.                                       |
| `agent_steer`    | Push a steering message to a running agent.                                                        |
| `agent_stop`     | Terminate a running agent.                                                                         |
| `session_submit` | Delegate an entire task to Ptah's Team Leader, which fans out to sub-agents via the SDK Task tool. |

`session_submit` accepts a free-form `task` (required), plus optional `cwd`, `allowSubagents` (default `true`), and a `profile` (`claude_code` or `enhanced`). With `allowSubagents` enabled, the Team Leader decomposes the task and fans work out to sub-agents, aggregating their results into a single MCP response.

## Cost attribution

On startup `mcp-serve` mints a per-process host session id (a ULID) and exports it as `PTAH_MCP_HOST_SESSION_ID` so downstream usage can be attributed back to this host. It's also reported in the `notifications/initialized` payload.

During a `session_submit` run, cost and token deltas stream as `notifications/message` frames (including `session.cost`), and a final `mcp.session.summary` lands when the turn settles. Hosts that surface MCP notifications will see these inline; hosts that ignore notifications still get the aggregated result.

## Introspection

Two introspection methods are available in both `interact` and `mcp-serve` modes:

| Method             | Returns                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.describe` | `serverName`, `version`, `schemaVersion`, `mode` (`mcp-serve`), the registered method list, the MCP tool catalog, error codes, and capabilities. |
| `session.methods`  | Just `{ methods: string[] }` — the live registered method list.                                                                                  |

In `mcp-serve` mode, `session.describe` reports `mode: "mcp-serve"`, `capabilities: ["mcp"]`, and the seven-tool catalog (filtered by `--allow-tools` when set).

## Cancellation and shutdown

- An MCP host cancels an in-flight call by sending `notifications/cancelled`.
- The process shuts down cleanly on **stdin EOF** (exit `0`), **SIGINT** (exit `130`), or **SIGTERM** (exit `143`).
- On any of these, the server drains pending stdout, races the drain against a 5-second cap, and tears down the session.

## Troubleshooting

| Symptom                                                     | Cause / fix                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `tools/call` hangs, then the process exits `3`            | An approval-gated tool ran without `--auto-approve`. Add `--auto-approve` (or `PTAH_AUTO_APPROVE=true`) to the host config.                        |
| `tools/call` returns `isError: true` with `sdk_init_failed` | The call arrived before the agent SDK finished bootstrapping. Retry after `notifications/initialized`.                                             |
| The host's MCP parser reports garbage / extra lines         | Something wrote to stdout that isn't the MCP wire. Ptah keeps stdout pristine and logs to stderr — check a wrapper script isn't echoing to stdout. |
| The host's handshake times out                              | `initialize` is answered eagerly before DI finishes, so this is rare. Confirm the host launches the binary directly and isn't buffering stdio.     |

## Related

- [Built-in MCP Server](/mcp-and-skills/built-in-mcp-server/) — the in-app HTTP/SSE server that exposes `ptah_*` tools to models (the opposite direction).
- [Ptah CLI](/providers/ptah-cli/) — registering CLI agents and the broader headless surface.
- [CLI Flags](/reference/cli-flags/) — global flag reference.
  </content>
  </invoke>
