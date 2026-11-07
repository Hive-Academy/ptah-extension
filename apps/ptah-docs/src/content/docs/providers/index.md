---
title: Providers
description: Ptah works with many AI providers. Bring your own keys.
sidebar:
  order: 1
---

# Providers

Ptah works with many AI providers. You connect the services that you want to use, and Ptah sends chat, sub-agent, and tool traffic to them.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/providers.mp4" type="video/mp4" />
</video>

**You bring your own keys.** Credentials go from your machine directly to the AI provider. No Ptah server is involved. Some providers use a translation proxy that runs on your own machine.

## Supported providers

| Provider                              | How you connect                          |
| ------------------------------------- | ---------------------------------------- |
| [Claude](/providers/claude/)          | Claude Code sign-in, or an API key       |
| [OpenAI Codex](/providers/codex/)     | Sign-in with a ChatGPT plan              |
| [GitHub Copilot](/providers/copilot/) | Sign-in with a Copilot plan              |
| [Kimi Code](/providers/kimi-code/)    | Kimi Code sign-in, or an API key         |
| [Z.AI (GLM)](/providers/z-ai/)        | API key                                  |
| [OpenRouter](/providers/openrouter/)  | API key                                  |
| [Requesty](/providers/requesty/)      | API key                                  |
| [Sakana (Fugu)](/providers/sakana/)   | API key                                  |
| [Ollama](/providers/ollama/)          | Local server; Ollama Cloud with a key    |
| [LM Studio](/providers/lm-studio/)    | Local server, no key                     |
| OpenCode Zen, OpenCode Go             | API key                                  |

### Custom endpoint

You can add your own endpoint: any OpenAI- or Anthropic-compatible server. Click **Connect provider**, then **Configure** next to **Custom endpoint gateway**. Set the **Base URL**, the key, the models, and the tier mapping. Ptah does not operate or check a host that you add.

## Connect a provider

1. Open **Settings**. The **Providers** tab opens.
2. Click **Connect provider**.
3. Click **Connect** next to the provider.
4. Paste the key, or sign in.

Click a connection to open its details. The tabs are **Overview & Used By**, **Credentials**, and **Models & Tiers**. Custom endpoints also have **Advanced**.

## How routing works

- **Main agent** — the section at the top of the Providers tab sets the provider, model, and reasoning effort of the main chat agent.
- **CLI agents** — the CLI agents matrix lists installed agent CLIs and your [Ptah CLI](/providers/ptah-cli/) instances. Click a model or effort cell to change it.
- **Background Model Roles** — set the models for the memory curator, skill enhancement, and decisions.
- **Web search** — see [Web search](/providers/web-search/).

## Model tiers

Ptah asks for models by three tier words: `opus`, `sonnet`, and `haiku`. Each provider maps these tiers to real model ids. Some providers have a default map. For others, Ptah derives the map from the live model list. To change the map, open the connection and select **Models & Tiers**.

## Where keys are stored

:::note[Security]
Secrets go into `secrets.json` in the Electron user-data folder. Each value is encrypted with [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Non-secret settings go into `~/.ptah/settings.json`.
:::

## No provider gating

Ptah is free and open source. Every provider is available to everyone. You do not need a Ptah account, a license key, or a subscription.
