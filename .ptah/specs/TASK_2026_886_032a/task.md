---
id: TASK_2026_886_032a
status: done
type: RESEARCH
title: Sweep task statuses, merged worktrees and stale backlog
description: >-
  Audit every task carrier against merged PRs and codebase evidence, correct
  wrong statuses, remove local worktrees whose branches are merged, and flag
  backlog tasks that recent changes made stale.
depends_on: []
created: 2026-11-07T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Housekeeping sweep in three phases:

1. Merged/finished tasks: confirm each carrier status matches its PR and code state.
2. Local worktrees under `.claude-worktrees/` whose branch is merged into `main`: remove them.
3. Backlog: find tasks that recent merges or current code made stale, duplicated or obsolete.
