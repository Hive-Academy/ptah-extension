---
title: Claude
description: Configure Anthropic Claude in Ptah.
sidebar:
  order: 2
---

# Claude (Anthropic)

Claude is Ptah's default reasoning provider. It supports the full feature set: thinking, prompt caching, vision, and sub-agent spawning.

## What you need

- An Anthropic API key from the [Anthropic Console](https://console.anthropic.com/settings/keys).
- Claude model access enabled on your account.

## Available models

| Model                 | Good for                                                | Context | Thinking |
| --------------------- | ------------------------------------------------------- | ------- | -------- |
| **Claude Opus 4.7**   | The hardest reasoning tasks, long multi-file refactors. | 200k    | Yes      |
| **Claude Sonnet 4.6** | Daily development work — best speed/quality balance.    | 200k    | Yes      |
| **Claude Haiku 4.5**  | Quick edits, autocompletion, low-latency chat.          | 200k    | Limited  |

## Configuration

Open **Settings → Providers → Claude** in the app and paste your API key. The key is stored in encrypted `safeStorage`.

Non-secret Claude settings live in `~/.ptah/settings.json`:

```json
{
  "anthropicProviderId": "anthropic",
  "llm.defaultProvider": "claude"
}
```

Set `anthropicProviderId` to:

- `"anthropic"` — direct Anthropic API (requires your API key).
- `"openrouter"` — route Claude traffic through OpenRouter instead (requires an OpenRouter key — see [OpenRouter](/providers/openrouter/)).
- `"openai-codex"` / `"github-copilot"` — use Codex or Copilot's upstream Claude access.

## Verifying it works

1. Open the chat.
2. Select **Claude Sonnet 4.6** in the model selector.
3. Send a simple prompt: `What is 2 + 2?`
4. You should see a streaming response and the cost bar should show input/output tokens and a non-zero USD amount.

## Troubleshooting

- **`invalid x-api-key`** — the key is wrong or revoked. Regenerate it in the Anthropic Console and re-paste it in Settings.
- **`rate_limit_error`** — you've hit your tier's RPM or TPM cap. Wait or upgrade your Anthropic plan.
- **`model_not_found`** — your account may not have access to the selected model. Check model permissions in the Anthropic Console.
- **High cost but no output** — check the [Execution Tree](/chat/execution-tree/) for thinking-block token usage. Switch to a lower [effort level](/chat/effort-levels/) to cap thinking budget.

:::tip
Claude's prompt caching can drop costs by ~80% on long conversations. Ptah enables it automatically — watch the **cache read** number in the [cost bar](/chat/cost-and-tokens/) rise across turns.
:::
