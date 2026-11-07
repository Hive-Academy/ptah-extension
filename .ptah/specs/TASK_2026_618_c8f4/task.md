---
id: TASK_2026_618_c8f4
status: backlog
type: BUGFIX
title: Make the linked-worktree re-listing test in git-watcher.real-git.spec.ts robust to slow CI
depends_on: []
created: "2026-10-06T00:12:27.441Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The real-git watcher test that waits PUSH_TIMEOUT_MS (3 s) for a worktree re-listing after
  `git worktree add` timed out once on CI under coverage and 2 workers. Wait on the real signal.
estimate: S
labels:
  - flaky-test
  - ci
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The test "a commit inside a linked worktree pushes a refs change, and adding it re-lists
worktrees" runs `git worktree add`, then polls for at most `PUSH_TIMEOUT_MS` until the watcher
re-lists worktrees. The re-listing depends on a real file-system watch event on the common git dir
and on the worktree-audit throttle (`claimWorktreeAudit`). Under coverage and 2 workers the event
or the audit can arrive after the fixed deadline. It failed once on CI (run 37381148207,
2026-10-05) and passed on re-run.

1. Find which step misses the deadline (watch event or audit throttle). Add a failure diagnostic
   that prints the watcher's pushes, causes and audit state.
2. Make the test wait on the real condition (the audit or re-listing signal), or give the audit a
   deterministic trigger in the test. Keep the meaning of the assertion.
3. Check the other real-git tests that use `PUSH_TIMEOUT_MS` for the same pattern.

Acceptance: 20 consecutive passes under `--coverage --maxWorkers=2` (run under the verify lock),
and green on CI. No production change unless the investigation finds a watcher bug.

## Current state (2026-11-07)

- Not fixed. `apps/ptah-electron/src/services/git-watcher.real-git.spec.ts:45` still has
  `PUSH_TIMEOUT_MS = 3_000`; the test is at `:332` with a fixed deadline at `:338`.
- The spec file has not changed since `a3450c372` (2026-10-06).
- The throttle is `claimWorktreeAudit` at `apps/ptah-electron/src/services/git-watcher.service.ts:953`.

Full context, plan and discussion live in [./context.md](./context.md).
