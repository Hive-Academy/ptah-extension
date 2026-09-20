# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: TASK_2026_494.

## Deliverables

1. SQLite tables and numbered migrations in `persistence-sqlite`: pinned apps, versions, grants, refresh records. No secrets in app records. Scope for each workspace.
2. A named scheduler handler (`handler:NAME`, `libs/backend/cron-scheduler/src/lib/job-runner.ts:14,60`) that runs the stored tool call, validates the output and updates the snapshot. The current job schema cannot hold a tool call or a budget, so it needs new columns or a table.
3. Backoff for each app, staleness, and disable after repeated auth failure. A delivery failure must not damage the last good snapshot.
4. Delivery: text summary with a deep link. The adapter contract has only `sendMessage` and `editMessage` (`libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:107,116`).
5. Unpin removes the schedule, the grants and the cache.
6. The Schedules view and the Cron tab in Thoth use one data source.

## Measure after release

Share of users who pin an app, and share of pins that are active after 14 days. The result decides the scope of the host work.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 5. `.ptah/specs/TASK_2026_490_583c/critique-product.md` section 6.
