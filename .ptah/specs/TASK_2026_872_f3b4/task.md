---
id: TASK_2026_872_f3b4
status: done
type: FEATURE
title: Split session sidebar into agent run details and lane plan limits
description: >-
  AGENTS table carries every per-run detail (tokens, time, cost); LANES section shows one
  plan-limit row per provider with a progress bar like the main PLAN LIMITS card.
depends_on: []
created: 2026-11-03T15:20:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

The session sidebar has two sections with overlapping content. AGENTS lists each run with
tokens, cost and status, but CLI lane rows show only dashes. LANES groups runs per provider
with token, cost and status chips and repeats the run details.

Target:

- AGENTS shows every per-run detail we have for lanes: tokens, duration, cost, status.
- LANES shows only plan limits: one row per provider (for example one Codex row, not one per
  run), each with a usage progress bar and reset time, styled like the main PLAN LIMITS card.
