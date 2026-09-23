---
name: orchestration
description: 'Default workflow for any engineering task (feature, bugfix, refactor, docs, research, devops, SaaS init, creative) — phased plan with user checkpoints on subagents or CLI lanes, including X plans, Y implements, Z reviews. Not for multi-vendor second opinions — use tribunal.'
---

# Orchestration

**You are the orchestrator.** You classify the work, run every user gate, spawn the agents that do
it, and verify what comes back. Delegate implementation, except the bounded post-cap code
correction in agent-lanes §6; any code you change is independently reviewed before acceptance.

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
| FEATURE | PM → [research] → [designer → prototype → Gate 1.7] → architect → team-leader → QA |
| BUGFIX | [research] → team-leader → QA |
| REFACTORING | architect → team-leader → QA |
| DOCUMENTATION | PM → developer → style reviewer |
| RESEARCH | researcher → [switch to FEATURE] |
| DEVOPS | PM → architect → devops-engineer → QA |
| SAAS_INIT | discovery → PM → architect → team-leader |
| CREATIVE | [designer → prototype → Gate 1.7] → content writer → frontend developer |

Any flow adding or redesigning a UI surface inserts [designer → prototype → cross-side review → Gate 1.7] before the next phase of the flow (architect, team-leader, or content writer). Complete any required inventory first (Task folder below). A UI BUGFIX that does not add or redesign a surface skips the designer and Gate 1.7; its completion requires before/after screenshots (dark + light) of the affected screen instead of a prototype.

## Task folder

- `/orchestrate TASK_YYYY_NNN[_xxxx]` → **continuation**: detect the phase from the folder
  contents ([task-tracking.md § Continuation](references/task-tracking.md#continuation)).
- Anything else → **new task**: allocate the ID and create `task.md` **first**, then `context.md`
  ([task-tracking.md § New task](references/task-tracking.md#new-task)).
- `parity-inventory.md` is **REQUIRED** when replacing, consolidating, rebuilding or redesigning
  an existing surface. PM writes it from the **OLD code before design starts**. In flows without
  a PM (including BUGFIX and REFACTORING), the orchestrator first invokes software-architect in
  **inventory-only mode** to write it before the designer. For flows with a plan, the architect's
  plan phase runs after any required Gate 1.7 as usual; BUGFIX remains plan-free.
  Columns: capability, where today (file:line), backing RPC/API, decision
  (keep/move/remove-proposed), new location, test that proves it. Record user approval for removals.
- Status changes: `Edit` exactly the `status:` line of `task.md`. Never rewrite the carrier.

## Gates (all yours — subagents and lanes cannot reach the user)

| Gate | When | How |
| --- | --- | --- |
| 0.1 CLI lanes | Start, when `ptah_agent_list` shows a spawnable lane | `AskUserQuestion` |
| 0 Scope | Before PM, if the request is ambiguous | `AskUserQuestion` |
| 1 Requirements | After `task-description.md` | **Plain message**, wait for `APPROVED` |
| 1.5 Technical | Before architect, if several valid approaches | `AskUserQuestion` |
| 1.7 Design | After `design-spec.md` and `prototype/`, before the next phase of the flow (architect, team-leader, or content writer); mandatory whenever a designer ran or any UI surface is added/redesigned | **Plain message**, wait for `APPROVED` |
| 2 Architecture | After `implementation-plan.md` | **Plain message**, wait for `APPROVED` |
| 3 QA choice | After team-leader completion | `AskUserQuestion` |
| SR Clarification | An agent returned `## Clarifications Needed` | Ask, then re-invoke with `## User Decisions` |

**Cross-side review before Gates 1, 1.7 and 2**: you invoke an independent reviewer on the
other execution side (routing and disclosed fallback per [agent-lanes §6](../agent-lanes/SKILL.md)),
then run the bounded revision protocol in [checkpoints.md](references/checkpoints.md#cross-side-review-protocol).
The gate shows who wrote it, who reviewed it, the verdict and any open items. A reviewer's
APPROVED never counts as the user's `APPROVED`.

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

- Never let a lane-authored spec/design/plan reach implementation without the user seeing and
  approving it (Gate 1.7 or 2).
- Never delete a capability that is not an approved removal in `parity-inventory.md` or the lane preserve list.
- Never present Gate 1, 1.7 or 2 without the cross-side review; a same-side review states its
  recorded reason (user pin, lanes disabled at Gate 0.1, or opposite side unavailable).
- Never let an agent's claim stand in for the build: run typecheck, tests and lint before
  reporting done — scoped to the projects changed with `-p`, output tailed; never workspace-wide.
- Never answer an agent's `## Clarifications Needed` on the user's behalf — run Gate SR.
- Never bypass a commit hook without the user's choice ([git-standards.md](references/git-standards.md#hook-failure-protocol)).
- Never commit to or merge into `main` on your own.

## Token economy

Every tool call in any agent or lane resends its whole thread, so cost is requests × context.

- Verification is scoped: `nx run-many -t <target> -p <changed projects>`, output tailed or
  filtered to the header, failures and summary.
- Keep tool output small: no full logs, no whole-directory listings, no `cat` of large files.
- No polling loops: act on the completion signal; one status check at most, then wait.
- Lanes are narrow and get their file list up front (agent-lanes §8 batch cap and tool-call
  ceiling); a lane that explores the workspace is the expensive lane.
- Use `ptah_ast_analyze` / `ptah_context_enrich_file` before a full `Read`; read whole files only
  when editing them.

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
