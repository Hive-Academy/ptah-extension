# Handoff - TASK_2026_619_af7f (2026-10-07)

## Update (2026-10-08, sixth session "619 session 6", launcher branch `session/task-619-s6-launcher`, unused) — read this first

- **Role:** the fifth-session parent closed and handed over; session 6 is the 619 orchestrator. Work happens in this worktree only (the launcher worktree is unused; the user owns its cleanup). Writes into this worktree from the session-6 tab need approval; codex lanes can write here.
- **Diagnosis of b13e symbols-exact 0/0:**
  - ptah side: NOT `parseSymbolHits` (no `parse:` errors). All listed failures were `unknown-coverage` with the 13c mid-census reasons `["updating","unrecognised?","unchecked"]`; the 13e cap rule classified that shape as unknown. Every `?` code in `COVERAGE_REASONS` ranks before `unchecked`, so that shape cannot hide a `?` reason.
  - native side: environment. b13b native hit@5 0.85 / error_rate 0; b13e error_rate 1, latency 0, 1 call per answer -> each rg spawn failed instantly (smoke started from git-bash; `where rg` likely a shim). The scorecard hid it.
- **Decisions:** the user delegated the five open questions to a codex lane -> `decisions-s6.md`. Batch 13f implements them (see batches.md); committed this session.
- **User approvals (2026-10-08):** one smoke after 13f is committed (only after the 620 session confirms its recordings ended); push + PR 1 (Batches 1-13f) against main after that smoke and the CI gate pass — show the user a PR summary first; never merge.
- **620 hold:** session `ptah-ptah-extension-task-620-final-round-ec2ce70000ktg2q3sqvco0b` runs 4 live recordings. No 619 bench/smoke/mcp-bench build/corpus or bench-data work until it says they ended; message it first and wait for OK. Tell 620 that 13f landed (b15607206 never broke parsing; it only over-classified mid-census answers).
- **Next:** after the 620 OK: rerun `host-launcher.spec.ts` alone; smoke `--host=cli-headless --suite=lifecycle,symbols-exact --smoke` from any shell (rg preflight now fails fast if rg cannot spawn); check native hit@5 ~0.85 and ptah symbols-exact no longer 0; then PR 1 prep. Delete `b13b-pre-simplify.patch` (decision 5) when convenient.
- **Smoke attempts (b13f):** attempt 1 was killed at 300 s by the codex per-command limit. Attempt 2 (detached from a codex lane) broke in lifecycle case 9 with "open-handle probe returned no JSON", so no scorecard. Batch 13g hardened the probe and saves the raw reply on failure. Leftover temp corpora (not deleted): %TEMP%\ptah-mcp-bench-corpus-dkIjxJ (and maybe -1TGf6P). Next smoke: preferably started by the user from their own PowerShell window, after the 620 session says its recordings ended.
- **PR plan (decided):** PR 1 = Batches 1-13f; later PRs 18-26, 27-28, 29-33, 34, 36-37; 620's PR after 619 PR 1 merges.

## Update (2026-10-08, fifth session `ptah-ptah-extension-continue-619-follow-0b15390000ktg2q3sqvco0a`) — read this first

