---
title: Providers
description: Ptah is multi-provider. Bring your own keys.
sidebar:
  order: 1
---

# Providers

Ptah is multi-provider by design. You configure the AI services you want to use, Ptah routes chat traffic, sub-agent spawns, and tool calls across them, and a single unified cost ledger shows you what each turn cost — no matter which backend served it.

**You bring your own keys.** Ptah never proxies your traffic through a service we control. Your API keys stay on your machine.

## Supported providers

| Provider                              | Auth            | Best for                                                     | Cost tracking                          |
| ------------------------------------- | --------------- | ------------------------------------------------------------ | -------------------------------------- |
| [Claude](/providers/claude/)          | API key         | Reasoning-heavy work, long contexts, prompt caching.         | Anthropic published rates.             |
| [GitHub Copilot](/providers/copilot/) | OAuth           | Code completion quality, bundled if you have Copilot.        | $0 (your subscription).                |
| [OpenAI Codex](/providers/codex/)     | OAuth / API key | GPT-5 family, high-reasoning modes.                          | OpenAI published rates.                |
| [Gemini](/providers/gemini/)          | API key         | Gemini 2.5 Pro and Flash — long contexts, vision.            | Google published rates.                |
| [Ollama](/providers/ollama/)          | Local / token   | Offline work, privacy, local models.                         | $0 for local, Cloud uses Ollama rates. |
| [OpenRouter](/providers/openrouter/)  | API key         | Access hundreds of models with one key; live pricing feed.   | Live from OpenRouter registry.         |
| [Ptah CLI](/providers/ptah-cli/)      | User-configured | Wrap any CLI-based agent. Highest priority in CLI detection. | Delegated to wrapped tool.             |

And three web search providers for grounding:

- [Tavily, Serper, Exa](/providers/web-search/) — API keys for web search tools.

## How routing works

- The **main chat agent** uses the provider and model you pick with the in-chat model selector — or your default from `~/.ptah/settings.json`.
- **Sub-agents** spawned by Autopilot use the CLI detection priority (`ptah-cli > gemini > codex > copilot`) unless the parent specifies a CLI explicitly.
- **Web search tools** use whichever web search provider you have an API key for, with Tavily as the default.
- **Embeddings / indexing** tasks use a lightweight model from your active provider family.

See [Switching](/providers/switching/) for what happens when you change providers mid-conversation.

## Where keys are stored

:::note[Security]
API keys are encrypted on disk using [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage), which wraps the OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Keys never appear in plaintext in `~/.ptah/settings.json` — that file only holds non-secret configuration like default model names and endpoints.
:::

Non-secret settings live in `~/.ptah/settings.json`. Secrets live in secure storage, managed from the Providers settings page inside the app.

## Pro-tier gating

A few provider integrations require a Ptah Pro subscription:

- GitHub Copilot OAuth (enterprise SSO support).
- OpenAI Codex OAuth flow.
- OpenRouter with the Ptah-hosted cost registry.

Every provider has a "bring your own key, no subscription required" path — see the individual provider pages.
