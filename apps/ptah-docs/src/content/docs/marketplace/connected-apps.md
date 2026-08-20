---
title: Connected Apps
description: Connect OAuth-secured remote MCP servers — authorize in your browser, and Ptah keeps the tokens encrypted on your machine.
---

**Connected Apps** is the Marketplace provider for **remote MCP servers that sign you in with OAuth** — Sentry, Notion, Linear, and any other server that speaks OAuth 2.0. You paste the server's URL, authorize it in your browser, and Ptah handles the rest: no API key to copy, no token to paste into a config file.

## Connecting an app

1. Open **Marketplace → Connected Apps**.
2. Paste the server URL into the **Connect an OAuth MCP server** field (for example `https://mcp.notion.com/mcp`). Quick-connect chips for **Sentry**, **Notion** and **Linear** fill the field for you — the URL box is always the source of truth, so you can edit or replace whatever a chip inserts.
3. Optionally give the connection a **friendly name**. Without one, Ptah uses the server's hostname.
4. Click **Connect**. Your system browser opens on the provider's authorization page.
5. Approve the request. The browser hands the result back to Ptah, which finishes the exchange and adds the server to the **Connected apps** list.

The button shows **Connecting…** for the whole round-trip — it stays pending until authorization completes or fails, so there is nothing to poll or re-click. You have **five minutes** to finish in the browser before the attempt times out.

### Advanced: pre-registered client credentials

Most authorization servers let Ptah register itself automatically, so the **Advanced** section stays collapsed and empty. Open it only when a server does **not** support automatic app registration — then paste the **Client ID** (and **Client Secret**, if the server issued one) you were given. Without a Client ID, a server that lacks automatic registration refuses the connection and says so in the error banner.

## The connected list

Each connected server is a row showing its name, its URL, and a status badge:

| Badge            | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| **Connected**    | A usable token is stored for this server                               |
| **Expired**      | The access token has expired and there is no refresh token to renew it |
| **Disconnected** | No token is stored — or its state could not be read                    |

Rows that are not **Connected** get a **Reconnect** button, which re-runs the same browser authorization against the existing entry. **Disconnect** is always available: it deletes the stored tokens and removes the server from the list.

## When a connection takes effect

Connected servers are attached to chat sessions **at session start**. Connect an app and your next new chat gets its tools; a session already running does not pick it up. On each session start Ptah re-reads the connected list and refreshes any access token that is close to expiring.

A server whose token is missing or can no longer be refreshed simply contributes nothing to that session rather than failing the chat — if an app's tools are missing, check its badge here and hit **Reconnect**.

Once attached, the server's tools sit alongside `ptah_*` tools and obey the same [permission model](/mcp-and-skills/third-party-mcp/#permissions) as every other MCP tool.

## Where credentials live

- **Tokens** — access tokens, refresh tokens and any client secret — are held in Ptah's **encrypted secret store**, one isolated slot per server. They are never written to a plaintext config file, never logged, and never sent to Ptah's servers.
- **Non-secret metadata** — the server's name, URL and connection timestamp — is kept in a plain file at `~/.ptah/mcp-oauth-installed.json`.
- During a chat, the access token is passed to the server as an `Authorization: Bearer` header that exists **only in memory for that session**.

:::caution
Authorizing an app grants the agent whatever that app's OAuth scopes allow — often read _and_ write access to your data. Connect only servers you trust, and use **Disconnect** to revoke Ptah's stored tokens when you are done with one.
:::

## Connected Apps vs. the other MCP providers

|               | Connected Apps                     | [Smithery](/marketplace/smithery/) | [MCP Registry](/marketplace/mcp-registry/) |
| ------------- | ---------------------------------- | ---------------------------------- | ------------------------------------------ |
| **You bring** | The server's URL                   | A Smithery API key                 | Nothing                                    |
| **Auth**      | Browser sign-in, per server        | One key for the whole catalog      | Per-server, configured by hand             |
| **Discovery** | None — you already know the server | Searchable hosted catalog          | Searchable official registry               |

Use Connected Apps when the server you want is a hosted SaaS endpoint that expects you to _log in_ rather than paste a key.

## Next steps

- [Smithery](/marketplace/smithery/) — hosted MCP servers
- [MCP Registry](/marketplace/mcp-registry/) — the official registry
- [Third-party MCP servers](/mcp-and-skills/third-party-mcp/) — manual configuration & transports
- [Marketplace overview](/marketplace/)
