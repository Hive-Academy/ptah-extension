---
title: Sakana (Fugu)
description: Sakana AI's Fugu models through a translation proxy on your machine.
---

[Sakana AI](https://sakana.ai) serves its **Fugu** models over an OpenAI-compatible API at `https://api.sakana.ai/v1`. Ptah converts between the Anthropic Messages protocol and OpenAI Chat Completions with a translation proxy on your machine.

## What you need

An API key from [console.sakana.ai/api-keys](https://console.sakana.ai/api-keys).

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **Sakana (Fugu)**.
3. Paste your API key.

Ptah stores the key in encrypted storage.

## Models and tiers

Ptah reads the model list live from Sakana. Ptah has a default tier map for Fugu (`fugu-ultra` for `opus`, `fugu` for `sonnet` and `haiku`). To change it, open the connection and select **Models & Tiers**.

## Cost

Sakana does not publish prices, so Ptah has no cost data for Fugu. The cost display shows $0. Examine your Sakana console for real spend.

## Troubleshooting

- **"Unauthorized"** — the key is wrong or revoked. Make a new key and paste it again.
- **Tool calls behave incorrectly** — tool calls go through the translation proxy. Report the problem with the [execution tree](/chat/execution-tree/) attached.
