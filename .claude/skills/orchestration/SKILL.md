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

   | Keywords                                    | Type          |
   | ------------------------------------------- | ------------- |
   | new SaaS, multi-tenant, scaffold workspace  | SAAS_INIT     |
   | CI/CD, pipeline, Docker, Kubernetes, deploy | DEVOPS        |
   | landing page, marketing, brand, visual      | CREATIVE      |
   | implement, add, create, build               | FEATURE       |
   | fix, bug, error, issue                      | BUGFIX        |
   | refactor, improve, optimize                 | REFACTORING   |
   | document, readme, guide                     | DOCUMENTATION |
   | research, investigate, analyze              | RESEARCH      |

2. **Pick depth**: Full (unclear scope), Partial (known requirements), Minimal (one developer or
   reviewer). Two types equally plausible, or none fits → pick the broader flow, log it in
   `decisions.md` and announce it; the user can redirect.
   If `ptah_route_decide` is listed, call it once here with
   `{stage:'pre-flight', request:<user request>}`. Use its non-null `taskType.value` and
   `depth.value`; a null answer falls back to the rules above. Record the result in
   `decisions.md` (stage, each answer's source/confidence/fallbackCause/modelProposal,
   overallConfidence, reasons and usage). An explicit user choice in the current turn wins;
   record the override.

3. **Announce** type, depth and the planned agent sequence. Then proceed.

| Type          | Flow                                                                               |
| ------------- | ---------------------------------------------------------------------------------- |
| FEATURE       | PM → [research] → [designer → prototype → Gate 1.7] → architect → team-leader → QA |
| BUGFIX        | [research] → team-leader → QA                                                      |
| REFACTORING   | architect → team-leader → QA                                                       |
| DOCUMENTATION | PM → developer → style reviewer                                                    |
| RESEARCH      | researcher → [switch to FEATURE]                                                   |
| DEVOPS        | PM → architect → devops-engineer → QA                                              |
| SAAS_INIT     | discovery → PM → architect → team-leader                                           |
| CREATIVE      | [designer → prototype → Gate 1.7] → content writer → frontend developer            |

Any flow adding or redesigning a UI surface inserts [designer → prototype → cross-side review → Gate 1.7] before the next phase of the flow (architect, team-leader, or content writer). Complete any required inventory first (Task folder below). Any UI change that adds or redesigns no surface requires no prototype and skips the designer and Gate 1.7; its completion requires before/after screenshots (dark + light) of the affected screen instead of a prototype — capture the before screenshots from the base commit (or before the first batch / before the fix lands) with the visual-reviewer.

## Task folder

