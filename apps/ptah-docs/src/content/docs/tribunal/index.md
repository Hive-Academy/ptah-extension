---
title: Tribunal
description: Fan one question across your installed vendor CLIs, let them critique each other, and converge on a cited verdict.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Tribunal

Tribunal assembles every CLI vendor you have installed into a **flat panel of peers** and puts them to work together — not as a hierarchy where some agents are junior labor, but as independent voices that can disagree with each other.

That disagreement is the signal.

When a Claude-family model, a Codex-family model, and a Kimi-family model all reach the same conclusion independently, you can trust it. When they diverge, Tribunal surfaces the disagreement and explains why each vendor arrived where it did — so you can make an informed call instead of inheriting one model's blind spots.

## The three moves

<CardGrid>
  <Card title="Council" icon="approve-check">
    Fan one question to N vendors → anonymized cross-critique → single cited verdict. **Available now.** [How it works →](/tribunal/council/)
  </Card>
  <Card title="Forge" icon="laptop">
    Each vendor attempts the same coding task in isolation → round-robin diff review → ranked merge. **Available now.** [How it works →](/tribunal/forge/)
  </Card>
  <Card title="Race" icon="rocket">
    N parallel attempts → rubric scoring → verified winner before any commit. **Available now.** [How it works →](/tribunal/race/)
  </Card>
</CardGrid>

## How the panel is assembled

Tribunal builds its panel automatically from the CLI vendors installed on your machine. It picks **one agent per vendor family** to maximize diversity:

| Vendor family | CLI agent used            |
| ------------- | ------------------------- |
| Anthropic     | `ptah-cli` (Claude)       |
| OpenAI        | `codex`                   |
| GitHub        | `copilot`                 |
| Moonshot      | `ptah-cli` (Kimi)         |
| Z.AI          | `ptah-cli` (GLM)          |
| Ollama Cloud  | `ptah-cli` (Ollama Cloud) |
| OpenRouter    | `ptah-cli` (OpenRouter)   |
| Cursor        | `cursor`                  |

If a vendor isn't installed, it doesn't appear on the panel. The composition is data-driven — add a new vendor and it joins the next Tribunal automatically.

:::note[Minimum panel size]
Tribunal requires **at least 2 distinct vendor families** to form a meaningful panel. With only one vendor installed, it runs that single agent and labels the result a single-voice answer (not a tribunal). Install two or more CLI providers to enable full cross-vendor debate.
:::

## Tribunal vs. Orchestration

Tribunal and the everyday [orchestration workflow](/agents/agent-orchestration/) solve different problems. Use the right tool for the job:

| Dimension                     | Orchestration                                                 | Tribunal                                                                      |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Structure**                 | Hierarchical (orchestrator → senior leads → CLI helpers)      | Flat peer panel (all vendors at the same level)                               |
| **Use case**                  | Deliver a feature — plan, implement, review, ship             | Evaluate an approach, make a judgment call, or get a second opinion           |
| **Output**                    | Working code, tests, migrations                               | Council: verdict with citations. Forge/Race: ranked implementation            |
| **Vendor relationship**       | CLI helpers are junior labor, subordinate to the orchestrator | All vendors are peers; no single vendor "owns" the task                       |
| **When disagreement happens** | Orchestrator arbitrates and continues                         | Disagreement is the primary signal — Tribunal surfaces and explains it        |
| **Best for**                  | "Build X", "Refactor Y", "Add tests for Z"                    | "Which approach is sound?", "Second opinion on this", "Let the models debate" |

:::tip
If you're building something, use **Orchestration**. If you're deciding something, use **Tribunal**.
:::

## Invoking Tribunal

Tribunal activates in response to natural language. Trigger phrases that start a Council:

- "Convene a council on this"
- "Get a second opinion from the panel"
- "Have the models debate this approach"
- "Multi-vendor review of X"
- "What do the other vendors think?"

You can also select the **Tribunal Conductor** harness explicitly from the harness picker to start a structured Tribunal session.

## Platform requirements

Tribunal is available in the **Ptah Electron desktop app** and via **ptah-cli** in headless mode. It requires at least one non-default CLI vendor installed (Codex, Copilot, Moonshot, Z.AI, or similar) to form a multi-vendor panel. VS Code extension users can access Council through ptah-cli if it's installed on their `PATH`.