- **Commits this session:** ce290b460 Batch 13b (user-chosen simplification: one census per root, joiners share it, lifecycle owns follow-ups; foreign-abort + user-click-join fix; APPROVED 8/10); 2e80facac Batch 13d (bench: positive lifecycle hit counts under unknown coverage; APPROVED 7/10); cf9d72f9f Batch 13c (product: known partial coverage during a census; APPROVED 8/10); b15607206 Batch 13e (bench: `unrecognised?` alone is not unknown coverage; probe matches symbol or `Class.member`; REVISE 5/10 -> rev 1 -> APPROVED 8/10). Open non-blocking items per batch are in batches.md.
- **Diagnosis (`batch-13b-smoke-diagnosis.md`):** watcher delivery works in the bench host (direct probes, `tmp/watch-probe/*.mjs`). Edits/adds failed because the bench scored every answer during a census as `unknown-coverage`. Then (13c gating) found the deeper cause: every code-index answer has `unrecognised?` (`unrecognised: null` by design), so the bench scored EVERY ptah symbol answer as an error -> symbols-exact hit@5 = 0 by construction. Fixed bench-side in 13e (user decision).
- **Lanes:** grok balance exhausted (402) mid-13d; user chose codex implementor + in-process code-logic-reviewer subagent. Codex resumes over 60k context start a fresh lane: give full context.
- **Smoke:** user authorized `nx run mcp-bench:bench --host=cli-headless --suite=lifecycle,symbols-exact --smoke --out=tools/mcp-bench/out/b13e-cli-smoke` (build included); 620 gave OK. The 620 session `...finish-task-620-and-9da...` has stopped; the NEXT 620 session (branch feat/task-620-memory-skills-bench-s3) will message 619 before its recordings/B24 and wait for OK. 620 knows about b15607206.
- **Not committed:** `.claude/commands/orchestrate.md` (not ours), `b13b-pre-simplify.patch` (backup of the replaced 13b design; delete when no longer needed).
- **Task 13b.3** (query-file priority for cold start) still open: decide after the b13e smoke.

### b13e smoke result (`tools/mcp-bench/out/b13e-cli-smoke`, exit 0, 12 min 20 s incl. build; log `tmp/watch-probe/b13e-smoke.log`, gitignored)

| Case | b13b | b13e |
| --- | --- | --- |
| edit-then-query 5 s / 60 s | fail / fail | **pass / pass** (found under unknown coverage) |
| add-then-query | fail | **pass** (5.4 s) |
| large-file-3900 | fail | **pass** |
| large-file-1.5mib | pass | pass |
| delete-then-query | (check b13b) | **fail**: still answered after 60 s, all states unknown-coverage |
| cold-start | fail | fail (no clean/positive answer for `onKeepEditing` in 120 s) |
| index-age-24h | fail | fail (census not settled in 120 s) |
| two-workspaces-symbol-scope | fail | fail (workspace B: symbolCount 0, reindexInFlight false, unknown census) |
| symbols-exact hit@5 ptah / native | 0 / 0.85 (b11) | **0 / 0**, error_rate 1 |

### First actions for the sixth session (in order)

1. **symbols-exact is broken in b13e: native hit@5 is also 0** (was 0.85). Suspect the 13e change in `tools/mcp-bench/src/suites/tool-results.ts` (`symbolHits`, `parseSymbolHits` now throws on a hit without a string `symbolName`) or a ground-truth/scoring path; read `scorecard.json` suite section (`failures`, per-question errors) and the native baseline path. Do not re-run the bench before a cause is found (620 coordination required; the stopped 620 session said the next 620 session will message 619 first).
2. **Mid-census answers are still `unknown-coverage`**: the 13c mid-census reasons are `["updating","unrecognised?","unchecked"]` (3 entries), and the 13e rev-1 cap rule (3 entries incl. `unrecognised?` -> unknown) classifies exactly that shape as unknown. So 13c is invisible to the bench. Decide (user): drop/refine the cap rule (e.g. treat as unknown only when the 3rd slot is `unrecognised?` AND a lower-priority `?` reason could exist — check `COVERAGE_REASONS` order in `language-coverage.interface.ts:205-226`), or accept.
3. delete-then-query now fails (needs a clean answer by design); after item 2 it may pass. two-workspaces-symbol-scope: workspace B never gets a census in that host — investigate.
4. cold-start / index-age: census does not finish in 120 s on the 6,455-file corpus; Task 13b.3 (query-file priority) is the remaining lever; needs a user decision.
5. Then Batch 14 onward per batches.md.

## Update (2026-10-07, fourth session `ptah-ptah-extension-continue-619-task-f6797e0000ktg2q3sqvco04`) — read this first

