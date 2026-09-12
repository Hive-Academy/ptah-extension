---
status: in_progress
type: feature
title: Agent two-way messaging
description: >-
  Let a spawned agent message the session that spawned it, and let that session
  message the agent back, so a child can report that it finished and can ask a
  question mid-run instead of only answering at exit. Replaces the
  single-vendor steer path with a capability-driven router.
---

Eight batches. Batches 1, 2 and 3 are committed on `feat/agent-two-way-messaging`.
Batches 4, 5, 7 and 8 were never started. Batch 6 was implemented but never
committed, and its code was lost when the worktree was removed — only
`batch-6-report.md` survives, and it names every file and change.

This carrier was rebuilt on 2026-09-12. The original folder was never committed
and died with the worktree; `task-description.md`, `implementation-plan.md`,
`batches.md`, `steering-research.md` and the four batch reports were recovered
verbatim from the orchestration session transcript. This file is the one
document with no recoverable original, because the original was minted by
`ptah_task_create` rather than written to disk by an agent.

Scope, requirements and acceptance criteria are in `task-description.md`. The
architecture is in `implementation-plan.md`. The batch breakdown and the
executor prompts are in `batches.md`.
