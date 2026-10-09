# HANDOFF — TASK_2026_620_a13e (and TASK_2026_621_3d5c)

## RESUME HERE (2026-10-10 — PR follow-up session; READ THIS FIRST)

Goal of the next session: get the open PRs green (CI + SonarCloud) and address review comments. No new
features. The user merges (squash is disabled; the repo uses merge commits). Pushing fixes to the PR
branches is approved; opening PRs is approved.

**PR state at hand-off (2026-10-10 ~00:30 local):**
- **#672 (TASK_2026_619) — MERGED** (merge commit `ffeea1657`, admin override for main's pre-existing
  failures, at the user's request).
- **#687 `fix/mcp-bench-regex-escape` @ `12067928d`** — all CI green, SonarCloud gate OK. Ready to merge.
  It replaces the `parseTextLocations` lazy regex (Sonar S8786) with a linear scanner (fuzz-checked equal
  on 200k strings) and drops a useless `\|` escape that broke `nx lint mcp-bench` on main.
  Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark` (now on that branch).
- **#686 `feat/task-620-memory-skills-bench-s3` @ `b1c23b980`** — the 620 PR to main. CI + Sonar were
  re-running at hand-off. The same scanner change is on this branch (`a419e57d2`), so #686 and #687
  merge cleanly in either order.

**#686 history this session:** `origin/main` merged in (`5090ef1b8`, 4 UI conflicts, review APPROVE 9/10:
`code-logic-review-main-merge.md`); post-merge scoped checks green (`post-main-merge-checks.md`); lint
fix `62072bb1e`; CI/Sonar fixes `b1c23b980` (di-lint provenance-tap registration, ThothStatusService no
longer waits on pause reads — fixes Electron e2e `message-handlers-eager.spec.ts:187`, Linux-neutral
session sampling, deterministic funnel clock, liveness wording, 22×S2871, 4×S4036). Reviews:
`code-logic-review-pr686-ci-fixes.md` (round 1 REVISE 5/10 → round 2 APPROVE 7/10). Reports:
`pr686-ci-sonar-fixes-report.md`, `pr686-ci-fixes-round2-report.md`.

**Expected CI failures that are NOT from #686/#687 (do not fix in these PRs; the user says another
session is fixing them on main):** auth-providers `plan-usage.service.spec.ts` F31/F32 (from PR #673);
platform-electron `workspace-watch-host.stress.spec.ts` (needs a built watch-host bundle); platform-cli
`cli-workspace-watcher.spec.ts` nestedRepoDetection (timing flake); Webview E2E plan-limits stats strip
and settings-visual orchestration specs (also fail on `fix/session-handoff-workflow`). Re-check each
against main before classifying — main may have fixed them by then.

**What to check first:** `gh pr checks 686` / `687`; SonarCloud via the public API (the sonarqube MCP
returned 0 issues for PRs): `https://sonarcloud.io/api/qualitygates/project_status?projectKey=Hive-Academy_ptah-extension&pullRequest=<n>`
and `.../api/issues/search?componentKeys=Hive-Academy_ptah-extension&pullRequest=<n>&resolved=false&types=BUG,VULNERABILITY`.
Fetch failed job logs with `gh api repos/Hive-Academy/ptah-extension/actions/jobs/<id>/logs` (run it
from inside a worktree; `gh run view --log-failed` is empty while a run is in progress; GitHub API
calls sometimes time out — retry once). Open review comments: `gh pr view <n> --comments` and
`gh api repos/Hive-Academy/ptah-extension/pulls/<n>/comments`.

**Open, non-blocking notes from the reviews (fix only if cheap or a reviewer asks):** resolve the
deferred pause promises at the end of the new thoth-status spec and assert `summary().paused`;
sample-sessions stats the source mtime after the copy (TOCTOU); `createGitTreeReader` resolves git
eagerly; production now runs `scheduleProvenance` per dispatch (harmless — mention in the PR if asked).

**Environment:** the 620 worktree's `node_modules` junction was REMOVED at hand-off. To run checks,
re-create it: `cmd /c mklink /J <620-worktree>\node_modules D:\projects\ptah-extension\node_modules`,
and remove it afterwards with `cmd /c rmdir <620-worktree>\node_modules` (never a recursive delete).
The 619 worktree has no `node_modules`; run binaries from the main checkout
(`node D:/projects/ptah-extension/node_modules/jest/bin/jest.js ...`).

**Recording (deferred, not this PR):** `extraction-record-v1` hit the runner's 4 h default host timeout
at 229 cassette entries; diagnosis and options in `follow-up-recordings.md`. Do not run any bench
without asking the user.

