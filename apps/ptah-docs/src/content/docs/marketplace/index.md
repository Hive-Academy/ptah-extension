---
title: Marketplace
description: One hub to add MCP servers, skills, and plugins to your workspace — from official registries and hosted providers like Smithery.
---

The **Marketplace** is Ptah's in-app hub for extending any workspace with new capabilities. It brings several catalogs together behind one screen: skill packs, the official MCP registry, community skills, and hosted MCP providers — each installable without leaving the app.

![Marketplace overview](/screenshots/marketplace-overview.png)

## Opening the Marketplace

In the Ptah desktop app, click the **Marketplace** entry in the navigation rail. Pick a provider from the list and its catalog mounts on the right.

:::note
The Marketplace is a **Pro feature**. Free-tier users see the hub with an upgrade prompt; no catalog loads until the license resolves.
:::

## Providers

| Provider         | Adds                                                      | Status      |
| ---------------- | --------------------------------------------------------- | ----------- |
| **Plugins**      | Bundled skill packs for orchestration, frontend & backend | Live        |
| **MCP Registry** | Servers from the official Model Context Protocol registry | Live        |
| **Skills**       | Community skills you can discover and install             | Live        |
| **Smithery**     | Hosted MCP servers with one-click setup                   | Live        |
| **Composio**     | Managed-auth MCP toolkits                                 | Coming soon |

Only the provider you select loads — unselected and coming-soon providers fire no network calls.

### Plugins

Curated, multi-contribution packs (agents, skills, templates, slash commands). The Marketplace's Plugins surface is the same catalog covered in depth under [Plugins](/plugins/marketplace/).

### MCP Registry

Browse and install servers from the **official MCP registry**. See [MCP Registry](/marketplace/mcp-registry/).

### Skills

Discover and install **community skills** — scoped knowledge packs invoked on demand in chat. For how skills work once installed, see [Skills](/mcp-and-skills/skills/).

### Smithery

**Hosted MCP servers** with a guided, often one-click, setup. See [Smithery](/marketplace/smithery/).

### Composio (coming soon)

Managed-auth MCP toolkits — connect SaaS tools without hand-managing tokens. Listed in the hub and will go live in a future release.

## How installs take effect

After you install a skill or resolve an MCP server, Ptah refreshes its autocomplete caches so the new skill or server's tools immediately show up in `/command` and `@agent` suggestions and in the installed lists. MCP tools become first-class citizens alongside `ptah_*` tools, subject to the same [permission model](/mcp-and-skills/third-party-mcp/#permissions).

## Next steps

- [Smithery setup](/marketplace/smithery/)
- [MCP Registry](/marketplace/mcp-registry/)
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/) — manual configuration
- [Plugins](/plugins/)
