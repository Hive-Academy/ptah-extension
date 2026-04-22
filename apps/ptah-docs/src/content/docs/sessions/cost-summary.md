---
title: Cost Summary
description: Aggregate cost, tokens, messages, and duration per session.
---

# Cost Summary

Every session in Ptah has a live cost summary — tokens consumed, dollars spent, messages exchanged, and wall-clock duration. It's visible per session in the header, and aggregated across sessions in [Analytics](/sessions/analytics/).

![Cost summary card](/screenshots/sessions-cost-summary.png)

## What's tracked

| Metric                 | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| **Input tokens**       | Tokens sent to the model (prompts, tool results, history) |
| **Output tokens**      | Tokens returned by the model                              |
| **Cache read tokens**  | Tokens served from prompt cache (billed at a discount)    |
| **Cache write tokens** | Tokens written to prompt cache                            |
| **Total cost (USD)**   | Provider-priced sum of all token classes                  |
| **Message count**      | User + assistant + tool turns                             |
| **Duration**           | First-message to last-message wall-clock time             |
| **Active duration**    | Time actually spent generating, excluding idle            |

## Where to find it

### Session header

A compact cost badge sits next to the session title. Hover for the full breakdown.

### Session analytics tab

Each session row in analytics shows totals. Click the row to see per-turn breakdown.

### Status bar

The global status bar shows today's running cost across all sessions. Click it to open the analytics dashboard scoped to today.

## Per-turn breakdown

Expand any message to see the exact cost of that turn:

```text
Turn 14 — backend-developer
  Input:   12,480 tokens  ($0.1872)
  Cached:   8,100 tokens  ($0.0243)
  Output:   1,240 tokens  ($0.1860)
  Total:               $0.3975
```

This is especially useful for spotting expensive single turns (big tool outputs, long pasted files) so you can adjust context.

## How pricing is computed

Costs come from the provider's reported usage. When a provider doesn't return a per-call price, Ptah applies the public list price for that model at the time of the call. You can override pricing per model in:

```json
{
  "ptah.pricing.overrides": {
    "claude-opus-4-7": {
      "inputPer1M": 15.0,
      "outputPer1M": 75.0,
      "cacheReadPer1M": 1.5,
      "cacheWritePer1M": 18.75
    }
  }
}
```

Overrides are applied going forward; historical records keep the price they were recorded with.

## Budgets and alerts

Set a **daily cost budget** in **Settings → Sessions → Budget**:

```json
{
  "ptah.budget.dailyUsd": 25,
  "ptah.budget.warnAtPercent": 80,
  "ptah.budget.blockOverBudget": false
}
```

- **Warn** — banner in the status bar at 80% of budget
- **Block** — when enabled, new turns are paused at 100% until you raise the budget or wait for the next day

:::tip
Budgets are per-machine, not per-account. If you use Ptah on multiple devices, set per-device budgets that sum to your desired total.
:::

## Exporting

The cost column is included in [Session history exports](/sessions/session-history/#exporting) (CSV and JSON). You can pipe CSV into your spreadsheet of choice for finance reporting.

## Privacy

Cost data is local to your machine. Ptah does not report usage or spend to any external service.
