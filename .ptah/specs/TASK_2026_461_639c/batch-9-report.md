## Task 9.1

Completed 2026-09-17. Implemented the decision-3 transcript-by-session-id fallback without changing the trajectory extractor, migration 0045, cleanup store, settings, UI, or adapter boundaries.

### Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts` — shared projects-root helper and uncached immediate-directory listing.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts` — listing/filter/error cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\agent-sdk\CLAUDE.md` — uncached listing contract.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\session-transcript-locator.ts` — optional structural reader port, per-run listing/result cache, safe-id validation, and lookup stats.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\session-transcript-locator.spec.ts` — real exclusive temp-directory cases plus EBUSY and traversal guards.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts` — one locator lookup per run, A12 dispositions, rejection reason, counters, and lookup-stat debug record.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts` — report-only `rejectedNoTranscript` subset and counter identity documentation.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts` — lookup outcomes, no-call seams, exact rejection, and shared-session cache case.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.integration.spec.ts` — real SQLite plus real locator over fake listers for found, absent, and unavailable cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\di\register.ts` — singleton locator registration.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\CLAUDE.md` — cleanup lookup and counter contract.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` — summary appends `, no transcript N`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.spec.ts` — counter fixture and exact summary.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\CLAUDE.md` — job summary contract.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts` — report fixture counter.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-9-report.md` — this evidence.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\agent-output-root.md` — executor handoff.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-9.1.done` — completion marker, written last.

The docs grep `rg -n "backlog cleanup|backlog-cleanup" apps/ptah-docs/src/content/docs/skill-synthesis` returned no matches, so no docs-app file was changed.

### Stack observed

- Node 24 / TypeScript 5.9 Nx monorepo (`package.json`, `.nvmrc`); tsyringe registration in `skill-synthesis/src/lib/di/register.ts`.
- External JSONL file access remains owned by agent-sdk; skill-synthesis injects `SDK_TOKENS.SDK_JSONL_READER` through a local structural port.
- Existing trajectory parsing/evidence validation remains in `TrajectoryExtractor` and `hasSessionWorkEvidence`; no new boundary format was introduced.

### Acceptance evidence

Every test/run-many/audit command was preceded by a Win32 process check reporting `PROCESS_CHECK: no live jest or nx run-many process`. `NX_DAEMON=false` was used for Nx commands and binaries came from `D:\projects\ptah-extension\node_modules`.

1. Full tests:

   Command: `nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`

   Header: `NX Running target test for 4 projects:`

   Result: PASS. Agent-sdk 110 suites passed / 2 skipped, 1968 tests passed / 3 skipped; skill-synthesis 76 suites passed / 6 skipped, 1537 tests passed / 37 skipped; thoth-runtime 6 suites and 100 tests passed; cli-engine 19 suites and 190 tests passed. `NX Successfully ran target test for 4 projects`.

2. Full lint:

   Command: `nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`

   Header: `NX Running target lint for 4 projects:`

   Result: PASS, 0 errors. Existing warnings only: agent-sdk 42, skill-synthesis 35, cli-engine 1; thoth-runtime clean. `NX Successfully ran target lint for 4 projects`.

3. `JsonlReaderService` typed-use grep:

   Command: `rg -n "JsonlReaderService" libs apps --glob '*.ts'`

   Relevant uncast typed constructions are real `new JsonlReaderService(...)` instances or DI class registrations. Structural test doubles in skill-synthesis and memory-curator are explicitly cast. The app registration hit is `apps/ptah-electron/src/activation/wire-runtime.spec.ts:121 useClass: JsonlReaderService`. No extra project beyond the required seven was added.

4. Typecheck:

   Command: `nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers ptah-electron ptah-cli --parallel=1`

   Header: `NX Running target typecheck for 7 projects:`

   Result: PASS, all seven projects; `NX Successfully ran target typecheck for 7 projects`.

5. node:sqlite focused binding:

   Command: `nx run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator|skill-synthesis.reachability"' --runInBand`

   Header: `NX Running target test for project @ptah-extension/skill-synthesis:`

   Result: PASS — `Test Suites: 5 passed, 5 total`; `Tests: 45 passed, 45 total`; `Snapshots: 0 total`.

   Reachability-only confirmation with the same run-many form and pattern `skill-synthesis.reachability`: `Test Suites: 1 passed, 1 total`; `Tests: 5 passed, 5 total`; 0 skipped.

