---
title: Discord Setup
description: Talk to Ptah from a Discord server.
---

# Discord Setup

## 1. Create a Discord application + bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it
3. Sidebar → **Bot** → **Add Bot**
4. Copy the bot token (you'll only see it once)

## 2. Enable required intents and scopes

In the Bot tab:

- Enable the **Message Content** privileged intent

In the OAuth2 → URL Generator tab, when generating the invite URL, select scopes:

- `bot`
- `applications.commands`

Bot permissions: at minimum **Send Messages** and **Read Message History**.

## 3. Invite the bot to your guild

Use the generated OAuth2 URL to invite the bot. Note the guild ID (right-click the server icon with developer mode on → **Copy Server ID**).

## 4. Configure Ptah

Open **Settings → Messaging → Discord**:

1. Paste the bot token (encrypted by the UI before persisting)
2. Add the guild ID to **Allowed guild IDs** (`gateway.discord.allowedGuildIds`)
3. Enable **Discord** (`gateway.discord.enabled = true`)
4. Enable the global **Messaging Gateway** (`gateway.enabled = true`)

## 5. Pair the binding

1. In any allowed guild, message the bot (DM or @-mention in a channel it can read)
2. The bot replies with a 6-digit pairing code
3. Approve the binding in **Settings → Messaging → Bindings**

The Discord adapter is `discord.js`-compatible and shipped as `DiscordAdapter`.

:::note
A single bot can be whitelisted across multiple guilds. Each guild + user pair becomes its own binding with independent pairing.
:::
