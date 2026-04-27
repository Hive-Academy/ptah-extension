---
title: Agent Orchestration
description: How Ptah coordinates an orchestrator, senior leads, and CLI helpers to deliver non-trivial work.
---

# Agent Orchestration

Ptah doesn't throw one model at every problem. It uses a **three-tier orchestration model** that mirrors how a real engineering team splits work: a coordinator at the top, specialists in the middle, and a pool of parallel helpers at the bottom.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/cli-agent-orchestration.mp4" type="video/mp4" />
</video>

![Orchestration hierarchy](/screenshots/agents-orchestration.png)

## The three tiers

### Tier 1 — Orchestrator

The top-level agent that owns the conversation. It:

- Reads the user's goal
- Decomposes the goal into a plan
- Picks which specialists to invoke and in what order
- Synthesizes results back into a single response

You usually talk to the orchestrator directly unless you've explicitly picked a specialist.

### Tier 2 — Senior leads (sub-agents)

Specialists spawned by the orchestrator. Each has a narrow domain (architecture, backend, frontend, reviews, research) and a stricter tool set. They:

- Receive a scoped task with acceptance criteria
- Do the work (or delegate again to CLI helpers)
- Return a structured report to the orchestrator

Senior leads can spawn other senior leads. Hierarchy depth is capped to prevent runaway recursion.

### Tier 3 — CLI helpers

External CLIs (Copilot, Gemini, Codex, ptah-cli) spawned for bulk, parallel, or provider-specific work. They follow the [spawn → poll → read](/agents/cli-agents/#the-spawn--poll--read-pattern) pattern and are capped at 3 concurrent.

## When to delegate

| Task shape                                                     | Who handles it                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| One quick question                                             | Orchestrator answers directly                                     |
| A multi-step feature                                           | Orchestrator delegates to 1–3 senior leads sequentially           |
| Wide, parallel exploration (e.g., "write tests for 6 modules") | Senior lead spawns CLI helpers in parallel                        |
| Cross-cutting refactor                                         | Architect plans → implementation leads execute → reviewers verify |
| Research + write-up                                            | researcher-expert → technical-content-writer                      |

:::tip[Rule of thumb]
If a task has more than **three distinct deliverables**, let the orchestrator decompose it. If a task has more than **three files to touch in parallel**, push it to CLI helpers.
:::

## Parallelization rules

Ptah parallelizes aggressively where it's safe:

- **Read-only work** (searches, analyses, reads) — parallelize freely.
- **Independent writes** (different files, no shared state) — parallelize up to the 3-CLI cap.
- **Overlapping writes** (same file or same module) — serialize. The orchestrator enforces this by batching overlapping tasks into a single agent.

:::caution[Never in parallel]

- Git commits and git resets
- Migrations against the same database
- Writes to the same file from different agents
  :::

## Handoff protocol

When Tier 1 hands off to Tier 2, the message includes:

1. **Goal** — what success looks like
2. **Context** — relevant files, prior decisions, constraints
3. **Acceptance criteria** — how the orchestrator will check the result
4. **Return format** — structured markdown the orchestrator can parse

Senior leads return a report with the same shape. CLI helpers return a transcript plus a final summary block.

## Example: "Add a dark mode toggle"

```text
User → Orchestrator:
  "Add a dark mode toggle to the settings page."

Orchestrator plan:
  1. ui-ux-designer — design tokens + component spec
  2. frontend-developer — implement the toggle
  3. senior-tester — add tests
  4. code-style-reviewer — final polish pass

Execution:
  Step 1 runs → returns spec
  Step 2 runs with spec in context → writes code
  Steps 3 and 4 run IN PARALLEL (tester reads tests-dir, reviewer reads src) → both return reports
  Orchestrator merges reports → replies to user.
```

## Steering a running orchestration

You can interrupt at any point. Type a new message in the chat and the orchestrator will:

1. Stop any in-flight CLI helpers (or let them finish if you say "finish current work")
2. Incorporate your new input into the plan
3. Resume with the adjusted plan

For finer-grained control, open the **Agent Timeline** panel to pause, resume, or cancel individual sub-agents.

## Observability

Every orchestration produces a timeline you can inspect:

- Which agents ran
- How long each took
- Token usage per agent
- The exact handoff messages between tiers

See [Session analytics](/sessions/analytics/) for aggregate dashboards.
