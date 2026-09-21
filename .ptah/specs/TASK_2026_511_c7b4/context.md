# Context — TASK_2026_511

## What happened

On one install the `observation_queue` table reached 178,867 rows and held
878 MB of a 1.2 GB database. `memory_retention_state` showed
`last_completed_at: null`. Retention had never completed one run in that
table's history.

The cause was the governor wait ceiling derived from the run's own wall
budget, so the wait consumed the budget it was meant to fit inside. Every run
started, waited, and ended at the 60 second wall budget with nothing purged.
Commit `bd2987777` fixes that, and it is merged into `main`.

## Why this task exists

The livelock was not hard to detect. Nothing was looking.

`last_completed_at` sat at null, readable, for months. No code treats "never
completed" as a fault. `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts`
does show pending bytes, run outcomes and a backlog signal, but only in the
Electron Memory tab, and only if the user opens that tab. Nothing tells the
user to look.

A check that flags a null `last_completed_at` after a number of scheduled
attempts would have caught this on every affected install, months earlier,
without anyone reading a database by hand.

## Scope decision

In scope: a backend verdict, a persisted attempt counter, one warning log, and
a banner in the panel that already exists.

Out of scope, and deliberately so:

- Shipping `scripts/` offline drain tooling to users. It is repository
  maintenance, it appears in no `files` list, no `.vscodeignore` and no
  `electron-builder.yml`, and it must stay that way.
- A host notification, toast or badge. The user chose the panel banner.
- Any change to the retention budgets or gates. `bd2987777` owns that fix.

## Verified facts

- `MemoryStorageHealthDto.retention.lastCompletedAt` already exists and is
  already sent to the UI. See
  `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:142`.
- `RetentionState` has no attempt counter and no first-attempt timestamp. See
  `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts:243`.
  A verdict based on elapsed time alone cannot be computed from the current
  columns, which is why this task adds a counter.
- `memory_retention_state` is a single-row table,
  `id INTEGER PRIMARY KEY CHECK (id = 1)`, created by migration `0043`.
  Absence of the row means "never ran".
- The cron fires hourly. Real work runs at most once per 24 hours
  (`RETENTION_INTERVAL_MS`). A `not-due` tick writes nothing, so it must not
  count as an attempt.
- The highest existing migration is `0046_memory_merge_subject_index.ts`.
