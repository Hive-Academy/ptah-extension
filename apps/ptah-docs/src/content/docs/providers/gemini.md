---
title: Gemini
description: Configure Google Gemini in Ptah.
sidebar:
  order: 5
---

# Gemini (Google)

Gemini 2.5 Pro and Flash give you large-context reasoning and strong vision — useful for analyzing long files, images, and PDFs.

## What you need

- A Google API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- Gemini API access enabled on your Google Cloud or AI Studio project.

## Available models

| Model                     | Good for                                                    | Context   |
| ------------------------- | ----------------------------------------------------------- | --------- |
| **Gemini 2.5 Pro**        | Long-context analysis, multi-file understanding, reasoning. | 2M tokens |
| **Gemini 2.5 Flash**      | Fast chat, cheap completions, drafts.                       | 1M tokens |
| **Gemini 2.5 Flash-Lite** | High-volume, low-cost classification.                       | 1M tokens |

## Configuration

1. Open **Settings → Providers → Gemini**.
2. Paste your Google API key. It's stored in encrypted `safeStorage`.
3. Optionally pick a default model.

The Gemini CLI (if installed) is detected automatically and becomes available as a sub-agent target. Gemini has the **second-highest priority** in CLI detection, after `ptah-cli`.

Non-secret agent-orchestration settings live in `~/.ptah/settings.json`:

```json
{
  "agentOrchestration.disabledClis": []
}
```

Add `"gemini"` to the array to prevent Gemini from being used as a sub-agent.

## Verifying it works

1. Open the chat.
2. Select a **Gemini 2.5** model.
3. Attach a large file (`@` a file bigger than 100KB) and ask for a summary.
4. You should see a streaming response and, in the [cost bar](/chat/cost-and-tokens/), input tokens well above 25k.

## Troubleshooting

- **`API_KEY_INVALID`** — regenerate the key in AI Studio.
- **`PERMISSION_DENIED`** — enable the Generative Language API in the Google Cloud project tied to your key.
- **`RESOURCE_EXHAUSTED`** — free-tier quota hit. Upgrade to a paid AI Studio plan.
- **Gemini CLI not detected** — install the Gemini CLI, ensure it's on your `PATH`, and restart Ptah.

:::tip
Gemini's 2M-token context is ideal for large codebase questions. Use `@folder` to attach an entire module and let Gemini reason over it in one turn.
:::
