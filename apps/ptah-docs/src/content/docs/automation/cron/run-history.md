---
title: Run History
description: Audit every cron firing — succeeded, failed, or skipped.
---

# Run History

Every job fire produces a row in the runs table. Open any job in the **Cron** panel to see its history.

## Statuses

| Status      | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `pending`   | Slot recorded but execution hasn't started                       |
| `running`   | Currently in-flight                                              |
| `succeeded` | Agent returned a clean result                                    |
| `failed`    | Agent threw or the run timed out — `errorMessage` has the detail |
| `skipped`   | Catchup policy or concurrency cap suppressed this slot           |

## Fields per run

- `scheduledFor` — the slot the run targets
- `startedAt` — when execution actually began (may differ from `scheduledFor` after catchup)
- `endedAt` — completion timestamp
- `resultSummary` — short summary returned by the agent
- `errorMessage` — populated when status is `failed`

## Uniqueness

The runs table has a `UNIQUE(jobId, scheduledFor)` constraint. The same slot can never fire twice — if catchup tries to replay an already-fired slot, the insert is rejected and the duplicate is logged.

## Cleanup

When a job is deleted via `cron:delete`, its runs are **cascade-deleted**. There's no orphan history.

:::tip
Use the run history as a feedback loop. A high failure rate, or `resultSummary` strings that all look the same, are signals that the prompt needs sharpening or the schedule is too aggressive.
:::