- **Commits this session:** 285ce9855 Batch 11 (smoke baseline, host fixes, probe PID-reuse guard); d514bdc0e Batch 12 (rev 2 had landed; codex R3 REVISE 6/10 found purgeJunk/purgeWorkspace bypassing the vec protocol; ONE bounded correction by grok; codex final APPROVED 8/10; gate memory-curator 54/54); 181c657ab TASK_2026_620 schema (model-panel + panel, shared GROUND_TRUTH_METHODS, displayLabel; codex R2 APPROVED 8/10).
- **User decision:** no Batch 11 full runs (they died again: `^C` at 93 min). The only full run is Batch 36. See context.md § "no full before baseline". 620 was told.
- **Batch 13:** committed d81526c31 after 2 revise rounds + 1 bounded correction + 1 user-authorized fix (mixed batch); codex checks APPROVED the fixes. The cli-headless smoke (`tools/mcp-bench/out/b13-cli-smoke`, 15.5 min) still FAILS cold-start / edit / add-then-query, and ptah symbols-exact hit@5 is 0 (native 0.85), same as B11. Diagnosis `batch-13-smoke-diagnosis.md`: edits during a full run wait for it (lifecycle deferral), and `ensureIndexFresh` starts a competing full run. **Batch 13b** added to batches.md for these fixes (own review cycle); next action.
- **Batch 13b (IN_PROGRESS, UNCOMMITTED in the worktree — do not lose it):** grok implemented 13b.1 (per-file reindex during a census) + 13b.2 (one full-run owner); codex R1 REVISE 4/10 (purge race, unlocked delete) -> rev 1 (kept paths + locked `deleteFileSymbols` with tombstones) -> codex R2 REVISE 6/10 (concurrent same-root censuses, dead sink arg) -> ONE bounded correction (per-root serialized `indexWorkspace` with one shared follow-up; sink arg removed) -> codex FINAL `code-logic-review-b13b-final.md` **REVISE 5/10**: (1) SERIOUS abort after the shared follow-up commits resolves as success (`code-symbol-indexer.service.ts:721-743`); (2) SERIOUS lifecycle `followUp` + indexer waiter can produce a third census (`workspace-index-lifecycle.ts:360-395` vs indexer `:552-557,:712-766`); (3) MODERATE first waiter's options (cap, onProgress) control the shared follow-up (`:786-799`). Cap AND bounded correction are used: per the agent-lanes rule this needs a USER decision (authorize one more fix, or reduce scope) before any further change or commit. Gate on the current code passes (thoth-runtime lib 120, workspace-intelligence code-symbol-indexer* 59, cli-engine bootstrap 125, vscode-lm-tools code-namespace.builder 44; typecheck/lint 0 errors; prettier clean). Files: code-symbol-indexer.service.ts (+spec), code-namespace.builder.ts (+spec), workspace-index-lifecycle.ts (+spec), boot-thoth-runtime.ts, cli-workspace-index.ts.
- **Recommended simplification for 13b (orchestrator view):** the waiter/abort/options complexity comes from making the indexer join callers. A simpler shape: the indexer only exposes `isIndexing(root)`; `ensureIndexFresh` and `runSymbols` skip (or return "in flight") when a run is active; the lifecycle stays the single owner of follow-ups. Drop the shared-follow-up machinery. Ask the user before changing the design.
- **13b smoke (`tools/mcp-bench/out/b13b-cli-smoke`, measured on 13b rev 1):** still FAILS cold-start, edit-then-query 5 s/60 s, add-then-query, large-file-3900, index-age; ptah symbols-exact hit@5 still 0 (native 0.85). Index growth is faster (4,356 symbols at 5 s vs ~2,000 in B13), so the competing runs are gone, but edits/adds are not visible even at 60 s although per-file reindex no longer waits. **Prime suspect: watcher events are not delivered to the lifecycle in the bench host** (the open "Unknown" in `batch-13-smoke-diagnosis.md`; the CLI watcher runs in a separate watch-host process, `workspace-watch-host.mjs`). Next diagnostic: log lifecycle event receipt / reindexFile calls in the bench host (stderr) and re-run the smoke; also check the edited path normalization vs the lifecycle root. Task 13b.3 (query-file priority for cold start) is still open.
- **620 session now:** `ptah-ptah-extension-finish-task-620-and-9da3740000ktg2q3sqvco07` (branch feat/task-620-memory-skills-bench-s3, rebased on 181c657ab). It plans four recordings + its B24 run; it was told this session runs no more benches. The next 619 session must message it (use ListAgents) before any 619 bench and wait for OK.
- **Docs committed at session end** (batches.md, context.md, handoff.md, 13b reports/reviews); 13b code NOT committed.
- **Jest in this worktree:** run `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js` (not npx: cmd.exe mangles `^`/`|`), and pass the project's own mappers too, e.g. `--moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","(^|/)wasm-bundle-dir([.]js)?$":"<rootDir>/__mocks__/wasm-bundle-dir.ts"}'` (`[.]` avoids a JSON escape problem). The CLI mapper REPLACES the config mapper.
- **Lanes:** codex resumes often fall back to a fresh lane (context > 60k); give full context in every prompt. Do not include `.claude/commands/orchestrate.md` (one-word change, not ours) in any commit.

## Update (2026-10-07, end of third session)

- **Batch 12 state: NOT done, NOT committed.** Codex round 2 = REVISE 5/10 (`code-logic-review-b12.md` § Round 2). Open: (1) BLOCKING rowid reuse during a vec outage keeps a stale embedding (`code_symbols.id` is TEXT, implicit rowid reused; `reconcileOrphanVecRows` only removes absent rowids); (2) MODERATE `purgeMissing` failure only logged, run still returns `complete: true`.
- Grok revision 2 (agent `a0e8d790`) was the LAST allowed round. The lane record is gone (host lost it), and it wrote NO "Revision 2" section in `batch-12-executor-report.md`. `code-symbol.store.ts` has some `stale` edits: treat them as PARTIAL and unverified. First action: `git diff` the five Batch 12 libs files, decide whether rev 2 landed; if not, do one bounded correction (suggested design: persisted "vec stale" marker in an existing meta table, no migration, delete all vec rows on recovery; purge failure must make the result incomplete), then an independent codex review, then the scoped gate.
- Scoped gate for Batch 12 (memory-safe, one heavy check at a time): `npx jest -c libs/backend/<lib>/jest.config.ts <specs> --coverage=false --maxWorkers=2 --moduleNameMapper='{"^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js","^vscode$":"<rootDir>/../../../__mocks__/vscode.ts"}'` for workspace-intelligence, memory-curator, memory-contracts; `npx nx typecheck|lint <project> --parallel=1`. Earlier gates in this session did not use `--parallel=1`/`--maxWorkers=2`: always use them now, and repeat the CLAUDE.md rules in every lane prompt.
- Commit Batch 12 ALONE (only its libs files), separate from Batch 11.
- Full runs (driver pid 40628): at session end the cli-headless run was still in progress (log at ~93 min), flag `%TEMP%\mcp-bench-b11-full-done.flag` not present yet. Then the Batch 11 commit + 620 messages as below.
- Other sessions' codex lanes (`25b9d520` UI-defects `nx run-many`, `1df2cccd` chat-ui jest) were running at the same time; they are not ours. They can inflate bench latency.
- `.claude/commands/orchestrate.md` is modified in the worktree: not from Batch 11/12; check its origin before any commit, do not include it blindly.

## Update (2026-10-07, third session, ~18:05)

- First full runs failed: cli-headless voided at 105 min by the guard (false positive, PID reuse in `open-handle-probe.ts` tree walk adopted the real Ptah node.exe); Electron full run killed externally in the native phase. No full scorecards.
- Probe fix (codex lane, rev 1; orchestrator corrected one stale expectation in `host-launcher.spec.ts`): creation-time check in PowerShell + TS `processTree`, holder command line / creation time / parent chain in `BenchHeldRealStateError`. Report `batch-11-probe-fix-report.md`; review `code-logic-review-b11-probe-fix.md` APPROVED 8/10, 0 blocking (2 moderate: `createdAt()` RangeError, unredacted command line in the error text). Scoped mcp-bench gate exit 0. NOT committed yet.
- Full runs restarted 18:03 detached via WMI (`%TEMP%\mcp-bench-drivers\b11-full.ps1`, driver pid 40628): logs `%TEMP%\mcp-bench-b11-6r.log` then `-7r.log`, flag `%TEMP%\mcp-bench-b11-full-done.flag` when both end.
- After the runs: Batch 11 commit (include probe fix, context.md, handoff.md, TASK_2026_622_2d05/), send the SHA and "619 Batch 11 runs done" to the 620 session (now `ptah-ptah-extension-continue-the-work-of-ae3f8400001wc2q3o7yeq04`; it waits for both before its B24).
- New binding user decisions (context.md § CLI Lanes): only codex and grok lanes; codex = planner/reviewer, grok = implementor; Claude subagents only as fallback.
- 620 request accepted (do after the full runs, then send 620 the SHA): scorecard.types.ts:30 groundTruth.method adds literal 'model-panel' + optional `panel: string` (only with model-panel); suite-kinds.ts:15 same union from one shared constant; optional `displayLabel` (1-80 chars) on the suite view, shown in the markdown. 620 B2 = 705bcb61e.
- Lane budget raised by user decision: ~/.ptah/settings.json agentOrchestration.laneToolCallSteerAt 120 / StopAt 160 (default 40/60 stopped grok lanes).
- Batch 12: grok implemented; scoped tests pass only with `--moduleNameMapper` for `marked` (worktree has no node_modules); codex review REVISE 4/10 (`code-logic-review-b12.md`, codex session 01a11708-7645-7ed1-a451-9accf1e6458a); grok revision 1 running (agent 0ccc5ee8).
- User decision (18:10): keep both full runs AND start Phase 2 now. Limits while runs are live: no edits in tools/mcp-bench, no ptah-electron/ptah-cli/mcp-bench builds, no bench runs; per-batch bench smoke checks are deferred until the full runs end. Batch 12 implementing on grok (agent 5324208a), then codex review.

## Update (2026-10-07, second session)

- Batches 5 and 6 are COMPLETE: `7e1572272` (Batch 5), `629e4f719` (Batch 6). 9 of 41 batches done (the team-leader corrected the count: 1-37 + 4b/4c/4d + 34b = 41). The sections below this update describe the state before these commits and are kept for history.
- New user decisions in context.md: relevance truth = PRs + commits (200 test / 1,427 tune); SCIP indexers installed globally (scip-typescript 0.4.0 and scip-go 0.2.7 on Windows, scip-go at `%USERPROFILE%\go\bin`; scip-python 0.6.6 only in WSL Ubuntu-24.04 via nvm Node 22, because it crashes on Windows).
- Batch 7 in progress: opencode lane writes `scip-cross-check.ts` + spec + `corpus.config.json` `polyglot` pins (attrs 25.4.0 `9a98e00a`, logrus v1.9.4 `b61f268f`, both MIT). The orchestrator makes the indexes outside the lane: `%TEMP%\mcp-bench-scip-go.scip`, `%TEMP%\mcp-bench-scip-python.scip` (WSL: `scip-python index . --environment /tmp/scip-env.json` with `[]`), `%TEMP%\mcp-bench-scip-ts.scip` (`tsconfig.scip.json` in `%TEMP%\mcp-bench-b5-corpus`).
- Ground-truth generators run outside lanes via an esbuild bundle of a throwaway driver kept in `%TEMP%\mcp-bench-drivers` (never in `tools/mcp-bench/out/`: ESLint lints that folder).
- `batches.md` has one uncommitted edit (Batch 6 SHA in its header) and `batch-6-executor-report.md` an executor-line fix; commit both with the next batch.
- TASK_2026_620 requests (2026-10-07, accepted by the orchestrator; the next team-leader Mode 2 adds them to Batch 9 as a first small task): (1) export a core per-suite zod schema from `scorecard.types.ts`; (2) an explicit `env` option on `launchBenchHost`, merged after isolation, refusing isolation keys; (4) export the bench-host argument and shutdown helpers. (3) answered: `guard: { ci: true }` is correct for the 620 Linux CI job. 620 commits so far: 179a5bbc6, 44a3329c4 (only project.json targets). Send 620 the Batch 9 SHA.
- **State at 2026-10-07 ~11:00:** Batches 1-10 COMPLETE (13/41): B8 `7ba564816`, B9.0 `ea2f92fd2`, B9 `4d3d0dd5d`, B10 `deb8aaa4b`. Phase 1 code-logic review APPROVED on both sides; fixes committed `4e533a6a9` (also holds the Batch 11 Phase A mcp-bench code, inseparable). Batch 11 Phase B in progress: post-fix cli-headless smoke → `out/b11-cli-smoke-postfix` → `record-baseline` → `gate` exit 0 → vscode-lm-tools mandate spec (uncommitted, fails until gate-baseline.json exists; needs the jest moduleNameMapper override from batch-11-executor-report.md because the worktree has no node_modules) → Electron launch smoke → one full run per host (detached, >2 h). Reduced plan chosen (no full-mode noise runs). Then team-leader Mode 2 for the Batch 11 commit, then Phase 2 (Batch 12).
- TASK_2026_620 is holding all corpus runs and Electron launches until "619 Batch 11 runs done". Always message it before/after real runs.
- Pre-fix smoke `out/b11-cli-smoke` is evidence only (native baselines changed after it). TASK_2026_622 data points so far: python-attrs host 0xC0000409 before ready (B9 run 2); lifecycle host crash-on-shutdown in noise run 2 and in the B11 pre-fix smoke.
- Lane evidence (cont.): opencode failed twice at start ("Unknown error", 6-9 s) as Phase 1 reviewer → codex reviewed instead; codex reached the revise cap on the lane-side fixes; orchestrator made one bounded correction plus one extra trivial `-z` fix (disclosed).
- Batch 7 COMPLETE `90de07275` (10/41). Batch 8 in progress on codex (agent 195947f4, then rev 1 agent 3fc64e43, session `01a113cc-3ee1-7163-a357-6deeba9bdd1e`).
- ripgrep: no `rg` on the Windows PATH (`rg` in Git Bash is a shell function). Local runs set `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe` (14.1.1, transitive). CI installs ripgrep via apt (Task 10).
- Lane evidence: opencode Batch 7 (code+spec, 11 tests, report delivered, then process exit code 1 at close after the deliverable = false failure; 1 orchestrator correction: win32 path separators); codex Batch 8 (first pass hid 2 defects behind an rg-absent skip: env fallback, stdin hang).
- Lane evidence added: codex Batch 5 rev 1 (7 defects, 3 m 17 s, 2 orchestrator corrections after); opencode Batch 6 rev 1 (25 m 21 s, clean scoped checks, report delivered).

The orchestrator session stopped at the user's request after the Batch 5 / Batch 6 step. This file is the entry point for the next session. Read it first, then `context.md` (all user decisions), then `batches.md`.

## Where things are

- **Worktree:** `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`
- **Branch:** `fix/task-619-tool-benchmark`, based on `origin/main` 7910f34cf. Never commit to `main`. Never work in the main checkout.
- **Flow:** orchestration skill, BUGFIX, Full depth, plan-free. Phase 1 = benchmark (Batches 1-11, no product change). Phase 2 = fixes (Batches 12-37).
- **Progress:** 7 of 39 batches committed. Batches 5 and 6 are IN_PROGRESS and NOT committed.

### Commits on the branch

| Commit | Batch |
|---|---|
| 122a9dd7b | 1 - mcp-bench scaffold, retrieval and cost metrics |
| 4fc9d147c | 2 - scorecard model, writers, pinned corpus checkout |
| b538e8fb6 | 3 - HTTP transport, isolated cli-headless bench host |
| d995a1e1a | 4 - Electron host (launch/attach), real-DB guard modes (hash / process-watch) |
| 1ae06c824 | 4b - generic scorecard core shared with TASK_2026_620 |
| d716e0e8f | 4c - shared bench-host boot helper, bench data folder |
| f22b604fe | 4d - shutdown classification, partial guard report, spawn errors |

### Uncommitted in the worktree (intentional)

- `batches.md` (state edits from the 4d Mode 2: Batches 5/6 IN_PROGRESS, parallel rules) and `context.md` (new sections: "User Requests (2026-10-07)", "Workspace hygiene").
- `.ptah/specs/TASK_2026_622_2d05/` — a separate product-bug task (see below), moved here from the main checkout at the user's request. Commit it with the next batch commit.
- `batch-5-executor-report.md`, `tools/mcp-bench/src/ground-truth/` (8 files), `tools/mcp-bench/questions/7910f34cf/` (8 JSON files).

## First actions for the next session (in this order)

1. **Verify the tree.** `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed at the stop. Re-run it once: a TASK_2026_620 subagent ran the full `mcp-bench:test` in parallel at about 02:00, and the two corpus-spec runs can see each other's temp folders.
2. **Finish Batch 5** (Codex lane, session `01a1135e-53f4-7f70-a3cf-4f06026e5fd8`). Code and spec are done (`ground-truth.spec.ts`, 3 tests pass), but the five question files are EMPTY envelopes: `symbols-exact.json`, `symbols-concept.json`, `references.json`, `definitions.json`, `dependents.json`. Cause: every Codex command was killed at 30 s, so the `git archive` extraction and the generator never ran. **Do not commit empty files as ground truth.** Run the extraction and the generator from a subagent or the orchestrator Bash (long timeout), not from a Codex lane: `git -C <worktree> archive 7910f34cf | tar -x -C %TEMP%\mcp-bench-b5-corpus`, then a throwaway driver with `node --max-old-space-size=8192` (see `batch-5-executor-report.md` line 29). Check the stratum counts against the Batch 5 spec in `batches.md`.
3. **Finish Batch 6** (Glm lane, session `cb9f49bd-22c1-486d-8780-00b908996ed5`; it exited with `no-deliverable`: no report, no `ptah_agent_report`). State: `file-tools.json` 400 questions and `memory.json` 489 questions were generated; `relevance.json` has 0, because `gh pr list --state merged --limit 1000 --json ...files...` failed (truncated JSON, then HTTP 502 from the GitHub GraphQL API). Fix: page the gh query (smaller `--limit`, several calls) or use `gh api` REST with pagination, then regenerate `relevance.json` (target: 200 held-out `test` PRs + `tune`). Write `batch-6-executor-report.md` (missing). The Batch 6 spec is `relevance-memory.spec.ts`.
4. **Format:** 11 files under `tools/mcp-bench/src/ground-truth` and `tools/mcp-bench/questions` fail `npx prettier --check`. Run `npx prettier --write` on them.
5. **Review** both batches yourself (read the generators; spot-check 10 questions per file against the corpus), then a **fresh team-leader in Mode 2** with both report paths. Each batch gets its own commit. Include `TASK_2026_622_2d05/` and the uncommitted `context.md`.
6. Continue with Batch 7 per `batches.md`.

