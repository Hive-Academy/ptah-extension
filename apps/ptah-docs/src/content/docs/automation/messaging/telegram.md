---
title: Telegram Setup
description: Talk to Ptah from a Telegram chat.
---

# Telegram Setup

## 1. Create a bot

1. Open a chat with [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Pick a name and a username
4. BotFather replies with a token (looks like `1234567890:ABC...`). Copy it

## 2. Find your Telegram user ID

You'll need this to whitelist yourself. Talk to a "userinfobot" or similar — the ID is a number, not a `@username`.

## 3. Configure Ptah

Open **Settings → Messaging → Telegram**:

1. Paste the bot token. The UI encrypts it via the OS keyring before persisting — never edit it directly in `settings.json`
2. Add your numeric user ID to **Allowed user IDs** (`gateway.telegram.allowedUserIds`)
3. Enable **Telegram** (`gateway.telegram.enabled = true`)
4. Enable the global **Messaging Gateway** (`gateway.enabled = true`)

## 4. Pair the binding

1. Open Telegram and send any message to your bot
2. The bot replies with a 6-digit pairing code
3. Open **Settings → Messaging → Bindings** in Ptah
4. Approve the pending binding using the code

After approval, every subsequent message you send is forwarded to the agent. Replies stream back as edits to a single message (see [Stream coalescing](/automation/messaging/stream-coalescing/)).

## Voice messages

Send a voice note like normal — Ptah transcribes via Whisper and sends the text to the agent. Requires ffmpeg available on the host. See [Voice messages](/automation/messaging/voice-messages/).

:::tip
You can talk to the same bot from multiple Telegram accounts as long as each user ID is in the allow-list. Each account gets its own binding and its own pairing code.
:::
