---
title: Smithery
description: Find and install hosted MCP servers from Smithery.
---

[Smithery](https://smithery.ai) is a registry of hosted MCP servers. In the Marketplace, you can search Smithery, fill in the configuration of a server, and install it.

![Smithery in the Marketplace](/screenshots/marketplace-smithery.png)

## Connect Smithery

1. Open **Marketplace → Sources → Smithery**.
2. Paste your Smithery API key in **Connect Smithery**.
3. Click **Connect**.

PtahCode stores the key encrypted on your computer. Get a key from your account at [smithery.ai](https://smithery.ai).

## Connections

After you connect, the **Connections** list shows each connection in your Smithery namespace. Each row has a status. A connection that PtahCode installed shows **Managed by Ptah**, an **Authorize** button when it is not connected, and a **Remove** button. PtahCode does not change a connection that you made in Smithery directly.

## Find a server

The page shows **Popular Servers** and a search box. Category chips such as Web Search, Browser Automation, and Dev Tools fill in a search. A card can show the badges **Verified** and **Scan passed**.

## Install a server

1. Open a server.
2. Fill in the **Configuration** form. If the server needs no settings, the panel shows "No configuration required — one-click setup."
3. Click **Install server**.

When the install completes, the server is available in new chat sessions.

In a chat session, all servers that you installed through Smithery come from one MCP server named `smithery`. Each tool name starts with its connection ID, for example `hubspot.search_contacts`.

:::caution
Hosted servers do actions for you. Prefer **Verified** and **Scan passed** servers. Examine what a server can do before you install it.
:::

## Next steps

- [MCP Registry](/marketplace/mcp-registry/)
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/)
- [Marketplace overview](/marketplace/)
