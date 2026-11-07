---
title: Z.AI (GLM)
description: Use Z.AI's GLM models in Ptah.
sidebar:
  order: 10
---

# Z.AI (GLM)

Z.AI serves its GLM models over an Anthropic-compatible API at `https://api.z.ai/api/anthropic`.

## What you need

- A Z.AI API key. See [open.z.ai](https://open.z.ai/open/api/openkey).

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **Z.AI (GLM)**.
3. Paste your API key.

Ptah stores the key in encrypted storage.

To use Z.AI as an extra CLI agent lane, add a [Ptah CLI instance](/providers/ptah-cli/) on this connection.

## Model tiers

Ptah has a default tier map for Z.AI. To change it, open the connection and select **Models & Tiers**. The values are stored in `~/.ptah/settings.json` as `provider.z-ai.modelTier.opus`, `.sonnet`, and `.haiku`. `null` uses the default.

## Troubleshooting

- **Authentication error** — the key is wrong or expired. Paste a new key.
- **Model unavailable** — your Z.AI account cannot use the model. Select a different model for the tier.
- **Context length errors** — shorten the conversation, or start a new session.
