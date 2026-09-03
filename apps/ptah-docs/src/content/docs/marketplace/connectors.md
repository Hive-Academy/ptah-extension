---
title: Connectors
description: A curated, verified catalog of apps you can connect in one place — with a status badge that always matches what your chat sessions can actually reach.
---

**Connectors** is the first tab in the Marketplace. It brings together a curated catalog of popular apps, your [Connected Apps](/marketplace/connected-apps/) OAuth servers, and your [Smithery](/marketplace/smithery/) connections, and shows one accurate status badge per app.

## The catalog

Every entry in the catalog was checked against the provider's own MCP server before it was added — Ptah confirms the server answers and how it expects you to sign in, rather than listing a name and hoping the URL still works. A search box and category chips (Code, Communication, Data, Design, Productivity, Sales & Marketing, Finance, DevOps) narrow the grid.

## Three kinds of connector

Each card shows how that app signs in:

| Kind      | Card says                                     | What Connect does                                                                                                                                                                     |
| --------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic | **Signs in with your browser**                | Opens your browser on the provider's authorization page. Nothing to set up first.                                                                                                     |
| App       | **Needs an app you create with the provider** | Opens the [Connected Apps](/marketplace/connected-apps/) form, pre-filled and with **Advanced** already open, so you can paste the client ID and secret you create with the provider. |
| Smithery  | **Managed by Smithery**                       | Installs through your Smithery account. If the upstream app still needs authorization, Ptah opens that step for you and waits for it to finish.                                       |

## Status badges

| Badge                   | Meaning                                                        | Action offered                             |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| **Connected**           | The app is authorized and its tools are available              | Disconnect                                 |
| **Needs authorization** | The app is listed but will not answer until you finish sign-in | Authorize                                  |
| **Error**               | The provider reported a problem with this connection           | Authorize, with a reason shown on the card |
| **Not connected**       | Nothing is set up yet                                          | Connect                                    |

A Smithery connection you made outside Ptah shows no Disconnect button — Ptah will not remove a connection it did not create. The card says so, and Authorize explains rather than acting.

## Connect a custom server

A collapsed **Connect a custom server** section at the bottom of the grid embeds the same form used by [Connected Apps](/marketplace/connected-apps/) — paste any OAuth MCP server URL that is not in the catalog yet.

## The MCP chip in chat

Every chat session shows an **MCP** chip in the header, next to the [cost bar](/chat/cost-and-tokens/). It normally reads a plain connected count. When a server needs authorization or has failed, the chip turns amber and switches to `<connected>/<total>`. The chip also turns amber, with the count unchanged, when your claude.ai connectors are unavailable — see below.

Click the chip to see every server the session reports, each with its own status pill. A server marked **Needs authorization** or **Failed** gets an **Authorize** button:

- A Smithery server (key `smithery`) opens the [Smithery](/marketplace/smithery/) surface, where the Connections list has a per-connection Authorize button — one namespace endpoint can hold several connections, so there is no single thing to authorize from the chip itself.
- A Connected Apps server re-runs the browser authorization for that server directly from the chip.
- Anything else — including a Connected Apps server whose connection record was removed — opens the Connectors tab so you can reconnect it there.

## claude.ai connectors

If the popover shows a note about **claude.ai connectors**, this chat session is running on a different, third-party provider than the account those connectors belong to. Gmail, Calendar, Drive and Canva connectors live entirely with that account, so Ptah cannot configure, list, or manage them from here — the note only explains why they are absent.

The note links to **Settings → Providers**, where you can switch back to the account that owns them.

## Next steps

- [Connected Apps](/marketplace/connected-apps/) — OAuth-secured MCP servers
- [Smithery](/marketplace/smithery/) — hosted MCP servers and your account
- [Cost and tokens](/chat/cost-and-tokens/) — the rest of the chat header
- [Marketplace overview](/marketplace/)
