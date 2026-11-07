---
title: OpenRouter
description: Many models with one API key, and the live pricing feed that Ptah uses for cost tracking.
sidebar:
  order: 7
---

# OpenRouter

OpenRouter gives you one API key and one endpoint for models from many vendors. Ptah talks to OpenRouter through a translation proxy on your machine.

Ptah also reads prices from the public OpenRouter model list (`https://openrouter.ai/api/v1/models`). When OpenRouter changes a price, the cost display uses the new price. If the list cannot load, Ptah uses its bundled price table.

## What you need

- An OpenRouter API key from [openrouter.ai/keys](https://openrouter.ai/keys). Keys start with `sk-or-`.
- Credit on your OpenRouter account.

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **OpenRouter**.
3. Paste your API key.
4. Select a model in the model picker.

## Model tiers

To set the OpenRouter model for each tier, open the connection and select **Models & Tiers**. The values are stored in `~/.ptah/settings.json` as `provider.openrouter.modelTier.opus`, `.sonnet`, and `.haiku`. `null` uses the default of Ptah.

## Troubleshooting

- **`401 Unauthorized`** — the key is wrong or revoked. Make a new key at openrouter.ai/keys.
- **`402 Payment Required`** — you have no credit. Add credit to your OpenRouter account.
- **`404 model not found`** — OpenRouter changed the model id. Select a current model.
