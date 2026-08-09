# Context — TASK_2026_185

## Origin

C5 was designated the **P2 cut** in TASK_2026_181's plan — the scope to drop if
the task needed trimming. It was deferred **by decision, not by lapse**: the user
was asked directly once everything above it was complete, and chose to defer.

That distinction matters. The cut was named before anyone knew how the task would
go, which is when scope decisions are most trustworthy. Building it because it
turned out cheap is how a scoped task stops being scoped.

## Why it should be cheap

Every mechanism this needs already exists and is verified:

| Mechanism                                         | Where                              | Status                |
| ------------------------------------------------- | ---------------------------------- | --------------------- |
| Single carrier write funnel                       | `TaskWriterService.updateMetadata` | TASK_2026_181 Batch 4 |
| `deferNotify` + one rebuild per bulk              | `registerBulkUpdateStatus`         | Batch 11              |
| Chunked loop, cancel, push suppression            | `TasksStore`                       | Batch 12              |
| Confirmation above 10, naming count and target    | `task-bulk-bar`                    | Batch 12              |
| Three-group summary + per-card badge              | `task-bulk-summary`, `task-card`   | Batch 12              |
| Selection model, shift-range, select-all-matching | `TasksStore`                       | Batch 12              |

Labels reuse all of it. The work is a new RPC method, a label-shaped patch, and
the UI to choose add-vs-remove.

## The dangling field this task owns

`TasksBulkResultItem.noop` was declared in TASK_2026_181 Batch 11 and **has no
producer**. FR-C4 never asked for it; FR-C5.2 — this task — does.

Batch 11's reasoning for declaring it early and leaving it unpopulated: setting
`noop` on the _status_ path needs a pre-read, and a stale pre-read turns a
requested write into a silent skip. So it documented the field with its intended
producer rather than faking one.

**This task must either give `noop` a producer or delete it.** A declared error or
outcome code that cannot occur invites a client to write a branch that never runs
— the same defect a reviewer removed from `TasksSaveViewsResult` in Batch 8.

## Carry these forward — they were learned expensively

### 1. The mutation-window rule

Recorded in TASK_2026_181's `batches.md` and binding there for Batches 11–14.

**Mutation-based verification is destructive to concurrent readers even when it is
perfectly non-destructive to the repository.** Byte-identical afterwards says
nothing about during. A reader sampling a tree mid-mutation gets a result that is
internally consistent, reproducible-looking, and false — and it carries a
signature that mimics a real defect (failures confined to one describe block that
pass in isolation is the textbook fingerprint of order-dependence).

Rules: announce the window before the first mutation; close it only **after a
clean confirmation run**, because the restore transient counts as inside the
window; do not start a full-suite run inside anyone else's window. Separate
worktrees are preferred, serialised windows are the fallback.

It cost a full false-alarm investigation in Batch 10 to discover, and it held
cleanly through Batches 11 and 12.

### 2. The three-group accounting shape

A bulk run over N tasks produces **three** groups, not two:

```
succeeded + failures + untouched === requested
```

TASK_2026_181's own implementation plan got this wrong. Its `finally` sketch did
`_selection.set(new Set(results.filter(r => !r.ok)…))`, which clears the selection
of every task the run **never reached** — cancel 120 after 40 and the 80
un-attempted tasks silently vanish.

**Un-attempted is not failed.** Reporting them as failures tells a user 80 tasks
broke when they pressed Cancel. Successes deselect, failures stay selected,
un-attempted stay and are counted as neither. Assert the invariant directly at a
cancel fixture, not just at a clean-run one.

And the corollary, found by the visual pass: **fixing this in the data model is
half the job.** The board must render the three groups distinguishably too, or
the user still cannot act on the difference.

### 3. A claim is not evidence — run the mutation that should kill it

TASK_2026_181 produced **eight** claims its own code did not honour. The carriers
were: a comment, a test name, a docblock, a test fixture, a test harness, an
instruction from the orchestration layer, and a status report. Six were invisible
to a green test suite; two were green tests that could not fail.

The reliable check is always the same: **break the thing the claim depends on and
watch what happens.** Specific traps that recurred:

- A fixture that narrows to exactly one item tests the clamp, not the reset — the
  buggy and correct behaviours agree.
- A suite wired to a no-op collaborator makes a "called exactly once" spy pass
  either way.
- A test driving `.click()` proves nothing about the keyboard path.
- An assertion counting only the expected call passes against every permutation
  **and every superset** — it needs an "and no other fired" half.
- A range over a reversed sort is identical to the un-reversed one between two
  endpoints.

The last carrier is the worst and has no gate: a status report never touches the
tree, so nothing can catch it but someone going to look.

### 4. Standing constraints inherited

- **The word "atomic" never appears** — nor _transactional_ nor _all-or-nothing_.
  TASK_2026_181 ships a `BANNED` ratchet sweeping rendered text; keep it passing.
- **`BULK_CHUNK_SIZE` is imported** from `libs/shared/.../task-view.types.ts`,
  never redeclared — two enforcers of one number is broken in one direction and
  silently unbounded in the other.
- **`≤ 1` board reload per bulk operation**, enforced on two fronts: the loop
  never calls `loadBoard`, and the push handler short-circuits during a run.
- **No `alert-*` classes, no `primary`/`primary-content` for small text, no
  opacity-modified `text-base-content/NN`** — all below gate on the default
  theme. See TASK_2026_183, which owns the theme fix.
- **The label limits live only in `TaskMetadataPatchSchema`** — do not restate
  them client-side.

## Not in scope

Families (A) native agent integration and (D) messaging-gateway intake remain
deferred, as they were throughout TASK_2026_181.
