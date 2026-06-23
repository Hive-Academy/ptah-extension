---
title: Moonshot (Kimi)
description: Configure Moonshot's Kimi models as a ptah-cli provider.
sidebar:
  order: 9
---

# Moonshot (Kimi)

Moonshot's Kimi models are available in Ptah as a **ptah-cli provider** — an Anthropic-compatible API provider that joins the CLI agent pool alongside Codex and Copilot. The flagship coding model is `kimi-k2.7-code`.

## Models

| Model                      | Context | Pricing (per 1M tokens) | Notes                               |
| -------------------------- | ------- | ----------------------- | ----------------------------------- |
| `kimi-k2.7-code`           | 256K    | ~$0.95 in / $4.00 out   | Opus-tier. Agentic coding flagship. |
| `kimi-k2.7-code-highspeed` | 256K    | Varies                  | Lower-latency variant.              |

`kimi-k2.7-code` is the **opus-tier** model for the Moonshot family — it's what Ptah selects when a high-capability Moonshot agent is requested (including when Moonshot joins a [Tribunal](/tribunal/) panel).

:::note
Pricing figures are approximate and subject to change. Check the [Moonshot platform](https://platform.moonshot.ai/) for current rates.
:::

## What you need

- A Moonshot account and API key from [platform.moonshot.ai](https://platform.moonshot.ai/console/api-keys).
- The Ptah Electron desktop app, or `ptah-cli` for headless use.

## Configuration

Add Moonshot from **Settings → Providers → Ptah CLI** in the app:

1. Add a new Ptah CLI provider and choose **Moonshot** as the provider.
2. Paste your Moonshot API key. The key is stored in encrypted `safeStorage` — never in plaintext.
3. Save. Moonshot now appears in the model selector and the CLI agent pool.

Ptah registers Moonshot as an Anthropic-compatible provider and maps its capability tiers to concrete models automatically. Non-secret tier mappings live in `~/.ptah/settings.json`:

```json
{
  "provider.moonshot.modelTier.opus": "kimi-k2.7-code",
  "provider.moonshot.modelTier.sonnet": "kimi-k2.6",
  "provider.moonshot.modelTier.haiku": "kimi-k2.5"
}
```

Set any tier to `null` to fall back to Ptah's default for that tier.

## Verifying it works

1. Open the chat and select your **Moonshot** agent from the model selector.
2. Send a coding prompt: `Write a TypeScript function that validates an ISO 8601 date string.`
3. You should see a streaming response, attributed to the Moonshot ptah-cli provider in the [Execution Tree](/chat/execution-tree/).

## Tribunal panel participation

When [Tribunal](/tribunal/) assembles a panel, Moonshot joins as the **Kimi vendor family** if its ptah-cli agent is enabled — contributing a Kimi answer and critique to each [Council](/tribunal/council/), a worktree implementation in [Forge](/tribunal/forge/), and an attempt in [Race](/tribunal/race/). To drop Moonshot from the panel, disable or remove its agent in **Settings → Providers**.

## Troubleshooting

- **Agent not listed in the selector** — confirm the Moonshot provider is enabled in Settings, then restart Ptah.
- **Authentication error** — the API key is wrong or expired. Re-enter it in **Settings → Providers → Ptah CLI**; regenerate it at [platform.moonshot.ai](https://platform.moonshot.ai/console/api-keys) if needed.
- **Model unavailable** — your Moonshot account may not have access to `kimi-k2.7-code`. Check model permissions in the Moonshot console.
- **Slow first response** — Kimi K2.7 at 256K context can have a brief cold start; subsequent turns in the same session are faster.
