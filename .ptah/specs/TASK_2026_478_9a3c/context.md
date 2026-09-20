# Context — retention livelock

## Measured on the live host, 2026-09-19

`~/.ptah/state/ptah.sqlite` is 1,203.9 MB. `dbstat` attribution:

| object | size | rows |
|---|---|---|
| observation_queue | 878.0 MB | 177,919 |
| memory_chunks_vec_vector_chunks00 | 58.6 MB | - |
| memories | 39.8 MB | 36,278 |

Of the 177,919 queue rows, **171,524 already have `processed_at` set**. They hold
780.7 MB of payload text. Oldest row: 2026-06-01. Nothing has ever deleted them.

## The `memory_retention_state` row

```
last_started_at        2026-09-18T21:17:00.010Z
last_finished_at       2026-09-18T21:18:00.017Z
last_outcome           partial
last_reason            time-budget
last_duration_ms       60007
processed_purged       0
processed_rows_after   171524
last_completed_at      null          <-- never completed, ever
last_skipped_at        2026-09-19T14:17:00.001Z
last_skip_reason       foreground-active
```

## Root cause (confirmed, not suspected)

`libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts:70`

```typescript
await governor.whenClear({
  signal: options.signal,
  lane: GOVERNOR_LANE,
  maxDeferMs: Math.max(1, remainingMs),   // remainingMs IS the run's wall budget
});
```

`RETENTION_MAX_RUN_MS` is 60_000. The service hands its **entire remaining run
budget** to the governor as the deferral ceiling. When the governor is busy the
wait consumes all of it, the governor releases at the ceiling, `msLeft() <= 0`,
and `hardStop()` reports `time-budget`. No batch ever runs.

The host log line that proves the path was taken:

```
[background-work] deferral ceiling reached - proceeding:
  {"lane":"memory-retention","maxDeferMs":59997,"state":"foreground-busy"}
```

59997 is the 60000 ms budget minus setup. This is deterministic, not a race.

## Secondary: the gate never opens

Every hourly attempt since 2026-09-18 ends `foreground-active`. With 7 concurrent
sessions the foreground signal is essentially always busy, so even a correct
budget would rarely get a turn.

## Scope

1. Give the governor wait a ceiling independent of the run wall budget. The wait
   must not be able to consume the time the batches need.
2. Ensure retention makes progress under sustained load. A permanently closed
   `foreground-active` gate is indistinguishable from `disabled`.
3. Provide a way to drain the existing 171,524-row / 878 MB backlog. Reclaim via
   `SqlitePageReclaimer` / `incremental_vacuum` — **never `VACUUM`** (see the
   memory-curator CLAUDE.md).

## Constraints

- Do NOT add an index on `observation_queue`. A migration that builds one reads
  the 1 GB file on the boot path (stated in `observation-retention.store.ts`).
- Retention must never write `processed_at`. A spec asserts this.
- Batches stay bounded and yielding. Never one large DELETE on the main thread.
- `catch (error: unknown)`, narrow with `instanceof Error`.
