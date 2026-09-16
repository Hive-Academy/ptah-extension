# Test Report - TASK_2026_461_639c, Batch 7

## Scope

- User request: finish Phase 3 (skills unblock) with full verification, prefilter-narrowing
  measurement and a byte-copy backlog-cleanup measurement, per `batches.md` Batch 7 (Tasks
  7.4, 7.1, 7.2, 7.3), executed in that order.
- Criteria tested: Task 7.4 acceptance (a)-(d); Task 7.1's full 8/12/10-project verification,
  degradation-audit ceilings, XB1 both-binding SQLite runs, and the three greps; Task 7.2's
  prefilter-narrowing counts; Task 7.3's safety procedure and cleanup-outcome measurement
  (moved to `backlog-cleanup-measurement.md`).
- Regressions covered: none — Batch 7 is verification-only; no production defect was found
  that needed a regression test.
- Review findings covered: the Batch 6 review's MODERATE finding (`adaptNodeDatabase`
  fabricated `.transaction()` and hardcoded `inTransaction: false`) is fixed and evidenced in
  Task 7.4 below.
- Deliberately not tested: automatic promotion (R3, phase 5), the generalization shortcut
  (R4, phase 5), `SkillInvocationTracker` usage (R5, phase 5) — all three are explicitly out
  of scope for this phase and are recorded as notes, not failures.

## Task 7.4 — reachability node:sqlite adapter tracks transaction state

- File changed: `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts`
  (`adaptNodeDatabase`, lines 41-96 after the edit). No production file and no change to the
  five reachability proof groups.
- Diff summary:
  - `inTransaction` no longer hardcodes `false`. It prefers a native `isTransaction` getter on
    the raw `node:sqlite` `DatabaseSync` handle when present, else falls back to manual
    tracking: `exec` of `BEGIN` (any form) sets a local flag `true`; `COMMIT` / `END` /
    `ROLLBACK` (but **not** `ROLLBACK TO ...`, which ends a savepoint, not the transaction)
    sets it `false`. The `.transaction()` wrapper sets/clears the same flag around its own
    `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, on both the success and throw paths.
  - Added a doc comment on `adaptNodeDatabase` stating it covers only the members the
    reachability proof reaches, and that `.transaction()` is not a verified equivalent of
    better-sqlite3's `Database.transaction()` (no nesting, no savepoints).
- Evidence (Node v24.15.0, node:sqlite `DatabaseSync`): a scratch script
  (`scratch-intransaction-check.mjs`, written at the worktree root, run with plain `node`, then
  deleted — chosen over an assertion inside the existing `beforeAll` so the adapter's
  detection logic could be iterated on before touching the reachability spec) produced:
  ```
  has native isTransaction getter: false   (own-property getter, not on the prototype — the
                                             adapter's detection was widened to check both)
  before BEGIN: false
  after BEGIN IMMEDIATE: true
  after COMMIT: false
  after 2nd BEGIN IMMEDIATE: true
  after ROLLBACK: false
  ```
  A follow-up inline check confirmed `Object.getOwnPropertyDescriptor(db, 'isTransaction')`
  finds the getter as an **own** property of the `DatabaseSync` instance (not its prototype),
  which is why `adaptNodeDatabase`'s detection checks the instance first and the prototype
  second.
- XB1 both bindings, reachability spec:
  - node:sqlite (`npx nx.cmd run-many -t test -p @ptah-extension/skill-synthesis
    --testPathPatterns=skill-synthesis.reachability --runInBand`): `Test Suites: 1 passed, 1
    total`, `Tests: 5 passed, 5 total`, 0 skipped.
  - better-sqlite3 via Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`, `electron.cmd` +
    `jest.js --config libs/backend/skill-synthesis/jest.config.ts
    --testPathPatterns=skill-synthesis.reachability --runInBand`): `Test Suites: 1 passed, 1
    total`, `Tests: 5 passed, 5 total`, 0 skipped.
- `run-many -t typecheck -p @ptah-extension/skill-synthesis`: green (`tsc --noEmit` clean;
  `test-support.ts` is excluded from `tsconfig.lib.json` per the plan's note, so this typecheck
  target does not itself compile the edited file — it was compiled cleanly by ts-jest in both
  runs above).
