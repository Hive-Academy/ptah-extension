---
title: MCP Registry
description: Find servers in the official Model Context Protocol registry and install them.
---

The **MCP Registry** source shows servers from the official MCP server registry (`registry.modelcontextprotocol.io`). Install a server into the MCP config of each CLI that you select.

## Find and install a server

1. Open **Marketplace → Sources → MCP Registry**.
2. Search for a capability, for example `postgres` or `github`.
3. Open a server to see its details.
4. Select the targets and install the server.

The install targets are Claude, VS Code, Cursor, Copilot, Codex, and Antigravity. The server is available in new agent sessions.

## Find servers from chat

Agents can search the same registry with `ptah_harness_search_mcp_registry`. When a Smithery API key is set, the tool also searches Smithery. Agents install a server with `ptah_harness_install_mcp_server`. See [Third-party MCP servers](/mcp-and-skills/third-party-mcp/).

## See what is installed

Open **Marketplace → MCP Servers** to see the installed MCP servers.

## Registry compared with Smithery

|             | MCP Registry                     | [Smithery](/marketplace/smithery/) |
| ----------- | -------------------------------- | ---------------------------------- |
| **Source**  | Official MCP registry            | Smithery hosted catalog            |
| **Hosting** | Mostly local (stdio) or your own | Hosted servers                     |
| **Account** | Not necessary                    | A Smithery API key                 |

## Next steps

- [Smithery](/marketplace/smithery/)
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/)
- [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/)