## Earlier: RESUME HERE (2026-10-09 — hand-off to the 619 wrap-up session)

**User decisions 2026-10-09 (final):** the 620 PR ships the product changes and the committed bench
WITHOUT recordings. Everything that needs a live recording (the four recordings, Batch 24, U3, Batch 26,
per-call provenance correlation) is deferred to a follow-up task: brief `follow-up-recordings.md`.
PR order: 619 #672 merges first, then 620 is retargeted onto `main` and opened as a normal PR to `main`.
**Ask the user before any push.** PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Branch state:** `feat/task-620-memory-skills-bench-s3` @ `3aa1af0bc` (+ this handoff commit), local only,
rebased onto the 619 head `9bba84b23` (105 commits). Backup of the pre-rebase state:
`backup/task-620-s3-pre-rebase-0329ff421` (delete after the PR merges).
Scoped checks after the rebase, all green: typecheck/lint/test for memory-curator, agent-sdk, cli-engine,
platform-core, rpc-handlers, skill-synthesis, thoth-runtime, core, dashboard, memory-curator-ui,
skill-synthesis-ui, thoth-shell, shared, ptah-electron; typecheck/lint for webview-e2e-harness and
mcp-bench (mcp-bench lint 0 errors, 6 pre-existing warnings — do not add eslint-disable waivers).
Conflicts resolved in `memory-trigger.service.ts` (621 hardening kept, 620 pause re-applied):
`rebase-conflict-resolution.md`. mcp-bench adapted to the 621 retention contract: `post-rebase-mcp-bench-fixes.md`.

**Remaining steps:**
1. Wait for #672 to merge (ask the user for its merge method). Then
   `git fetch origin && git rebase --onto origin/main 9bba84b23` (619 asked to keep `9bba84b23` as the old
   base; 620 does not touch `cli-workspace-index.ts` or `.github/workflows/*`, only
   `cli-engine/src/lib/bootstrap/thoth-runtime*`).
2. Re-run the scoped checks per project (one project at a time, `--parallel=1`, Jest `--maxWorkers=2`;
   NEVER `nx run-many`, never the full mcp-bench test target). Fix failures via lanes; validate yourself.
3. Ask the user, push, open the PR to `main` (title < 70 chars; `## Summary` + `## Test plan`). The body
   must state: recordings deferred (`follow-up-recordings.md`); suites that report `na` without cassettes
   or panel labels (extraction, merge/update, scope-write, funnel, everything gated on U1-U4 / R-M4); the
   memory-skills bench is not in any CI workflow; the Phase 4 product seams are follow-ups.
4. After the PR: remove the worktree's node_modules junction with `cmd /c rmdir <path>\node_modules`
   (NEVER a recursive delete).

**Background recording still running:** `extraction-record-v1` (started ~14:38Z, detached `cmd` running
`%TEMP%\extraction-record.cmd`; log `%TEMP%\extraction-record.log`; it writes `%TEMP%\extraction-record.done`
when it ends). It was ~173/255+ entries at 16:38Z and slow. It blocks nothing; its cassette and run dir are
private bench data for the follow-up task. When it ends, read `run-summary.json` / `recording-rejection.json`
in `%LOCALAPPDATA%\ptah-mcp-bench\runs\extraction-record-v1` and note the result in `follow-up-recordings.md`.

**Open review notes:** `code-logic-review-model-free-resolve.md` defect 3 (aggregate provenance counting)
is deferred to the follow-up. `code-logic-review-curator-rebind.md` defect 1 was rejected with evidence.

**Standing rules (repeat in every lane prompt):** memory-safe scoped checks only (CLAUDE.md); never edit
619-owned `tools/mcp-bench/src/{scorecard,transport,corpus}/`, `suites/question-sets.ts`, `bench-data.ts`;
never commit private bench data under `%LOCALAPPDATA%\ptah-mcp-bench`; lanes never read
`C:\Users\abdal\.codex\auth.json` or the real `C:\Users\abdal\.ptah`; lanes never commit, push, stash,
restore, checkout --, reset, clean or run rebase steps (the orchestrator does git).

## Earlier: RESUME HERE (2026-10-08, session on branch `feat/task-620-memory-skills-bench-s3`)

Worktree `D:\projects\ptah-extension\.claude-worktrees\feat-task-620-memory-skills-bench-s2-2be8618bcca9`,
branch `feat/task-620-memory-skills-bench-s3` (created from `-s2` tip `9832dc17c`). Nothing pushed.
The user stopped this session to save time; the next session continues from here.

### Commits this session