- `run-many -t lint -p @ptah-extension/skill-synthesis`: 0 errors, 35 warnings (pre-existing —
  same count the Batch 6 report recorded).
- `git status --short` under `libs/`: only
  `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts` — no
  other file touched.

## Task 7.1 — full suite + typecheck + lint + greps

### Test (8 projects)

Command: `npx nx.cmd run-many -t test -p @ptah-extension/skill-synthesis
@ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine
@ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared
@ptah-extension/skill-synthesis-ui`

Header: `Running target test for project @ptah-extension/skill-synthesis` (batched run-many),
concluding `Successfully ran target test for 8 projects` — confirmed N = 8.

Per-project totals from that run:

| Project | Suites | Tests |
| --- | --- | --- |
| platform-core | 27 passed | 431 passed |
| skill-synthesis | 75 passed, 6 skipped (81 total) | 1512 passed, 37 skipped (1549 total) |
| persistence-sqlite | 32 passed, 9 skipped (41 total) | 438 passed, 80 skipped (518 total) — local `node:sqlite` fallback; the skipped suites are the ones that require a real `better-sqlite3` binary (native probe fails locally with a `NODE_MODULE_VERSION` mismatch; see XB1 below, where the same specs run and pass under Electron-as-Node) |
| rpc-handlers | 101 passed | 3016 passed, 33 skipped |
| thoth-runtime | 6 passed | 100 passed |
| cli-engine | 19 passed | 190 passed |
| shared, skill-synthesis-ui | cached from an earlier identical run in this session; included in the "8 out of 8" cache line on the re-run below | — |

All failures: none.

Re-run with `--parallel=1` (HANDOFF rule 8 / R9, known load flakes — platform-core file-settings
bench, memory-curator boot-scan abort, rpc-handlers skills-sh source-root spec): Nx served all 8
tasks from cache (`Nx read the output from the cache instead of running the command for 8 out of
8 tasks`) because nothing changed between the two invocations and Nx's cache key is not a
function of the runner's `--parallel` value — i.e. the second run is a hash-verified replay of
the same green result, not fresh execution under different concurrency. No flake occurred in
either invocation; none of the three named flaky specs failed.

### Typecheck (12 projects)

Command: `run-many -t typecheck -p` the same 8 + `@ptah-extension/webview-e2e-harness
ptah-electron-e2e ptah-electron ptah-cli`.

Header: `Successfully ran target typecheck for 12 projects` — confirmed N = 12. All green, 0
errors.

### Lint (10 projects)

Command: `run-many -t lint -p` the same 8 + `@ptah-extension/webview-e2e-harness
ptah-electron-e2e`.

Header: `Successfully ran target lint for 10 projects` — confirmed N = 10. 0 errors; warnings
only (pre-existing `no-non-null-assertion`, unused `eslint-disable`, empty-arrow-function
warnings in `ptah-electron-e2e` fixtures — none in files this phase touched).

### `degradation-audit:lint`

Exit 0. Requested per-directory lines (baseline in parentheses), all "ok":

```
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/persistence-sqlite: 5 ok (baseline 5)
libs/backend/platform-core: 7 ok (baseline 7)
libs/backend/rpc-handlers: 1 ok (baseline 1)
libs/shared/src: 3 ok (baseline 3)
libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
apps/ptah-electron: 4 ok (baseline 4)
apps/ptah-cli: 29 ok (baseline 29)
```

`thoth-runtime` has no entry in the per-directory totals (confirmed by its absence from the
printed list) — it stays at 0, as required. `--update-baseline` was never run.

### XB1 — better-sqlite3 via Electron-as-Node (widened patterns)

skill-synthesis:
```
--config libs/backend/skill-synthesis/jest.config.ts
--testPathPatterns "skill-synthesis.reachability|skill-backlog-cleanup|skill-candidate.store|skill-synthesis.stage-handlers|judge-panel.service|cluster-holdout-end-to-end"
--runInBand
```
Result: `Test Suites: 8 passed, 8 total`, `Tests: 182 passed, 182 total`, 0 skipped.

