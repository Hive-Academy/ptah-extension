---
title: External MCP Callers
description: How the built-in MCP server of PtahCode identifies its callers, and what each caller can do.
---

The [built-in MCP server](/mcp-and-skills/built-in-mcp-server/) checks every request. A caller can send a token, and each token has one access level. A request without a token gets read-only access. This page tells you which callers get which level, and how to give more access to other local tools.

## Access levels

| Level | What the caller can call |
| ----- | ------------------------ |
| Read-only | Only the read-only tools, for example `ptah_workspace_analyze`, `ptah_search_files`, and `ptah_memory_search` |
| Lane report | The read-only tools, and the tools that a lane uses to report: `ptah_agent_report`, `ptah_agent_message_status`, and `ptah_agent_message_ack` |
| Privileged | All tools, including `execute_code` |

Outside the read-only tools, the three lane report tools above accept the lane report level. All other tools need privileged access. When a caller calls a tool that its level does not permit, the server refuses the call.

## Who gets which level

- **CLI lanes that PtahCode starts** get their own token for the lane. The token lasts up to 4 hours. Antigravity lanes get the lane report level. Other lanes get the privileged level.
- **External callers** are other local tools that read the token from a config file. They get the level that **External MCP callers** sets.

## Config files with a token

While the MCP server runs, PtahCode writes its server entry, with a token, to these config files:

| Tool | Config file | Scope |
| ---- | ----------- | ----- |
| Claude Code | `<workspace>/.mcp.json` | Workspace |
| Cursor | `<workspace>/.cursor/mcp.json` | Workspace |
| Codex | `<workspace>/.codex/config.toml` for a trusted project, otherwise `~/.codex/config.toml` | Workspace or home |
| Antigravity | `<workspace>/.agents/mcp_config.json` and `~/.gemini/config/mcp_config.json` | Workspace and home |

PtahCode writes the Cursor, Codex, and Antigravity files only when it finds that tool on your computer. In the Cursor file, the token is in an `Authorization` header. In the other files, the token is part of the server URL.

These tokens stay the same when the MCP server stops and starts again. PtahCode keeps only a hash of each token, not the token itself.

## Set the access of external callers

1. Open **Settings → Advanced → MCP & Browser**.
2. In **External MCP callers**, select a value.

| Value | Effect |
| ----- | ------ |
| **Read-only (recommended)** | Default. External tools can call only read-only tools |
| **Full access** | External tools can also call privileged tools, including `execute_code`. They cannot cross workspaces |

The setting key is `mcp.externalCallerAccess`, with the values `read-only` and `full`. A value that is not valid reads as `read-only`.

:::note
**Full access** applies only to the config files with workspace scope. A token in a config file in your home folder always stays read-only.
:::

## Request checks

The server also refuses a request when:

- The `Host` header is not `localhost`, `127.0.0.1`, or `[::1]` with the port of the server.
- The request has an `Origin` header.
- The `Content-Type` is not `application/json`.

## Related

- [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/)
- [Ptah tools](/mcp-and-skills/ptah-tools/)
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/)
