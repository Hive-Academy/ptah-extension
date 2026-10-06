# HANDOFF — TASK_2026_620_a13e (and TASK_2026_621_3d5c)

Written 2026-10-07 by the orchestrator session `ptah-ptah-extension-skills-trajectory-an-10a89600005aw2q23htdi0c`
at the user's request ("stop after the current step, create a handoff"). Read `context.md` in this
folder first — it holds every user decision, the 619 agreement, and the corrections. This file is
the resume point only.

## Where things are

| Item | Location |
|---|---|
| 620 branch / worktree | `feat/task-620-memory-skills-bench` at `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench` (based on 619 `d716e0e8f`; `node_modules` is a junction to the main repo — never delete it) |
| 620 task folder | this folder, inside the 620 worktree (moved out of the main checkout 2026-10-07; the Tasks board on `main` will not show 620 until it merges) |
| 621 branch / worktree | `fix/task-621-retention-guard` at `D:\projects\ptah-extension\.claude-worktrees\agent-a0c9cbefc2a09f580-4957846ea3d6`; task folder `.ptah/specs/TASK_2026_621_3d5c/` inside it |
| 621 PR | https://github.com/Hive-Academy/ptah-extension/pull/666 (open, final review APPROVED, task status `in_review`) |
| Bench data (private, never commit) | `C:/Users/abdal/AppData/Local/ptah-mcp-bench/` — `snapshots/ptah-20261006-pre-retention.sqlite` (sha256 `82cd16ac…d575a`), `snapshots/skill-candidates-20261006/` + manifest (`73a184c5…45f3`), `labelling/skill-rubric-v1/raters/rater-r1|r2/`, `drafts/memory-ground-truth/` (B10 drafts) |
| 619 peer session | `ptah-ptah-extension-compare-grep-and-our-7799a800005aw2q23htdi0b` (owns `tools/mcp-bench/src/scorecard/`, `transport/`, `corpus/`, `bench-data.ts`; message it before any schema change or any real bench run) |

## State at handoff

- 620 worktree is clean. Last commits: `179a5bbc6` B15 (bench host), `a3d12d49f` docs (this task
  folder + the status edits to 439/471/473/563/578/588). Nothing is pushed.
- **Tell the new 619 session** that `179a5bbc6` added the `build-host-memory-skills` target to
  `tools/mcp-bench/project.json` (619 asked to be told the commit). `bench-memory-skills` is not added
  yet (Batch 16).
- 621 worktree: DONE — `.ptah/specs/TASK_2026_621_3d5c/` committed as `104a55d5d` (local; the
  branch is 1 commit ahead of `origin`). The user has NOT yet approved pushing it to PR #666; ask
  before pushing.

## 620 commits so far (on top of `d716e0e8f`)

Phase 1 (B1–B9, B11 part) and its review fixes, plus Phase 2 B12–B14:
`4733c7b21` B1, `346cfccc1` B3, `817ee839e` B5, `10abf8578` B2, `52755452e` B6, `49f341213` B9,
`60ac44a36` B8, `2ad65ced6` B11-part, `a07178aa6` B7, `9450ebd17` B4, `4c0db24f2` phase-1 fix
(doubles), `22f6cd94b` phase-1 fix (data/labelling), `525db5bd5` phase-1 fix (metrics/matcher/
baselines), `111a97be8` B14, `1ad622066` B12, `9cce01784` B13, `fe0ad8fff` phase-1 fix (generator).

## Next steps, in order

1. **Batch 15 is done** (`179a5bbc6`; 48/48 host specs, eslint/typecheck/prettier clean, no
   619-owned file changed, smoke run through `launchBenchHost` exited clean with the process-watch
   guard). Notes for Batch 16 from `batch-15-report.md`: poll `host-completion.json` (the launcher
   stops reading host stdout after the ready line); `HOST_SUITES` is still empty; no fake-timer
   library is a declared dependency.
2. **Phase-1 re-review** (all phase-1 findings are fixed): cross-side again — lane-authored fixes
   (metrics/matcher/baselines `525db5bd5`, doubles `4c0db24f2`, generator `fe0ad8fff`) → a subagent
   reviewer; in-process fixes (data/labelling `22f6cd94b`, orchestrator corrections) → a CLI lane.
   Reviews: `code-logic-review-phase1-lanes.md`, `code-logic-review-phase1-inprocess.md`.
3. **Open item from the generator fix:** `ground-truth/seeded-session-generator.ts:40-44` imports the
   `@ptah-extension/memory-curator` barrel at runtime (for the real `clampTranscript`). The barrel
   loads tsyringe and vscode-core, so the generator only runs where `reflect-metadata` and a `vscode`
   shim exist (the bench host), not in the plain runner parent — same class as phase-1 finding 15.
   Decide: run generation inside the host, or move the clamp check to the spec/host.
4. **Rebase** onto 619 `f22b604fe` (4d; additive API, `resolveBenchDataDir()` now follows junctions)
   when no agent writes in the worktree; re-run `npx jest -c tools/mcp-bench/jest.config.ts
   tools/mcp-bench/src/memory-skills --runInBand`.
5. **B11.1** (seeded session fixtures, needs the fixed generator), then **B16–B23** per `batches.md`
   (runner CLI, suites). B14 note for B16: wire `failIfAny(label)` into `--ci` and pass worker entries
   through `guardedWorkerEntry()` (`batch-14-report.md`). Each phase ends with one cross-side review.
6. **B24 (CI workflow + first recorded run)**: before any real bench run, message the 619 session —
   `withPinnedCorpus` force-removes every corpus worktree (race, see context.md); never run two benches
   at once. A win32 `crash-on-shutdown` (TASK_2026_622) is a run fact, not a suite error.
7. **User activities pending:** (U1–U3) the two raters label the 105-document skills packet blind;
   (U4) re-run the held-out session sampler AFTER the eval window closed (2026-10-07T00:00Z) — the
   current sample is provisional and contains the orchestrator's own still-growing transcript — then
   label. B21, B23 scored runs and B25–B26 wait on labels.
8. **B10 drafts** (`drafts/memory-ground-truth/`, accepted on the third attempt): 130 facts / 68
   folders, 29/30 updates, 100 merge pairs, 21 temporal, 18 abstention. 11 update v2 sources cite spec
   edits that were uncommitted — re-verify after the docs commit in "Uncommitted" above. A human check
   is required before freezing (B25).
9. **When 620 is finished: open a PR** (user instruction). If 619 has not merged, rebase on `main`
   after it merges, or open a draft PR on top of the 619 branch and say which.

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
