---
title: OpenAI Codex
description: Set up the OpenAI Codex SDK in Ptah.
sidebar:
  order: 4
---

# OpenAI Codex

The OpenAI Codex integration gives Ptah access to the GPT-5 family and Codex CLI agents with reasoning-effort control.

## What you need

- An OpenAI account with API access from the [OpenAI Platform](https://platform.openai.com/api-keys), **or** a ChatGPT subscription for the OAuth path.

## Configuration

You have two ways to authenticate:

### API key (direct)

1. Create an API key at [platform.openai.com](https://platform.openai.com/api-keys).
2. Open **Settings → Providers → OpenAI Codex**.
3. Paste the key. It's stored in encrypted `safeStorage`.

### OAuth (ChatGPT subscription)

:::caution[Pro tier]
The Codex OAuth flow (using your ChatGPT subscription for API-style access) is a **Ptah Pro** feature.
:::

1. Open **Settings → Providers → OpenAI Codex**.
2. Click **Sign in with ChatGPT**.
3. Approve the Ptah app in your browser.

Non-secret Codex settings live in `~/.ptah/settings.json`:

```json
{
  "provider.openai-codex.oauthApiEndpoint": "",
  "provider.openai-codex.modelTier.opus": null,
  "provider.openai-codex.modelTier.sonnet": null,
  "provider.openai-codex.modelTier.haiku": null,
  "agentOrchestration.codexModel": "",
  "agentOrchestration.codexReasoningEffort": "",
  "agentOrchestration.codexAutoApprove": true
}
```

- `codexReasoningEffort` accepts `"low"`, `"medium"`, or `"high"` (empty string uses the in-chat [effort level](/chat/effort-levels/)).
- `codexAutoApprove: true` lets the Codex CLI auto-approve sandbox operations; set to `false` to require manual approval.

## Verifying it works

1. Open the chat.
2. Select a **GPT-5** or **Codex** model.
3. Send a prompt that requires reasoning: `Explain the time complexity of quicksort with and without the median-of-three optimization.`
4. You should see a streaming response with thinking tokens visible in the [Execution Tree](/chat/execution-tree/).

## Troubleshooting

- **`invalid_api_key`** — regenerate the key at platform.openai.com.
- **`model_not_available`** — your org may not have GPT-5 access yet. Try `gpt-4o` or request access.
- **Codex CLI not detected as a sub-agent** — make sure the Codex CLI is installed and on your `PATH`, then restart Ptah. Check that `codex` isn't in `agentOrchestration.disabledClis`.
- **OAuth sign-in fails** — requires a ChatGPT Plus/Team/Enterprise plan. Free ChatGPT accounts can't use the OAuth path; use an API key instead.
