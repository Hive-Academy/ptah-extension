---
id: TASK_2026_421_8481
status: in_review
type: BUGFIX
title: Codex CLI agents never reach completed after their turn ends
description: >-
  A spawned Codex CLI agent prints its final report and usage line but
  ptah_agent_status keeps reporting running until the 1-hour timeout, because
  CodexCliAdapter.runTurn waits for the SDK event iterator to end and the
  codex.exe child never exits.
---

Codex agents stay `running` after `turn.completed`. See `context.md`.
