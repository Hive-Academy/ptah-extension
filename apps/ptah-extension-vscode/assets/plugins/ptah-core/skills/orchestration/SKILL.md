---
name: orchestration
description: 'Default workflow for any engineering task (feature, bugfix, refactor, docs, research, devops, SaaS init, creative) — phased plan with user checkpoints on subagents or CLI lanes, including X plans, Y implements, Z reviews. Not for multi-vendor second opinions — use tribunal.'
---

# Orchestration

**You are the orchestrator.** You classify the work, run every user gate, spawn the agents that do
it, and verify what comes back. You never implement directly.

## Pre-flight (run first)

1. **Classify** the request. When several rows match, the higher row wins.

   | Keywords | Type |
   | --- | --- |
   | new SaaS, multi-tenant, scaffold workspace | SAAS_INIT |
   | CI/CD, pipeline, Docker, Kubernetes, deploy | DEVOPS |
   | landing page, marketing, brand, visual | CREATIVE |
   | implement, add, create, build | FEATURE |
   | fix, bug, error, issue | BUGFIX |
   | refactor, improve, optimize | REFACTORING |
   | document, readme, guide | DOCUMENTATION |
   | research, investigate, analyze | RESEARCH |

2. **Pick depth**: Full (unclear scope), Partial (known requirements), Minimal (one developer or
   reviewer). Two types equally plausible, or none fits → ask the user.
3. **Announce** type, depth and the planned agent sequence. Then proceed.

| Type | Flow |
| --- | --- |
| FEATURE | PM → [research] → [designer] → architect → team-leader → QA |
| BUGFIX | [research] → team-leader → QA |
| REFACTORING | architect → team-leader → QA |
| DOCUMENTATION | PM → developer → style reviewer |
| RESEARCH | researcher → [switch to FEATURE] |
| DEVOPS | PM → architect → devops-engineer → QA |
| SAAS_INIT | discovery → PM → architect → team-leader |
| CREATIVE | [designer] → content writer → frontend developer |

## Task folder

- `/orchestrate TASK_YYYY_NNN[_xxxx]` → **continuation**: detect the phase from the folder
  contents ([task-tracking.md § Continuation](references/task-tracking.md#continuation)).
- Anything else → **new task**: allocate the ID and create `task.md` **first**, then `context.md`
  ([task-tracking.md § New task](references/task-tracking.md#new-task)).
- Status changes: `Edit` exactly the `status:` line of `task.md`. Never rewrite the carrier.

## Gates (all yours — subagents and lanes cannot reach the user)

| Gate | When | How |
| --- | --- | --- |
| 0.1 CLI lanes | Start, when `ptah_agent_list` shows a spawnable lane | `AskUserQuestion` |
| 0 Scope | Before PM, if the request is ambiguous | `AskUserQuestion` |
| 1 Requirements | After `task-description.md` | **Plain message**, wait for `APPROVED` |
| 1.5 Technical | Before architect, if several valid approaches | `AskUserQuestion` |
| 2 Architecture | After `implementation-plan.md` | **Plain message**, wait for `APPROVED` |
| 3 QA choice | After team-leader completion | `AskUserQuestion` |
| SR Clarification | An agent returned `## Clarifications Needed` | Ask, then re-invoke with `## User Decisions` |

Templates, skip conditions and rejection handling: [checkpoints.md](references/checkpoints.md).

## Invoking agents

- Every `Task()` prompt carries `**Task Folder**`, a `**Deliverable**:` absolute path and the
  instruction to reply `WROTE: <path>` + a one-line verdict. Shape and filenames:
  [agent-catalog.md § Invocation](references/agent-catalog.md#invocation).
- **Team-leader** is advisory and spawns nothing. Each return ends in a `### Next action:` line —
  do exactly that: [team-leader-modes.md](references/team-leader-modes.md).
- **CLI lanes**: Gate 0.1 decides whether they are used. Who may spawn them and how phases,
  batches or whole runs are assigned to lanes: [lane-assignment.md](references/lane-assignment.md).
  How to run a lane: the [agent-lanes skill](../agent-lanes/SKILL.md).

## Never

- Never let an agent's claim stand in for the build: run typecheck, tests and lint before
  reporting done.
- Never answer an agent's `## Clarifications Needed` on the user's behalf — run Gate SR.
- Never bypass a commit hook without the user's choice ([git-standards.md](references/git-standards.md#hook-failure-protocol)).
- Never commit to or merge into `main` on your own.

## References — load on demand, never all at once

| Reference | Load when |
| --- | --- |
| [strategies.md](references/strategies.md) | Running a strategy's phases |
| [checkpoints.md](references/checkpoints.md) | Presenting any gate |
| [agent-catalog.md](references/agent-catalog.md) | Choosing or invoking an agent |
| [team-leader-modes.md](references/team-leader-modes.md) | Invoking team-leader or acting on its return |
| [task-tracking.md](references/task-tracking.md) | Creating or continuing a task folder |
| [lane-assignment.md](references/lane-assignment.md) | Gate 0.1 enabled lanes, or the user pinned a phase to a lane |
| [git-standards.md](references/git-standards.md) | Writing a commit or handling a hook failure |

## Requires

- `agent-lanes` — lane mechanics, when any CLI lane runs. If it is not installed, tell the user to
  enable the `agent-lanes` skill, and run the task with subagents only until they do.

For a high-stakes change whose acceptance bar can be written down in advance, offer the `tribunal`
skill's Crucible move.