- `c46be5c1a` `--codex-auth-source` flag (`runner/run-memory-skills.args.ts` + spec, entry wiring).
  Codex review APPROVED 9/10 (`code-logic-review-codex-auth-flag.md`).
- `bae970db0` B25.2: U1 skill labels (numeric), skill-docs (ids, hashes, strata), U4 trigger labels
  (`skill-triggers.v1.jsonl`), U4 real-session labels (`real-sessions.v1.jsonl`), MANIFEST; real runs
  load the PRIVATE U1 panel manifest (`suites/skills/rubric-panel-manifest.ts`), missing/invalid →
  `na` (never `labelled`); rater packet asks for ISO-8601 `ratedAt`. Reviews: codex REVISE 4/10 →
  Glm r2 APPROVED 8/10 (3 minor: no entry integration test; loader overrides `options.panel`;
  manifest raterIds not cross-checked with `options.raters`).
- `fe76f1b3a` recording-plans review (codex REVISE: only B18 blocked, by the B25.1 fixtures).
- B25.1: see "B25.1 state" below.

### Lane facts that changed

- **grok is OUT: HTTP 402 "Grok Build usage balance exhausted"** (2026-10-07 ~20:41Z). Until the user
  tops it up: implementor = codex, reviewer = Glm ptah-cli (`pc-355b645d-…`, cross-family). User
  instruction: "save your quota and assign codex and grok the work" — do not use in-process
  subagents for implementation; keep the orchestrator's own work to verification and commits.
- antigravity: never let it use its own subagents (the first U2 part-5 lane timed out at 35 min
  waiting on them). Split work into ≤34-item halves; ≤2 lanes at once; `--model gemini-3.1-pro --effort high`.
- `ptah_agent_wait` returns "operation timed out" well before its timeoutSec; rely on the push signal.
- Codex resume can silently become a fresh lane with a handoff brief when the old context is
  > 60k tokens — always give complete instructions.
- Lane "scoped checks passed" claims were false twice more (B25.1 ran 2 of 11 fixture specs).
  Always re-run every spec that reads the changed fixtures (list below).

### Labelling: DONE (all private, `C:\Users\abdal\AppData\Local\ptah-mcp-bench`)

Merged outputs and manifests (`panelManifestSchema`-valid, panel `xAI+Google; adjudicator=GLM`) in
`labelling/merged/`: `u1-rubric.*` (105, 37 adjudicated, 0 unresolved), `u2-memory.*` (298, 41
adjudicated, 0 unresolved), `u4-sessions.*` (20, 0 unresolved), `u4-triggers.*` (23, all
adjudicated, 0 unresolved). Merge script: `labelling/tools/merge-panels.ts` (bundle with esbuild
`--tsconfig=tools/mcp-bench/tsconfig.json` to `%TEMP%`, run `node … [triggers|sessions|rubric|memory]`).
Validators: `labelling/tools/validate-u2.mjs`, `validate-trigger-adj.mjs`; builders
`build-u2-adj.mjs`, `build-trigger-adj.mjs`.

Disclose in B26 / PR: U2 r2 parts 0, 1 (weak instruction) and 5 (all-accept) were discarded and
re-run once with `STRICT-ADDENDUM.md`; part 5 re-ran in two halves 5a/5b; 5b is 34/34 accept with
item-specific evidence (r1 agrees on 32/34); some T- evidence rows have an empty `checked` field.
U2 adjudicator read each item's own `sourceCommit` (not only `e0ca51e`) and, for
`worktree-untracked-or-uncommitted` v2 sources, the current spec files (one TASK_2026_621 file only
in worktree `agent-a0c9cbefc2a09f580-…`). U1 raters wrote date-only `ratedAt`; the merge normalised
it to midnight UTC (format only). U4 triggers: 5 candidate prompts naming a skill id were excluded
before adjudication. Prompt hashes in the manifests are hashes of the instruction files the lanes
read (the inline spawn prompts were not stored).

### B25.1 state (memory ground truth) — IN PROGRESS at handoff

**B25.1 at stop:** committed as `673c7f278`.
Codex lane wrote it; revise round 1 fixed a UTF-8 BOM in MANIFEST.json and specs pinned to the
10-fact draft. Orchestrator re-ran all 11 fixture specs: 11 suites / 149 tests pass, `tsc` clean,
no BOM. Report: `batch-25-1-report.md`. Counts: 129 facts, 98 merge pairs (50/48), 28 update,
21 temporal, 18 abstention; F-005 fixed; M-094 dropped (F-038 rejected).
**Still to do first: an independent Glm code-logic review of that commit** (write
`code-logic-review-batch-25-1.md`; check the spec rewrites keep each test's intent and are not
re-pinned observed numbers). A REVISE gets a follow-up commit (codex implements).

