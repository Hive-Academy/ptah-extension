---
title: Signing in
description: Activate a license, configure providers, and unlock Pro features in Ptah.
---

Ptah has two layers of authentication:

1. A **Ptah license** that controls which app features are unlocked.
2. **Provider credentials** (API keys or OAuth tokens) that let Ptah talk to the AI services you use.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/auth.mp4" type="video/mp4" />
</video>

This page covers both. Neither is required to start using Ptah — the Free tier works out of the box with any provider you configure — but Pro unlocks advanced workflows.

## License tiers

| Tier  | Price                     | Who it's for                          | Key features                                                                                   |
| ----- | ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Free  | $0                        | Individual developers evaluating Ptah | Chat, agents, plugins, templates, basic MCP                                                    |
| Trial | Free for a limited period | New users who want to test Pro        | Every Pro feature, time-limited                                                                |
| Pro   | Paid                      | Professional users and teams          | Browser automation, full MCP server, CLI skill sync, enhanced system prompts, priority support |

See the [pricing page](https://ptah.dev/pricing) for current trial length and subscription details.

## Entering a license key

1. Open **Settings → License** (or click **Enter license key** on the welcome screen).
2. Paste the key you received by email.
3. Click **Activate**.

Ptah validates the key against the license server, then stores it in your operating system's secure credential store using Electron's `safeStorage` API. The key is never written to a plain-text settings file.

![License activation panel](/screenshots/license-activate.png)

:::note[Machine binding]
A Pro license activates on a limited number of machines. Deactivate an old machine from the license portal before moving to a new one, or contact support if you've hit the device limit.
:::

### Offline grace period

Ptah re-verifies your license on startup. If your machine is offline or the license server is temporarily unreachable, Ptah continues to work in Pro mode for a **7-day grace period** using the last successful verification. After 7 days offline, Pro features gracefully degrade to Free until a successful re-verification.

## What Pro unlocks

- **Browser automation** — drive a bundled Chromium instance from agents (navigate, click, type, capture screenshots, record network traffic, run JS evaluations).
- **Built-in MCP server** — expose Ptah's tools (file search, diagnostics, worktrees, browser, agent spawn) to any MCP-compatible client.
- **CLI skill sync** — keep skill definitions in sync across the Claude CLI, ptah-cli, and the desktop app.
- **Enhanced system prompts** — richer project-aware prompting for every generated agent.
- **Priority support** — direct channel for bug reports and feature requests.

Free-tier users see Pro-only features in the UI with a lock icon. Clicking one opens the upgrade flow.

## Configuring providers

Ptah ships with first-class support for several AI providers. You only need to configure the ones you plan to use.

| Provider   | Auth method                      | Where to get credentials            |
| ---------- | -------------------------------- | ----------------------------------- |
| Claude     | API key                          | Your Anthropic Console              |
| Copilot    | OAuth (device flow) or CLI login | Your GitHub account                 |
| Codex      | API key or CLI login             | Your OpenAI dashboard               |
| Gemini     | API key                          | Google AI Studio                    |
| Ollama     | Local endpoint (no key)          | `http://localhost:11434` by default |
| OpenRouter | API key                          | Your OpenRouter dashboard           |

### Add a provider

1. Open **Settings → Providers**.
2. Click the provider you want to configure.
3. Paste your API key, or click **Sign in** to start an OAuth device flow.
4. Click **Test connection** to verify the credential works.

![Providers settings panel](/screenshots/providers-settings.png)

### Where credentials are stored

Provider settings live in `~/.ptah/settings.json` — a user-scoped config file outside your project folders. Secrets (API keys, OAuth tokens) are stored via the OS secure credential store, not in plain text in the settings file.

:::caution[Don't commit secrets]
`~/.ptah/settings.json` is a user-level file and is never part of your project's source tree. If you ever copy configuration into a workspace, strip secrets before committing.
:::

### Local models with Ollama

If you run models locally with Ollama, Ptah auto-detects a running Ollama daemon on `http://localhost:11434`. No API key is needed. To point Ptah at a remote or non-default Ollama endpoint, edit the Ollama provider settings and update the base URL.

## Starting a trial

If you clicked **Start free trial** on the welcome screen, Ptah provisions a trial license tied to your email and device. The trial activates immediately — no credit card required. When it ends, Pro features revert to Free behavior and a one-click upgrade link appears in **Settings → License**.

See [ptah.dev/pricing](https://ptah.dev/pricing) for the current trial length, plan comparison, and team pricing.

## Next step

You're ready to start using Ptah. Head over to the [Chat guide](/chat/) to send your first message, or jump to [Agents](/agents/) to customize the agents created by the setup wizard.
