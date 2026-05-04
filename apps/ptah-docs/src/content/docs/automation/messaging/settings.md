---
title: Messaging Settings
description: Every gateway tunable, with defaults.
---

# Messaging Settings

Gateway settings live under the `gateway.*` prefix in `~/.ptah/settings.json`. Edit through **Settings → Messaging**.

## Global

| Key                     | Default | What it does                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------ |
| `gateway.enabled`       | `false` | Master kill-switch. **Must** be `true` for any platform to connect |
| `gateway.coalesceMs`    | `800`   | Stream coalesce window in milliseconds                             |
| `gateway.voice.enabled` | `true`  | Whether voice attachments are transcribed and forwarded            |

## Per-platform shape

Each platform exposes the same shape, with its own credential field:

| Key                              | Default | What it does                                              |
| -------------------------------- | ------- | --------------------------------------------------------- |
| `gateway.<platform>.enabled`     | `false` | Per-platform kill-switch                                  |
| `gateway.<platform>.tokenCipher` | (none)  | OS-keyring-encrypted token blob — **never** edit directly |
| `gateway.<platform>.allowed*Ids` | `[]`    | Whitelist of user / guild / team IDs                      |

### Telegram

| Key                               | Default | What it does                              |
| --------------------------------- | ------- | ----------------------------------------- |
| `gateway.telegram.enabled`        | `false` | Per-platform kill-switch                  |
| `gateway.telegram.tokenCipher`    | (none)  | Encrypted bot token                       |
| `gateway.telegram.allowedUserIds` | `[]`    | Numeric Telegram user IDs allowed to pair |

### Discord

| Key                               | Default | What it does                     |
| --------------------------------- | ------- | -------------------------------- |
| `gateway.discord.enabled`         | `false` | Per-platform kill-switch         |
| `gateway.discord.tokenCipher`     | (none)  | Encrypted bot token              |
| `gateway.discord.allowedGuildIds` | `[]`    | Guild IDs the bot may operate in |

### Slack

| Key                            | Default | What it does                                |
| ------------------------------ | ------- | ------------------------------------------- |
| `gateway.slack.enabled`        | `false` | Per-platform kill-switch                    |
| `gateway.slack.tokenCipher`    | (none)  | Encrypted bot + app token blob              |
| `gateway.slack.allowedTeamIds` | `[]`    | Workspace (team) IDs the bot may operate in |

:::caution[Token storage]
Tokens are encrypted at rest using the OS keyring via `electron-safe-storage-vault`. **Always paste tokens through the Settings UI** — it encrypts before writing `tokenCipher`. Never put raw tokens into `~/.ptah/settings.json`.
:::

## Storage

Bindings, pairing codes, and message-tracking state live in `~/.ptah/ptah.db`. Backing up that file backs up your gateway state.