**Cost warning for the extraction recording:** with 129 facts the extraction plan now runs 255
recording cases (129 one-fact seeded sessions + 63 long sessions per placement), far more live
gpt-5.6-terra calls than the 10-fact draft. Tell the user the call volume and get an explicit OK
before recording (or agree a smaller recording subset).

### Next steps, in order

1. Finish B25.1: Glm review of the committed B25.1 (checks already re-run; repeat them after any fix).
   Fixture specs: `ground-truth/{committed-u4-labels,fixture-manifest,seeded-session-generator}.spec.ts`,
   `host/plan.schema.spec.ts`, `runner/{ground-truth-freshness,run-memory-skills,runner-plan}.spec.ts`,
   `suites/memory/{extraction,read-side,retention}.suite.spec.ts`, `suites/skills/rubric-agreement.suite.spec.ts`
   (all under `tools/mcp-bench/src/memory-skills/`; extraction takes ~200 s).
2. Recordings (plans written and reviewed: `<bench>/plans/{extraction.record,b18-record,scope-write.record,funnel-record.plan}.json`;
   commands in `recording-plans-review.md`). The bench target runs esbuild builds (`build-host-memory-skills`)
   — tell the user. Message the 619 session (ListAgents; last seen
   `ptah-ptah-extension-continue-619-follow-0b15390000ktg2q3sqvco0a`) and wait for its OK; ask the user
   to refresh the Codex login; pass `--codex-auth-source <abs path of ~/.codex/auth.json>`. Desktop Ptah
   may stay open (619 `process-watch` guard). If B25.1 changed the extraction seed size, re-check
   the extraction plan first. After recording: copy accepted cassettes into committed fixtures,
   replay once.
3. B24 (CI workflow, first recorded run on Windows + Linux/WSL, known failures, ledger) — message 619 first.
4. U3 (matcher sample from the B24 replay), then `matcher-sample.v1.jsonl`. Panel = two non-OpenAI
   rater families + a third-family adjudicator. If grok is still out, the panel needs a third
   eligible family (e.g. an opencode route to Kimi/Qwen); check `ptah_agent_list` and
   `evaluatePanelEligibility`, and ask the user if fewer than three families exist.
5. B26 close-out; PR per context.md:134-135 (ask the user before any push).
6. Remove the `node_modules` junction with `cmd /c rmdir` when 620 is finished.

## Previous resume point (2026-10-07 ~19:30Z, session on branch `feat/task-620-memory-skills-bench-s2`)

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
  "tribunal" — tell Glm not to select prompts containing a skill id). r1/out.jsonl VALIDATED (23 rows,
  5+5 each, grok-4.7). Next: Glm adjudication (all 23 differ; choose 5+5 from 10+10, blinded A/B).
  U2 r2 out-4 landed (5,100 bytes = same size as all-accept out-3; likely 50/50 accept on
  should-not-merge pairs where r1 edited 5) — validate; if all accept, re-run once with the strict
  instruction. U2 r2 out-5 landed: the lane reports ALL 68 accepted, including items citing
  TASK_2026_621 that cannot be checked at e0ca51e (r1: 60/5/3). Treat as suspect; validate and consider
  one strict re-run. All lanes of this session have ended; worktree clean.
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
- **Product issue reported by the user (not 620 work; open it as its own task / UI-defects session):
  session-budget "Continue in new session" must be a proper workflow.**
  - User words: "this pop shows while the agent is working and doesn't send before it shows the
    continue in new session"; "start when a message turn finishes and compact the session in the
    background where the agent generates a handoff document, then close the current session and start
    a new one. The current flow is not correct: lots of notifications stack on each other and the
    agent keeps working until exceeding the limit."
  - Wanted flow: (1) trigger only at the END of a message turn, never mid-turn; (2) in the background,
    the agent compacts the session and writes the handoff document; (3) the current session closes;
    (4) a new session starts, seeded with the handoff. One flow per session, no stacked prompts.
  - Observed defects: the budget popup/banner appears while the agent is still working; the queued
    message is not sent before the prompt appears; budget notifications stack; the agent keeps working
    past the limit (lane completions and peer messages keep re-invoking it).
  - Code pointers: `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:139-194`
    (preview-handoff / write-handoff / openTabForHandoff), `.../notifications/session-budget-banner.component.ts`,
    `libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.ts`,
    `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:170-183,460-483`
    (`refuseIfBudgetReached`, `SESSION_BUDGET_REACHED_MESSAGE`), `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts`,
    `libs/shared/src/lib/types/session-budget.types.ts` (TASK_2026_597 N7 / F3).

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