## Lane evidence so far (for the final per-lane table the user asked for)

| Lane | Batches | Result | Notes |
|---|---|---|---|
| codex | 1, 2, 4b, 5 | 1 ok; 2 needed 1 revision (corpus.ts cleanup defects); 4b needed 1 revision (API design) + a queued addition; 5 incomplete | Skipped Prettier in 1 and 2. **Each command is killed at 30 s** in this environment: it cannot run the nx check (1-2 min), long git, or generators. Unsuitable for batches whose verification or output needs long commands. A queued message arrives only as a later turn: wait for it before starting another lane on the same files. One resume failed at 1 s (SDK exit 1). |
| Glm (ptah-cli, Ollama Cloud, tier opus) | 6 | Partial; exit `no-deliverable` after 18 m 47 s, $6.13 | Generated 2 of 3 outputs; got stuck waiting on a background gh retry; wrote no report. |
| subagents (backend-developer) | 3, 4, 4c, 4d | All complete | 4d found a real product bug with a careful bisect. |
| opencode, antigravity | — | not used yet | Plan: opencode for Batch 7 (no messaging support: no report, no steering); antigravity as the Phase 1 lane reviewer of subagent-authored code. |

Re-check the plan in `context.md` "User Requests (2026-10-07)": given the Codex 30 s limit, prefer subagents (or lanes with no command limit) for Batches 7-8, and keep lanes for pure-code tasks whose verification the orchestrator runs.

