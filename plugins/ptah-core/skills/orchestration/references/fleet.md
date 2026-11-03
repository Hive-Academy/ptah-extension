# Fleet mode

Use fleet mode when `/orchestrate` receives multiple task IDs or an explicit request to coordinate several tasks as a fleet. A single resolved task ID uses ordinary continuation. The orchestrator owns the fleet schedule, artifact checks, task status, and commits; workers own only their assigned deliverables.

## Entry

1. Resolve the requested set of task IDs. Before spawning anyone, check that each ID identifies an existing task folder under `.ptah/specs/`, that its `task.md` can be read, and that the IDs are distinct. Report invalid or missing IDs instead of guessing a folder or creating one.
2. Read each task's plan, current `task.md` status, and existing artifacts. Build a stage for each task from that evidence. A completed stage is skipped; an incomplete stage is scheduled.
3. Group independent tasks into bounded batches, then move each through plan, implementation, independent judge, and completion. Apply the normal orchestration document gates to plans and the normal lane review rules to code. The [lane assignment reference](lane-assignment.md) and [agent-lanes skill](../../agent-lanes/SKILL.md) govern executor selection.

An explicit fleet request without usable task IDs needs the task set resolved before any spawn. If it resolves to one task, continue that task normally.

## Resume from disk

After interruption, reconstruct each stage from the task folder and its artifacts. Re-read disk instead of trusting a previous process's in-memory stage, completion signal, or parallel call order. Supply fresh, self-contained work only for incomplete stages. Do not reset a completed task to `in_progress` because a worker or host restarted.

For every stage, compare the expected artifact with the actual file and its required content before deciding it is complete. A respawned worker whose assigned artifact is already complete **no-ops** and reports that finding. If the file is missing, partial, or inconsistent with the task, finish or repair the assigned stage and report what changed. The orchestrator verifies the result before moving the task forward.

## Checkpoints

Write an artifact before reporting stage completion. `context.md` records planning context; the task's planned implementation deliverables and batch report show what was changed and verified. A `task.md` status alone is not implementation evidence. The judge writes `.ptah/specs/<taskId>/judge-round-<round>.json` before returning. Its JSON object has these keys:

```json
{
  "taskId": "TASK_YYYY_NNN",
  "round": 1,
  "pass": false,
  "defects": [],
  "testsRan": [],
  "mentorNote": "Concise verdict and next action"
}
```

`taskId` identifies the task, `round` is the judge round number, `pass` is a boolean, `defects[]` holds the cited findings, `testsRan` records the verification actually run or why none ran, and `mentorNote` explains the verdict. An empty `defects[]` with `pass: true` is an approval; a failed verdict identifies work to revise. Do not invent test results.

Only the orchestrator/team-leader writes the `task.md` `status:` line, and only after checking the relevant artifact. Workers and judges never edit `task.md`. Change exactly the status line, following [task tracking](task-tracking.md); do not rewrite the task carrier. The orchestrator can move a verified implementation to `in_review`, and a task to `done` only after the required review and verification pass.

## Disjoint batching

At most 6 files across at most 2 libraries/projects per batch, with one scoped verification command. Name the owned files and verification command in the batch assignment. Split larger work into sequential batches; a stage's size does not waive the cap.

Run implementers in parallel only when their write sets do not overlap and they cannot mutate the same library or project concurrently. Same-area work runs sequentially. If ownership changes during implementation, stop the conflicting parallel work and reassign disjoint batches. Verify each batch's actual outputs before scheduling dependent work. Follow the [lane assignment batch contract](lane-assignment.md#batches-on-lanes) and [agent-lanes cost rule](../../agent-lanes/SKILL.md#8-cost).

## Judge protocol

Use an independent, read-only judge after implementation. The judge starts by trying to refute the claimed result, reads the deliverable and its verification evidence, and checks the task's acceptance criteria. Every defect in `defects[]` names a `file:line` anchor, the concrete failing scenario, and evidence for it. A judge may write only its `judge-round-<round>.json` artifact; it never changes implementation files or `task.md`.

On a failed first round, assign the cited defects for revision and verify the revised artifact before round two. At most two judge rounds are allowed. If round two fails, stop the automatic revise loop and escalate to the orchestrator for a decision. The orchestrator checks the JSON and cited evidence rather than treating the judge's `pass` field as sufficient by itself.

## Commit window and lane mechanics

Commit only in a quiet window after every implementer and judge has stopped writing and the required checks have passed. The orchestrator owns git operations; lanes and other workers never commit. Use [git standards](git-standards.md#quiet-commit-window) for the window and the repository's own commit rules.

For CLI lanes, use [agent-lanes §§1, 3, 4, and 8](../../agent-lanes/SKILL.md): discover live lanes, send self-contained prompts with absolute paths and output format, wait for the completion signal or make one status check, read the result, and respect the concurrency and cost limits. A lane result is evidence to inspect, not an automatic stage transition.
