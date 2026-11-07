---
title: Custom URL (OAuth servers)
description: Connect a remote MCP server that signs in with OAuth. PtahCode keeps the tokens encrypted on your computer.
---

The **Custom URL** source connects a remote MCP server that signs you in with OAuth, for example Sentry, Notion, or Linear. Paste the URL of the server, authorize in your browser, and PtahCode does the rest.

## Connect a server

1. Open **Marketplace → Sources → Custom URL**.
2. Paste the server URL in **Server**, for example `https://mcp.notion.com/mcp`. The **Quick connect** cards for Sentry, Notion, Linear, and HubSpot fill in the URL for you.
3. Optional: type a **Friendly name**.
4. Click **Connect**. Your browser opens on the authorization page of the provider.
5. Approve the request.

The server then shows in the **Connected apps** list.

## Two kinds of OAuth servers

| Kind                       | Examples               | What you do                                                                                      |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| Automatic registration     | Sentry, Notion, Linear | Paste the URL and click **Connect**                                                              |
| Pre-registered app         | HubSpot                | Create an app with the provider, register the redirect URL, and paste the client ID and secret   |

### Connect a server that needs an app

1. Open **Advanced**.
2. Copy the **Redirect URL**. In the desktop app it is `http://127.0.0.1:41739/callback`.
3. Create an app with the provider and register the redirect URL in it.
4. Paste the client ID and client secret into **Advanced**.
5. Click **Connect** and approve the request in your browser.

If another process uses port 41739, a server that needs an app cannot connect. Servers with automatic registration are not affected.

## The connected list

Each server in **Connected apps** shows its name, URL, and status: **Connected**, **Expired**, or **Disconnected**. A server that is not connected has a **Reconnect** button. **Disconnect** deletes the stored tokens and removes the server.

## When a connection takes effect

PtahCode adds connected servers to a chat session when the session starts. A new session gets the tools. A session that is already open does not. If an access token is near its expiry time, PtahCode refreshes it when the session starts.

## Where credentials are stored

- Access tokens, refresh tokens, and client secrets are in the encrypted secret store of PtahCode.
- The name, URL, and connection time are in `~/.ptah/mcp-oauth-installed.json`.
- In a session, the access token goes to the server as an `Authorization: Bearer` header.

:::caution
An authorized app gives the agent the access that its OAuth scopes allow. This is often read and write access to your data. Connect only servers that you trust.
:::

## Next steps

- [Connectors](/marketplace/connectors/)
- [Smithery](/marketplace/smithery/)
- [Marketplace overview](/marketplace/)
