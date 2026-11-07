---
title: Cron Expressions
description: Quick reference for the cron expression grammar that PtahCode accepts.
---

# Cron Expressions

PtahCode uses [croner](https://github.com/Hexagon/croner) to read and schedule expressions. Use a 5-field or 6-field expression. The seconds field is optional.

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

Set an IANA timezone for each job. The same expression fires at different times in `America/New_York` and `Asia/Tokyo`.

:::tip
For the full grammar, see the [croner README](https://github.com/Hexagon/croner).
:::
