---
title: OpenRouter
description: Hundreds of models with one API key — and the live pricing feed Ptah uses for cost tracking.
sidebar:
  order: 7
---

# OpenRouter

OpenRouter is an aggregator: one API key, one endpoint, and access to hundreds of models from dozens of providers. It's the fastest way to try a new model without signing up for another service.

Ptah also uses OpenRouter's public model registry as its **live pricing data source** for cost calculations — so when OpenRouter updates prices, your cost bar updates too, no app release required.

## What you need

- An OpenRouter account and API key from [openrouter.ai/keys](https://openrouter.ai/keys).
- Credits on your OpenRouter account (pay-as-you-go).

## Configuration

1. Open **Settings → Providers → OpenRouter**.
2. Paste your OpenRouter API key. It's stored in encrypted `safeStorage`.
3. Browse the model catalog — Ptah pulls it live from OpenRouter on first load.
4. Pick a default model (or leave it unset and use the in-chat [model selector](/chat/switching-models/)).

Non-secret OpenRouter settings live in `~/.ptah/settings.json`:

```json
{
  "provider.openrouter.modelTier.opus": null,
  "provider.openrouter.modelTier.sonnet": null,
  "provider.openrouter.modelTier.haiku": null
}
```

Pin `modelTier.*` values to specific OpenRouter model slugs (e.g. `"anthropic/claude-sonnet-4"`, `"openai/gpt-5"`) to control which model Ptah picks when a sub-agent requests an Opus/Sonnet/Haiku-tier model. `null` means "use Ptah's default mapping."

## Using Claude via OpenRouter

If you set:

```json
{ "anthropicProviderId": "openrouter" }
```

all Claude traffic — including Autopilot sub-agents — is routed through OpenRouter instead of the Anthropic API. Useful if you prefer a single billing relationship.

## Verifying it works

1. Open the chat.
2. Pick any OpenRouter model (e.g. `anthropic/claude-sonnet-4`).
3. Send a prompt. You should see streaming output and a USD cost that matches the current OpenRouter price for that model.

## Troubleshooting

- **`401 Unauthorized`** — wrong or revoked API key. Regenerate at openrouter.ai/keys.
- **`402 Payment Required`** — out of credits. Top up your OpenRouter balance.
- **`404 model not found`** — the model slug has changed on OpenRouter's side. Refresh the model list from Settings.
- **Pricing shows `$0.00` when it shouldn't** — the model is missing from the registry feed. Restart Ptah to force a fresh pull.

:::tip
OpenRouter is the recommended provider for trying **Moonshot, Z-AI, Mistral, DeepSeek, and other third-party models** without signing up for each one individually. The `provider.moonshot.modelTier.*` and `provider.z-ai.modelTier.*` keys in settings let you pin specific models per tier when you route through OpenRouter.
:::
