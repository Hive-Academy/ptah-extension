---
title: Ptah CLI
description: Add more agent lanes on providers that you already connected.
sidebar:
  order: 8
---

# Ptah CLI

A **Ptah CLI instance** is an agent lane that runs on a provider connection that you already have, for example OpenRouter, Kimi Code, Z.AI, or GitHub Copilot. Ptah runs the instance through the Claude Agent SDK. The orchestrator can then send sub-tasks to it, in the same way as to Codex or Copilot.

## Add an instance

1. Connect the provider first. See [Providers](/providers/).
2. Open **Settings → Providers**.
3. In the **CLI agents** matrix, open **Add Ptah CLI Agent Instance**.
4. Type an **Instance name**. Each instance must have a different name.
5. Select the **Provider connection**.
6. For GitHub Copilot, sign in with GitHub when Ptah asks.
7. Click **Create Instance**.

The instance appears in the CLI agents matrix. Click its model or effort cell to change it. You can set a model for each tier of the instance.

## Settings

Ptah stores instances in `~/.ptah/settings.json` under `ptahCliAgents`. Each entry has an `id`, a `name`, a `providerId`, an `enabled` flag, and optional `tierMappings` and `selectedModel`. Use the Settings page to change them. Keys stay in encrypted storage.

## Turn off a CLI

- To change or delete an instance, open its **More actions** menu in the CLI agents matrix. An instance with `enabled: false` is not used.
- `agentOrchestration.disabledClis` applies to CLI types (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`, `claude`), not to Ptah CLI instances. A disabled CLI type is not used, and a spawn request for it is refused.

```json
{ "agentOrchestration": { "disabledClis": ["cursor"] } }
```

## Verify that it works

1. In the CLI agents matrix, run the test of the instance. Ptah shows **Test passed.** when it works.
2. Ask the main agent to send a sub-task to the instance. The [Execution Tree](/chat/execution-tree/) shows the lane.

## Troubleshooting

- **The instance does not run** — examine the provider connection. Fix the key or sign in again.
- **"Another Ptah CLI instance already uses this name."** — choose a different name.
