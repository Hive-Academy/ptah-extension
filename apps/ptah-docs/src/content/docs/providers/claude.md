---
title: Claude
description: Use Anthropic Claude in Ptah through your Claude Code sign-in or an API key.
sidebar:
  order: 2
---

# Claude (Anthropic)

You can use Claude in two ways:

| Connection                  | What you need                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- |
| **Claude (Subscription)**   | Claude Code installed and signed in. No API key.                              |
| **Claude API**              | An Anthropic API key from the [Anthropic Console](https://console.anthropic.com/settings/keys). |

## Use your Claude Code sign-in

1. Install Claude Code and sign in to it in a terminal.
2. In Ptah, open **Settings → Providers**.
3. Click **Connect provider**, then **Connect** next to **Claude (Subscription)**.

If Ptah shows **Sign in with the Claude CLI in a terminal.**, Claude Code is not signed in. Sign in, then examine the connection again. To check Claude Code at any time, open **Settings → Advanced** and click **Check Claude Code**.

### Named Claude accounts

A Claude (Subscription) connection has an **Accounts** tab. Use it to add more Claude accounts and pick one for each agent lane.

## Use an API key

1. Create an API key in the [Anthropic Console](https://console.anthropic.com/settings/keys).
2. In Ptah, open **Settings → Providers**.
3. Click **Connect provider**, then **Connect** next to **Claude API**.
4. Paste the key.

Ptah stores the key in encrypted storage.

## Verify that it works

1. Open a chat.
2. Select a Claude model in the model selector.
3. Send a short prompt.
4. Make sure that the response streams and that the cost display shows token counts.

## Troubleshooting

- **`invalid x-api-key`** — the key is wrong or revoked. Make a new key in the Anthropic Console and paste it again.
- **`rate_limit_error`** — you are at the rate limit of your Anthropic plan. Wait, or change your plan.
- **`model_not_found`** — your account cannot use the selected model. Select a different model.
- **High cost with little output** — examine the [Execution Tree](/chat/execution-tree/) for thinking tokens. Select a lower [effort level](/chat/effort-levels/).
