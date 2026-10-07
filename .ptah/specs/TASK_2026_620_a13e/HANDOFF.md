# HANDOFF — TASK_2026_620_a13e (and TASK_2026_621_3d5c)

Updated 2026-10-07 ~06:45 by orchestrator session `ptah-ptah-extension-continue-memory-skil-b503dc00005aw2q23htdi0e`.
Read `context.md` first (user decisions incl. "User decisions 2026-10-07, B-P pause switches", the 619
agreement and answers). This file is the resume point only.

## Where things are

| Item                  | Location                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 620 branch / worktree | `feat/task-620-memory-skills-bench` at `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`, based on 619 `ea2f92fd2` (Batch 9.0). Nothing pushed.                                                              |
| 621                   | PR #666 (`fix/task-621-retention-guard`): all CI green (main, SonarCloud, e2e, git-real-git x3), CodeRabbit threads answered, pushed to `a0edd9ffb`. Review state REVIEW_REQUIRED (a reviewer must re-approve after the new pushes). |
| Bench data (private)  | `C:/Users/abdal/AppData/Local/ptah-mcp-bench/` — never commit                                                                                                                                                                        |
| 619 peer session      | `ptah-ptah-extension-continue-619-tool-en-55bb9d00005aw2q23htdi0d` — find its successor with `ListAgents` if gone                                                                                                                    |

## State

- **Benchmark program:** Phases 3.1-3.6 DONE and cross-side reviewed (B1-B23 committed; phase reviews
  `code-logic-review-phase3-{2,4,5,6}*.md` all APPROVED). 17 memory + 16 skills suites registered.
  Scoped jest: 51 suites / 578 tests. Many suites report `na` today by design (labels not committed,
  cassettes not recorded, product seams missing) — see "Phase 4 seams" below.
- **B-P pause switches (user request 2026-10-07, user-approved plan `pause-switches-plan.md`):**
  IMPLEMENTED and REVIEWED: PD `7872fc689`, P1 `a6a6a6854`(+`a42ddf299`,`06a3decbe`), P2
  `c2618c287`(+`ad6461c42`), P3 `752633f44`, P4 `f15e6e3a1`, P5 `56a03a52a`(+`98831dddb`), boot retry
  `49b318425`,`1d4eddd75`,`48572ef5e`,`0c67b707a`,`8e25a6df6`. Reviews: backend r3 APPROVED,
  RPC/UI/Electron r2 APPROVED, boot-retry r5 APPROVED.
- **B-P visual review APPROVED (round 2, 9/10)**: `visual-review.md`, screenshots in `screenshots/b-p/`.
- **Previously NOT DONE for B-P (now done):** dark + light screenshots of the Thoth Memory and Skills tabs (switch, Paused
  badge, greyed manual actions) by a visual-reviewer — postponed at 619's request while its Batch 10
  noise runs measure latency (no Electron launch until "619 noise runs done"). Manual Linux/macOS
  tray check (the reviewer verified the fs.watch path statically only).

## Next steps, in order

1. Wait for "619 noise runs done". Then run the visual review (screenshots dark + light; see
   `b-p-p4-report.md` "how to see it").
2. Rebase onto 619 `4d3d0dd5d` (Batch 9: corpus owner-pid sweep, bench-host.entry.ts memory seeding,
   new project.json targets — check `build-host-memory-skills` / `bench-memory-skills` merge cleanly).
   Then drop the `suite-result.ts` mirror and the `process.env` save/restore around launchBenchHost
   (619 exported `suiteCoreSchema`, `HostLaunchOptions.env`, `bench-host-process.ts` in `ea2f92fd2`).
   Re-run scoped jest + `nx run-many -t typecheck,lint -p mcp-bench` + the B-P projects.
3. User activities U1-U4 (raters label the 105-document packet; re-run the held-out session sampler
   after the eval window, then label) — B21/B23 scored runs, B25, B26 wait on them.
4. B24 (CI workflow + first recorded run): message the 619 session first and wait for its OK; never
   run two benches at once. Pending live recordings (paid model calls — ask the user first):
   extraction.v1, B18 curator cassettes, scope-write, funnel.v1 (commands in batch-17/18/19/22 reports).
