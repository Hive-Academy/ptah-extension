---
id: TASK_2026_688_f6d2
status: in_review
type: BUGFIX
title: Validate session:stats-batch pages in Session Analytics
description: >-
  Session Analytics fails with "result.data.sessionStats is not iterable" when a stats page has no sessionStats array.
depends_on: []
created: 2026-10-17T00:00:00.000Z
updated: 2026-10-17T00:00:00.000Z
---

## Description

The Analytics dashboard shows `result.data.sessionStats is not iterable` and stops the full
load. `SessionAnalyticsStateService.mergePage` trusts the `session:stats-batch` response shape.
The Electron e2e fake RPC listener answers unmocked methods with `success: true` and a default
object that has no `sessionStats`, and `pageMatchesLoad` accepts it.

A malformed page must make each requested session on that page read as unreadable (`'error'`),
the same as an unanswered session. It must not fail the load.
