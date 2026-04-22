---
title: Session Analytics
description: Performance metrics, quality scores, and trend charts for your AI work.
---

# Session Analytics

The Session Analytics dashboard turns your chat history into signal. It surfaces performance, cost, and quality metrics — per session and across your whole workspace — so you can see what's working, what's expensive, and where your agents are spending time.

![Analytics dashboard](/screenshots/sessions-analytics.png)

## Opening the dashboard

- Sidebar → **Analytics**
- Command Palette: **Ptah: Open Analytics**
- From any session header → **View analytics for this session**

## Dashboard at a glance

The top row shows rolling KPIs for the selected time range:

| KPI               | What it measures                        |
| ----------------- | --------------------------------------- |
| **Sessions**      | Count of sessions in the range          |
| **Messages**      | Total user + assistant turns            |
| **Tokens**        | Input + output tokens across all models |
| **Cost**          | Aggregated USD cost                     |
| **Avg. quality**  | Mean quality score (0–100)              |
| **Avg. duration** | Mean wall-clock minutes per session     |

Change the time range via the picker (Today / 7d / 30d / 90d / Custom).

## Performance metrics

The performance tab breaks down:

- **Latency** — time-to-first-token and time-to-last-token per message, aggregated by agent and model
- **Throughput** — tokens/second distribution
- **Tool usage** — which tools ran, how often, and how long each took
- **CLI helper overhead** — average spawn → done time for each CLI

Use this to spot regressions: a sudden spike in time-to-first-token usually points at a model change or a slow upstream provider.

## Quality scores

Ptah computes a **quality score** per session using a three-phase review protocol:

| Phase    | Weight | What it checks                                 |
| -------- | ------ | ---------------------------------------------- |
| Style    | 40%    | Lint, naming, idioms, readability              |
| Logic    | 35%    | Correctness, edge cases, dummy data, tech debt |
| Security | 25%    | OWASP-style vulnerabilities, secret handling   |

The weighted sum yields a 0–100 score. Scores update when new review-capable agents run against the session, so a session's score can improve over time as you add tests and polish.

:::tip
Filter the dashboard by "Quality < 70" to surface sessions that might benefit from a reviewer pass.
:::

## Trend charts

The trends tab plots time series for any KPI:

- Sessions / day
- Cost / day
- Tokens / day split by model
- Quality score moving average (7-day)

Hover for exact values. Click a point to drill into the sessions that made up that day.

![Trend charts](/screenshots/sessions-analytics-trends.png)

## Per-session drill-down

Click any session to open its detailed view, which includes:

- Timeline of every message, tool call, and agent handoff
- Token and cost breakdown by turn
- Quality score with per-phase sub-scores
- Full review reports from style/logic/security agents

## Exporting analytics

The **Export** button on each tab produces:

- CSV (KPI tables, trends)
- JSON (full underlying dataset)

Both exports are local — Ptah does not send analytics data anywhere.

## Data retention

All analytics are computed on-the-fly from your local session files. There's no separate analytics database to manage. Delete a session from [Session history](/sessions/session-history/) and its contribution to the dashboard disappears on the next refresh.

:::note[What's measured where]
Performance and cost numbers come directly from the session transcripts and provider responses. Quality scores are computed by the review agents — if you've never run a reviewer on a session, its quality score will show as `—`.
:::
