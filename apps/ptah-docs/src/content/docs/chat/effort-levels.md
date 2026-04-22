---
title: Effort levels
description: Tune latency, cost, and depth with Quick, Balanced, and Thorough presets.
sidebar:
  order: 4
---

# Effort levels

Effort levels are one-click presets that tune how hard the model thinks before replying. They map to reasoning-effort, max-tokens, and sub-agent budgets in the background, so you don't have to configure each provider individually.

The selector lives next to the Send button. It applies to the **next message only** — pick a level, send, and the composer returns to your default.

## The three levels

| Level        | When to use                                                       | What it does under the hood                                                            |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Quick**    | Simple edits, one-liners, "what does this do?"                    | Minimal reasoning effort, tight max-token budget, no sub-agents. Fastest and cheapest. |
| **Balanced** | Normal development work — refactors, small features, code review. | Default reasoning effort, standard budget, sub-agents allowed but not encouraged.      |
| **Thorough** | Multi-file features, debugging hard issues, architectural design. | High reasoning effort, generous budget, autopilot encouraged to spawn specialists.     |

## How effort maps per provider

- **Claude (Anthropic API & OpenRouter)** — adjusts `thinking.budget_tokens` and `max_tokens`.
- **GPT-5 / Codex** — sets `reasoning.effort` (`low`, `medium`, `high`).
- **Gemini** — adjusts thinking budget on 2.5-series models.
- **Ollama / local models** — adjusts context size and sampling where supported.
- **Copilot** — maps to the underlying upstream model's effort controls when the selected Copilot model exposes them.

:::note
Providers that don't expose an effort knob (e.g. older chat-completions models) ignore the level but still receive the corresponding max-token budget.
:::

## Setting a default

Your default effort level is per-workspace and lives in workspace settings. The in-chat selector overrides the default for one message at a time.

:::tip
Thorough costs noticeably more than Quick — often 3–10x. Keep an eye on the [cost bar](/chat/cost-and-tokens/) when you use it.
:::
