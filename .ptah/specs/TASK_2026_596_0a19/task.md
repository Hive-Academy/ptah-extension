---
id: TASK_2026_596_0a19
status: done
type: FEATURE
title: >-
  Predictable plan-limit reset detection and display for the main agent and CLI lanes
description: >-
  Detect the session (5h) and weekly plan-limit windows and their reset times for Claude, Codex,
  Antigravity, OpenCode and Ollama Cloud. Show them in the session stats grid, the agent picker and
  the dashboard, add CLI lane stats, and feed exhausted-until state into ptah_agent_list and
  ptah_agent_spawn.
depends_on: []
created: 2026-10-03T00:00:00.000Z
updated: 2026-10-03T00:00:00.000Z
---

## Description

One predictable way to know, for the main agent and for every CLI lane, how much of each plan-limit
window is used and when it resets. Each value carries its source (`provider-api`, `stream-event`,
`estimated`) so the UI never presents an estimate as authoritative.

Related: TASK_2026_535 (lane outcome ledger, `failure_kind: quota`), TASK_2026_441 (lanes first,
fall back only when every lane is at its limit), TASK_2026_575 (CLI lane cost left out of scope).