6. better-sqlite3 focused binding:

   Command: `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator|skill-synthesis.reachability"' --runInBand`

   Result: PASS — `Test Suites: 5 passed, 5 total`; `Tests: 45 passed, 45 total`; `Snapshots: 0 total`.

   Reachability-only confirmation: `Test Suites: 1 passed, 1 total`; `Tests: 5 passed, 5 total`; 0 skipped.

7. Degradation audit:

   Command: `nx run degradation-audit:lint`

   Result: PASS / exit 0. `libs/backend/skill-synthesis: 6 ok (baseline 6)`; `libs/backend/cli-engine: 12 ok (baseline 12)`; `libs/backend/agent-sdk: 4 ok (baseline 4)`; thoth-runtime has no entry and therefore remains 0. No baseline update was run.

8. Final whitespace/constraint checks:

   `git diff --check` PASS. Production grep added no `.claude` or transcript-root `projects` literal under skill-synthesis. `trajectory-extractor.ts`, migration 0045, `SkillBacklogCleanupStore`, settings, UI, and `batches.md` are unchanged.

One first full-test capture used a shell timeout that ended before Nx and left its executor finishing; execution was allowed to exit before the successful captured rerun above. One focused test-only compile exposed a nullable test capture; the assertion was corrected and all final passes above include the correction.

### Mutation evidence

- **9.1-mutA** changed the all-absent branch to `kept-root-unknown`. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup"' --runInBand`. Expected failure: 2 suites / 2 tests failed. Unit report received `keptRootUnknown: 1`, `rejectedNoTranscript: 0`, `rejectedTranscriptUnreadable: 0`; integration received the corresponding 1/0/1 values instead of 0/1/2.
- **9.1-mutB** disabled cache hits with a type-correct never-true cache condition. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup.service|session-transcript-locator"' --runInBand`. Expected failure: 2 suites / 2 tests failed. Service cache hits received 0 instead of 1; locator received `cacheHits: 0`, `pathStats: 2` instead of 1/1. An initial mutation form caused a TypeScript compile failure and was replaced before recording the required behavioural kill.
- **9.1-mutC** treated non-ENOENT/ENOTDIR stat errors as absent. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"session-transcript-locator"' --runInBand`. Expected failure: 1 suite / 1 test failed; EBUSY received `{ kind: 'absent' }` instead of `{ kind: 'unavailable' }`.
- All mutations were restored. Restoration command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator"' --runInBand`. PASS — 4 suites, 40 tests, 0 failed. Changed-file list remains exactly the source/docs/spec/report files listed above; grep confirmed none of `cacheHits < 0`, the mutated unavailable assignment, or the all-absent mutation remains.

### Assumptions and risks

- **A9:** The locator path is reached only after the root loop has made no attempt. Root-resolved unit coverage asserts `locate` is not called.
- **A10:** Empty source ids return `kept-root-unknown`; existing coverage now also asserts no locator call.
- **A11:** Missing optional method, null listing, listing throw, unsafe id, and non-missing stat failures return unavailable. Unsafe ids perform zero listings/stats.
- **A12:** Precedence is evidence found -> kept-evidence; any readable found transcript -> reject-no-evidence; any found but unreadable transcript -> reject-unreadable; otherwise any unavailable -> kept-root-unknown; otherwise all absent -> reject-no-transcript.
- **R-TL15:** One lazy listing per run lookup, stop at first file hit, cache every session result, expose listings/stats/hits, and keep the existing between-candidate stop checks.
- **R-TL16:** EBUSY is remembered and produces unavailable unless a later directory hits; mutation 9.1-mutC proves the guard.
- **R-TL17:** The full grep and seven-project typecheck passed.
- **R-TL18:** The structural port method is optional; the unchanged reachability fake safely yields unavailable and reachability remains 5/5 under both bindings.
- **R-TL19:** Cleanup now has eight injected collaborators, using the one named locator requested by the plan.
- **R-TL20:** Empty ids and ids containing `/`, `\\`, or `..` are rejected before path joining or I/O.

### Plan deviations

None. The docs-app grep had no cleanup-disposition page, so the conditional docs update did not apply. Formatting the touched cleanup files produced broader formatting-only diff hunks but no contract change.

### Out-of-scope observations

Existing lint warnings remain in agent-sdk, skill-synthesis, and cli-engine; no new warning remains in a changed file. No out-of-scope source was edited.

## Task 9.3

Status: DONE - senior-tester re-verification and byte-copy re-measurement. No production file changed by this task. Pre-flight (`Get-CimInstance Win32_Process`) confirmed no live `jest-worker` / `nx run-executor` before every heavy run; only Nx daemons, MCP helper processes, and an unrelated Electron e2e instance from a different worktree (`task-453-tile-open-long-tasks`) were present throughout.

