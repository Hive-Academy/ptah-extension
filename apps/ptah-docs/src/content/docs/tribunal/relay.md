---
title: Relay
description: Run one task through a plan → architect → implement → review pipeline, with each phase executed by a different CLI vendor instead of a sub-agent — and the whole run persisted to .ptah/specs.
---

# Relay

Relay takes a **single, well-specified task** and runs it through the same phased pipeline as everyday [Orchestration](/agents/agent-orchestration/) — plan → architect → implement → review — but with one change: every phase is executed by a **CLI vendor lane** instead of a sub-agent. The Conductor stays in charge, hands the task from one vendor to the next, and writes each phase's output to a `.ptah/specs/TASK_*` folder so the whole run is auditable and resumable.

Where [Forge](/tribunal/forge/) and [Race](/tribunal/race/) give every vendor the _same_ prompt and pick a winner, Relay gives each vendor a _different_ prompt — one per phase — and runs them as a sequential pipeline. The diversity shows up in one place: the **review phase is always handled by a different vendor family than the one that wrote the code**, so you get genuine cross-vendor review baked into delivery.

## When to use Relay

- **You want orchestration's structured delivery** — a real plan, an architecture doc, an implementation, and a review — but you want the work done by external CLI vendors rather than in-process sub-agents.
- **Cross-vendor review on your own changes** — the implementer and the reviewer are deliberately different vendor families.
- **An auditable, resumable run** — every phase is persisted to `.ptah/specs`, so you can review each artifact or resume a run that timed out.

:::tip
Relay is the bridge between Tribunal and Orchestration: orchestration's pipeline, run entirely on the vendor panel with no sub-agents. If you just want competing answers to the _same_ prompt, use Council, Forge, or Race instead.
:::

## How it runs

### Phase 1 — Plan & architect

The Conductor creates a `.ptah/specs/TASK_*` folder, restates the task with explicit acceptance criteria, and hands the planning and architecture phases to a reasoning-strong vendor lane. Each phase writes its deliverable (`task-description.md`, then `implementation-plan.md`) to disk. You review and approve these documents before any code is written — the same checkpoints as a normal Orchestration run.

### Phase 2 — Implement

The approved plan is handed to a coding-strong vendor lane, which implements the change in place on your working branch and logs its work to `tasks.md`. The artifact from each phase becomes an input to the next — that hand-off is the "relay baton".

### Phase 3 — Cross-vendor review

A **different vendor family** reviews the implementation against the acceptance criteria and writes `code-logic-review.md`. Because the reviewer never wrote the code, this is a true peer review, not a self-check. If the review surfaces a real issue, the Conductor relays a fix phase before declaring the task done.

### Phase 4 — Verify & synthesize

The Conductor runs the project's tests/build/lint on the change, then produces a summary that cites which vendor produced each artifact. You see the diff and approve before anything is committed.

## Safety

- **Runs in place on your active branch** — no worktrees by default, since it's one task rather than N competing attempts.
- **Never commits without your sight** and never auto-merges to `main`.
- **Vendors never commit** — each lane does its phase and hands back; the Conductor owns verification and the final commit.
- **Resumable** — the `.ptah/specs/TASK_*` folder lets a timed-out run pick up where it left off instead of starting over.

## Invoking Relay

**Natural language triggers:**

- "Relay this task across the panel"
- "Run this as a vendor pipeline — plan, build, then a different vendor reviews"
- "Orchestrate this with CLI vendors instead of sub-agents"

**Explicit harness**: select **Tribunal Conductor** from the harness picker, then describe the task and its acceptance criteria.

## Relay vs. the other moves

| Move        | Prompt per vendor          | Shape               | Produces                          |
| ----------- | -------------------------- | ------------------- | --------------------------------- |
| **Council** | Same question              | Parallel panel      | A cited verdict (no code)         |
| **Forge**   | Same coding task           | Parallel + review   | Best of N implementations, merged |
| **Race**    | Same coding task           | Parallel + verify   | One verified winner               |
| **Relay**   | Different prompt per phase | Sequential pipeline | Delivered change + spec artifacts |

## Limitations

- **Needs a clear task and acceptance criteria** — a vague brief produces a vague plan, and the whole pipeline inherits the fuzz.
- **Cost** — roughly one vendor call per phase (more if a high-stakes phase is fanned out to multiple vendors). Ptah announces the lanes and cost before spending.
- **Heterogeneous, not a panel** — Relay deliberately bends Tribunal's "diversity is the signal" thesis; the diversity here is the cross-vendor review phase, not N answers to one question.
