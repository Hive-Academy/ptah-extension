---
title: OpenAI Codex
description: Use your ChatGPT plan through OpenAI Codex in Ptah.
sidebar:
  order: 4
---

# OpenAI Codex

The OpenAI Codex connection gives Ptah access to GPT models through your OpenAI Codex (ChatGPT) plan. Codex can be the main agent, and it can run as a CLI agent lane.

## What you need

- A ChatGPT plan that includes Codex.

Ptah includes its own copy of the Codex CLI. You need an installed Codex only if you sign in with a plain `codex login` command in a terminal.

## Connect

1. Open **Settings → Providers**.
2. Click **Connect provider**, then **Connect** next to **OpenAI Codex**.
3. Click **Sign in with Codex**.
4. Approve the sign-in in your browser.

## Codex as a CLI agent

When Codex runs as a sub-agent lane, its model and reasoning effort come from the **CLI agents** matrix on the Providers tab. Click the model or effort cell of the Codex row to change it. These settings are stored in `~/.ptah/settings.json` as `agentOrchestration.codexModel` and `agentOrchestration.codexReasoningEffort`. An empty value uses the default.

`agentOrchestration.codexAutoApprove` (default `true`) lets the Codex CLI approve its sandbox operations without a prompt. Set it to `false` to approve them yourself.

## Verify that it works

1. Open a chat.
2. Select a Codex model.
3. Send a prompt that needs some reasoning.
4. Make sure that the response streams. The [Execution Tree](/chat/execution-tree/) shows the thinking steps.

## Troubleshooting

- **Sign-in fails** — your ChatGPT plan must include Codex.
- **Codex is not available as a sub-agent** — make sure that `codex` is not in `agentOrchestration.disabledClis`.