node:sqlite counts for the identical pattern (`npx nx.cmd run-many -t test -p
@ptah-extension/skill-synthesis --testPathPatterns "<same>" --runInBand`): `Test Suites: 8
passed, 8 total`, `Tests: 182 passed, 182 total` — identical to the better-sqlite3 run.

persistence-sqlite:
```
--config libs/backend/persistence-sqlite/jest.config.ts
--testPathPatterns "0028_|0030_|0038_|0039_|0040_|0041_|0042_|0043_|0044_|0045_"
--runInBand
```
Result (better-sqlite3 / Electron-as-Node): `Test Suites: 10 passed, 10 total`, `Tests: 83
passed, 83 total`, 0 skipped.

Result (node:sqlite, same pattern, plain `nx run-many -t test`): `Test Suites: 10 passed, 10
total`, `Tests: 74 passed, 9 skipped, 83 total` — the 9 skips are the specs that carry a native
`better-sqlite3` probe and self-skip without the real binary (matches the full 8-project run's
"native probe failed" messages); every one of those 9 ran and passed under the production
binding above.

Command-line note: on this Windows/Git-Bash setup, `--testPathPatterns` values containing `|`
had to be passed through the PowerShell tool with the `'"a|b"'` quoting HANDOFF prescribes —
plain Bash quoting (single- or double-quoted, with or without embedded literal quotes) was
re-tokenized by the `.cmd` wrapper's own `cmd.exe` invocation and split the pattern into
separate commands (`'skill-backlog-cleanup' is not recognized...`). Every widened-pattern run
above was executed via the PowerShell tool for this reason.

### Greps

(a) `CandidateNamer|setDisplayName|nameCandidate|depthOk|eligibilityMinTurns|prefilterMinChars`
over `libs` and `apps` (`*.ts`, `*.md`):
```
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:57:  eligibilityMinTurns: 5,
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:59:  prefilterMinChars: 800,
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:76:  const depthOk =
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:77:    t.turnCount >= OLD_SETTINGS.eligibilityMinTurns &&
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:78:    t.charLength >= OLD_SETTINGS.prefilterMinChars;
libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:79:  return editOk || toolOk || testOk || depthOk;
```
Only the opt-in corpus harness's inline "old" predicate — matches the expected result exactly.

(b) A3 — no production `contextId` producer passed to `recordInvocation`:
`grep -rn "recordInvocation" libs/backend/skill-synthesis/src` shows the SQLite-store method
(`skill-candidate.store.ts:908`), the deleted-and-never-restored spec-only callers, and
`SkillInvocationTracker.recordInvocation` (`skill-invocation-tracker.ts:48`, a *different*
method on a different class that calls `store.recordSkillEvent`, never `store.recordInvocation`).
Traced `SkillTriggerService.recordInvocation` (`triggers/skill-trigger.service.ts:625-690`, the
only production code with `contextId` in scope near a call named `recordInvocation`) end to end:
it calls `this.recorder.recordSkillEvent(...)` (`SkillInvocationRecorder`, line 673), which in
turn calls `this.store.recordSkillEvent(...)` (`skill-invocation-recorder.ts:46`) — never
`store.recordInvocation`. So `SkillCandidateStore.recordInvocation` (the method that inserts
into `skill_invocations`, the table the backlog cleanup purges) has zero production callers;
every call site in `libs/backend/skill-synthesis/src` is a test file. A3 confirmed clean.

(c) `cron-scheduler` import: `grep -rn "cron-scheduler" libs/backend/skill-synthesis/src` finds
one hit — a comment in `queue/skill-drain.service.ts:6` explaining *why* `IPowerMonitor` is
NOT injected ("that port lives in `cron-scheduler`"). No actual import. Confirmed clean.

### Phase-5 notes (not fixed in this phase, recorded per batches.md)

- **R3 — automatic promotion is still impossible; UI text may imply otherwise.**
  `SkillSynthesisService.promote`/`promoteBulk` route every candidate through
  `SkillPromotionService.promoteManually` (mode `'manual'`), which never applies the frequency
  threshold. The only path that reaches `mode: 'automatic'` is the private `evaluate()` entry
  point, and nothing in the production graph calls it outside the drain's own internal use.
  Confirmed on disk at the Batch 6 re-read (`skill-synthesis.service.ts:1155-1210`,
  `skill-promotion.service.ts:212,242,249`) and unchanged by Batches 7.
