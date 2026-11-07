---
title: Requesty
description: Many models through one Anthropic-compatible router.
---

[Requesty](https://requesty.ai) is a router. One key reaches many models from many vendors.

Requesty speaks the Anthropic Messages protocol. Ptah sends requests directly to `https://router.requesty.ai`, with no translation proxy.

## What you need

An API key from [app.requesty.ai/api-keys](https://app.requesty.ai/api-keys). Ptah does not check the format of the key. The connection test tells you if it works.

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **Requesty**.
3. Paste your API key.

Ptah stores the key in encrypted storage.

## Models and tiers

Ptah reads the model list live from Requesty. Requesty has no default tier map, so Ptah derives the map from the live list. If the result is wrong, open the connection, select **Models & Tiers**, and set the tiers. Your choice always has priority.

## Cost

Requesty bills you directly.

## Troubleshooting

- **A 404 on the first message** — the tier did not resolve to a model. Select a model in the picker, or set the tiers.
- **"Unauthorized"** — the key is wrong or revoked. Make a new key and paste it again.
