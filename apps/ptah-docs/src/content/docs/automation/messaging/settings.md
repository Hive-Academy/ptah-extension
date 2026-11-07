---
title: Messaging Settings
description: Gateway settings and their defaults.
---

# Messaging Settings

Gateway settings use the `gateway.*` prefix in `~/.ptah/settings.json`. The **Messaging** tab writes the tokens, the allow lists, and the enable flags for you. Edit the other keys in the file.

## Global

| Key                               | Default | What it does                                                         |
| --------------------------------- | ------- | -------------------------------------------------------------------- |
| `gateway.enabled`                 | `false` | Master switch. It must be `true` for any platform to connect         |
| `gateway.rateLimit.minTimeMs`     | `500`   | Shown as a read-only value in the Messaging tab                      |
| `gateway.rateLimit.maxConcurrent` | `2`     | Shown as a read-only value in the Messaging tab                      |
| `gateway.voice.enabled`           | `true`  | Lets the gateway transcribe voice notes that an adapter supplies     |

The tool approval level for gateway turns is `gateway.permissionLevel`: `ask` (default), `auto-edit`, or `yolo`. This key is not a `settings.json` key, and the Messaging tab has no control for it.

:::note
The adapters do not download voice notes at this time. A voice note without text does not start a turn.
:::

## Telegram

| Key                               | Default | What it does                                 |
| --------------------------------- | ------- | -------------------------------------------- |
| `gateway.telegram.enabled`        | `false` | Platform switch                              |
| `gateway.telegram.tokenCipher`    | (empty) | Encrypted bot token. Do not edit it          |
| `gateway.telegram.allowedUserIds` | `[]`    | Numeric Telegram user IDs and group chat IDs |

## Discord

| Key                               | Default | What it does                                    |
| --------------------------------- | ------- | ----------------------------------------------- |
| `gateway.discord.enabled`         | `false` | Platform switch                                 |
| `gateway.discord.tokenCipher`     | (empty) | Encrypted bot token. Do not edit it             |
| `gateway.discord.allowedGuildIds` | `[]`    | Server (guild) IDs where the bot can work       |
| `gateway.discord.applicationId`   | (empty) | Application ID for the invite link and commands |

## Slack

| Key                            | Default | What it does                                      |
| ------------------------------ | ------- | ------------------------------------------------- |
| `gateway.slack.enabled`        | `false` | Platform switch                                   |
| `gateway.slack.botTokenCipher` | (empty) | Encrypted bot token (`xoxb-...`). Do not edit it  |
| `gateway.slack.appTokenCipher` | (empty) | Encrypted app-level token (`xapp-...`)            |
| `gateway.slack.allowedTeamIds` | `[]`    | Slack workspace (team) IDs where the app can work |

## Storage

Bindings, pairing codes, and message records are stored in `~/.ptah/ptah.db`.
