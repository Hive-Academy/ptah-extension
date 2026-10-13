---
description: Quick reference for /orchestrate task continuation, fleet mode, and workflow checkpoints.
---

# Orchestrator Quick Reference

## Usage

```text
/orchestrate <task description>             Start a new task
/orchestrate TASK_YYYY_NNN[_xxxx]          Continue one task
/orchestrate TASK_A TASK_B ...              Run several tasks as a fleet
/orchestrate fleet <task IDs>               Request fleet mode explicitly
/orchestrate continue                       Resume the last incomplete task
```

The command resolves and validates every supplied task ID against an existing task folder and `task.md` before any spawn. Missing, malformed, or duplicate IDs need correction. One resolved ID uses ordinary continuation, even if “fleet” was said; an explicit fleet request needs several identified tasks before it starts.

## Ordinary workflow

The orchestration skill selects the task strategy, loads the task folder, applies the relevant document checkpoints, assigns bounded implementation and verification work, and records the outcome. Strategy and agent selection depend on the task; `/orchestrate` is the single entry point.

## Fleet workflow

For several existing tasks, the orchestrator loads `orchestration/references/fleet.md` and:

1. Reads each task's status and artifacts to resume only incomplete stages.
2. Forms disjoint batches with at most 6 files across at most 2 libraries/projects and one scoped verification command per batch.
3. Verifies each deliverable, runs an independent read-only judge for at most two rounds, and updates `task.md` status only after artifact checks.
4. Commits during a quiet window after all writers stop, using the repository's own commit rules.

Workers and judges do not change task status or commit. A respawned worker with an already complete artifact reports a no-op. Judge findings go in `judge-round-<round>.json` with cited defects.

## When work stops

Read the task's current artifacts and the specific validation or judge finding. Correct the cited issue, verify the affected batch, and continue from the incomplete stage. After a second failed judge round, the orchestrator decides the next action. A hook failure follows the three choices in `orchestration/references/git-standards.md#hook-failure-protocol`; no hook is bypassed automatically.