**Important context noted, not acted on (out of this task's scope):** the parallel `code-logic-reviewer` finished during this task and returned `code-logic-review-batch-9.md` = **CHANGES_REQUESTED, 6/10**, marker `review-9.done`. Its one finding: an existing-but-EMPTY `~/.claude/projects` (a successful `readdir` returning zero child directories) is misclassified by `SessionTranscriptLocator` as "searched everywhere, found nothing" (`absent`) rather than "the lookup could not usefully run" (`unavailable`), which on a machine with no transcript root would reject every root-unknown candidate instead of keeping them. This machine's `~/.claude/projects` has 41 real child folders throughout this measurement, so the finding does not invalidate any number below, but batches.md's stated dependency ("9.3 depends on: 9.2 APPROVED") is not yet satisfied - the orchestrator's direct instruction to this agent was to run 9.3 now, in parallel with the review, so this measurement proceeded on the current (not yet revised) Task 9.1 code. A revise round on 9.1 is expected to follow; re-running this measurement after a fix is cheap (no data changed) but was not required by this task's instructions.

### 1. Full re-verification (Task 8.3 sets plus `@ptah-extension/agent-sdk`)

**Test (9 projects)** - `nx.cmd run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/skill-synthesis-ui @ptah-extension/agent-sdk --parallel=1 --skip-nx-cache`

Header: `NX Running target test for 9 projects:` -> `NX Successfully ran target test for 9 projects` - confirmed N = 9 (Task 8.3's 8 plus agent-sdk). Zero failures:

| Project | Suites | Tests |
| --- | --- | --- |
| shared | 59 passed | 1521 passed |
| platform-core | 41 passed | 785 total, 4 todo, 781 passed |
| agent-sdk | 2 skipped, 110 passed (112 total) | 3 skipped, 1968 passed (1971 total) |
| persistence-sqlite | 9 skipped, 32 passed (41 total) | 80 skipped, 438 passed (518 total) - native-probe skips, XB1 below |
| skill-synthesis | 6 skipped, 76 passed (82 total) | 37 skipped, 1537 passed (1574 total) - repo's existing opt-in suites |
| rpc-handlers | 101 passed | 33 skipped, 3016 passed (3049 total) |
| thoth-runtime | 6 passed | 100 passed |
| cli-engine | 19 passed | 190 passed |

**Typecheck (13 projects)** - `run-many -t typecheck -p` the same 9 + `@ptah-extension/webview-e2e-harness ptah-electron-e2e ptah-electron ptah-cli`. Header: `NX Running target typecheck for 13 projects:` -> `NX Successfully ran target typecheck for 13 projects` - confirmed N = 13. 0 errors.

**Lint (11 projects)** - `run-many -t lint -p` the same 9 + `@ptah-extension/webview-e2e-harness ptah-electron-e2e`. Header: `NX Running target lint for 11 projects:` -> `NX Successfully ran target lint for 11 projects` - confirmed N = 11. 0 errors; warnings only (pre-existing `catch-return-sentinel`-class and `Unused eslint-disable directive` warnings; none newly introduced).

**`degradation-audit:lint`** - `nx.cmd run degradation-audit:lint`, exit 0 (`Successfully ran target lint for project degradation-audit`):

```
libs/backend/agent-sdk: 4 ok (baseline 4)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
degradation-audit: TOTAL 303 unsuppressed site(s)
```

`thoth-runtime` absent from the per-directory totals (stays 0, as required); `agent-sdk` unchanged at its baseline (4, same as Task 9.1's own measurement); `TOTAL 303` - identical to Batch 8. `--update-baseline` never run.

**XB1 - better-sqlite3 via Electron-as-Node vs node:sqlite** (PowerShell, `'"a|b"'` quoting):

skill-synthesis (Task 8.3 pattern plus `session-transcript-locator`):
```
--config libs/backend/skill-synthesis/jest.config.ts
--testPathPatterns "skill-synthesis.reachability|skill-backlog-cleanup|skill-candidate.store|skill-synthesis.stage-handlers|judge-panel.service|cluster-holdout-end-to-end|session-transcript-locator"
--runInBand
```
node:sqlite (`run-many -t test`): `Test Suites: 9 passed, 9 total`, `Tests: 202 passed, 202 total`. better-sqlite3 (Electron-as-Node): `Test Suites: 9 passed, 9 total`, `Tests: 202 passed, 202 total` - identical between bindings. (202 vs Batch 8's 184: Task 9.1 added the new `session-transcript-locator.spec.ts` suite plus new cases in the existing cleanup specs.) The reachability spec is included in this pattern and passed 5/5 under both bindings (no separate isolated run needed; Task 9.1's own report already isolated it to confirm 5/5 twice).

persistence-sqlite (Task 8.3 pattern, unchanged - Task 9.1 touched no persistence-sqlite file):
```
--config libs/backend/persistence-sqlite/jest.config.ts
--testPathPatterns "0028_|0030_|0038_|0039_|0040_|0041_|0042_|0043_|0044_|0045_"
--runInBand
```
node:sqlite: `Test Suites: 10 passed, 10 total`, `Tests: 9 skipped, 74 passed, 83 total` (9 native-`better-sqlite3`-probe skips). better-sqlite3 (Electron-as-Node): `Test Suites: 10 passed, 10 total`, `Tests: 83 passed, 83 total`. Both identical to Batch 7 and Batch 8.

**Greps:**

(a) `.claude` / `projects` path literal in skill-synthesis production files (`*.ts`, excluding `*.spec.ts` and `*.test-support.ts`): zero `.claude` literal hits; the four `projects` hits are unrelated doc-comment prose ("projects on purpose", "reading across projects", "the two can never [collide]", "promoted mid-session reached `.claude/skills` and the rival CLIs only at [...]") - no transcript-root path literal added. Matches Task 9.1's own R-TL17/seam claim and the reviewer's independent grep in `code-logic-review-batch-9.md`.

(b) `listSessionsDirectories` over `libs` (`*.ts`): exactly six files - the reader (`jsonl-reader.service.ts`) and its spec, the locator (`session-transcript-locator.ts`) and its spec, and the two cleanup specs that construct a fake lister (`skill-backlog-cleanup.service.spec.ts`, `skill-backlog-cleanup.integration.spec.ts`). No stray hit.

(c) `rejectedNoTranscript` over `libs` (`*.ts`): exactly the seven files the plan named - `skill-backlog-cleanup.service.ts`/`.types.ts`/`.service.spec.ts`/`.integration.spec.ts`, `thoth-runtime/skill-backlog-cleanup-job.ts`/`.spec.ts`, and `cli-engine/bootstrap/thoth-runtime.spec.ts`. No stray hit.

Corpus re-measurement: **not required** and not run - the prefilter predicate is unchanged since Batch 8 (Task 9.1 touched no prefilter/eligibility file), per the batch-9 task description.

### 2. Byte-copy re-measurement (Task 8.3 procedure verbatim)

Procedure followed verbatim (HANDOFF rule 5 / R-TL9, identical to Task 7.3/8.3): source snapshot re-listed via `fs.readdirSync` + `fs.statSync` only (never opened directly); newest `ptah.pre-migration-*.sqlite` unchanged from Batch 7/8 (`1,178,537,984` bytes, `2026-09-09T23:06:09.256Z`); fresh fail-if-exists temp dir `skill-cleanup-measure-<random>` (`fs.mkdtempSync` under `os.tmpdir()`, name does not start with `ptah`); byte copy via `fs.copyFileSync(..., COPYFILE_EXCL)`; only the copy ever opened; real `SqliteConnectionService` constructed directly (not through DI), `.configure({ factory: <better-sqlite3 opener>, vecPathResolver: null, vecPathPlatformResolver: null, vecPathFallbackResolver: null })`, no backup service registered; `openAndMigrate()` run under Electron-as-Node (the production `better-sqlite3` binding); the real cleanup service stack built by hand in the same constructor order as `cleanup/skill-backlog-cleanup.service.ts` (`SkillCandidateStore`, `SkillQueueStore`, `SessionVerdictStore`, `SkillBacklogCleanupStore`, a real `TrajectoryExtractor` wrapping a real `JsonlReaderService` behind a timing proxy, a real `SessionTranscriptLocator` over that SAME real `JsonlReaderService` (so its `listSessionsDirectories` reads the live `~/.claude/projects` root exactly as the product would, read-only, existence/listing only, no transcript content read except through the extractor's own `readJsonlMessages`), a real `ForegroundActivityTracker`, a fake `IWorkspaceProvider` zeroing `bootDeferralMs`). `run()` looped until `{status:'skipped', reason:'complete'}`. Harness: `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.byte-copy-measurement.spec.ts`, a temporary opt-in spec (`PTAH_BACKLOG_BYTE_COPY=1`), deleted immediately after its one run.

Command:
```
$env:ELECTRON_RUN_AS_NODE='1'; $env:PTAH_BACKLOG_BYTE_COPY='1'
electron.cmd jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup.byte-copy-measurement"' --runInBand
```
Result: `Test Suites: 1 passed, 1 total`, `Tests: 1 passed, 1 total`. Time: 12.495 s.

- Pragma read-back (all six match production): `journal_mode=wal`, `foreign_keys=1`, `synchronous=1`, `temp_store=2`, `mmap_size=268435456`, `busy_timeout=5000`.
- Schema before 41 (unchanged source), after 45. Migration wall time this run: 1,058.6 ms (one-time boot cost; within the 1.2 s-7.6 s host-variance range recorded across Batches 7-8).
- Candidates at `status='candidate'` before: **2,418** (unchanged source snapshot).
- Ticks to completion: **13** (identical to Batches 7 and 8); the 14th call returned `{status:'skipped', reason:'complete'}`, not counted as a tick.
- Wall time per tick: min 104.9 ms, median 200.0 ms, max 992.0 ms - higher than Batch 8's 16/25/916 ms because every tick this run performs the new by-id lookup (directory listing + up to ~7,300 `stat` calls per tick) for every remaining root-unknown candidate; still well inside the 60 s per-tick wall budget (no tick returned `time-budget`; every tick that was not the final `complete` call hit the 200-row cap, i.e. `row-budget`).
- Largest single transcript read: **31.24 ms** (smaller than Batch 7/8's 226/147 ms - the by-id lookup reads are short conversation-only transcripts, not the larger edit-heavy ones).
- Final counters (state row, cumulative): kept-evidence **122**, kept-verdict 174, kept-degraded-verdict 265, rejected-no-evidence 0, rejected-transcript-unreadable (persisted, includes no-transcript) **1,857**, invocations-deleted 2,424.
- `rejectedNoTranscript` (per-run, summed across all 13 ticks): **1,540** - a SUBSET of the 1,857 persisted `rejectedTranscriptUnreadable` (the other 317 are the unchanged root-resolved/read-attempted/extractor-returned-nothing bucket).
- `keptRootUnknown` (per-run, summed across all 13 ticks): **0**.
- `deferredOnError` (per-run, summed): **0**.
- Identity check: `examined - (keptEvidence + keptVerdict + keptDegradedVerdict + rejectedNoEvidence + rejectedTranscriptUnreadable(persisted) + summedKeptRootUnknown + summedDeferredOnError)` = `2,418 - (122+174+265+0+1,857+0+0)` = **0**. Holds exactly. (`rejectedNoTranscript` is a per-run SUBSET already inside the 1,857 and is correctly NOT added a second time, per the type doc and `countDisposition`.)
- Cross-check against `SkillBacklogCleanupStore.readState()`: the persisted counters read back from the state row after completion match the `run()` cumulative report field-for-field (`examined 2418`, `keptEvidence 122`, `rejectedTranscriptUnreadable 1857`, `invocationsDeleted 2424`, etc.).

### 3. Where the Batch 8 candidates land now

| Metric | Batch 7 | Batch 8 | Batch 9 |
| --- | --- | --- | --- |
| Examined | 2,418 | 2,418 | 2,418 |
| Ticks | 13 | 13 | 13 |
| Kept - evidence | 120 | 109 | **122** |
| Kept - verdict | 174 | 174 | 174 |
| Kept - degraded verdict | 265 | 265 | 265 |
| Kept - root unknown (per run) | did not exist | 1,553 | **0** |
| Rejected - no evidence | 0 | 0 | 0 |
| Rejected - transcript unreadable (persisted) | 1,859 | 317 | **1,857** |
| ...of which `rejectedNoTranscript` (per-run subset, new) | n/a | n/a | **1,540** |
| Deferred on error | 0 | 0 | 0 |
| Invocations deleted | 2,424 | 2,424 | 2,424 |
| Migration wall time | 1,221 ms / 7,612 ms (two runs) | 5,154 ms | 1,058.6 ms |
| Wall time per tick (min/median/max) | 18 / 29 / 1,007 ms | 16 / 25 / 916 ms | 104.9 / 200.0 / 992.0 ms |
| Largest single transcript read | 226 ms | 147 ms | 31.24 ms |

**Kept-evidence rose by exactly 13 (109 -> 122).** Batch 8 recorded exactly 13 `kept-root-unknown` candidates with a transcript file present on disk by read-only existence check. Under decision 3's by-id lookup, those 13 candidates were found by `SessionTranscriptLocator` and their transcripts carried code-work evidence, moving them from `kept-root-unknown` to `kept-evidence` - the exact redistribution the decision was designed to produce.

**The remaining 1,540 of Batch 8's 1,553 `kept-root-unknown` candidates landed in `reject-no-transcript`** (1,553 - 13 = 1,540, matching `rejectedNoTranscript` exactly): every session id named by these candidates was confirmed ABSENT from all 41 live `~/.claude/projects` child folders by the by-id lookup, so decision 3 converts the old "kept, unresolved" state into an explicit, searchable terminal rejection (`backlog-cleanup: no transcript found for any session`) instead of leaving them in limbo.

**`keptRootUnknown` is now 0** - every candidate that previously had no resolvable workspace root was, on this snapshot and this live corpus, definitively resolved one way or the other by the by-id lookup (found + evidence, found + no evidence, found + unreadable, or confirmed absent everywhere). No candidate remained stuck.

### 4. Accepted-risk check (required by Task 9.3, independent of the run's own classification)

For every candidate rejected with the exact reason `backlog-cleanup: no transcript found for any session` (**1,540** candidates), an INDEPENDENT read-only existence check (directory listing + `fs.statSync`, never through `SessionTranscriptLocator` or `JsonlReaderService`, never opening file content) was run against `~/.claude/projects/*/<sessionId>.jsonl` for every session id named by the candidate:

| Metric | Value |
| --- | --- |
| `reject-no-transcript` candidates checked | 1,540 |
| Distinct sessions checked | 1,540 |
| Candidates with >=1 transcript file present on disk | **0** |

**Result: 0, as required - no defect.** Every candidate the run classified as "no transcript found for any session" is independently confirmed to have no session file anywhere in the live `~/.claude/projects` tree at measurement time. The same independent check was also run for the 317 candidates rejected with the unchanged `backlog-cleanup: transcript unreadable and no verdict` reason (root resolved, read attempted, extractor returned nothing): **0** of those 317 have a file present on disk either - identical to Batch 8's result for that bucket, confirming decision 3 did not disturb the root-resolved path.

`keptRootUnknown` remaining: **0**, so there is no A11-cause split to report this run (the lower-bound proxy query - `status='candidate'` rows with an empty `source_session_ids` array - also returned **0**, consistent).

### 5. Lookup cost per tick (R-TL15)

Measured via a proxy wrapped around `SessionTranscriptLocator.createRunLookup()` (one lookup object created per `run()` call = one tick), capturing `directoryListings`, `pathStats`, `cacheHits` from `.stats()` and per-`locate()`-call wall time:

| Tick | Directory listings | Path stats | Cache hits | Lookup calls | Lookup ms (min/median/max) | Tick wall ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 7,298 | 22 | 200 | 0.001 / 1.82 / 5.72 | 383 |
| 2 | 1 | 3,649 | 111 | 200 | 0.001 / 0.003 / 4.51 | 200 |
| 3 | 1 | 4,346 | 94 | 200 | 0.001 / 1.67 / 5.52 | 234 |
| 4 | 1 | 4,346 | 94 | 200 | 0.001 / 1.73 / 6.68 | 232 |
| 5 | 1 | 3,567 | 62 | 149 | 0.001 / 1.69 / 5.31 | 202 |
| 6 | 1 | 2,665 | 42 | 107 | 0.001 / 1.62 / 3.09 | 161 |
| 7 | 1 | 1,763 | 11 | 54 | 0.001 / 1.78 / 2.56 | 105 |
| 8 | 1 | 4,100 | 22 | 122 | 0.001 / 1.82 / 7.14 | 242 |
| 9 | 1 | 3,526 | 17 | 103 | 0.001 / 1.77 / 5.16 | 194 |
| 10 | 1 | 3,198 | 5 | 83 | 0.002 / 1.77 / 3.08 | 171 |
| 11 | 1 | 2,911 | 10 | 81 | 0.001 / 1.80 / 6.61 | 164 |
| 12 | 1 | 1,381 | 17 | 54 | 0.001 / 1.81 / 4.77 | 992 |
| 13 (final, `complete`) | 0 | 0 | 0 | 0 | n/a | 119 |

Totals across the run: **12** directory listings (one per tick that did lookup work; each lookup object lists the live projects root exactly once and caches it for the whole tick, per the R-TL15 design), **42,750** path `stat` calls, **507** cache hits (repeat session ids within a tick), **1,553** total `locate()` calls (matches Batch 8's total `kept-root-unknown` count exactly - every one of those candidates got exactly one lookup pass this run).

**No escalation required.** Every tick's median individual-lookup time is 0.001-1.82 ms and the single slowest lookup observed across the whole run was 7.14 ms - several orders of magnitude under the R-TL15 threshold (median lookup ms per tick > 5,000 ms would trigger a readdir-index escalation to the orchestrator). The per-tick wall-time cost of the lookup (up to ~992 ms for ~1,381 path stats in the slowest tick) stays far inside the 60-second per-tick budget; no tick returned `time-budget` as its stop reason - every non-final tick hit `row-budget` (200 candidates).

### 6. Safety proofs

- Source never opened with SQLite; only `fs.statSync`/`fs.readdirSync`.
- Fail-if-exists temp dir name did not start with `ptah`; created via `fs.mkdtempSync` (itself fail-if-collision by design).
- Byte copy via `COPYFILE_EXCL`; only the copy opened.
- Six production pragmas read back and matched (above).
- Connection closed, then `fs.rmSync(tmpDir, {recursive:true, force:true})`; `fs.existsSync(tmpDir)` asserted `false` by the harness itself (test passed).
- Source re-`statSync`-ed after the run: size `1,178,537,984` bytes (unchanged), mtime `2026-09-09T23:06:09.256Z` / `1,788,995,169,256.003` ms (unchanged) - asserted by the harness itself (test passed).
- Harness deleted immediately after its one run (`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.byte-copy-measurement.spec.ts`).
- `git status --short` after deletion shows only Task 9.1's files (agent-sdk reader + spec + CLAUDE.md; skill-synthesis cleanup service/types/specs, `di/register.ts`, CLAUDE.md; thoth-runtime job/spec/CLAUDE.md; cli-engine `thoth-runtime.spec.ts`; the new `session-transcript-locator.ts`/`.spec.ts`) plus the task-folder files (`batch-9-report.md`, `batch-9.1.done`, `agent-output-root.md`, `code-logic-review-batch-9.md`, `review-9.done`) - no harness file remains, and no file outside Task 9.1's own scope was touched by this task.

### Execution

- Commands run: every command listed above, verbatim, from `W`, `NX_DAEMON=false` for every `nx.cmd` invocation, `ELECTRON_RUN_AS_NODE=1` only for the XB1 second-binding and byte-copy runs. Live-process preflight (`Get-CimInstance Win32_Process`) run before every heavy command; no live `jest`/`nx run-executor` at any point; `electron.cmd` was never launched without the `jest.js` script argument.
- Result: zero failures across every command in Task 9.3.
- Not executed: corpus re-measurement (explicitly not required - prefilter predicate unchanged since Batch 8).

### Verdict

- Criteria proven: all Task 9.3 verification headers confirmed with the requested N (9/13/11 projects); degradation-audit exits 0 at every requested ceiling including `agent-sdk` unchanged at baseline 4; XB1 both-binding counts identical between bindings (202/202 and 83/83); all three greps clean; byte-copy re-measurement shows the identity holding exactly, the required accepted-risk check returning 0 (no defect), and the exact redistribution of Batch 8's 1,553 `kept-root-unknown` candidates into 13 `kept-evidence` + 1,540 `reject-no-transcript`; lookup cost is negligible (no R-TL15 escalation).
- Criteria not proven: none identified as missing from this task's own scope.
- Risks a reader should know about: **`code-logic-review-batch-9.md` returned CHANGES_REQUESTED (6/10)** for an empty-`~/.claude/projects`-directory edge case in `SessionTranscriptLocator` that this measurement's live machine (41 real folders) could not exercise or disprove; the batch is not yet ready to commit per `batches.md`'s stated dependency (9.3 depends on 9.2 APPROVED), even though this task's own instructions directed it to run now, in parallel with the review. A revise round on Task 9.1 and, if the fix changes `SessionTranscriptLocator`'s behaviour meaningfully, a re-run of this byte-copy measurement, are both still pending. Migration wall time and tick wall time remain host-variance across runs on this shared machine, not a regression signal.

## Task 9.1 — revise round 1

Completed 2026-09-17 after reading `code-logic-review-batch-9.md` in full and addressing all three requested findings.

### Fixes

- **Empty successful listing is unavailable** — `libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts:94-99` now maps both `null` and `[]` listings to a cached `{ kind: 'unavailable' }` before any path stat. Agent-sdk's `listSessionsDirectories()` contract remains unchanged. Regression coverage is at `session-transcript-locator.spec.ts:96-110`: directory listings 1, path stats 0, cache hits 0.
- **Service preserves candidates when nothing can be searched** — `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.spec.ts:305-334` uses a real locator whose lister returns `[]` and proves `keptRootUnknown: 1`, `rejectedNoTranscript: 0`, `rejectedTranscriptUnreadable: 0`, and an empty rejection batch.
- **Lookup statistics are production-observable** — `skill-backlog-cleanup.service.ts:289-294` logs exactly one aggregate lookup-stat record per `execute()` at `info`, containing only `directoryListings`, `pathStats`, and `cacheHits`; no session id or path is logged. The service regression case asserts the exact aggregate payload.
- **Readability state is phase-local** — `skill-backlog-cleanup.service.ts:317-344` uses `rootReadable` only for the normal root loop, while `:350-380` uses independent `lookupReadable`, `found`, and `unavailable` state for by-id precedence. Behaviour and precedence remain unchanged.

Round-1 production/test files changed:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\session-transcript-locator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\session-transcript-locator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-9-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\agent-output-root.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-9.1-r1.done` (written last)

The existing Task 9.3 measurement/report files and all unrelated dirty-worktree state were preserved.

### Mutation evidence

Every mutation command was preceded by `PROCESS_CHECK: no live jest or nx run process`, used the main checkout's binaries, and set `NX_DAEMON=false`.

- **9.1-mutD (remove empty-list guard)**: changed the locator condition back to `sessionDirectories === null`. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup.service|session-transcript-locator"' --runInBand`. Expected failure: `Test Suites: 2 failed, 2 total`; `Tests: 2 failed, 33 passed, 35 total`. Locator received `{ kind: 'absent' }` instead of unavailable; service received `keptRootUnknown: 0`, `rejectedNoTranscript: 1`, and `rejectedTranscriptUnreadable: 1` instead of 1/0/0.
- **9.1-mutA (all-absent becomes kept-root-unknown)**: changed the final all-absent return to `kept-root-unknown`. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup"' --runInBand`. Expected failure: `Test Suites: 2 failed, 1 passed, 3 total`; `Tests: 2 failed, 28 passed, 30 total`. The all-absent unit case and SQLite integration case both detected the missing no-transcript rejection/counter.
- **Restore**: both mutations were reverted. Command: `nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator"' --runInBand`. PASS — `Test Suites: 4 passed, 4 total`; `Tests: 42 passed, 42 total`; 0 failed. Final source contains the `sessionDirectories === null || sessionDirectories.length === 0` guard and `unavailable ? 'kept-root-unknown' : 'reject-no-transcript'` all-absent decision. No mutation remains.

### Verification

All test/run-many/audit commands were preceded by a process check confirming no live Jest, Nx run-many, or Nx run-executor process. `NX_DAEMON=false` was used for Nx commands. No `nx reset` or baseline update was run.

1. Command: `nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`

   Header: `NX Running target test for 4 projects:`

   PASS: agent-sdk 110 passed suites / 2 skipped, 1968 passed tests / 3 skipped; skill-synthesis 76 passed suites / 6 skipped, 1539 passed tests / 37 skipped; thoth-runtime 6 suites / 100 tests passed; cli-engine 19 suites / 190 tests passed. Footer: `NX Successfully ran target test for 4 projects`.

2. Command: `nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine --parallel=1`

   Header: `NX Running target lint for 4 projects:`

   PASS with 0 errors. Existing warnings only: agent-sdk 42, skill-synthesis 35, cli-engine 1; thoth-runtime clean. Footer: `NX Successfully ran target lint for 4 projects`.

3. Command: `nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers ptah-electron ptah-cli --parallel=1`

   Header: `NX Running target typecheck for 7 projects:`

   PASS: all seven projects. Footer: `NX Successfully ran target typecheck for 7 projects`.

4. node:sqlite command: `nx run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator|skill-synthesis.reachability"' --runInBand`

   Header: `NX Running target test for project @ptah-extension/skill-synthesis:`

   PASS: `Test Suites: 5 passed, 5 total`; `Tests: 47 passed, 47 total`; `Snapshots: 0 total`.

5. better-sqlite3 command: `$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup|session-transcript-locator|skill-synthesis.reachability"' --runInBand`

   PASS: `Test Suites: 5 passed, 5 total`; `Tests: 47 passed, 47 total`; `Snapshots: 0 total`. Electron was invoked with `jest.js` as required.

6. Command: `nx run degradation-audit:lint`

   PASS / exit 0: `libs/backend/skill-synthesis: 6 ok (baseline 6)`; `libs/backend/cli-engine: 12 ok (baseline 12)`; `libs/backend/agent-sdk: 4 ok (baseline 4)`; thoth-runtime remains absent from the findings table (= 0). Footer: `NX Successfully ran target lint for project degradation-audit`.

7. `git diff --check` PASS. No source under the forbidden live-data locations was opened. `batches.md`, agent-sdk's directory-listing contract, the extractor, migration, store, settings, and UI remain unchanged in this revise.

### Deviations and observations

No plan deviation. The review's three requested changes were implemented directly in the named files. Existing repository lint warnings remain and no new warning is attributed to a changed file.
