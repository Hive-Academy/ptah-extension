---
title: Cron Expressions
description: Quick reference for the expression grammar Ptah accepts.
---

# Cron Expressions

Ptah uses [croner](https://github.com/Hexagon/croner) for parsing and scheduling. It accepts standard 5- or 6-field expressions; the second-of-minute field is optional.

## Field order

```text
┌───────────── second (optional, 0–59)
│ ┌─────────── minute (0–59)
│ │ ┌───────── hour (0–23)
│ │ │ ┌─────── day of month (1–31)
│ │ │ │ ┌───── month (1–12 or JAN–DEC)
│ │ │ │ │ ┌─── day of week (0–7 or SUN–SAT, 0 and 7 are Sunday)
│ │ │ │ │ │
* * * * * *
```

## Common patterns

| Expression        | Meaning                        |
| ----------------- | ------------------------------ |
| `* * * * *`       | Every minute                   |
| `0 * * * *`       | Top of every hour              |
| `*/15 * * * *`    | Every 15 minutes               |
| `0 9 * * MON-FRI` | 9:00 every weekday             |
| `0 0 * * SUN`     | Midnight every Sunday          |
| `0 0 1 * *`       | First of every month, midnight |
| `0 9 1 1 *`       | 9:00 on January 1st            |
| `30 2 * * *`      | 2:30 every day                 |

## Timezones

Pair every expression with an IANA timezone. `0 9 * * MON-FRI` in `America/New_York` and the same expression in `Asia/Tokyo` fire at very different absolute times — be explicit.

If you're unsure what zone string to use, the [IANA tzdb list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) is canonical.

:::tip
For full grammar — ranges, lists, step values, named months, last-day-of-month, day-of-week shortcuts — see the [croner README](https://github.com/Hexagon/croner). Anything croner accepts, Ptah accepts.
:::
