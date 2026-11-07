---
title: Session Budget
description: Limit the tokens or cost that one session can use.
---

# Session Budget

The session budget measures the spend of one session against a limit. The chat shows the budget state of the session.

## Budget stages

The budget moves through these stages:

1. **normal**: the spend is below the tighten point.
2. **tighten**: the spend is at `sessionBudget.tightenPercent` of the limit.
3. **handoff**: the spend is at `sessionBudget.handoffPercent` of the limit, or the session compacted `sessionBudget.handoffAfterCompactions` times. A handoff to a new session is advised.
4. **limit**: the spend is at the limit.

## Settings

PtahCode stores these keys in `~/.ptah/settings.json`. You can also change them on the settings card.

| Key                                       | Default      | What it does                                             |
| ----------------------------------------- | ------------ | -------------------------------------------------------- |
| `sessionBudget.enabled`                   | `true`       | Turns the budget on or off.                              |
| `sessionBudget.unit`                      | `tokens`     | Budget unit: `tokens` or `cost` (USD).                   |
| `sessionBudget.tokens`                    | `50000000`   | Token limit (1,000,000 to 2,000,000,000).                |
| `sessionBudget.usd`                       | `30`         | USD limit (0.5 to 10,000).                               |
| `sessionBudget.fallbackWeightedTokens`    | `9000000`    | Weighted token limit when no price is available.         |
| `sessionBudget.tightenPercent`            | `50`         | Percent of the limit that starts the tighten stage.      |
| `sessionBudget.handoffPercent`            | `80`         | Percent of the limit that starts the handoff stage.      |
| `sessionBudget.handoffAfterCompactions`   | `3`          | Number of compactions that starts the handoff stage.     |
| `sessionBudget.tightenWindowTokens`       | not set      | Auto-compact window to apply at the tighten stage.       |
| `sessionBudget.autoHandoffAtLimit`        | `false`      | Hands off to a new session automatically at the limit.   |
| `sessionBudget.closeSourceAfterAutoHandoff` | `false`    | Closes the old session after an automatic handoff.       |

The tighten percent must be lower than the handoff percent.

## Unpriced sessions

When the unit is USD and a session has no price, PtahCode measures a weighted token estimate against `sessionBudget.fallbackWeightedTokens`. When only part of a session has a price, the cost shows as a lower bound, such as `≥ $x`.
