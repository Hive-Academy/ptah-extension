---
status: backlog
type: BUGFIX
title: The ptah-cli test chain is unrunnable in a worktree and hangs on exit
description: >-
  Three defects that together make an agent working in a git worktree hang
  forever with no diagnostic. copy-wasm resolves node_modules against the
  worktree root, which has none, so the whole ptah-cli build chain fails. The
  fallback to raw jest then leaks async handles and never exits under
  --runInBand. Underneath both, withEngine swallows three DI failures as
  non-fatal and leaves a half-booted engine running.
---

Found on 2026-09-12 while running Batch 5 of TASK_2026_402_a5c7. A subagent
appeared to stall for roughly twenty minutes. It had not stalled: it was blocked
on a `jest` process that had finished its tests and could not exit.

Every claim in `context.md` is reproduced, not inferred. The three defects are
ranked there by how much time they cost, not by how hard they look.

Evidence and acceptance criteria are in `context.md`.
