---
title: Run History
description: Examine each cron run — succeeded, failed, or skipped.
---

# Run History

Each time a job fires, the scheduler records a run. Open a job in **Thoth → Schedules** to see its run history.

## Statuses

| Status      | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `pending`   | The slot is recorded, but the run did not start               |
| `running`   | The run is in progress                                        |
| `succeeded` | The run completed                                             |
| `failed`    | The run failed. The run shows the error message               |
| `skipped`   | The run did not start, for example because of the job limit   |

## Fields of a run

- `scheduledFor` — the slot that the run is for.
- `startedAt` — the time the run started. After catch-up, it can be later than `scheduledFor`.
- `endedAt` — the time the run ended.
- `resultSummary` — a short summary of the result.
- `errorMessage` — the error, when the status is `failed`.

## Rules

- Each slot runs at most one time. The database rejects a second run for the same job and slot.
- When you delete a job, its runs are deleted too.

:::tip
Use the run history to improve a job. Many failures, or summaries that are all the same, show that the prompt or the schedule needs a change.
:::
