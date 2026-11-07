---
title: Kimi Code
description: Use a Kimi Code subscription in Ptah.
sidebar:
  order: 9
---

# Kimi Code

Kimi Code connects Ptah to the Kimi models of a **Kimi Code subscription**. Ptah connects to `https://api.kimi.ai/coding/` through an Anthropic-compatible API.

## What you need

- A Kimi Code subscription. See [kimi.com/code](https://www.kimi.com/code).
- Optional: a Kimi Code API key.

Which models you can use depends on your Kimi Code plan.

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **Kimi Code**.
3. Click **Sign in with Kimi Code** and complete the sign-in. Or paste a Kimi Code API key.

Ptah stores the key in encrypted storage.

To use Kimi Code as an extra CLI agent lane, add a [Ptah CLI instance](/providers/ptah-cli/) on this connection.

## Model tiers

Ptah has a default tier map for Kimi Code. If your plan does not include a default model, open the connection, select **Models & Tiers**, and pick a different model for that tier.

## Cost

Kimi Code bills against your plan quota. Ptah shows no per-token cost for it, but it still counts tokens. Examine your quota in the Kimi Code console.

## Troubleshooting

- **Authentication error** — the sign-in expired or the key is wrong. Sign in again, or paste a new key.
- **Model unavailable** — your plan does not include that model. Pick a different model for the tier, or change your plan.
- **Cannot connect** — make sure that your network can reach `api.kimi.ai`.
