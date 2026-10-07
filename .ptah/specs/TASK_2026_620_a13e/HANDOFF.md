# HANDOFF — TASK_2026_620_a13e (and TASK_2026_621_3d5c)

## RESUME HERE (2026-10-07 ~19:30Z, session on branch `feat/task-620-memory-skills-bench-s2`)

Worktree `D:\projects\ptah-extension\.claude-worktrees\feat-task-620-memory-skills-bench-s2-2be8618bcca9`.
Branch rebased onto 619 `181c657ab` (schema commit; contains probe-fix `285ce9855`). Nothing pushed.

Commits this session: A1 `595cde626` (codex r1 REVISE 4/10 → r2 APPROVED 10/10), rebase fixture fix
`012df8123` (`HostStopReport.tempLeft`), S1 adopt 619 model-panel schema `094331fec` (r1 REVISE 5/10 →
r2 APPROVED 8/10), user decisions `5044f1647`. Checks on the final tree: memory-skills jest 55 suites /
653 tests, mcp-bench `tsc` clean, eslint 0 errors (2 known max-lines warnings).

User decisions (context.md, last section): panel data flow approved for U1/U2/U4; new B24/recording
gate = rebase done + message 619 before each 620 bench/recording and wait for OK + ask the user to
refresh Codex login just before recordings. "619 Batch 11 runs done" will never come (619 decision).
619 session now: `ptah-ptah-extension-continue-619-task-f6797e0000ktg2q3sqvco04` (ListAgents if gone).

### Model-panel labelling state (all private, under `C:\Users\abdal\AppData\Local\ptah-mcp-bench`)

Raters: r1 = grok `grok-4.7` (xAI); r2 = antigravity with `--model gemini-3.1-pro --effort high`
("Gemini 3.1 Pro (High)"; antigravity's DEFAULT model is `claude-sonnet-4-6` = Anthropic — always pass
the Gemini model; `gemini-3.1-pro-high` conflicts with --effort). Adjudicator = Glm ptah-cli
`pc-355b645d-…` (`glm-5.3-flash:cloud`). antigravity quota is small: run ≤2 lanes at a time (HTTP 429
"Individual quota reached", resets in minutes). Validation scripts were inline `node -e` (re-write).

- **U1 DONE** `labelling/skill-rubric-v1/panel/`: r1/out-0..5.csv and r2/out-0..5.csv (105 valid each);
  `adjudicate.txt` (37 = 2 pass-differs + 35 gap>12); blinded `adj/chunk-0..7.csv` → `adj/out-0..7.csv`
  (37 rows) — row SKD-C311B75A in out-2.csv had total≠sum, replaced by `adj/out-2-retry.csv` (valid).
  0 unresolved. r1 mean total is 10 points above r2.
- **U4 sessions DONE** `sessions/gt-memory-real-v1/`: re-drawn after the window closed (provisional
  false, 20 sessions). Condensed packets `panel/packets/RS-*.txt` (user/assistant text only, `L<n>` =
  JSONL line), `panel/INSTRUCTIONS.md`, `panel/group-0..3.txt`. r1/out-0..3.jsonl, r2/out-0..3.jsonl
  (r2 groups 0 and 1 used their one retry for non-existent line numbers). 1 identical, 19 adjudicated
  from candidate-line excerpts `panel/adj/chunk-0..3.md` → `adj/out-0..3.jsonl` (63 refs). 0 unresolved.
  Limit to disclose: the adjudicator chooses only among lines a rater cited.
- **U4 trigger labels IN PROGRESS** `labelling/skill-triggers-v1/`: `skills.jsonl` (23 authored skills,
  descriptions parsed with js-yaml), `INSTRUCTIONS.md`. r2/out.jsonl valid (one tribunal prompt names
  "tribunal" — tell Glm not to select prompts containing a skill id). r1 lane grok `150c5e06` was still
  running. Next: validate r1, then Glm adjudication (all 23 differ; choose 5+5 from 10+10).
- **U2 IN PROGRESS** `drafts/memory-ground-truth/panel/`: part-0..5.jsonl (298 items), INSTRUCTIONS.md.
  r1/out-0..5 valid (269 accept / 22 edit / 7 reject). r2: first instruction rubber-stamped (88/88
  accept) → kept as `r2/out-{0,1}.weak-instruction.*`, re-run with a strict per-item instruction.
  r2 out-0 (strict) 40/3/1, out-1 (strict) 44 accept, out-2 40 accept/2 reject, out-3 50 accept; out-4
  (`7948e221`) and out-5 (`7fe0d20d`) were still running. Validate r2 parts 1,4,5; then build blinded
  adjudication for differing decision or replacement hash; Glm adjudicates. Items citing TASK_2026_621
  cannot be checked at `e0ca51e` (621 is another branch) — disclose. antigravity lanes left scratch
  files in the worktree root (spec excerpts + `write_output.py` that writes "accept" except a listed
  reject set); moved to `drafts/memory-ground-truth/panel/r2-lane-scratch/`. Check `git status` for
  new strays after the running lanes end, and tell r2 lanes to keep scratch files out of the repo.
- Then: write private panel manifests (`panelManifestSchema`: lanes, families, models, prompt sha,
  counts, unresolved share), merged label files for B25. U3 waits for the B24 replay.

### Next steps after labelling

Four Codex/terra recordings (message 619 first; ask the user to refresh Codex login; the runner has
`codexAuthSource` only as a `RunMemorySkillsOptions` field — add the CLI flag in
`run-memory-skills.entry.ts` first), then U3, B24, B25, B26, PR (ask before push; base per context.md:134).

### Open items / follow-ups

- **node_modules junction:** this session created `<worktree>\node_modules` → `D:\projects\ptah-extension\node_modules`
  (junction) so jest resolves. REMOVE the junction (`cmd /c rmdir`, never recursive delete) before
  anyone removes the worktree.
- 620 runner does not surface 619's new `HostStopReport.tempLeft`.
- `ptah_agent_report` from this child session always failed `unattributed-caller`.
- **Product UI issue reported by the user (not 620 work; route to the UI-defects session):** "this pop
  shows while the agent is working and doesn't send before it shows the continue in new session" —
  a popup appears while the agent is still working, and the pending message is not sent before the
  "continue in new session" prompt appears. Get a screenshot / exact popup name from the user.

Updated 2026-10-07 ~06:45 by orchestrator session `ptah-ptah-extension-continue-memory-skil-b503dc00005aw2q23htdi0e`.
Read `context.md` first (user decisions incl. "User decisions 2026-10-07, B-P pause switches", the 619
agreement and answers). This file is the resume point only.

## Where things are

| Item                  | Location                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 620 branch / worktree | `feat/task-620-memory-skills-bench` at `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`, based on 619 `4d3d0dd5d` (Batch 9). Nothing pushed.                                                              |
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

1. DONE 2026-10-07: visual review APPROVED (round 2) and rebased onto 619 `4d3d0dd5d` (project.json
   merged at JSON level; scoped jest 578/578, mcp-bench typecheck+lint, build-host-memory-skills pass).
2. DONE 2026-10-07: 619 exports adopted (`062e88f02`: suiteCoreSchema, HostLaunchOptions.env, bench-host-process
   helpers; mem.extraction claim source fixed) and nested-key strictness (`f94a9bdd4`); review APPROVED
   (`code-logic-review-619-adoption-r2.md`). Scoped jest 51 suites / 581 tests.
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
