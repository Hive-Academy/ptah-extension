---
title: Connectors
description: A catalog of apps that you can connect, with one status for each app.
---

**Connectors** is a page of the Marketplace. It shows a catalog of popular apps, your [Custom URL](/marketplace/connected-apps/) OAuth servers, and your [Smithery](/marketplace/smithery/) connections, with one status for each app.

## The catalog

Use the search box and the category chips to filter the grid. The categories are Code, Communication, Data, Design, Productivity, Sales & Marketing, Finance, and DevOps.

## Three kinds of connector

Each card shows how the app signs in:

| Card text                                     | What the button does                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Signs in with your browser**                | **Connect** opens your browser on the authorization page of the provider                      |
| **Needs an app you create with the provider** | **Set up** shows the provider steps. You create an app and paste its client ID and secret     |
| **Managed by Smithery**                       | **Connect** installs the app through your Smithery account                                    |

## When you must create an app

Some providers need your own app before they let PtahCode connect.

1. Click **Set up** on the card.
2. Do the numbered steps for the provider.
3. Copy the redirect URL and register it with the provider.
4. Paste the client ID and client secret that the provider gives you.
5. Click **Connect**.

Always copy the redirect URL that the form shows. Do not type it.

## Status

| Status            | Meaning                                                 | Action offered |
| ----------------- | ------------------------------------------------------- | -------------- |
| **Connected**     | The app is authorized and its tools are available       | Disconnect     |
| **Needs sign-in** | The app does not answer until you complete the sign-in  | Authorize      |
| **Failed**        | The provider reported a problem with the connection     | Authorize      |
| (no status)       | Nothing is set up                                       | Connect        |

PtahCode does not remove a Smithery connection that you made outside PtahCode.

## The MCP chip in chat

The chat input shows an **MCP** chip with the number of connected servers. Click the chip to see the status of each server in the session. A server that needs sign-in or failed has an **Authorize** button.

If the list shows "claude.ai connectors are not loaded", the session runs on a provider that is not the account that owns those connectors. PtahCode cannot manage Gmail, Calendar, or Drive connectors. Click **Settings → Providers** in the note to change the provider.

## Next steps

- [Custom URL](/marketplace/connected-apps/)
- [Smithery](/marketplace/smithery/)
- [Marketplace overview](/marketplace/)
