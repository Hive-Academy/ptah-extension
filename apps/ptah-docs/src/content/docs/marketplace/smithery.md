---
title: Smithery
description: Browse and install hosted MCP servers from Smithery with guided, often one-click, setup.
---

[Smithery](https://smithery.ai) is a registry of **hosted MCP servers**. Through the Marketplace, Ptah lets you search Smithery, vet servers, fill in any required configuration, and wire a connection into your workspace — usually in a click or two.

![Smithery in the Marketplace](/screenshots/marketplace-smithery.png)

## Connecting Smithery

The first time you open the Smithery provider, Ptah asks for a **Smithery API key**. Until a key is saved, no browsing happens.

1. Open **Marketplace → Smithery**.
2. Paste your Smithery API key into the **Connect Smithery** prompt and click **Connect**.
3. Ptah verifies the key and loads the popular-servers list.

:::note
Your key is **stored encrypted by Ptah and never leaves your machine**. You can get a key from your Smithery account at [smithery.ai](https://smithery.ai).
:::

## Your Smithery account

Once a key is saved, an **account row** shows the Smithery **namespace** every Ptah install lands in. If your key has more than one namespace, Ptah names it and installs into the first — the row says so. If the key has no namespace at all, the row shows the reason instead.

Below the account row, a **Connections** list shows every connection in that namespace — the ones Ptah created and any you made in Smithery directly. Each row shows a status badge:

| Badge                   | Meaning                                                 |
| ----------------------- | ------------------------------------------------------- |
| **Connected**           | The connection is authorized and ready to use           |
| **Needs authorization** | Smithery still needs you to finish sign-in for this one |
| **Error**               | Smithery reported a problem with this connection        |

A connection Ptah installed also carries a **Managed by Ptah** badge, an **Authorize** button when it is not yet connected, and a **Remove** button. A connection you made outside Ptah shows neither button — Ptah will not disconnect or reauthorize a connection it did not create; manage those from Smithery itself.

## Browsing servers

Once connected you'll see **Popular Servers**, and a search box for finding specific ones. Each result card shows the server name, a short description, and trust badges:

| Badge           | Meaning                                                      |
| --------------- | ------------------------------------------------------------ |
| **Verified**    | The server is verified by Smithery                           |
| **Scan passed** | It passed Smithery's automated security scan                 |
| **Ready**       | You've already resolved a connection to it in this workspace |

## Installing a server

Click **Install** on a server to expand its setup panel:

- **One-click setup** — if the server needs no configuration, the panel says _"No configuration required"_ and you can set it up directly.
- **Guided configuration** — if the server requires settings (API keys, endpoints, options), Ptah renders a form generated from the server's configuration schema. Fill in the fields; the **Set up server** button stays disabled until the form is valid.

Click **Set up server**. Ptah resolves the connection and marks the server **Ready** — _"Connection resolved — ready to use in a session."_ Its tools are now available to agents the same way `ptah_*` tools are.

An installed server's badge can also read **Needs authorization** or **Error** instead of **Installed** — Ptah reads the badge from the connection's own status, not just from the install record, so a server that Smithery still needs you to authorize does not look ready when it is not. **Installed** on its own means an older install that predates the Connections list; reconnect it to get a live status.

In a chat session, every server you installed through the Connections API arrives as tools on **one** MCP server named `smithery`, with each tool name prefixed by its connection ID (for example `hubspot.search_contacts`) — one namespace endpoint carries every connection. A server you installed before this change keeps working through its own old URL until you reconnect it; nothing migrates automatically.

## Permissions

Smithery server tools follow the same [permission model](/mcp-and-skills/third-party-mcp/#permissions) as every other MCP tool — tool IDs are `mcp__<server-name>__<tool-name>`, and you can allow, ask, or deny each one.

:::caution
Hosted servers run actions on your behalf. Prefer **Verified** / **Scan passed** servers, and review what a server can do before granting broad permissions — especially anything that writes data or calls a paid API.
:::

## Smithery vs. manual MCP config

Smithery is the **discover-and-click** path. If you already know the server you want — or it's an internal/stdio server — you can also declare it by hand in `~/.ptah/settings.json`. See [Third-party MCP servers](/mcp-and-skills/third-party-mcp/).

## Next steps

- [MCP Registry](/marketplace/mcp-registry/) — the official MCP server registry
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/) — manual configuration & transports
- [Marketplace overview](/marketplace/)
