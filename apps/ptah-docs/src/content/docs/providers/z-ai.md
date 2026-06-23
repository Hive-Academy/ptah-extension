---
title: Z.AI (GLM)
description: Configure Z.AI's GLM models as a ptah-cli provider.
sidebar:
  order: 10
---

# Z.AI (GLM)

Z.AI's GLM models are available in Ptah as a **ptah-cli provider** — an Anthropic-compatible API provider that joins the CLI agent pool alongside Codex and Copilot. The flagship coding model is `glm-5.2`, with a 1M-token context window.

## Models

| Model     | Context | Pricing (per 1M tokens) | Notes                                          |
| --------- | ------- | ----------------------- | ---------------------------------------------- |
| `glm-5.2` | 1M      | ~$1.40 in / $4.40 out   | Opus-tier. Strongest open-source coding model. |

`glm-5.2` is the **opus-tier** model for the Z.AI family — it's what Ptah selects when a high-capability Z.AI agent is requested (including when Z.AI joins a [Tribunal](/tribunal/) panel).

:::note
Pricing figures are approximate and subject to change. Check the [Z.AI platform](https://z.ai/) for current rates.
:::

## What you need

- A Z.AI account and API key from [z.ai](https://z.ai/).
- The Ptah Electron desktop app, or `ptah-cli` for headless use.

## Configuration

Add Z.AI from **Settings → Providers → Ptah CLI** in the app:

1. Add a new Ptah CLI provider and choose **Z.AI** as the provider.
2. Paste your Z.AI API key. The key is stored in encrypted `safeStorage` — never in plaintext.
3. Save. Z.AI now appears in the model selector and the CLI agent pool.

Ptah registers Z.AI as an Anthropic-compatible provider and maps its capability tiers to concrete models automatically. Non-secret tier mappings live in `~/.ptah/settings.json`:

```json
{
  "provider.z-ai.modelTier.opus": "glm-5.2",
  "provider.z-ai.modelTier.sonnet": "glm-5.1",
  "provider.z-ai.modelTier.haiku": "glm-4.7-flashx"
}
```

Set any tier to `null` to fall back to Ptah's default for that tier.

## Long-context capabilities

`glm-5.2`'s 1M-token context window suits tasks that reason over large codebases, long session histories, or extensive reference material in one pass. Ptah passes the active context to GLM automatically — no special configuration needed to use the extended window.

:::tip
For [Tribunal Council](/tribunal/council/) sessions with long prior context, routing through Z.AI can be advantageous — the 1M window means GLM sees everything the other vendors see, even in deeply nested debates.
:::

## Verifying it works

1. Open the chat and select your **Z.AI** agent from the model selector.
2. Send a coding prompt: `Write a Go function that parses a nested JSON structure into a typed struct.`
3. You should see a streaming response, attributed to the Z.AI ptah-cli provider in the [Execution Tree](/chat/execution-tree/).

## Tribunal panel participation

When [Tribunal](/tribunal/) assembles a panel, Z.AI joins as the **GLM vendor family** if its ptah-cli agent is enabled — contributing a GLM answer and critique to each [Council](/tribunal/council/), a worktree implementation in [Forge](/tribunal/forge/), and an attempt in [Race](/tribunal/race/). To drop Z.AI from the panel, disable or remove its agent in **Settings → Providers**.

## Troubleshooting

- **Agent not listed in the selector** — confirm the Z.AI provider is enabled in Settings, then restart Ptah.
- **Authentication error** — the API key is wrong or expired. Re-enter it in **Settings → Providers → Ptah CLI**.
- **Model unavailable** — your Z.AI account may not have access to `glm-5.2`. Check model availability in the Z.AI console.
- **Context length errors** — if you hit the 1M-token limit, shorten the conversation history or run `/compact` before continuing.
