---
id: TASK_2026_575_74a4
status: in_review
type: BUGFIX
title: Make session and analytics cost accounting correct and pinned by tests
description: >-
  Per-message cost badge shows the cumulative SDK process total, the live header omits subagent and CLI-lane spend,
  the analytics page drops the whole cost of partially priced sessions, and [1m] model ids get no price.
depends_on: []
created: 2026-09-29T00:00:00.000Z
updated: 2026-09-29T00:00:00.000Z
---

## Description

Session cost numbers in the chat stats header, per-message badges and the analytics page are not
trustworthy for Claude and Codex main agents. Fix the accounting so that each message shows its own
turn cost, the session header shows the true accumulated cost (main agent + subagents + CLI lanes)
priced at the rates of the model actually used, the analytics page never silently drops spend, and
regression tests pin the semantics.