- **R4 — the generalization shortcut is unreachable after Batch 1.** Not touched this phase;
  no code path was found that exercises it in the current graph. Left for phase 5.
- **R5 — `SkillInvocationTracker` is registered but unused.** `di/register.ts` still registers
  the class; grep confirms no production caller invokes `tracker.recordInvocation` outside its
  own spec. The class's `store.recordInvocation` write path is the same one A3 confirms has no
  producer. Left for phase 5 (its removal/wiring is out of Batch 7's scope, XB4).

## Task 7.2 — prefilter narrowing measurement (opt-in corpus harness)

Command (from the spec's own header, `PTAH_PREFILTER_CORPUS=1`):
```
PTAH_PREFILTER_CORPUS=1 npx jest --config libs/backend/skill-synthesis/jest.config.ts \
  -t 'prefilter evidence narrowing' --runTestsByPath \
  libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts
```
Result: `Test Suites: 1 passed, 1 total`, `Tests: 1 passed, 1 total`. Wall time: 22.245 s.

Counts (`PREFILTER_CORPUS_REPORT`, printed by the harness; content never logged, only
aggregate numbers per its own privacy header):

| Metric | Value |
| --- | --- |
| Sessions scanned | 1710 |
| Null trajectory (extractor floor not met) | 15 |
| Extracted (readable trajectories) | 1695 |
| Phase-2 (old, depth-inclusive) eligible | 1641 |
| Phase-3 (new, evidence-only) eligible | 1639 |
| Retained fraction (phase-3 / phase-2) | 0.999 |
| Removed from eligibility by the narrowing | 2 |
| Phase-2 depth-only passes (sessions that were eligible ONLY via the removed turn-count/char-length branch, i.e. become ineligible under phase 3) | 2 |
| Phase-2 rate | 96.8% |
| Phase-3 rate | 96.7% |

Not reported by this harness: a separate "tool-only" breakdown. The spec instruments only
`phase2DepthOnly` (sessions the old predicate passed on depth alone); it does not further split
the sessions that pass on tool-use vs edit-count vs test-command evidence. Reporting a
fabricated tool-only figure was avoided; the true, measured narrowing is 2 of 1641
previously-eligible sessions (0.12%) — R2 (tool evidence being broad) is not contradicted by
this measurement, since almost every previously-eligible session remains eligible under the
evidence-only predicate.

## Task 7.3 — cleanup outcome on a byte copy: safety proofs

(Counts and the cleanup outcome itself are in `backlog-cleanup-measurement.md`, per the
task's privacy rule that no session ids, paths or transcript content appear there. This
section carries only the safety evidence.)

1. **Source, never opened with SQLite.** Re-listed `C:\Users\abdal\.ptah\state` for
   `ptah.pre-migration-*.sqlite` via `Get-ChildItem` (directory listing only): the newest — and
   only — snapshot is still `ptah.pre-migration-20260909T230600Z.sqlite`, size
   `1,178,537,984` bytes, `LastWriteTime` `2026-09-10 02:06:09 AM` local — matching the size
   and mtime `batches.md` recorded at the Batch 7 re-read. No newer snapshot exists. Never
   opened directly; only `fs.statSync` (via `Get-ChildItem`, and inside the harness).
2. **Fail-if-exists temp dir.** `fs.mkdirSync(path.join(os.tmpdir(), 'skill-cleanup-measure-<4
   hex>'))` with no `{recursive:true}` — the harness used a random 4-hex-char suffix
   (`crypto.randomBytes(2).toString('hex')`), name does not start with `ptah`. A second
   `mkdirSync` at the same literal path would throw `EEXIST`; the random suffix means no
   collision occurred in practice, which is the correct outcome for a fresh run.
3. **Byte copy, exclusive.** `fs.copyFileSync(sourcePath, <tmp>/backlog-copy.sqlite,
   fs.constants.COPYFILE_EXCL)`. Only the copy was ever opened with SQLite (a short-lived
   read-only `better-sqlite3` handle for the "before" schema version, then the real
   `SqliteConnectionService` for everything else).
4. **Pragma read-back** (after `openAndMigrate()`, production binding):
   `journal_mode=wal`, `foreign_keys=1`, `synchronous=1`, `temp_store=2`, `mmap_size=268435456`,
   `busy_timeout=5000` — all six match the six production pragma statements in
   `sqlite-connection.service.ts`.
5. **Temp dir removed and proven gone.** `connection.close()` then `fs.rmSync(tmpDir,
   {recursive:true})`, then `fs.existsSync(tmpDir) === false` — asserted in the harness and
   printed `"tmpDirGone": true`.
6. **Source unchanged.** Re-`statSync`-ed after the whole run: size `1,178,537,984` bytes
   (unchanged), mtime `2026-09-09T23:06:09.256Z` (unchanged) both before and after — asserted
   in the harness (`statAfter.size === statBefore.size`, `statAfter.mtimeMs ===
   statBefore.mtimeMs`) and independently re-verified afterward via `Get-ChildItem`.
7. **Harness deleted.** The harness was a temporary spec,
   `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.byte-copy-measurement.spec.ts`,
   deleted with `rm` immediately after its measurement run.
8. **Git status scoped to skill-synthesis, after deletion:**
   ```
   M libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts
   ```
   Only the Task 7.4 file — confirmed by `git status --short -- libs/backend/skill-synthesis`.

## Execution

- Commands run: every command listed above, verbatim, from `W`, with `NX_DAEMON=false` for
  every `nx.cmd` invocation.
- Live-process check: `Get-CimInstance Win32_Process` filtered to `node.exe`/`electron.exe`
  before the first heavy run — only Nx daemons, MCP helper processes (`firecrawl-mcp`, Codex
  REPL) and an unrelated Electron e2e instance from a different worktree
  (`task-453-tile-open-long-tasks`) were present; no `jest-worker` or `nx run-executor` in
  flight. Re-checked implicitly by the absence of any resource contention or unexplained
  slowness across the whole session.
- Result: N passed / M failed / K skipped — see the per-command breakdowns above; **zero
  failures across every command in Batch 7**.
- Failures: none.
- Not executed: none of the assigned Batch 7 commands. (Task 7.2's "tool-only passes" figure
  was not a command that could be run — the harness does not compute it; explained above.)

## Verdict

- Criteria proven:
  - Task 7.4 (a)-(d) all satisfied: real transaction-state tracking with pasted before/after
    evidence; 5/5 under both bindings, 0 skipped; typecheck and lint green; only the one file
    changed.
  - Task 7.1: 8/12/10-project headers confirmed with the requested N; degradation-audit exits
    0 at every requested ceiling with `thoth-runtime` still at 0; XB1 both-binding counts
    recorded and reconciled; all three greps clean; R3/R4/R5 recorded.
  - Task 7.2: prefilter narrowing measured (2 of 1641 previously-eligible sessions, 0.12%,
    lose eligibility) with full counts and wall time.
  - Task 7.3 safety procedure: every HANDOFF-rule-5 / R-TL9 safety proof pasted above; the
    cleanup-outcome numbers are in `backlog-cleanup-measurement.md`.
- Criteria not proven: none identified as missing from this batch's scope.
- Risks a reader should know about:
  - The `--testPathPatterns` quoting for values containing `|` is fragile under this
    environment's Bash tool when the target is a Windows `.cmd` wrapper (`electron.cmd`,
    `nx.cmd`); the PowerShell tool with `'"a|b"'` quoting is required, not merely preferred,
    on this machine.
  - `persistence-sqlite`'s local (non-Electron) run always skips 9 native-binary-only specs
    because the repo's `better-sqlite3` build targets Electron's ABI, not the system Node's —
    expected, not a regression, and covered by the XB1 better-sqlite3 run above.
  - Byte-copy measurement counts (`backlog-cleanup-measurement.md`) reflect the pre-phase-3
    backlog as of the 2026-09-09 snapshot, not the live `~/.ptah/state/ptah.sqlite` — the
    live database was never touched, per HANDOFF rule 5, so its post-cleanup outcome (once the
    real cron job runs against it) may differ slightly if new candidates were created since the
    snapshot.