## Decisions to keep (full text in context.md)

- Prompt claims stay unchanged; fix the tools until they meet them.
- Language-server manager with TS/JS, Python (pyright), Go (gopls) in this task; others in a follow-up. Warm at session start in a separate process with a memory ceiling. SCIP is benchmark ground truth only.
- One coverage line when clean.
- Real-DB guard: `hash` mode, or `process-watch` when the desktop app writes the DB; CI always `hash`.
- Scorecard core is owned by 619; TASK_2026_620 registers its own suite kinds.
- **Open a PR at the end** (base `main`). Never merge it.
- New Phase 2 item: worktree-aware task tools (`workspaceRoot` argument on the five `ptah_task_*` tools), with Fix 7 / Batch 34. Not yet in `batches.md`: the next team-leader Mode 2 adds it.
- Workspace hygiene: nothing is written in the main checkout. After any `ptah_task_create`, move the new folder into this worktree at once (the tool writes to the main checkout).

## Open findings already assigned in batches.md

- Corpus cleanup race in `withPinnedCorpus` (`corpus.ts:30`, `:116-129`): Task 9.3 (owner liveness check). Also: the corpus spec should use a private temp root.
- Model download on every run: Task 9.1 (shared model cache under the bench data folder).
- `countEligibleFiles` is not the product's eligibility rule: Task 11.1.
- Guard `unprobed` → scorecard `run.guard.unprobed`: Task 9.3.

## Related tasks

- **TASK_2026_622_2d05** (in this worktree): product bug. `SqliteConnectionService.close()` (`libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:526`) dies with 0xC0000409 in `wal_checkpoint(TRUNCATE)` in 50-80% of win32 shutdowns after vectors are written to `vec0` tables. Not part of 619. The user was told it may affect the desktop app and the real DB; recommend starting it soon.
- **TASK_2026_620_a13e** (other session, `ptah-ptah-extension-skills-trajectory-an-10a89600005aw2q23htdi0c`): memory + skills benchmark. It reuses `tools/mcp-bench` (code in `src/memory-skills/`, two targets of its own in `project.json`). Agreements: 619 is the only writer of the scorecard core files; 620 does not run a bench that calls `withPinnedCorpus` while a 619 bench may run, and messages 619 before its first recorded run (its Batch 24). Send 620 the SHA of any commit that changes `tools/mcp-bench/src/scorecard/`, `transport/bench-host-boot.ts` or `bench-data.ts`.
