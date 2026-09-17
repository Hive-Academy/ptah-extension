---
title: Agent Orchestration
description: How Ptah assigns development work to specialist sub-agents and CLI lanes, with checkpoints and verified handoffs.
---

# Agent Orchestration

The `orchestration` skill in `ptah-core` coordinates development work: classify the request, choose a workflow, assign specialists or CLI lanes, run user checkpoints, and verify the results. A phase can run on a sub-agent or a CLI lane; a whole pipeline on lanes is [Relay](/tribunal/relay/).

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/cli-agent-orchestration.mp4" type="video/mp4" />
</video>

![Orchestration hierarchy](/screenshots/agents-orchestration.png)

## Who does what

| Role | Responsibility |
| --- | --- |
| **Orchestrator** | Owns the conversation and checkpoints; spawns sub-agents, batch executors, and phase lanes; verifies what returns. |
| **Team-leader** | Decomposes the plan into batches, recommends executors, verifies and gates batches behind review, and records their states in `batches.md`. It spawns nothing. |
| **Specialists** | Work within their assigned scope and return deliverables with evidence. Eligible specialists may use CLI lanes for focused sub-tasks when lanes are enabled or in auto mode. |
| **CLI lanes** | Run self-contained tasks through `ptah_agent_spawn`, using an installed CLI or a configured Ptah CLI provider. |

`visual-reviewer` and `ui-ux-designer` do not delegate to CLI lanes: visual review needs browser tools, and design needs interactive discovery. The team-leader recommends work for the orchestrator to assign.

Specialists do not allocate task IDs or edit `task.md` or `batches.md`. They report completion and blockers; the team-leader records batch state. In a Relay run without a team-leader, the conductor verifies the implementation report and records `batches.md`.

## Choosing a workflow

The skill covers FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, and CREATIVE work. It chooses full, partial, or minimal depth from the request and asks when the type is ambiguous.

A feature typically goes through project-manager → optional research/design → software-architect → team-leader → QA. The team-leader recommends batch executors; the orchestrator spawns them and acts on each returned next action.

## Checkpoints

The orchestrator owns every user checkpoint:

- **CLI lanes** — choose enabled, auto, or disabled when a spawnable lane is available.
- **Scope and technical choices** — clarify ambiguity before planning or architecture.
- **Requirements and architecture** — present `task-description.md` and `implementation-plan.md` for approval before continuing.
- **QA** — choose the verification work after implementation.
- **Specialist clarification** — relay an agent's blocking questions to you, then re-invoke it with your decisions.

## CLI lanes and required skills

Enable **`agent-lanes`** alongside `orchestration` to run CLI work. It defines discovery, addressing, self-contained prompts, spawn/status/read, recovery, messaging, review independence, and revision limits. If it is unavailable, orchestration asks you to enable it and uses sub-agents only until you do.

If the session has no `ptah_agent_*` tools, work proceeds with native tools and the agent says so. When `ptah_*` tools are available, agent templates use them first; when absent, they use native tools directly without probing for them.

:::tip[CLI-only delivery: Relay]
[Relay](/tribunal/relay/) is the orchestration pipeline run on CLI lanes, launched from the Tribunal panel for now. Assign a vendor and model to plan, architect, implement, and review. Review uses a separate lane, with another vendor family preferred; a user-requested same-family review is flagged.
:::

## Parallel work and handoffs

The lane skill defaults to **three concurrent lanes**. Parallel writes must be file-disjoint, or each lane needs its own worktree. This workflow budget is separate from the [runtime concurrency setting](/agents/cli-agents/#concurrency-limits).

Each handoff includes the objective, acceptance criteria, absolute input paths, permitted files, and an output format. File-producing tasks name an absolute deliverable path and return `WROTE: <path>` plus a short verdict. Agents that cannot proceed return `## Clarifications Needed` for the orchestrator to resolve with you.

The orchestrator checks reports against files and runs the project's validation commands. A lane's `PASS` does not replace a build, tests, or lint. Reviewers do not review their own implementation, and ordinary lane revision stops after two rounds if it has not converged.

## Following up with a lane

`ptah_agent_message` sends a message to a running lane and reports its delivery mode. A message may steer the current turn, queue a next turn, interrupt and resume with partial work discarded, or be unsupported. The orchestrator checks the result; delivery is not assumed.

A lane can send a finding or blocker back with `ptah_agent_report`; its `delivered` result says whether the spawning session received it. To resume a finished or interrupted lane, `ptah_agent_status` must have reported a **CLI Session ID**. Otherwise, a fresh spawn restates the context. See [CLI agents](/agents/cli-agents/) for the tool flow.
