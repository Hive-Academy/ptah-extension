---
title: GitHub Copilot
description: Use your GitHub Copilot plan through Ptah.
sidebar:
  order: 3
---

# GitHub Copilot

If you already pay for GitHub Copilot, you can use its models in Ptah at no added API cost.

## What you need

- A GitHub account with an active Copilot plan.

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **GitHub Copilot**.
3. Sign in with GitHub. Your browser opens the GitHub consent page.
4. Approve the sign-in.

Ptah stores the token in encrypted storage.

## Settings

Non-secret Copilot settings are in `~/.ptah/settings.json`. An empty string or `null` uses the default of Ptah.

| Key                                                  | Use                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `provider.github-copilot.modelTier.opus` / `.sonnet` / `.haiku` | The Copilot model for each tier. You can also set these in **Models & Tiers**. |
| `provider.github-copilot.tokenExchangeUrl`, `.apiEndpoint`, `.clientId` | Custom endpoints. Change them only if your Copilot admin gives you values. |
| `agentOrchestration.copilotAutoApprove`              | Default `true`. In Settings, this is **Auto-approve Copilot tool calls**. |

## Verify that it works

1. Open a chat.
2. Select a Copilot model.
3. Send a prompt.

Ptah shows a cost of $0 for Copilot, because Copilot bills you separately. Ptah still counts the tokens.

## Troubleshooting

- **The browser sign-in does not return to Ptah** — make sure that your browser does not block the `http://localhost` callback. Try a different browser.
- **`403 Forbidden`** — your Copilot plan does not include the model. Select a different model.
- **`401 Unauthorized` after some time** — the token expired. Sign out, then sign in again.
