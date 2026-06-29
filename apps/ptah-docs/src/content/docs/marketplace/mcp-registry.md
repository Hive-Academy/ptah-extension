---
title: MCP Registry
description: Browse and install servers from the official Model Context Protocol registry.
---

The **MCP Registry** provider browses the **official Model Context Protocol server registry** from inside Ptah. It's the curated, vendor-neutral catalog of MCP servers — filesystems, databases, SaaS connectors, and developer tools — that you can search and add to your workspace.

![MCP Registry in the Marketplace](/screenshots/marketplace-mcp-registry.png)

## Browsing and installing

1. Open **Marketplace → MCP Registry**.
2. Search by capability (e.g. `postgres`, `github`, `filesystem`) or scroll the popular list.
3. Open a server to see its details and install it into your workspace.

Once installed, the server's tools join your session alongside `ptah_*` tools and are governed by the same [permission model](/mcp-and-skills/third-party-mcp/#permissions).

## Discovering servers from chat

The same registry is searchable directly from any chat via the harness tool:

```text
ptah_harness_search_mcp_registry with:
{ "query": "postgres" }
```

It returns candidate servers with installation snippets you can paste into your settings.

## Verifying what's connected

To confirm a server was picked up, list the connected servers and their tool catalogs:

```text
harness_list_installed_mcp
```

The **Settings → MCP** panel shows the same information with per-server logs and a **Reconnect** button.

## Registry vs. Smithery

|             | MCP Registry                         | [Smithery](/marketplace/smithery/) |
| ----------- | ------------------------------------ | ---------------------------------- |
| **Source**  | Official MCP registry                | Smithery's hosted catalog          |
| **Hosting** | Mostly self-run (stdio / your infra) | Hosted servers                     |
| **Auth**    | No extra account needed              | Requires a Smithery API key        |
| **Setup**   | Install + configure transport        | Often one-click / schema form      |

## Next steps

- [Smithery](/marketplace/smithery/) — hosted MCP servers
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/) — manual config, transports, env expansion
- [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/)
