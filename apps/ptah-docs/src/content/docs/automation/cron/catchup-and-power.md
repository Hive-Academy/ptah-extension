---
title: Catchup & Power Events
description: What happens to scheduled jobs when your machine sleeps or Ptah is closed.
---

# Catchup & Power Events

Cron schedulers running on user machines have to deal with reality: laptops sleep, apps quit, networks drop. Ptah's scheduler handles these explicitly through a **catchup policy** and an OS power-monitor integration.

## What gets missed

Anything scheduled to fire while:

- The OS is asleep / hibernated
- Ptah isn't running
- The job was disabled and just got re-enabled

…is "missed" and subject to the catchup policy.

## Catchup policies

Set per-job:

| Policy | Behaviour after the app wakes up                                                                 |
| ------ | ------------------------------------------------------------------------------------------------ |
| `none` | Skip everything missed. Just resume on the next normal slot                                      |
| `last` | Fire the **most recent** missed slot once. Older missed slots are dropped                        |
| `all`  | Fire **every** missed slot, oldest first, up to `cron.catchupWindowMs` (hard-capped at 24 hours) |

## Power-monitor integration

On `wake` events, Ptah:

1. Re-arms in-memory timers for every active job
2. Asks the **CatchupCoordinator** which jobs have `nextRunAt` < now
3. Replays them according to each job's policy

The catchup window is hard-capped at 24 hours regardless of `cron.catchupWindowMs`. A laptop that's been closed for a week won't suddenly fire 168 missed hourly jobs.

:::caution[Replays can surprise you]
Don't use `all` for jobs that produce **side effects** — git commits, social posts, emails, deploys. A laptop closed overnight could fire a dozen replays the moment you open the lid. `last` or `none` is almost always safer for those.
:::

## Skipped runs

Slots that hit the policy filter (or the global concurrency cap) are recorded in the run history with status `skipped` and an explanation. Nothing missed disappears silently — you can audit it.
