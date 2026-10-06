# TASK_2026_618 — context

Follow-up of TASK_2026_616_de8a (PR #656).

## Problem

`apps/ptah-electron/src/services/git-watcher.real-git.spec.ts` ›
"a commit inside a linked worktree pushes a refs change, and adding it re-lists worktrees"
failed once on CI (job `main`, `nx run ptah-electron:test --coverage --maxWorkers=2`, run
37381148207, 2026-10-05): `expect(main.getWorktrees.mock.calls.length).toBeGreaterThan(listingsBefore)`
received the same count (4). The suite took 51.9 s. The job passed on re-run, and the test passes
locally.

The test runs `git worktree add`, then polls for at most `PUSH_TIMEOUT_MS` until the watcher re-lists
worktrees. The re-listing depends on a real file-system watch event on the common git dir and on the
watcher's worktree-audit throttle (`claimWorktreeAudit` in `git-watcher.service.ts`). Under coverage
and 2 workers the event or the audit can arrive after the fixed deadline.

PR #656 did not cause it: the spec's fake `GitInfoService` reports no status backoff, so the new
follow-up push never runs there.

## Scope

1. Find which step misses the deadline (watch event delivery vs. the audit throttle) — add a diagnostic
   on failure that prints the watcher's pushes/causes and audit state.
2. Make the test wait on the real condition (the audit / re-listing signal) instead of a fixed
   wall-clock budget, or give the audit a deterministic trigger in the test; keep the assertion's meaning.
3. Check the other real-git tests that use `PUSH_TIMEOUT_MS` for the same pattern.

## Acceptance

- The test passes 20 consecutive runs under `--coverage --maxWorkers=2` locally, and on CI.
- No production behaviour change unless the investigation finds a real watcher bug.
