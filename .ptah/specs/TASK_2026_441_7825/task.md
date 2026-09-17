---
id: TASK_2026_441_7825
status: backlog
type: REFACTORING
title: >-
  Lanes first: orchestration spends CLI lanes before subagents and falls back
  only when every lane is at its limit
description: >-
  The user prefers CLI lane execution over subagents, and falls back to
  subagents only when lanes hit usage limits. The shipped orchestration and
  agent-lanes skills default the other way - Gate 0.1 recommends "auto", which
  keeps every phase on subagents - so a 2026-09-14 run put the architect,
  team-leader, two of three batches and every review on subagents, and one
  code review was same-family. Make lanes the default executor and cross-family
  reviewer, add quota and limit detection with an ordered fallback, and record
  a limit so the run does not retry an exhausted lane.
depends_on: []
created: 2026-09-14T17:05:00.000Z
updated: 2026-09-14T17:05:00.000Z
---

See `context.md`.
