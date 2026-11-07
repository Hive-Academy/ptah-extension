---
title: Cron Scheduler
description: Run a prompt on a cron schedule as a headless PtahCode session.
---

# Cron Scheduler

The cron scheduler runs a prompt on a recurring schedule as a headless PtahCode session. Use it for nightly checks, digests, or maintenance work.

The scheduler uses [croner](https://github.com/Hexagon/croner). Jobs are stored in `~/.ptah/ptah.db` and stay after PtahCode restarts.

## Open the scheduler

1. Click **Thoth** in the chat header.
2. Open the **Schedules** tab.

The tab shows the jobs, the number of enabled and disabled jobs, and the next run. Use **This workspace** or **All workspaces** to filter the list.

## What you get

- 5-field or 6-field cron expressions, validated before save.
- An IANA timezone for each job.
- A global limit on parallel jobs.
- A run history for each job.
- Catch-up of missed slots after the computer sleeps or PtahCode was closed.

## Pages

- [Creating a job](/automation/cron/creating-a-job/)
- [Cron expressions](/automation/cron/cron-expressions/)
- [Catch-up and power events](/automation/cron/catchup-and-power/)
- [Run history](/automation/cron/run-history/)
- [Settings](/automation/cron/settings/)

The scheduler is enabled by default (`cron.enabled = true`). No job runs until you create one.
