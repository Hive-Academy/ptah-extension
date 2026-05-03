---
title: Messaging Gateway
description: Drive Ptah from Telegram, Discord, or Slack — voice messages welcome.
---

# Messaging Gateway

Send a message, get an AI reply with full workspace tools. The Messaging Gateway lets you run Ptah from your phone, your team chat, or anywhere else you can text.

## Supported platforms

| Platform | Adapter                   | Voice messages |
| -------- | ------------------------- | -------------- |
| Telegram | Bot API                   | Yes            |
| Discord  | discord.js-compatible     | Yes            |
| Slack    | `@slack/bolt` Socket Mode | Yes            |

## What works the same everywhere

- **Pairing** — first inbound message from a new sender produces a 6-digit code; you approve the binding in the Bindings UI before any agent work happens
- **Voice** — audio attachments are decoded with ffmpeg and transcribed by `nodejs-whisper`
- **Streaming** — partial AI output is coalesced into ≤3 message edits per ~250ms window so chat doesn't flap
- **Approval gates** — anything destructive still goes through Ptah's normal approval prompts; the chat platform just relays them

## Disabled by default

The gateway ships with `gateway.enabled = false`. Each platform also has its own `gateway.<platform>.enabled` flag. **Both** must be `true` for that platform to connect.

This is intentional. Bots-with-tools are a real attack surface — opt-in only.

## Setup at a glance

1. Create a bot / app on the platform (instructions per-platform: [Telegram](/automation/messaging/telegram/) · [Discord](/automation/messaging/discord/) · [Slack](/automation/messaging/slack/))
2. Paste tokens into Settings → Messaging → \[platform\]
3. Whitelist the user / guild / team IDs you want to allow
4. Enable the platform, then enable the gateway
5. Send a message → approve the pairing code → start working

:::caution[Token storage]
Tokens are encrypted at rest using the OS keyring via `electron-safe-storage-vault`. **Never paste raw tokens into `~/.ptah/settings.json`** — always use the Settings UI, which encrypts before persisting.
:::

## Read more

- [Pairing & approvals](/automation/messaging/pairing-and-approvals/) — how new senders get authorised
- [Voice messages](/automation/messaging/voice-messages/) — ffmpeg + whisper setup
- [Stream coalescing](/automation/messaging/stream-coalescing/) — why your chat won't flap
- [Settings](/automation/messaging/settings/) — every gateway tunable
