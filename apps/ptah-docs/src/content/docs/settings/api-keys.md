---
title: API Keys
description: Where to obtain credentials for each supported provider.
---

import { Aside } from '@astrojs/starlight/components';

All API keys are stored in `~/.ptah/settings.json` and encrypted with your OS keychain (see **Global Settings → Encryption of secrets**). You can paste them through the UI under **Settings → Providers**, or edit the file directly.

<Aside type="caution">
Never commit `~/.ptah/settings.json` to a shared repository. Keys are encrypted for the local machine only — moving the file to another machine will not decrypt them.
</Aside>

## Provider cheat sheet

| Provider   | Where to get a key                                                | Config key                    |
| ---------- | ----------------------------------------------------------------- | ----------------------------- |
| Claude     | [console.anthropic.com](https://console.anthropic.com) → API Keys | `providers.claude.apiKey`     |
| Copilot    | GitHub account → Copilot settings (see Copilot CLI docs)          | `providers.copilot.apiKey`    |
| Codex      | Your Codex provider dashboard                                     | `providers.codex.apiKey`      |
| Gemini     | [aistudio.google.com](https://aistudio.google.com) → Get API key  | `providers.gemini.apiKey`     |
| Ollama     | No key required — set `baseUrl` to your local server              | `providers.ollama.baseUrl`    |
| OpenRouter | [openrouter.ai](https://openrouter.ai) → Keys                     | `providers.openrouter.apiKey` |

## Web-search providers

| Provider | Where to get a key                           | Config key                |
| -------- | -------------------------------------------- | ------------------------- |
| Tavily   | [tavily.com](https://tavily.com) → Dashboard | `webSearch.tavily.apiKey` |
| Serper   | [serper.dev](https://serper.dev) → API Keys  | `webSearch.serper.apiKey` |
| Exa      | [exa.ai](https://exa.ai) → Keys              | `webSearch.exa.apiKey`    |

## Verifying a key

After saving, open a new chat and watch the status strip at the bottom of the window. A green dot next to the provider name means the key authenticated successfully. A red dot means the provider rejected the key — see **Troubleshooting → Provider errors**.

## Rotating a key

1. Generate a new key on the provider's dashboard.
2. Paste it into **Settings → Providers → [Provider] → API key**.
3. Revoke the old key on the dashboard.

Ptah picks up the new key immediately — no restart required.

## Removing a key

Click the trash icon next to the key field, or delete the `apiKey` entry from `settings.json`. The provider will be marked unavailable in the chat UI until a key is restored.
