---
id: TASK_2026_513_a7c2
status: backlog
type: BUGFIX
title: >-
  Session tile header reports the model, token count and cost of a spawned CLI
  agent instead of the session
description: >-
  The Orchestra session tile header of a Claude CLI session on an Opus model
  shows a model badge for a different vendor, together with a token count and a
  cost figure that do not belong to that session. The observed session had
  spawned background CLI agents from another vendor. The header appears to read
  the model identity and the usage totals of a spawned agent, or to aggregate
  agent usage into the session record. Find the true source of each of the four
  header fields, then make each field report the session that owns the tile.
---

# Session tile header reports the model, token count and cost of a spawned CLI agent

Investigation task. Parent evidence: `.ptah/specs/TASK_2026_513_a7c2/context.md`.

See `context.md`.
