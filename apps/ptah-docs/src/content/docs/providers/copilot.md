---
title: GitHub Copilot
description: Use your GitHub Copilot subscription through Ptah.
sidebar:
  order: 3
---

# GitHub Copilot

GitHub Copilot is integrated in Ptah via OAuth. If you already pay for Copilot, you can use its models inside Ptah at no additional API cost.

:::caution[Pro tier]
Copilot OAuth is a **Ptah Pro** feature. You still need an active GitHub Copilot subscription — Ptah Pro unlocks the integration, not the underlying service.
:::

## What you need

- A GitHub account with an active Copilot subscription (Individual, Business, or Enterprise).
- Ptah Pro license, signed in.

## Configuration

1. Open **Settings → Providers → GitHub Copilot**.
2. Click **Sign in with GitHub**. Your default browser opens to the GitHub OAuth consent page.
3. Approve the Ptah app.
4. The app returns to Ptah and stores the OAuth token in encrypted `safeStorage`.

Non-secret Copilot settings live in `~/.ptah/settings.json`:

```json
{
  "provider.github-copilot.tokenExchangeUrl": "",
  "provider.github-copilot.apiEndpoint": "",
  "provider.github-copilot.clientId": "",
  "provider.github-copilot.modelTier.opus": null,
  "provider.github-copilot.modelTier.sonnet": null,
  "provider.github-copilot.modelTier.haiku": null,
  "agentOrchestration.copilotModel": "",
  "agentOrchestration.copilotReasoningEffort": "",
  "agentOrchestration.copilotAutoApprove": true
}
```

Empty strings and `null` values mean "use Ptah's defaults." Override `tokenExchangeUrl`, `apiEndpoint`, and `clientId` only if you are on Copilot Enterprise with a custom endpoint — your admin will supply the values.

The `modelTier.*` fields let you pin which upstream Copilot model is used when Ptah's sub-agent orchestrator asks for an Opus/Sonnet/Haiku-tier model.

## Verifying it works

1. Open the chat.
2. Pick any **Copilot** model in the selector.
3. Send a prompt. You should get a streaming response with a $0 cost (your Copilot subscription covers the tokens).

## Troubleshooting

- **OAuth window closes without returning** — check that your browser isn't blocking the `http://localhost` callback. Try a different browser.
- **`403 Forbidden`** — your Copilot plan doesn't include the model you picked. Choose a different Copilot model.
- **`401 Unauthorized`** after working for a while — the OAuth token expired. Click **Sign out** then sign in again from Settings.
- **Enterprise "unknown endpoint"** — ask your Copilot admin for `tokenExchangeUrl`, `apiEndpoint`, and `clientId` values and paste them into `~/.ptah/settings.json`.

:::note
Copilot-served Claude and GPT models are routed through Copilot's infrastructure. Ptah reports $0 per turn because Copilot bills you separately. Tokens are still tracked in the [Execution Tree](/chat/execution-tree/).
:::
