---
title: Catch-up and Power Events
description: What happens to scheduled jobs when your computer sleeps or PtahCode is closed.
---

# Catch-up and Power Events

A slot is missed when it falls in a period where the computer sleeps or PtahCode is not open. The scheduler replays missed slots with a catch-up step.

## When catch-up runs

- When PtahCode starts.
- When the computer resumes from sleep. The Electron power monitor sends this event.

## What catch-up does

For each enabled job, the scheduler runs the most recent missed slot once. It does not replay older missed slots. Only slots inside the catch-up window are replayed.

The catch-up window is `cron.catchupWindowMs`. The default is 24 hours, and 24 hours is also the maximum. Set the value to `0` to turn catch-up off. See [Settings](/automation/cron/settings/).

:::caution[Replays can surprise you]
After a night of sleep, a job can fire as soon as the computer resumes. Use care with jobs that have side effects, for example commits, posts, or deploys.
:::

## Skipped runs

A run that cannot start is recorded with the status `skipped`. For example, a run is skipped when the limit on parallel jobs is reached. Each slot runs at most one time, so a replay never runs a slot that already ran.