- `/orchestrate TASK_YYYY_NNN[_xxxx]` → **continuation**: detect the phase from the folder
  contents ([task-tracking.md § Continuation](references/task-tracking.md#continuation)).
- `/orchestrate TASK_A TASK_B ...` or an explicit fleet request → validate every task ID before
  spawning, then load [fleet.md](references/fleet.md). One ID keeps ordinary continuation.
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

## Decide first, ask last

Agents decide from what exists; the user gets only the decisions that are theirs. Every open
decision runs the [decision ladder](references/checkpoints.md#decision-ladder):

1. **Evidence** — the task folder, code and conventions, project docs, `ptah_memory_search`,
   `ptah_web_search`. One defensible answer → decide.
2. **Peer** — still open or costly to undo → a cross-side reviewer validates the proposed decision.
3. **User** — only a [user-reserved decision](references/checkpoints.md#user-reserved-decisions)
   (scope intent, removals, irreversible or outward actions, security/privacy/licensing, money,
   breaking public changes, hook bypass) or a split the peer could not settle. One bundled
   `AskUserQuestion` call.

Every decision taken at steps 1–2 goes in `<taskFolder>/decisions.md` with its evidence; gate notices
and the completion summary list them so the user can audit and overturn any of them.

## Gates (all yours — subagents and lanes cannot reach the user)

| Gate           | When                                                                                                                                                                                            | How                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 0.1 CLI lanes  | Start; search execution preference with `ptah_memory_search`, then read request, settings and `ptah_agent_list`                                                                                 | Notice, no wait (no-preference default `enabled` when a capable lane is spawnable) |
| 0 Scope        | Before PM, if the request is ambiguous                                                                                                                                                          | Decision ladder; ask only for scope intent                                         |
| 1 Requirements | After `task-description.md`                                                                                                                                                                     | Per approval mode (below)                                                          |
| 1.5 Technical  | Before architect, if several valid approaches                                                                                                                                                   | Decision ladder; ask only if user-reserved                                         |
| 1.7 Design     | After `design-spec.md` and `prototype/`, before the next phase of the flow (architect, team-leader, or content writer); mandatory whenever a designer ran or any UI surface is added/redesigned | Per approval mode (below)                                                          |
| 2 Architecture | After `implementation-plan.md`                                                                                                                                                                  | Per approval mode (below)                                                          |
| 3 QA selection | After team-leader completion                                                                                                                                                                    | Notice, agents chosen by rule                                                      |
| SR Questions   | An agent messaged a question or returned `## Clarifications Needed`                                                                                                                             | Decision ladder, answer back via messaging                                         |

At Gate 0.1, a current explicit instruction wins. For conflicting or stale memory, use the most
recent unambiguous preference; if still unresolved, ask. With no preference and a spawnable capable
lane, select `enabled`; `auto` stays selectable. If memory is unavailable, record `preference unknown`
and use that no-preference default. If a stored preference wants lanes but none is spawnable, select
`disabled`, tell the user why, and set `Approval: user`. Record the preference source, mode,
approval mode and `ptah_agent_list` rows in `context.md`.

**Document gates** 1, 1.7 and 2 require cross-side review: you invoke an independent reviewer on the
other execution side (routing and disclosed fallback per [agent-lanes §6](../agent-lanes/SKILL.md)),
then run the bounded revision protocol in [checkpoints.md](references/checkpoints.md#cross-side-review-protocol).
The gate shows who wrote it, who reviewed it, the verdict and any open items.

**Shipping code** receives a separate independent code-logic review on the phase diff. Choose a
capable different-family reviewer when available; record the specific reason and weaker-evidence
label for any same-family or subagent fallback. Do not apply the document gate approval mode to code.

**Approval mode for document Gates 1, 1.7 and 2** (set at Gate 0.1, recorded in `context.md`;
[checkpoints.md § Approval mode](references/checkpoints.md#approval-mode)):

- `lane-review` — a spawnable lane exists and lanes are `enabled` or `auto`. The cross-side
  reviewer's APPROVED passes Gates 1, 1.7 and 2: post a short notice and continue without waiting.
- `user` — no spawnable lane, lanes `disabled`, or the user asked to approve gates. Present the
  gate as a **plain message** and wait for the user's `APPROVED`.
- Escalate to the user in either mode when the reviewer is still at REVISE after the cap, the
  review was not cross-side, the artifact proposes a removal, or the user asked to see the gate.

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
- **Subagent handoffs**: when you re-spawn an agent that Ptah stopped, put the pending handoff
  record path (from the Ptah pointer line or the `subagent-handoff-*.md` stub) in its prompt.
- **Subagent outcomes**: if `ptah_outcome_report` is listed, call it once after each Agent run with
  `{kind:'deliverables', target, paths, taskKind, taskId, routingSource}`. Take `target` from that
  run's Agent result: the Ptah `ptah-run: runId=...` tag gives `{runId}`; otherwise use the
  result's `agentId` as `{agentId}`. If neither exists, skip the report. Keep the `runId` with
  each run, including concurrent and repeated runs, and report background runs when their
  completion arrives. `taskKind` is one of `plan`, `implement`, `review`, `research`, `tests`,
  `docs`; use the Gate 0.1 row's `taskKind` and `source` when present. `held` and `queued`
  count as reported; do not repeat the call.
- **Review verdicts**: if `ptah_outcome_report` is listed, call it after each review verdict
  with `{kind:'review', target:{runId:<kept reviewed-run id>}, verdict}`. For a lane run
  without a kept `runId`, use `target:{agentId:<lane agent id>}`. Verdict is `approved`,
  `rejected` or `revise`. Skip either optional tool silently when it is not listed.

## Never

- Never let a spec/design/plan reach implementation without its gate decision: an approving
  cross-side review in `lane-review` mode, or the user's `APPROVED` in `user` mode or on escalation.
- Never let a reviewer approve a proposed removal — removals always go to the user.
- Never delete a capability that is not an approved removal in `parity-inventory.md` or the lane preserve list.
- Never present Gate 1, 1.7 or 2 without the cross-side review; a same-side review states its
  recorded reason (user pin, lanes disabled at Gate 0.1, or opposite side unavailable).
- Never let an agent's claim stand in for the build: run typecheck, tests and lint before
  reporting done — scoped to the projects changed with `-p`, output tailed; never workspace-wide.
- Never answer a user-reserved question on the user's behalf, and never ask the user a question
  that evidence or a peer settled — run Gate SR.
- Never take an unlogged decision: no row in `decisions.md`, no decision.
- Never bypass a commit hook without the user's choice ([git-standards.md](references/git-standards.md#hook-failure-protocol)).
- Never commit to or merge into `main` on your own.

## Token economy

Every tool call in any agent or lane resends its whole thread, so cost is requests × context.

- Verification is scoped: `nx run-many -t <target> -p <changed projects>`, output tailed or
  filtered to the header, failures and summary.
- Keep tool output small: no full logs, no whole-directory listings, no `cat` of large files.
- No polling loops: act on the completion signal. If push is unavailable, re-check at most 5 times
  per lane, at least 60 s apart, then tell the user the lane is still running or stop it
  (agent-lanes §4).
- Lanes are narrow and get their file list up front (agent-lanes §8 batch cap and tool-call
  ceiling); a lane that explores the workspace is the expensive lane.
- Use `ptah_ast_analyze` / `ptah_context_enrich_file` before a full `Read`; read whole files only
  when editing them.

## Lean orchestration rules

1. **Fresh team-leader per Mode 2/3 call.** Give it only the batch report path, plus the
   review path when you return with a phase review verdict. Never resume a long-lived team-leader.
2. **Resume only inside the cache window.** Resume a developer or reviewer only when its last
   activity was under 5 minutes ago. Otherwise start a fresh one with the batch section and the
   report paths.
3. **Risk-based review.** No per-batch review: each batch passes its scoped typecheck, lint and
   tests before commit. One independent code-logic review per phase, on the combined diff, by a
   capable reviewer from a different family than the implementer when available. Same-family review
   needs a specific reason and a weaker-evidence label; record the `Review family`. Batches that change
   only types, tests, docs or measurement get no review. Add a style review only for new public API.
4. **One fix round.** Blocking and Serious are fixed in one round. Moderate is fixed only if it can
   break a lane config or lose data; otherwise it becomes a named later task. Minor is recorded,
   not fixed. After the round, one short re-review scoped to the fixes.
5. **Short updates.** Keep orchestrator messages brief; no status message per notification.

## References — load on demand, never all at once

| Reference                                               | Load when                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [strategies.md](references/strategies.md)               | Running a strategy's phases                                                       |
| [checkpoints.md](references/checkpoints.md)             | Presenting any gate                                                               |
| [agent-catalog.md](references/agent-catalog.md)         | Choosing or invoking an agent                                                     |
| [team-leader-modes.md](references/team-leader-modes.md) | Invoking team-leader or acting on its return                                      |
| [task-tracking.md](references/task-tracking.md)         | Creating or continuing a task folder                                              |
| [lane-assignment.md](references/lane-assignment.md)     | Gate 0.1 enabled lanes, or the user pinned a phase to a lane                      |
| [fleet.md](references/fleet.md)                         | `/orchestrate TASK_A TASK_B ...` or an explicit fleet request; validate IDs first |
| [git-standards.md](references/git-standards.md)         | Writing a commit or handling a hook failure                                       |

## Requires

- `agent-lanes` — lane mechanics, when any CLI lane runs. If it is not installed, tell the user to
  enable the `agent-lanes` skill, and run the task with subagents only until they do.

For a high-stakes change whose acceptance bar can be written down in advance, offer the `tribunal`
skill's Crucible move.
