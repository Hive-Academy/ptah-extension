---
title: Messaging Gateway
description: Drive PtahCode agents from Telegram, Discord, or Slack.
---

# Messaging Gateway

The messaging gateway lets you send a prompt from a chat app and get the agent reply in the same chat. The gateway runs the platform adapters locally in the PtahCode desktop app.

## Supported platforms

| Platform | Library                   | How the bot receives messages                        |
| -------- | ------------------------- | ---------------------------------------------------- |
| Telegram | grammY (Bot API)          | Messages to the bot                                  |
| Discord  | discord.js                | `/ptah`, an @-mention, or a message in a Ptah thread |
| Slack    | `@slack/bolt` Socket Mode | An @-mention of the app                              |

## Open the gateway

1. Click **Thoth** in the chat header.
2. Open the **Messaging** tab.

The tab shows the gateway status, the running adapters, the pending approvals, and the approved senders. Each platform has a pane with the sections **Connection**, **Access**, and **Integration** (Discord only). Click **Setup guide** for short setup steps.

## How a message becomes a turn

- **Allow list** — each platform has an allow list of IDs. When the allow list is empty, the platform accepts any sender that the bot can see.
- **Pairing** — the first message from a new sender creates a pending binding with a 6-digit code. Approve the binding in PtahCode before any agent work starts. See [Pairing and approvals](/automation/messaging/pairing-and-approvals/).
- **One reply per turn** — the gateway collects the agent output and sends it as one message when the turn ends.
- **Tool approval** — gateway turns use `gateway.permissionLevel`, default `ask`. Only read-only tools run without approval. Other tools ask for approval in the desktop app, and the chat gets a notice.
- **Turn limit** — when a turn does not complete in 10 minutes, PtahCode stops it and sends an error reply. The next message runs normally.
- **Abuse limit** — each sender can send a maximum of 60 messages each minute.

## Discord threads and commands

On Discord, each thread is its own PtahCode session. Slash commands let you list sessions, attach a thread to a session, start a new session, and change the workspace of a thread. See [Discord setup](/automation/messaging/discord/). Telegram and Slack do not have these commands.

## Disabled by default

The gateway starts disabled (`gateway.enabled = false`). Each platform also has a `gateway.<platform>.enabled` flag. When you click **Save & start** and the adapter starts, PtahCode sets both flags to `true`.

## Setup at a glance

1. Create a bot or app on the platform: [Telegram](/automation/messaging/telegram/), [Discord](/automation/messaging/discord/), or [Slack](/automation/messaging/slack/).
2. In **Thoth → Messaging**, select the platform.
3. Paste the token and click **Save & start**.
4. Add the IDs to allow, and click **Save allow-list**.
5. Send a message to the bot.
6. Approve the pairing code under **Pending requests**.

:::caution[Token storage]
PtahCode encrypts tokens with the OS keychain before it saves them. Do not paste raw tokens into `~/.ptah/settings.json`. Always use the token form.
:::

## Read more

- [Pairing and approvals](/automation/messaging/pairing-and-approvals/)
- [Settings](/automation/messaging/settings/)
