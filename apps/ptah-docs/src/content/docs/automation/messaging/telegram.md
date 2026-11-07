---
title: Telegram Setup
description: Talk to PtahCode from a Telegram chat.
---

# Telegram Setup

## 1. Create a bot

1. Open a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Select a name and a username.
4. Copy the token that BotFather sends (for example `123456:ABC-...`).

## 2. Find your Telegram user ID

You need your numeric user ID for the allow list. A user ID is a number, not a `@username`. A bot such as "userinfobot" can tell you your ID.

## 3. Configure PtahCode

1. Open **Thoth → Messaging → Telegram**.
2. In **Connection**, paste the bot token and click **Save & start**.
3. In **Access**, add your user ID to the allow list, one ID on each line.
4. Click **Save allow-list**.

For a group chat, add the group chat ID to the allow list too. The bot ignores group chats that are not on the allow list.

## 4. Pair the binding

1. In Telegram, send a message to your bot.
2. The bot replies with a 6-digit pairing code.
3. In **Access → Pending requests**, type the code and click **Approve**.

After approval, each message that you send starts an agent turn. The bot sends one reply when the turn ends.

:::tip
More than one Telegram account can use the same bot. Add each user ID to the allow list. Each account gets its own binding and its own pairing code.
:::
