---
title: Signing in
description: Configure providers and optionally sign in for a Ptah Builders membership.
---

Ptah has two layers of authentication:

1. An optional **Ptah sign-in** that connects you to a Ptah Builders membership.
2. **Provider credentials** (API keys or OAuth tokens) that let Ptah talk to the AI services you use.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/auth.mp4" type="video/mp4" />
</video>

This page covers both. Neither is required to start using Ptah — every local capability is free and open source, and works out of the box with any provider you configure. Signing in is only for Builders membership perks.

## Tiers

| Tier          | Price              | Who it's for                  | What you get                                                                                                   |
| ------------- | ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Community     | Free (open source) | Everyone                      | Every local capability — browser automation, code execution, MCP, CLI agent sync, the Setup Hub, all providers |
| Ptah Builders | $29/mo or $290/yr  | Members who want hosted perks | Hosted gateway, priority support, early access, and community access — a membership, not a feature unlock      |

Community is fully free and open source, with **no gating** on any local feature. Ptah Builders is a paid membership that adds hosted and community perks on top; it does not unlock anything local.

See the [pricing page](https://ptah.live/pricing) for membership details.

## Entering a license key

If you're a Ptah Builders member (or hold a legacy key), you can attach it to the desktop app:

1. Open **Settings → License** (or click **Enter license key** on the welcome screen).
2. Paste the key you received by email.
3. Click **Activate**.

Ptah validates the key against the license server, then stores it in your operating system's secure credential store using Electron's `safeStorage` API. The key is never written to a plain-text settings file.

![License activation panel](/screenshots/license-activate.png)

## Configuring providers

Ptah ships with first-class support for several AI providers. You only need to configure the ones you plan to use.

| Provider   | Auth method                      | Where to get credentials            |
| ---------- | -------------------------------- | ----------------------------------- |
| Claude     | API key                          | Your Anthropic Console              |
| Copilot    | OAuth (device flow) or CLI login | Your GitHub account                 |
| Codex      | API key or CLI login             | Your OpenAI dashboard               |
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

## Next step

You're ready to start using Ptah. Head over to the [Chat guide](/chat/) to send your first message, or jump to [Agents](/agents/) to customize the agents created by the setup wizard.
