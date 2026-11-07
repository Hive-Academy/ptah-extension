---
title: Built-in MCP Server
description: The local MCP server of the PtahCode desktop app, its port, and its access rules.
---

The PtahCode desktop app runs a local MCP server. The server gives the `ptah_*` tools and `execute_code` to the agents that PtahCode starts.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/ptah-mcp-server.mp4" type="video/mp4" />
</video>

## What it does

- Serves the `ptah_*` tool catalog. See [Ptah tools](/mcp-and-skills/ptah-tools/).
- Runs `execute_code`, which gives an agent the `ptah` API in one call.
- Adds itself, with a token, to the `.mcp.json` file of each open workspace folder, so that agents in that folder can find it. When PtahCode finds Cursor, Codex, or Antigravity on your computer, it also adds itself to their config files.

## Port

The server listens on `localhost` over HTTP.

| Behavior      | Details                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| Default port  | `51820`                                                                     |
| Fallback      | If the port is not available, PtahCode tries the next two ports             |
| Change it     | **Settings → Advanced → MCP & Browser → MCP port** (range 1024–65535)       |
| Apply         | A new port applies after the MCP server restarts                            |

## Tool namespaces

In **Settings → Advanced → MCP & Browser**, you can turn tool groups on or off:

- **Browser Automation**
- **CLI Agents**
- **Git Worktree**
- **IDE / LSP**
- **JSON Validation**

## External callers

A caller of the server can send a token. A request without a token gets read-only access. PtahCode gives tokens to the sessions and CLI lanes that it starts. Other local tools that read the token from a config file are external callers.

Set **External MCP callers** (`mcp.externalCallerAccess`) to one of these values:

| Value                      | Effect                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Read-only (recommended)    | Default. External tools can call only read-only tools                                        |
| Full access                | External tools with a token from a workspace config file can also call privileged tools, including `execute_code`. Tokens in config files in your home folder stay read-only. Callers cannot cross workspaces |

## Next steps

- [External MCP callers](/mcp-and-skills/external-callers/)
- [Ptah tools](/mcp-and-skills/ptah-tools/)
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/)
