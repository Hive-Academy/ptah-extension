---
title: Cron Scheduler
description: Schedule recurring AI tasks with cron expressions, persisted across restarts.
---

# Cron Scheduler

Run an agent on a schedule. "Every weekday at 9am, summarise yesterday's commits and post to #standups." "Every hour, scan the issue tracker for new bugs and triage them." Cron makes those happen without you sitting at the keyboard.

Built on [croner](https://github.com/Hexagon/croner). Jobs persist in `~/.ptah/ptah.db`, survive Ptah restarts, and resume cleanly via the catchup coordinator after sleep/wake events.

## What you get

- 5- or 6-field cron expressions, validated by croner before save
- IANA timezone support (also validated)
- Per-job concurrency tracking and a global concurrency cap
- A run history per job — succeeded / failed / skipped, with start/end times and result summaries
- Power-monitor integration: missed slots can be replayed, ignored, or coalesced

## Quick links

- [Creating a job](/automation/cron/creating-a-job/) — fields, validation, and the panel
- [Cron expressions](/automation/cron/cron-expressions/) — quick reference
- [Catchup & power](/automation/cron/catchup-and-power/) — what happens after sleep
- [Run history](/automation/cron/run-history/) — auditing past runs
- [Settings](/automation/cron/settings/) — global tunables

## Disabled by default? No.

Cron is **enabled** by default at the global level (`cron.enabled = true`), but you have zero jobs until you create one. Nothing fires unprompted.
