---
title: Cron Settings
description: Global settings for the cron scheduler.
---

# Cron Settings

Cron settings use the `cron.*` prefix in `~/.ptah/settings.json`. The scheduler reads them when it starts. Restart PtahCode after you change them.

You can also change two of them in **Settings → Advanced → Fine-tuning → Scheduled jobs**.

## Reference

| Key                      | UI label        | Default               | What it does                                                         |
| ------------------------ | --------------- | --------------------- | -------------------------------------------------------------------- |
| `cron.enabled`           | —               | `true`                | When `false`, no job fires. Saved jobs stay                           |
| `cron.maxConcurrentJobs` | Parallel jobs   | `3`                   | The maximum number of jobs that run at the same time (1 to 16)       |
| `cron.catchupWindowMs`   | Catch-up window | `86400000` (24 hours) | How far back catch-up replays missed slots. `0` turns catch-up off   |

## Notes

- `cron.maxConcurrentJobs` applies to all jobs together. When the limit is reached, a new run is recorded as `skipped`.
- The maximum catch-up window is 24 hours. A larger value is reduced to 24 hours.

## Storage

All cron data — jobs and runs — is stored in `~/.ptah/state/ptah.sqlite`.
