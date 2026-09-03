---
title: Connected Apps
description: Connect OAuth-secured remote MCP servers — authorize in your browser, and Ptah keeps the tokens encrypted on your machine.
---

**Connected Apps** is the Marketplace provider for **remote MCP servers that sign you in with OAuth** — Sentry, Notion, Linear, and any other server that speaks OAuth 2.0. You paste the server's URL, authorize it in your browser, and Ptah handles the rest: no API key to copy, no token to paste into a config file.

## Connecting an app

1. Open **Marketplace → Connected Apps**.
2. Paste the server URL into the **Connect an OAuth MCP server** field (for example `https://mcp.notion.com/mcp`). Quick-connect chips for **Sentry**, **Notion**, **Linear** and **HubSpot** fill the field for you — the URL box is always the source of truth, so you can edit or replace whatever a chip inserts. Choosing **HubSpot** — or pasting any server URL that needs its own app — opens **Advanced** automatically.
3. Optionally give the connection a **friendly name**. Without one, Ptah uses the server's hostname.
4. Click **Connect**. Your system browser opens on the provider's authorization page.
5. Approve the request. The browser hands the result back to Ptah, which finishes the exchange and adds the server to the **Connected apps** list.

The button shows **Connecting…** for the whole round-trip — it stays pending until authorization completes or fails, so there is nothing to poll or re-click. You have **five minutes** to finish in the browser before the attempt times out.

## Two kinds of OAuth servers

Some servers let Ptah register itself automatically. Others need you to create an app with the provider first and hand Ptah its credentials.

| Kind                       | Examples               | What you do                                                                                                                |
| -------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Automatic registration** | Sentry, Notion, Linear | Paste the server URL and click **Connect**. **Advanced** stays collapsed and empty.                                        |
| **Pre-registered app**     | HubSpot                | Create an app with the provider, register Ptah's redirect URL in it, and paste the client ID and secret into **Advanced**. |

Without a client ID, a server that needs a pre-registered app refuses the connection and says so in the error banner.

:::tip
A Smithery-hosted server URL, such as `https://server.smithery.ai/<name>/mcp`, is an automatic-registration server too. Paste it here to connect straight to that one server through your browser — no Smithery API key, no vendor app. This is a different path from the [Smithery](/marketplace/smithery/) provider, which manages a whole catalog behind one key.
:::

### Connecting a server that needs an app (HubSpot example)

1. Open **Marketplace → Connected Apps**.
2. Click the **HubSpot** chip, or paste `https://mcp.hubspot.com`. Either opens **Advanced** for you.
3. Copy the **Redirect URL** shown in **Advanced**.
4. In HubSpot, go to **Development → MCP Auth Apps → Create MCP auth app**, and register that redirect URL. Scopes are chosen later, during install — not on this app.
5. Copy the **client ID** and **client secret** from the app's details page into Ptah's **Advanced** fields.
6. Click **Connect** and approve the request in your browser.

### Redirect URL by host

| Host                           | Redirect URL                                                    |
| ------------------------------ | --------------------------------------------------------------- |
| Desktop app (Electron) and CLI | `http://127.0.0.1:41739/callback`                               |
| VS Code                        | `vscode://ptah-extensions.ptah-coding-orchestra/oauth-callback` |

The desktop app and CLI use a fixed port so it can be registered ahead of time. If another process holds that port, connecting to a pre-registered server fails with an error naming the port; servers with automatic registration are unaffected. In Cursor or another VS Code fork, the scheme differs — copy the value **Advanced** shows rather than typing it by hand.

:::note
The redirect URL is the one thing the provider needs to know about Ptah. The client secret you paste into **Advanced** is stored the same way as connection tokens — in Ptah's encrypted secret store, never in a plaintext file.
:::

## The connected list

Each connected server is a row showing its name, its URL, and a status badge:

| Badge            | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| **Connected**    | A usable token is stored for this server                               |
| **Expired**      | The access token has expired and there is no refresh token to renew it |
| **Disconnected** | No token is stored — or its state could not be read                    |

Rows that are not **Connected** get a **Reconnect** button, which re-runs the same browser authorization against the existing entry. **Disconnect** is always available: it deletes the stored tokens and removes the server from the list.

## When a connection takes effect

Connected servers are attached to chat sessions **at session start**, and this needs no restart of Ptah. Connect an app and your next new chat gets its tools right away; a session already running does not pick it up. Ptah reads the connected list fresh at the start of every session — not once at launch — and refreshes any access token that is close to expiring at the same time.

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
