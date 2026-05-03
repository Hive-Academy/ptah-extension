---
title: Cron Settings
description: Global tunables for the cron scheduler.
---

# Cron Settings

Cron settings live under the `cron.*` prefix in `~/.ptah/settings.json`. Edit through **Settings → Cron**.

## Reference

| Key                      | Default               | What it does                                                              |
| ------------------------ | --------------------- | ------------------------------------------------------------------------- |
| `cron.enabled`           | `true`                | Master kill-switch. When `false`, no timers arm; existing jobs stay saved |
| `cron.maxConcurrentJobs` | `3`                   | Hard cap on simultaneous in-flight runs across **all** jobs               |
| `cron.catchupWindowMs`   | `86400000` (24 hours) | Maximum look-back window for catchup replays (hard-capped at 24h)         |

## Notes

- `cron.maxConcurrentJobs` is **global**, not per-job. If three jobs are already running and a fourth slot fires, the fourth is skipped (recorded as `skipped` in the runs table) until a slot frees up.
- Lowering `cron.catchupWindowMs` is the safe way to limit replay surprise without disabling catchup entirely.
- Per-job catchup policy (`none` / `last` / `all`) is a stronger control than the global window — see [Catchup & power](/automation/cron/catchup-and-power/).

## Storage

All cron state — jobs, runs, schedules — lives in `~/.ptah/ptah.db`. Backing up that file backs up your scheduler.
