# Handoff — TASK_2026_453_1eb4 (session ended 2026-09-16)

AC-11: open 3 canvas tiles on 2,000-event sessions; no renderer long task > 200 ms; total
long-task blocked time <= 1,500 ms. The budget must never be loosened. Read this file first, then
`batches.md` (authoritative batch state), `implementation-plan.md`, `context.md`, `test-report.md`.

## 1. Where the work lives

| Item          | Value                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Worktree      | `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks` (inside the repo on purpose, so CLI lanes can run there)      |
| Branch        | `perf/task-453-tile-open-long-tasks`, tracks origin, all commits pushed                                                                     |
| PR            | none yet — open it when Stage 1 is committed                                                                                              |
| Base          | `51d0d2e1f` (main with PR #518 and PR #519)                                                                                               |
| node_modules  | a junction to `D:\projects\ptah-extension\node_modules`. Never delete it with a tool that follows junctions; use `cmd /c rmdir` first.     |
| Old worktree  | `D:\projects\ptah-437` (TASK_2026_437) is merged and idle. Its removal is a user decision.                                                 |

## 2. Commits on the branch

| Commit       | Content                                                                              |
| ------------ | -------------------------------------------------------------------------------------- |
| `01307f73e`  | Plan: `task.md`, `context.md`, `implementation-plan.md`, `batches.md`                 |
| `49b436256`  | Batch 1 — C4 perf harness, settle-inclusive window, 3 CodeRabbit fixes from PR #518   |
| `93c41c41d`  | Batch 2 — M0 baseline, 9 runs, `test-report.md`                                       |
| `b9cc2f193`  | Batch 3 — C3 canvas request queue + C2 replay admission                               |
| `3f70c986e`  | Docs — Batch 3 commit hash recorded                                                   |
| `408ddffb2`  | Batch 4 — C1 replay motion gate                                                       |
| `1b59aa816`  | Docs — Batch 4 commit hash recorded                                                   |
| (Batch 5)    | Batch 5 — C5 replay render-window fence (hash in `batches.md` Batch 5 header)         |

## 3. Batch state

| Batch | Content                                        | State                                        |
| ----- | ------------------------------------------------ | ---------------------------------------------- |
| B1    | C4 perf harness                                 | COMPLETE, committed                           |
| B2    | M0 baseline                                     | COMPLETE, committed                           |
| B3    | C3 canvas request queue + C2 replay admission   | COMPLETE, committed `b9cc2f193`         |
| B4    | C1 replay motion gate                           | COMPLETE, committed `408ddffb2`               |
| B5    | C5 replay render-window fence                   | COMPLETE, committed (see `batches.md`)        |
| B6    | M1 measurement + decision point                 | IN_PROGRESS — next; needs an idle machine     |

**Before M1**: peer session `ptah-ptah-extension-continue-task-b3c889` (TASK_2026_461) agreed to
hold its heavy passes. Send it a "starting now" message before the first M1 run, and a release
message after the last run. Confirm 0 `jest-worker` / `run-executor` processes before and after
each run (§6 rule 4).

## 4. M0 result (committed evidence: `test-report.md`)

AC-11 is NOT met. Dev cold 3-tile: max 1,926 / 1,326 / 1,062 ms, total 6,941 / 5,463 / 4,077 ms.
Production cold: max 1,201 ms, total 4,767 ms. Warm 1-tile passes.

Key finding, which CORRECTS the FU-22d spike of TASK_2026_437: `scheduleFrame` in
`execution-node.component.ts` makes 88.3 % of all rAF calls, and `FireAnimationFrame` scales 3.09x
when events grow 4x. The spike had ruled this out because it assumed finalized rendering; chunked
replay streams every node instead. While a tile replays it holds about 3.5-4.3x the settled DOM
node count.

Architect decision after M0 (recorded in `implementation-plan.md` under "C1 scope decision"):
**C1 does NOT widen** and `execution-node.component.ts` stays unchanged, because C5 replaces the
binding that feeds `isNodeStreaming()`, so replayed nodes publish synchronously once C5 lands. A5
now expects about 3.3-3.8 s without C5 and about 1.0-1.9 s with it.

## 5. Batch 3 — committed

**State**: delta-2 logic and style reviews both APPROVED; team-leader verified and committed
Batch 3 (commit `b9cc2f193`), corrected Task 3.2 AC 9, and applied the plan's
C1 subsection 1a amendments to Task 4.1 AC 6 and Task 5.1 AC 5. Next: Batch 4 (C1). The notes
below are the pre-commit record.

Committed files: `app-state.service.ts` + spec,
`orchestra-canvas.component.ts` + spec, `session-history-replayer.service.ts` + spec, NEW
`session-history-replayer.admission.spec.ts`, `session-loader.service.spec.ts`,
`macrotask-scheduler.ts`, `libs/frontend/chat/CLAUDE.md`, the perf spec and `perf-page-capture.ts`
comments, `implementation-plan.md` (the C1 scope decision), and 9 `b3-*.md` reports and reviews (including both delta-2 reviews).

Review chain: two codex lanes implemented it; logic and style base reviews both NEEDS_REVISION;
revise round 1 closed them but created a new serious defect (a failed admission hand-off rejected
the already-succeeded replay, so the loader ran its failure recovery on a tab that had succeeded);
revise round 2 fixed that and closed every remaining item. The revise cap of 2 is now used.

Codex round-2 evidence: core 719, chat 1,245 passed + 2 skipped, canvas 121 (header 3 projects);
typecheck 3 projects exit 0; lint 4 projects 0 errors; prettier clean; degradation audit TOTAL 303.

Task 3.2 AC 9 now records that two legacy specs were restructured for scheduling only, with no
assertion weakened (evidence in `b3-revise-codex-report.md` section 5).

## 6. Operating rules (inherited from TASK_2026_437 `handoff.md` §8, still binding)

1. At most 2 agents run tests at once. Always `--parallel=1 --maxWorkers=2`.
2. Run tests separately from typecheck and lint. Never pass `--maxWorkers` to typecheck.
3. `npx nx run-many -t test -p ...` only. Never `nx test a b c`. Check the project count in the header.
4. Perf specs run only on an idle machine: 0 `jest-worker` / `run-executor` node processes before
   AND after each run. Discard a contaminated run and repeat it. Other Claude sessions share this
   machine; the `continue-task` session will hold its heavy passes if asked ahead of time.
5. On Windows PowerShell, quote every argument containing `|`. An unquoted `--testPathPatterns a|b`
   produced a stuck Nx executor that burned a core for 3.5 hours.
6. Stage by explicit path. Never `git add -A`, stash, amend, `--no-verify` or force push.
7. Every batch gets a logic review and a style review before the commit. Reviews are Claude Task
   agents; codex implements. The reviewer is never the implementer. Revise cap: 2 rounds.
8. Never raise the degradation-audit baseline: TOTAL 303.
9. `node_modules` is a junction. Never modify or delete it. No `nx reset` while another agent works
   in this worktree.
10. Codex lanes need `workingDirectory` inside `D:\projects\ptah-extension`; that is why this
    worktree lives under `.claude-worktrees`.

## 7. Open user decisions

1. Stage 2 option, only if M1 still misses AC-11 (per-frame mount budget, or tail-paged history).
2. When to open the PR for this branch, and whether as a draft.
3. TASK_2026_437 leftovers: D10 `publish-electron.yml` dispatch, FU-16b-c `internalQuery.maxConcurrent`,
   the `chore/bump-*` CI skip guard, the property-hub load-test scripts, AC-10 manual boot evidence.
4. Removal of the `D:\projects\ptah-437` worktree.
