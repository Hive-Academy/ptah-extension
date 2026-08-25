---
title: Tribunal
description: Fan one question across your installed vendor CLIs, let them critique each other, and converge on a cited verdict.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Tribunal

Tribunal assembles every CLI vendor you have installed into a **flat panel of peers** and puts them to work together — not as a hierarchy where some agents are junior labor, but as independent voices that can disagree with each other.

That disagreement is the signal.

When three vendors from three different families reach the same conclusion independently, you can trust it. When they diverge, Tribunal surfaces the disagreement and explains why each vendor arrived where it did — so you can make an informed call instead of inheriting one model's blind spots.

## The five moves

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
  <Card title="Relay" icon="random">
    One task through a plan → architect → implement → review pipeline, each phase run by a different vendor, persisted to `.ptah/specs`. **Available now.** [How it works →](/tribunal/relay/)
  </Card>
  <Card title="Crucible" icon="star">
    A cheap executor writes; a stronger judge from another family grades it against a frozen rubric and hands back defects, until it passes or the round cap stops it. **Available now.** [How it works →](/tribunal/crucible/)
  </Card>
</CardGrid>

## How the panel is assembled

Tribunal does not carry a list of vendors. It **discovers** them: every time you convene a panel, it asks which CLI agents are installed and which providers are configured **on this machine, right now**, and builds the panel from that answer.

Each installed CLI is its own **vendor family**, and each configured provider is its own family too. When you trigger Tribunal **from chat**, it assembles the panel for you: one lane per family, ordered by preference, up to a concurrency budget of three by default. A family that is present joins automatically; one that isn't is simply absent — neither case needs anything configured in advance. When you convene **from the panel**, you pick the lanes yourself from that same discovered list, up to eight, and a newly installed agent or newly configured provider appears as soon as you hit **Refresh**.

Any vendor named anywhere in these pages is an **illustration, not a roster**. What ships with a release and what is available to you are different questions, and only your own machine answers the second one.

For the two **role** moves — [Relay](/tribunal/relay/) and [Crucible](/tribunal/crucible/) — a lane is not just a panelist, it is a **role slot**. Relay has four (plan, architect, implement, review) and Crucible has two (executor, judge). You assign a vendor and a model to each slot, and the roster is validated before launch. In Relay the same vendor may fill two slots on different models — only an identical implement/review lane is blocked, and a same-family review is flagged as the weaker signal it is. In Crucible it may not: the judge must come from a **different vendor family** than the executor, whatever the model.

:::note[Minimum panel size]
Tribunal needs **at least 2 distinct vendor families** to form a meaningful panel. With only one available, it says so and asks whether to proceed single-voice — one lane, labelled a single-voice answer rather than a tribunal — or stop. Crucible is stricter — it cannot run at all below two families, because there is no independent judge to be had, and the wizard says so instead of degrading quietly. Install another CLI agent or configure another provider to enable full cross-vendor work.
:::

## Tribunal vs. Orchestration

Tribunal and the everyday [orchestration workflow](/agents/agent-orchestration/) solve different problems. Use the right tool for the job:

| Dimension                     | Orchestration                                                 | Tribunal                                                                                                             |
| ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Structure**                 | Hierarchical (orchestrator → senior leads → CLI helpers)      | Flat peer panel — except Crucible, which is an unequal executor/judge pair                                           |
| **Use case**                  | Deliver a feature — plan, implement, review, ship             | Evaluate an approach, make a judgment call, or get a second opinion                                                  |
| **Output**                    | Working code, tests, migrations                               | Council: a cited verdict. Forge/Race: a ranked implementation. Relay/Crucible: a delivered change plus its artifacts |
| **Vendor relationship**       | CLI helpers are junior labor, subordinate to the orchestrator | Vendors are peers; no single vendor "owns" the task. Crucible's two lanes are unequal on purpose                     |
| **When disagreement happens** | Orchestrator arbitrates and continues                         | Disagreement is the primary signal — Tribunal surfaces and explains it                                               |
| **Best for**                  | "Build X", "Refactor Y", "Add tests for Z"                    | "Which approach is sound?", "Second opinion on this", "Let the models debate"                                        |

:::tip
If you're building something, use **Orchestration**. If you're deciding something, use **Tribunal**.

Two moves bend that rule deliberately. [**Relay**](/tribunal/relay/) runs orchestration's build-it pipeline _on the vendor panel_, one lane per phase and no sub-agents. [**Crucible**](/tribunal/crucible/) puts one task through a cheap-executor / strong-judge loop against a rubric frozen before the run. Reach for either when you want delivery done by external vendors with independent review baked in.
:::

## Invoking Tribunal

There are two ways in, and they land in the same place.

### The Tribunal panel

From the dashboard, choose **Convene a Tribunal**. A wizard walks you through the run before it spends anything — three steps, or four for Crucible:

1. **Move** — the five cards. A move that cannot run on this machine is disabled and says why, rather than failing later.
2. **Panel** or **Roster** — the flat moves ([Council](/tribunal/council/), [Forge](/tribunal/forge/), [Race](/tribunal/race/)) get a lane picker: add vendors, pick a model per lane, up to the lane cap. The role moves ([Relay](/tribunal/relay/), [Crucible](/tribunal/crucible/)) get one slot per role instead, validated as you fill it.
3. **Rubric** — Crucible only, inserted before Run: the bar the judge grades against, plus the revise-round cap.
4. **Run** — a rough paid-turn estimate and the launch button. The page switches to the live grid, with a tile per lane and the conductor chat alongside; type your objective there to start the run.

Relay and Crucible also show **live progress** while they run — Relay a four-step phase rail with each phase's status and a link to its deliverable, Crucible a round-by-round verdict readout with the judge's defects and mentor notes.

:::note[The two role moves need the tribunal skill]
Relay and Crucible carry protocol that lives in the `tribunal` skill shipped with the `ptah-core` plugin. If the skill is missing, the wizard flags both cards — they still launch, and the conductor will ask for the protocol it needs, but they run best with the skill installed.
:::

### Natural language

Tribunal also activates on trigger phrases in chat. To start a Council:

- "Convene a council on this"
- "Get a second opinion from the panel"
- "Have the models debate this approach"
- "Multi-vendor review of X"
- "What do the other vendors think?"

To start a coding move:

- "Forge this across the panel" / "Race the models on this"
- "Relay this task across the panel" — plan, build, and a different vendor reviews
- "Run this as a crucible" — a cheap lane writes it, a stronger one grades it against a rubric
- "Orchestrate this with CLI vendors instead of sub-agents"

You can also select the **Tribunal Conductor** harness explicitly from the harness picker to start a structured Tribunal session.

## Platform requirements

Tribunal is available in the **Ptah Electron desktop app** and via **ptah-cli** in headless mode. What it needs is not a particular vendor but **two or more independent ones** — any mix of installed CLI agents and configured providers will do, and the wizard shows you what it found. With none available, there is no panel to convene; with only one, Tribunal is honest about running a single voice rather than a tribunal.
