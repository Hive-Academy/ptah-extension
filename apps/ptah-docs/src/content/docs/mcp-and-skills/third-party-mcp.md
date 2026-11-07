---
title: Third-party MCP Servers
description: Add external MCP servers to the agents that PtahCode runs.
---

In addition to the [built-in MCP server](/mcp-and-skills/built-in-mcp-server/), agents can use other MCP servers, for example filesystems, databases, and SaaS APIs.

## Ways to add a server

| Method                                                     | Use it for                                     |
| ---------------------------------------------------------- | ---------------------------------------------- |
| [Marketplace → MCP Registry](/marketplace/mcp-registry/)   | Servers from the official MCP registry         |
| [Marketplace → Smithery](/marketplace/smithery/)           | Hosted servers, with a Smithery API key        |
| [Marketplace → Custom URL](/marketplace/connected-apps/)   | Remote servers that sign in with OAuth         |
| `ptah_harness_install_mcp_server`                          | Let an agent install a server from chat        |
| Edit the config file of the CLI                            | A server that you already know                 |

## Config files

`ptah_harness_install_mcp_server` writes the server config to the file of each target:

| Target   | Workspace file      |
| -------- | ------------------- |
| `claude` | `.mcp.json`         |
| `vscode` | `.vscode/mcp.json`  |
| `cursor` | `.cursor/mcp.json`  |

The default targets are `claude` and `vscode`. The default `scope` is `workspace`, which needs an open folder. Use `scope: "user"` to install for all workspaces. The `codex`, `copilot`, and `antigravity` targets use files in your home folder, so they need `scope: "user"`.

A server is available to a new agent session only.

## Find and list servers from chat

- `ptah_harness_search_mcp_registry` searches the official MCP registry, and Smithery when a Smithery API key is set.
- `ptah_harness_list_installed_mcp` lists the servers in `.vscode/mcp.json` and `.mcp.json` of the workspace.

The registries list published packages. A vendor that hosts its own remote MCP endpoint is often in neither registry. Use [Custom URL](/marketplace/connected-apps/) for those servers.

:::caution
Third-party servers run with your user privileges. Examine what a server does before you install it. Take special care with servers that write to a database, call a paid API, or change remote infrastructure.
:::

## Next steps

- [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/)
- [Ptah tools](/mcp-and-skills/ptah-tools/)
