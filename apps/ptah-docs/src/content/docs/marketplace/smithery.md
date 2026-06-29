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
