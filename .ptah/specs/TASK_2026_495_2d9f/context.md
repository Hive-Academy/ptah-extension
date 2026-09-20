# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: TASK_2026_494.

## Deliverables

1. SQLite tables and numbered migrations in `persistence-sqlite`: pinned apps, versions, grants, refresh records. No secrets in app records. Scope for each workspace. The persisted form of the tool call is in "Persisted tool call" below.
2. A named scheduler handler (`handler:NAME`, `libs/backend/cron-scheduler/src/lib/job-runner.ts:14,60`) that runs the stored tool call, validates the output and updates the snapshot. The current job schema cannot hold a tool call or a budget, so it needs new columns or a table. The commit rules are in "Snapshot commit" below. The budget rules are in "Refresh budgets" below.
3. Backoff for each app, staleness, and disable after repeated auth failure. A delivery failure must not damage the last good snapshot. See "Snapshot commit" below.
4. Delivery: text summary with a deep link. The adapter contract has only `sendMessage` and `editMessage` (`libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:107,116`).
5. Unpin removes the schedule, the grants and the cache. Unpin cancels an in-flight refresh through its `AbortSignal`. Each snapshot write, cache write and delivery first checks that the pin still exists and that its generation number matches. A refresh that finishes after unpin writes nothing. A test covers a refresh that finishes after unpin.
6. The Schedules view and the Cron tab in Thoth use one data source.

## Persisted tool call

The stored tool call has these fields and no others:

- tool identifier
- schema version
- schema-validated arguments
- credential references
- output budget
- installation grant

The record never holds tokens, cookies or secret values. Arguments that carry a secret are rejected at pin time with a clear message. A test pins a tool call with a secret in its arguments and asserts the rejection. A second test asserts that the stored row holds no secret value.

## Snapshot commit

1. Validate the complete result first. Do not write a partial result.
2. Replace the snapshot in one transaction.
3. On a validation failure or a persistence failure, the current snapshot stays.
4. Deliver only after a successful commit. A delivery failure keeps the snapshot. The handler records the delivery failure separately.
5. Each snapshot has a monotonic revision. A write is conditional on the revision that the run started from. An older in-flight run cannot overwrite a newer snapshot. The scheduler prevents a duplicate claim for one slot, but two different runs can overlap.

Tests: a validation failure, a persistence failure, a delivery failure, and an old run that finishes after a new run.

## Refresh budgets

Opt-in agent refresh:

- Units: max turns, max tokens and max USD for each run, plus a daily cap for each app.
- Enforcement points: the scheduler handler checks the budget before the run starts. The SDK options (`maxTurns`) limit the run while it operates.
- Exceeded budget: the run stops. The tile shows "budget exceeded". The schedule pauses after 3 consecutive budget stops.

Deterministic refresh has no model. It has a wall-clock timeout and an output byte budget instead.

Tests: each limit stops the run, the daily cap blocks the start of a run, and the third consecutive budget stop pauses the schedule.

## Measure after release

Share of users who pin an app, and share of pins that are active after 14 days. The result decides the scope of the host work.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 5. `.ptah/specs/TASK_2026_490_583c/critique-product.md` section 6.
