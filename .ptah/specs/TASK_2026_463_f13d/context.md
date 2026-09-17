# TASK_2026_463 — TASK_2026_437 leftovers

## User intent

Close the TASK_2026_437 follow-ups that are code or workflow changes, on a separate branch off
`main` (`chore/task-463-437-leftovers`, worktree
`D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers`, base `97239e814`). Items
that need a person (the Electron release dispatch, AC-10 boot evidence, the load-test run) stay
with the user.

## User decisions (2026-09-16)

1. **CI skip guard.** Narrow the `chore/bump-*` skip in `ci.yml`, `electron-e2e.yml` and
   `vscode-e2e.yml` to the bot prefixes only, so a human dependency bump (like PR #512,
   `chore/bump-better-sqlite3-13`) runs CI. Verify the exact lines and the bot branch names from
   the workflows that create them.
2. **FU-16c.** Fix the `internalQuery.maxConcurrent` default mismatch (settings default 1 vs gate 2)
   and the stale doc comment.
   **FU-16b-c.** Option chosen: "raise the global limit to 3 and cap background work" (at
   limit − 1), so user-action queries keep a slot.
3. **D10 prerequisite.** Add a dry-run input to `.github/workflows/publish-electron.yml` that runs
   every safe step (build, package, verify) but does NOT tag, sign with the paid eSigner, open the
   bump PR, or publish a release. The dispatch itself is the user's manual action after merge.
4. **Property-hub load-test scripts** as defined in TASK_2026_437 `handoff.md` §9 (~:480-490).
   Add the scripts only; the run stays manual.

## Out of scope

- AC-10 manual boot evidence (user action).
- PR #457 (`main` → `release/cli`).
- Any release now (no dispatch, no Sync Release Branch run).

## Constraints for this planning pass

- No tests, builds, nx, jest or Playwright while the idle-machine perf run is in progress.
- No git writes, no code edits. `node_modules` in the worktree is a junction — never modify it.

## Sources

- `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\leftovers-inventory.md`
  — Table A (A1-A5) and grouping (2)/(3).
- `.ptah/specs/TASK_2026_437_0778/handoff.md` — §5 open decisions (:370-381), §6 FU-16a/c,
  FU-16b-c (:408-409), §7 PR #512 skip (:452-455), §9 manual load test (:480-490).
- `.ptah/specs/TASK_2026_437_0778/batches.md` — Batch 16 follow-ups (:1127-1129), Batch 16b
  outcome and FU-16b-c options (:1146-1155), Batch 10 D10 (:674, :701).
- `.ptah/specs/TASK_2026_437_0778/implementation-plan.md` — AC-10 (:802), for reference only.
- Root `CLAUDE.md` — task-spec carrier rules, release-branch rules.

Plan: [./implementation-plan.md](./implementation-plan.md).
