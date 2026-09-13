# Team-Leader Integration

The team-leader decomposes, verifies and commits. It is **advisory**: it spawns nothing, and every
return tells you, the orchestrator, what to spawn next. Its own agent definition owns the
`batches.md` schema, the executor heuristics and the verification steps — this file covers only your
side of the exchange.

---

## Modes

| Mode | Invoke when | It produces |
| --- | --- | --- |
| 1 — Decomposition | Architect approved (BUGFIX: right after init); no `batches.md` yet | `batches.md`, Batch 1 marked `IN_PROGRESS` |
| 2 — Verify and commit | An executor returned a report, or a reviewer verdict is ready | A review request, a rejection, or a commit plus the next assignment |
| 3 — Completion | Every batch is `COMPLETE` | Final verification summary and QA options |

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Mode <N> for TASK_[ID]',
  prompt: `You are team-leader for TASK_[ID].

**Task Folder**: <absolute path>
**MODE**: <1 - DECOMPOSITION | 2 - VERIFY AND COMMIT | 3 - COMPLETION>
<Mode 2 only — paste the executor report or the reviewer verdict verbatim>`,
});
```

## Acting on a return

Every return ends with a `### Next action:` line. Do what it says; the heading tells you which case
you are in.

| Return heading | Your action |
| --- | --- |
| `DECOMPOSITION COMPLETE` | Spawn Batch 1's executor (below) |
| `DECOMPOSITION BLOCKED` | Re-invoke software-architect with the blocking issues, then Gate 2 again |
| `BATCH [N] PARTIAL FAILURE` | Re-invoke the same executor for the missing tasks only |
| `NEEDS REVIEW` | Spawn the named reviewer (usually code-logic-reviewer), then re-invoke Mode 2 with its verdict |
| `BATCH [N] NOT ACCEPTED` | Re-invoke the same executor with the listed issues, then Mode 2 again |
| `BATCH [N] COMPLETE` | Spawn the next batch's executor |
| `ALL BATCHES COMPLETE` | Invoke Mode 3 |
| `TASK COMPLETE` | Present Gate 3 with the options it returned |

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
