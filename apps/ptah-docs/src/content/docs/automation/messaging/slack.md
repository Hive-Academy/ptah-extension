---
title: Slack Setup
description: Talk to PtahCode from a Slack workspace.
---

# Slack Setup

The Slack adapter uses [`@slack/bolt`](https://api.slack.com/tools/bolt) in **Socket Mode**. You do not need a public webhook URL. The app receives a message only when you @-mention it.

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App**, then **From scratch**.
3. Name the app and select the workspace.

## 2. Add bot scopes

In **OAuth & Permissions → Bot Token Scopes**, add these scopes:

- `app_mentions:read`
- `chat:write`

## 3. Enable Socket Mode and events

1. Open **Socket Mode** and turn it on.
2. Create an **App-Level Token** with the `connections:write` scope. Copy the `xapp-...` token.
3. Open **Event Subscriptions** and subscribe to the bot event `app_mention`.

## 4. Install the app

1. In **OAuth & Permissions**, click **Install to Workspace**.
2. Copy the **Bot User OAuth Token** (`xoxb-...`).

## 5. Find your team ID

The workspace (team) ID looks like `T0XXXXXXX`.

## 6. Configure PtahCode

1. Open **Thoth → Messaging → Slack**.
2. In **Connection**, paste the bot token (`xoxb-...`) and the app-level token (`xapp-...`).
3. Click **Save & start**.
4. In **Access**, add the team ID to the allow list, and click **Save allow-list**.

## 7. Pair the binding

1. In a channel, @-mention the app.
2. The app replies with a 6-digit pairing code.
3. In **Access → Pending requests**, type the code and click **Approve**.

:::tip
Socket Mode does not need a public URL. You can run PtahCode on a laptop behind NAT.
:::
