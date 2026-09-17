# Handoff — TASK_2026_453_1eb4 (updated 2026-09-17)

AC-11: open 3 canvas tiles on 2,000-event sessions; no renderer long task > 200 ms; total
long-task blocked time <= 1,500 ms. The budget must never be loosened. Read this file first, then
`batches.md` (authoritative batch state), `implementation-plan.md`, `context.md`, `test-report.md`.

## 1. Where the work lives

| Item         | Value                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree     | `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks` (inside the repo on purpose, so CLI lanes can run there)  |
| Branch       | `perf/task-453-tile-open-long-tasks`, tracks origin, all commits pushed                                                                |
| PR           | #524, draft; CI all green at `d8951fa03`                                                                                               |
| Base         | `51d0d2e1f` (main with PR #518 and PR #519)                                                                                            |
| node_modules | a junction to `D:\projects\ptah-extension\node_modules`. Never delete it with a tool that follows junctions; use `cmd /c rmdir` first. |
| Old worktree | `D:\projects\ptah-437` (TASK_2026_437) was removed 2026-09-16. Its leftovers moved to TASK_2026_463_f13d (see §7).                     |

## 2. Commits on the branch

| Commit      | Content                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01307f73e` | Plan: `task.md`, `context.md`, `implementation-plan.md`, `batches.md`                                                                                                                               |
| `49b436256` | Batch 1 — C4 perf harness, settle-inclusive window, 3 CodeRabbit fixes from PR #518                                                                                                                 |
| `93c41c41d` | Batch 2 — M0 baseline, 9 runs, `test-report.md`                                                                                                                                                     |
| `b9cc2f193` | Batch 3 — C3 canvas request queue + C2 replay admission                                                                                                                                             |
| `3f70c986e` | Docs — Batch 3 commit hash recorded                                                                                                                                                                 |
| `408ddffb2` | Batch 4 — C1 replay motion gate                                                                                                                                                                     |
| `1b59aa816` | Docs — Batch 4 commit hash recorded                                                                                                                                                                 |
| `b19077d03` | Batch 5 — C5 replay render-window fence                                                                                                                                                             |
| `0149adef8` | Docs — Batch 5 commit hash recorded                                                                                                                                                                 |
| `d8951fa03` | Batch 6 — M1 measurement in `test-report.md` + methodology review (docs only)                                                                                                                       |
| (docs)      | `docs(task-specs): design the TASK_2026_453 scroll fix and tail-paged history` — `scroll-regression-analysis.md`, Stage 2 (ii) in `implementation-plan.md`, Batches 7-17 in `batches.md`, this file |
| (fix)       | Batch 7 — `fix(chat): keep replayed transcript mounts monotonic so tiles stay pinned` (C5 replay mount retention + `b7-*` reports)                                                                  |
| (test)      | Batch 8 — `test(electron-e2e): record the TASK_2026_453 scroll re-check after the retention fix` (docs only; `b8-methodology-review.md`, `leftovers-inventory.md`)                                  |
| `7a84fd031` | Batch 9 — `feat(shared): add tail history page contracts and cursor utils` (C6)                                                                                                                     |
| `b19b013fd` | Batch 11 — `feat(chat-streaming): extract history message builder and tab cursor prepend` (C10 + C11)                                                                                               |
| `990955dfe` | Batch 12 — `feat(chat): page older session history on demand after a tail resume` (C12)                                                                                                             |
| (feat)      | Batch 10 — `feat(rpc-handlers): serve tail-paged chat history through chat:history-page` (C7 + C8 + CLI doc)                                                                                        |

**Stage 1 (C1-C5), the Batch 7 scroll fix, and Stage 2 Batches 9-12 (C6-C12) are committed. Batch
12 was committed before Batch 10 and did not typecheck alone; the Batch 10 commit resolves that.
Draft PR #524 CI was last all green at `d8951fa03`; later commits are not pushed.**

## 3. Batch state

| Batch   | Content                                           | State                                                      |
| ------- | ------------------------------------------------- | ---------------------------------------------------------- |
| B1      | C4 perf harness                                   | COMPLETE, committed                                        |
| B2      | M0 baseline                                       | COMPLETE, committed                                        |
| B3      | C3 canvas request queue + C2 replay admission     | COMPLETE, committed `b9cc2f193`                            |
| B4      | C1 replay motion gate                             | COMPLETE, committed `408ddffb2`                            |
| B5      | C5 replay render-window fence                     | COMPLETE, committed `b19077d03`                            |
| B6      | M1 measurement + decision point                   | COMPLETE, committed `d8951fa03` (docs only)                |
| B7      | C5 scroll retention fix                           | COMPLETE, committed (revise 1 of 2; F1 carried to B8 / U1) |
| B8      | Scroll sanity re-check (Electron, 23 attempts)    | COMPLETE, committed (docs only) — **PASS, 0/23 failures**  |
| B9      | C6 paged history contract (`libs/shared`)         | COMPLETE, committed `7a84fd031`                            |
| B10     | C7 events read + C8 `chat:history-page` + CLI doc | COMPLETE, committed (revise 1 of 2)                        |
| B11     | C10 history message builder + C11 tab cursor      | COMPLETE, committed `b19b013fd`                            |
| B12     | C12 paging orchestration (`chat`)                 | COMPLETE, committed `990955dfe` (revise 1 of 2)            |
| B13-B17 | C13 affordance, C14 e2e, M2 (B16-B17 conditional) | PENDING                                                    |
| B18     | Post-Stage-2 follow-ups (test quality)            | PENDING                                                    |

**Batch 8 result**: PASS — 0 scroll-sanity failures in 23 counted attempts (review APPROVED). 3 of
10 asserting runs met the AC-11 budget (runs 1, 6, 9); comparison only, not a verdict. One Playwright
worker crash at 0 ms was discarded and re-run. Review process notes: flag infra anomalies to the
orchestrator before spending a retry; Batch 15 (M2) must persist idle-check counts to a log.
Follow-ups from `leftovers-inventory.md` are folded into Stage 2 batches (batches.md D15).

**M1 result** (committed evidence: `test-report.md` "M1" section, review
`b6-m1-methodology-review.md` base NEEDS_REVISION → Delta APPROVED): **AC-11 NOT MET.**

| Run                | Max (ms)   | Total (ms) |
| ------------------ | ---------- | ---------- |
| Dev cold 1         | 220        | 3,226      |
| Dev cold 2         | 337        | 4,927      |
| Dev cold 3 (retry) | 185        | 2,169      |
| Production cold    | 166 (pass) | 985 (pass) |

Stage 1 cut max 5.4-8.8x and total 2.1-2.6x in dev; production now passes. TILE_2 (last admitted)
still carries ~90 % of blocked time. AC 2 is PARTIAL (DOM ratio measured whole-canvas only, 0.21-0.39x
on 3-tile runs). **New blocking regression**: scroll sanity failed in 2 of 11 attempts (132 px and
31,155 px from bottom, budget 120 px) on the still-replaying tile — the C5 tail-shift risk, present
on committed Batch 5 code.

**Peer hold released**: M1 is done; the TASK_2026_461 session no longer needs to hold heavy passes.

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

## 7. User decisions and next steps

**Decided 2026-09-16**:

- Stage 2 option: **(ii) tail-paged history**.
- Scroll regression: the architect finds the cause, then a codex lane fixes it inside C5 with logic
  and style reviews, then the scroll check is repeated — all before any Stage 2 code.
- PR: open this branch as a **draft** PR. Done: PR #524 (draft), CI all green at `d8951fa03`.

**Stage 2 (ii) decisions, 2026-09-16** (full record: `implementation-plan.md` "Resolved user
questions", `batches.md` Stage 2):

1. Initial page: 250 events, whole turns.
2. Load older: a button, plus auto-load that turns on only after the user scrolls up.
3. Stale cursor: show an error telling the user to reopen the session. No automatic re-open.
4. CLI scope: docs only; paging goes through `rpc.call`.
5. If M2 meets total but fails only the 200 ms max: drop the initial page to 150 events and
   re-measure without asking again (Batches 16-17). The budget is never loosened.
6. Orchestrator accepted the V1 retarget: Task 10.2 edits `sanitizeAnchorHint`.

**Done**: architect analysis (`scroll-regression-analysis.md`) and Stage 2 design
(`implementation-plan.md`); team-leader Batches 7-17 in `batches.md`; Batch 7 scroll fix committed
(logic + style APPROVED, revise 1 of 2). F1 (serious, open): the release window can still coincide
with live growth below — Batch 8 re-check and U1 escalation cover it.

Batch 8 PASS (0/23 scroll failures). Stage 2 Batches 9-12 committed 2026-09-17, each after logic +
style reviews.

**Next steps, in order**:

1. Batch 13: C13 "Load earlier" affordance (Task 13.0 timer-clear dedup, 13.1 sentinel directive,
   13.2 conditional facade split), then logic + style reviews and commit.
2. Batches 14-17 (C14 e2e, M2, conditional 150-event fallback), then Batch 18 follow-ups.
3. Push the branch and re-check draft PR #524 CI when the orchestrator decides.

**TASK_2026_437 leftovers** moved to **TASK_2026_463_f13d**, branch
`chore/task-463-437-leftovers`, worktree `.claude-worktrees/task-463-437-leftovers`. The
`D:\projects\ptah-437` worktree was removed 2026-09-16. User decisions for TASK_2026_463:

- `publish-electron.yml`: add the dry-run input first.
- FU-16b-c: raise the global `internalQuery.maxConcurrent` to 3, with a background cap.
- Property-hub load-test scripts: yes.
- PR #457: left open.

**Remaining manual user actions**:

1. AC-10 manual boot evidence.
2. Dispatch the `publish-electron` dry-run after TASK_2026_463 merges.
