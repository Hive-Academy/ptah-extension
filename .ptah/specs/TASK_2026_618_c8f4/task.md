---
id: TASK_2026_618_c8f4
status: backlog
type: BUGFIX
title: Make the linked-worktree re-listing test in git-watcher.real-git.spec.ts robust to slow CI
depends_on: []
created: "2026-10-06T00:12:27.441Z"
updated: "2026-10-06T00:12:27.441Z"
description: "The real-git watcher test that waits PUSH_TIMEOUT_MS for a worktree re-listing after `git worktree add` timed out once on CI (coverage, maxWorkers=2) in PR #656; it passed on re-run."
estimate: S
labels:
  - flaky-test
  - ci
relates_to:
  - TASK_2026_616_de8a
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The real-git watcher test that waits PUSH_TIMEOUT_MS for a worktree re-listing after `git worktree add` timed out once on CI (coverage, maxWorkers=2) in PR #656; it passed on re-run.

Full context, plan and discussion live in [./context.md](./context.md).