5. B25 freeze labels/ground truth (fix F-005, whose statement contains its own forbidden token; add
   abstention cases to reach 15), B26 close-out.
6. When 620 is finished: open a PR (619 base-branch rule in context.md).

## Phase 4 seams the benchmark found (product changes needed before some rows get a verdict)

- Trigger-pass result seam (liveness suites are `na: harness-only`).
- Pre-rerank order in `searchRich` (`mem.dedup.rerank` `na`).
- Public commit step of the memory curator (dedup/update/temporal `na: mirrored-commit-path`).
- 588: archaeology before authoring + a visible `noRoutine` reason (funnel feed-parity fails today);
  skills `manual-run` has no producer; promotion success counter stays 0; retirement removes a skill in
  use; boot reconcile deletes a promoted skill's directory.
- Memory: `mem.scope.write` fails on win32 (rows under a different key, 2 keyed `''`); tier-2 merge
  not configurable; `created_at` not injectable; lifecycle deletes useful rows; 9-day stall loses rows.

## Follow-ups recorded (not done)

- B-P: idle re-arm hard-codes the 1-hour rate-limit window (`RATE_LIMIT_WINDOW_MS`); per-workspace
  memory toggle fix (F1) and moving host-local trigger keys to `~/.ptah/settings.json` (F2).
- B-P UI: the Paused badges render at 10 px, not 12 px — an unlayered `.badge { font-size: 10px }` at
  `apps/ptah-extension-webview/src/styles.css:1737` overrides `text-xs` (visual-review.md Round 2).
- Runner N1: read-time re-check uses `git status` (a mid-run commit passes); N2 seeder realpath option.

## Rules learned in this session (keep applying)

- Lane output is evidence, not proof: three lanes reported a lint/typecheck pass that was false or
  unfinished (B1, B7, B10). Re-run every check yourself before committing; commit per batch with only
  that batch's files.
- `Glm` (ptah-cli, Ollama Cloud) fails on long or resumed sessions (context overflow, 0-turn resume,
  exit while waiting on a background run). Give it short tasks with small reads; prefer a fresh spawn
  over a resume. `codex` and `opencode` finish reliably but sometimes claim checks they did not run.
- Pure modules in `tools/mcp-bench` must not import the `memory-curator` barrel at runtime; specs may,
  with `import 'reflect-metadata'` and `jest.mock('vscode', () => ({}), { virtual: true })`.
- Every rate's `value` must equal `num / den` exactly (projection hash stability).
- Committed fixtures hold no user data; private data stays in the bench data folder.
- Revise cap is 2 rounds; after that, report or make one bounded correction with one more review.
- **Never run the full `nx run mcp-bench:test` target** while 619 may be running a bench: it includes
  619's `corpus.spec.ts`, whose `withPinnedCorpus` sweep force-removes other corpus worktrees.
  Incident 2026-10-07 ~02:00: the B15 subagent ran it against instructions while another bench ran
  (foreign corpus dir appeared mid-test); the 619 session was informed. 619 answer: no 619 bench was
  live, only its full mcp-bench check (passed; re-run by the next 619 session). The corpus spec uses
  its own temp git repos, so it cannot remove real-repo worktrees, but two concurrent runs share the
  OS temp folder; 619 Task 9.3 adds an owner liveness check and a private temp root.
- **The 619 session `…7799a800005aw2q23htdi0b` has stopped and handed off.** Find its successor with
  `ListAgents`; it is told to message 620 before any real bench run. Do the same before B24. Run only scoped jest paths
  under `tools/mcp-bench/src/memory-skills/`, and say so explicitly in every executor prompt.
- `opencode` failed twice in a row ("Unknown error", once after 8 s) on 2026-10-07; review work moved
  to `codex` and subagents. Retry it on a short task before relying on it again.
- Never move another agent's untracked files to prove a commit (it made the B22 agent think its files
  were deleted). Prove a partial commit by re-running checks after the other agent finishes instead.
- The repository `.gitignore` ignores every `skills/` folder; `tools/mcp-bench/src/memory-skills/suites/skills/`
  and `fixtures/memory-skills/cassettes/skills/` now have exceptions — add one for any new `skills/` path.
- Run multi-project nx tests with `--parallel=1` (Jest transform-cache race on Windows).
