---
title: Kimi Code
description: Use a Kimi Code subscription as a ptah-cli provider.
sidebar:
  order: 9
---

# Kimi Code

Kimi Code is available in Ptah as a **ptah-cli provider** — an Anthropic-compatible API provider that joins the CLI agent pool alongside Codex and Copilot. It runs on a **Kimi Code subscription**, not on pay-as-you-go API credit.

:::caution[Moving from the Moonshot Platform?]
Ptah no longer offers the Moonshot Platform (pay-as-you-go) provider. An old Moonshot Platform API key does **not** work with Kimi Code. Create a key in the Kimi Code console and enter it in Ptah instead.
:::

## Models

Which models you can use depends on your Kimi Code plan.

| Model                        | Context | Plan                     |
| ---------------------------- | ------- | ------------------------ |
| `k3.1-pro`                   | 256K    | Plus / Moderato and up   |
| `k3.1-pro[1m]`               | 1M      | Pro / Allegretto and up  |
| `k3.1-pro-highspeed`         | 1M      | Pro / Allegretto and up  |
| `k3`                         | 256K    | Plus and up              |
| `k3-256k`                    | 256K    | Plus and up              |
| `kimi-for-coding`            | 1M      | Andante and up           |
| `kimi-for-coding-highspeed`  | 256K    | Pro / Allegretto and up  |

Ptah maps its capability tiers to these defaults:

| Tier       | Default model     |
| ---------- | ----------------- |
| **opus**   | `k3.1-pro`        |
| **sonnet** | `k3`              |
| **haiku**  | `kimi-for-coding` |

The opus tier is what Ptah selects when a high-capability Kimi agent is requested (including when Kimi joins a [Tribunal](/tribunal/) panel). If your plan does not include a tier's default model, pick another model for that tier as described below.

## What you need

- A Kimi Code subscription and an API key from the Kimi Code console at [kimi.com/code](https://www.kimi.com/code).
- The Ptah Electron desktop app, or `ptah-cli` for headless use.

:::note
Kimi Code is available overseas only. Ptah connects to `https://api.kimi.ai/coding/`.
:::

## Configuration

Add Kimi Code from **Settings → Providers → Ptah CLI** in the app:

1. Add a new Ptah CLI provider and choose **Kimi Code** as the provider.
2. Paste your Kimi Code API key. The key is stored in encrypted `safeStorage` — never in plaintext. Ptah sends it as `ANTHROPIC_API_KEY` (the `x-api-key` header), as the Kimi Code documentation specifies.
3. Save. Kimi Code now appears in the model selector and the CLI agent pool.

Ptah registers Kimi Code as an Anthropic-compatible provider with the base URL above and maps its capability tiers to concrete models automatically. Model tiers and effort are configurable like any other provider. Non-secret tier mappings live in `~/.ptah/settings.json`:

```json
{
  "provider.kimi-code.mainAgent.modelTier.opus": "k3.1-pro",
  "provider.kimi-code.mainAgent.modelTier.sonnet": "k3",
  "provider.kimi-code.mainAgent.modelTier.haiku": "kimi-for-coding"
}
```

Set any tier to `null` to fall back to Ptah's default for that tier.

## Cost and usage

Kimi Code bills against your plan quota, so Ptah shows **no per-token cost** for it. Cost is displayed as covered by your subscription, or as unavailable. Tokens are still counted. Check your remaining quota in the Kimi Code console. See [Cost and tokens](/chat/cost-and-tokens/).

## Verifying it works

1. Open the chat and select your **Kimi Code** agent from the model selector.
2. Send a coding prompt: `Write a TypeScript function that validates an ISO 8601 date string.`
3. You should see a streaming response, attributed to the Kimi Code ptah-cli provider in the [Execution Tree](/chat/execution-tree/).

## Tribunal panel participation

When [Tribunal](/tribunal/) assembles a panel, Kimi Code joins as the **Kimi vendor family** if its ptah-cli agent is enabled — contributing a Kimi answer and critique to each [Council](/tribunal/council/), a worktree implementation in [Forge](/tribunal/forge/), and an attempt in [Race](/tribunal/race/). To drop Kimi from the panel, disable or remove its agent in **Settings → Providers**.

## Troubleshooting

- **Agent not listed in the selector** — confirm the Kimi Code provider is enabled in Settings, then restart Ptah.
- **Authentication error** — the key is wrong, expired, or is an old Moonshot Platform key. Create a Kimi Code key at [kimi.com/code](https://www.kimi.com/code) and re-enter it in **Settings → Providers → Ptah CLI**.
- **Model unavailable** — your plan may not include that model (see the plan column above). Choose a different model for the tier, or upgrade your plan.
- **Cannot connect** — Kimi Code is overseas only; confirm your network can reach `api.kimi.ai`.
