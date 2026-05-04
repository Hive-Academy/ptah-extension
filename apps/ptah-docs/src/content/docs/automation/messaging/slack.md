---
title: Slack Setup
description: Talk to Ptah from a Slack workspace.
---

# Slack Setup

The Slack adapter (`BoltSlackAdapter`) uses [`@slack/bolt`](https://api.slack.com/tools/bolt) in **Socket Mode** — no public webhook URL required.

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it and pick the workspace

## 2. Add bot scopes

Under **OAuth & Permissions → Bot Token Scopes**, add:

- `chat:write`
- `app_mentions:read`
- `channels:history`
- `im:history`
- `files:read`

## 3. Enable Socket Mode

1. Sidebar → **Socket Mode** → toggle **Enable**
2. When prompted, generate an **App-Level Token** with the `connections:write` scope. Save the `xapp-…` token

## 4. Install to workspace

**OAuth & Permissions → Install to Workspace.** After install, copy the **Bot User OAuth Token** (`xoxb-…`).

## 5. Find your team ID

The workspace ID looks like `T0XXXXXXX`. You can grab it from `slack.com/account/team` in the URL.

## 6. Configure Ptah

Open **Settings → Messaging → Slack**:

1. Paste **both** tokens (`xoxb-…` and `xapp-…`) — the UI encrypts before persisting
2. Add the team ID to **Allowed team IDs** (`gateway.slack.allowedTeamIds`)
3. Enable **Slack** (`gateway.slack.enabled = true`)
4. Enable the global **Messaging Gateway** (`gateway.enabled = true`)

## 7. Pair the binding

1. In any allowed workspace, DM the app or @-mention it in a channel
2. It replies with a 6-digit pairing code
3. Approve the binding in **Settings → Messaging → Bindings**

:::tip
Socket Mode means you don't need a publicly reachable URL — perfect for running Ptah on a laptop behind NAT.
:::
