---
title: Switching providers
description: How provider switching works mid-conversation and what state carries over.
sidebar:
  order: 10
---

# Switching providers

Ptah is designed so you can change providers at any point. The in-chat model selector is the primary entry point — see [Switching models](/chat/switching-models/) for the user-facing flow. This page covers the **mechanics**: what carries over, what doesn't, and when to restart a session.

## Provider vs. model

- **Provider** = the service (Claude, Copilot, Codex, Gemini, Ollama, OpenRouter, ptah-cli).
- **Model** = a specific endpoint within a provider (`claude-sonnet-4.6`, `gpt-5-mini`, `qwen2.5-coder:32b`, etc.).

Switching model within the same provider is cheap and transparent. Switching provider is heavier — a new connection, new auth, new pricing, new (or no) prompt cache.

## What carries over on a provider switch

| State                              | Carries over?                                  | Notes                                                          |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Message history                    | Yes                                            | Translated to the new provider's schema.                       |
| File attachments                   | Yes                                            | Stored as text/image in each message.                          |
| Tool calls and results             | Yes                                            | Schema-translated if the new provider uses a different format. |
| Thinking blocks                    | Only if the target provider supports thinking. | Dropped silently otherwise.                                    |
| Prompt cache                       | No                                             | Caches are scoped to one provider.                             |
| Sub-agents already running         | Yes                                            | They complete under the provider they started with.            |
| Configured permissions / approvals | Yes                                            | These live in workspace state, not provider state.             |

## Switching criteria

Common reasons to switch provider mid-conversation:

- **Long context needed** — move from Claude Sonnet (200k) to Gemini 2.5 Pro (2M).
- **Rate limit** — you hit Anthropic's TPM; fail over to OpenRouter-hosted Claude.
- **Privacy moment** — move to local Ollama for a sensitive subtask, then back.
- **Cost control** — drop from Opus to Haiku for a follow-up clarification.
- **Tool quality** — certain providers handle tool use better for specific shapes of work.

## Schema translation gotchas

Not all providers speak the same message schema. Ptah handles translation automatically, but a few edge cases are worth knowing:

- **Orphaned `tool_use` blocks** — if you abort a turn mid-tool-call and immediately switch providers, Ptah sanitizes the transcript so the new provider doesn't receive an unanswered tool call. You'll see a brief "cleaning up" banner.
- **Vision attachments** — dropped if the target model doesn't support vision. The text of the message is preserved.
- **System prompt differences** — some providers have stricter system-prompt rules. Ptah collapses injected skill/agent context as needed.

## When to start a new chat instead

Start a new chat if:

- You're switching from a **reasoning provider to a non-reasoning one** mid-task. The quality drop is usually jarring.
- The transcript is very long and you want the new provider to start with a clean cache-friendly prefix.
- You're debugging Ptah itself and want a clean trace.

## Provider availability signals

The in-chat model selector greys out providers that aren't usable right now, with an inline reason:

| Signal         | Meaning                                   |
| -------------- | ----------------------------------------- |
| "No API key"   | Configure it in Settings → Providers.     |
| "Offline"      | For Ollama, the server isn't reachable.   |
| "Pro required" | The integration is gated behind Ptah Pro. |
| "Rate limited" | Recent 429 — retry in a moment.           |

Click the provider anyway to open its settings page with the failure reason pre-populated.

:::tip
If you frequently switch between two providers for cost reasons (e.g. Opus for planning, Sonnet for execution), set the cheaper one as your workspace default in `llm.defaultProvider` and reach for the selector only when you need the premium model.
:::
