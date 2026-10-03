# Team-Leader Integration

The team-leader decomposes, verifies and commits. It is **advisory**: it spawns nothing, and every
return tells you, the orchestrator, what to spawn next. Its own agent definition owns the
`batches.md` schema, the executor heuristics and the verification steps — this file covers only your
side of the exchange.

---

## Modes

| Mode                  | Invoke when                                                                                                   | It produces                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1 — Decomposition     | Architect approved (BUGFIX: plan-free, after init and any required research/design gate); no `batches.md` yet | `batches.md`, Batch 1 marked `IN_PROGRESS`                          |
| 2 — Verify and commit | An executor returned a report, or a reviewer verdict is ready                                                 | A review request, a rejection, or a commit plus the next assignment |
| 3 — Completion        | Every batch is `COMPLETE`                                                                                     | Final verification summary and QA options                           |

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Mode <N> for TASK_[ID]',
  prompt: `You are team-leader for TASK_[ID].

**Task Folder**: <absolute path>
**MODE**: <1 - DECOMPOSITION | 2 - VERIFY AND COMMIT | 3 - COMPLETION>
<Mode 2 only — the executor report path and the review path, with the one-line verdict>`,
});
```

## Lean orchestration rules

- Every Mode 2/3 call is a **fresh** team-leader `Task()`. In Mode 2, give it the batch report path
  and the review path rather than resuming an earlier team-leader with its long thread.
- "Re-invoke the same executor" (below) means resume it only if its last activity was under
  5 minutes ago; otherwise start a fresh one with the batch section and the report paths.
- Risk-based review: no per-batch review; each batch passes its scoped typecheck, lint and tests
  before commit. One code-logic review per phase on the combined diff; none for type, test, doc or
  measurement-only batches; a style review only for new public API.
- At most one fix round: Blocking and Serious fixed; Moderate only if it can break a lane config or
  lose data (else a named later task); Minor recorded, not fixed. Then one re-review scoped to the
  fixes.

## Completion checks

Mode 3 verifies `parity-inventory.md` row by row: each capability stays, moves with its proving
test, or has a user-approved removal. A missing, unapproved capability blocks completion.
UI batches require visual-reviewer screenshots in dark + light themes against the approved
`<taskFolder>/prototype/`, or — for a UI change with no added/redesigned surface and so no
prototype — before/after screenshots (dark + light) of the affected screen (the "before" screenshots
captured from the base commit, before the fix lands), shown to the user before merge; typecheck/test/lint alone do not suffice.
For changed persisted settings/config/storage writes, require a **write-path trace** to each
runtime reader (key, scope, value format, side effects such as env vars), confirming unchanged or
intended behaviour. Missing evidence goes back for verification before `TASK COMPLETE`.

Mode 1 receives the plan, document reviews and recorded user gate decisions the selected flow
requires (including open items the user accepted). **BUGFIX is plan-free**: decompose from `task.md`,
`context.md` and `research-report.md` when present; `implementation-plan.md` is not required.
Missing or stale required evidence (including any required design gate) is a blocker for you.
Mode 3 checks that this evidence still applies and that every batch has its required shipping-code
review; it never commissions another document review. When a flow legitimately skips an artifact,
its approval and review are not required either.

## Acting on a return

Every return ends with a `### Next action:` line. Do what it says; the heading tells you which case
you are in.

| Return heading              | Your action                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DECOMPOSITION COMPLETE`    | Spawn Batch 1's executor (below)                                                                                                                                                                                                                                                                                                                             |
| `DECOMPOSITION BLOCKED`     | Plan-free BUGFIX: return the blocking questions to the orchestrator, who runs Gate SR or commissions researcher-expert, then re-invokes Mode 1; no software-architect/Gate 2 for a flow without a plan. Planned flows: re-invoke software-architect with the blocking issues, refresh the document review, then Gate 2 again.                                |
| `BATCH [N] PARTIAL FAILURE` | Re-invoke the same executor for the missing tasks only                                                                                                                                                                                                                                                                                                       |
| `NEEDS REVIEW`              | Pick each reviewer's execution side per agent-lanes §6. Obtain the required shipping-code review (`code-logic-review.md`; reuse an eligible existing review) and invoke any additional named reviewer. Re-invoke Mode 2 with each review's actual report path (`code-logic-review.md`, `code-style-review.md`, `visual-review.md` as applicable) and verdict |
| `BATCH [N] NOT ACCEPTED`    | Re-invoke the same executor with the listed issues, then Mode 2 again                                                                                                                                                                                                                                                                                        |
| `BATCH [N] COMPLETE`        | Spawn the next batch's executor                                                                                                                                                                                                                                                                                                                              |
| `ALL BATCHES COMPLETE`      | Invoke Mode 3                                                                                                                                                                                                                                                                                                                                                |
| `TASK COMPLETE`             | Present Gate 3 with the options it returned                                                                                                                                                                                                                                                                                                                  |

A hook failure during its commit is your gate: [git-standards.md](git-standards.md#hook-failure-protocol).

## Spawning a batch executor

Read the batch's `Recommended executor` and `Execution mode` in `batches.md`.

- **Sequential, subagent** → one `Task()` with the executor prompt from the return.
- **Parallel, CLI lanes** → one lane per task, file-disjoint, each with a self-contained prompt built
  from that task's entry. Run them per the `agent-lanes` skill; merge the lane results into **one**
  implementation report; re-invoke Mode 2 with it.
- **Recommended executor unavailable** (lanes disabled at Gate 0.1, or no such lane) → use the
  batch's `Fallback executor`.

Who may spawn what, and the per-role hand-offs: [lane-assignment.md](lane-assignment.md).

Executors never edit `batches.md` and never commit; the team-leader owns both.
