## Task 8.1

Status: DONE — tool evidence now counts only `tool_use` blocks whose string name does not start with `mcp__`; missing and non-string names count as non-MCP. The threshold remains 2, and edit/test-command evidence is unchanged. The backlog cleanup inherits the tightened predicate through `hasSessionWorkEvidence`.

### Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\trajectory-extractor.ts` — added and populated `nonMcpToolUseCount` without changing the existing counters.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\eligibility\session-work-evidence.ts` — changed only the tool-evidence branch to use the non-MCP count and documented the MCP exclusion.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\eligibility\session-work-evidence.spec.ts` — added MCP-only, non-MCP, mixed, and threshold-edge coverage.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\trajectory-extractor.spec.ts` — pinned 4 total / 2 non-MCP tools and missing/non-string-name behavior.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts` — retained the opt-in guard and added phase-3 untightened, tightened, and MCP-only-rejected aggregate counts. The corpus environment variable was not set and the measurement was not run.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\archaeology\regex-demotion.spec.ts` — added the required trajectory fixture field; no production text names the protected archaeology field.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts` — added the required trajectory fixture field only.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\gates\cluster-holdout-end-to-end.spec.ts` — added the required trajectory fixture field.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\gates\replay-validator.service.spec.ts` — added the required trajectory fixture field.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\gates\verdict-fallback.spec.ts` — added the required trajectory fixture field.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.enqueue.spec.ts` — added the required trajectory fixture field, including the rejection override.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.spec.ts` — added the required trajectory fixture field and preserved tool-evidence cases by matching the existing total count.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.stage-handlers.spec.ts` — added the required trajectory fixture field.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesizer.service.spec.ts` — added the required trajectory fixture field; production synthesizer use of `toolUseCount` was not changed.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\CLAUDE.md` — documented that prefilter tool evidence excludes MCP tools.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\apps\ptah-docs\src\content\docs\skill-synthesis\settings.md` — described `prefilterMinToolUses` as non-MCP tool calls without adding prohibited product names.

### Verification

- Focused new cases:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns='"session-work-evidence|trajectory-extractor"' --runInBand`
  - Header: `NX Running target test for project @ptah-extension/skill-synthesis`
  - Totals: `Test Suites: 2 passed, 2 total`; `Tests: 32 passed, 32 total`; exit 0.
- Reachability, Node `node:sqlite` binding:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns=skill-synthesis.reachability --runInBand`
  - Header: `NX Running target test for project @ptah-extension/skill-synthesis`
  - `Tests: 5 passed, 5 total`; `Test Suites: 1 passed, 1 total`; 0 skipped; exit 0.
- Reachability, Electron `better-sqlite3` binding:
  - Command: `$env:ELECTRON_RUN_AS_NODE='1'; D:\projects\ptah-extension\node_modules\.bin\electron.cmd D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-synthesis.reachability"' --runInBand`
  - `Tests: 5 passed, 5 total`; `Test Suites: 1 passed, 1 total`; 0 skipped; exit 0.
- Full tests:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --runInBand`
  - Header: `NX Running target test for project @ptah-extension/skill-synthesis`
  - Totals: `Test Suites: 6 skipped, 75 passed, 75 of 81 total`; `Tests: 37 skipped, 1517 passed, 1554 total`; exit 0. The skips are the repository's opt-in suites, including the corpus harness.
- Typecheck:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t typecheck -p @ptah-extension/skill-synthesis`
  - Header: `NX Running target typecheck for project @ptah-extension/skill-synthesis`
  - `Successfully ran target typecheck`; exit 0.
- Lint:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t lint -p @ptah-extension/skill-synthesis`
  - Header: `NX Running target lint for project @ptah-extension/skill-synthesis`
  - Totals: `35 problems (0 errors, 35 warnings)`; existing warnings only; target successful; exit 0.
- Degradation audit:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run degradation-audit:lint`
  - Header: `nx run degradation-audit:lint`
  - Line: `libs/backend/skill-synthesis: 6 ok (baseline 6)`; `TOTAL 303 unsuppressed site(s)` at recorded baselines; target successful; exit 0. No baseline update was run.
- Documentation gate:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd build ptah-docs`
  - Header: `nx run ptah-docs:build`
  - Totals: 32 screenshot references resolved, 156 pages built, target successful; exit 0. Existing non-fatal warnings: unsupported `gitignore` highlighting fallback, one unreferenced screenshot, and the existing `Entry docs → 404 was not found` message.
- Final scoped Ptah diagnostics: 0 errors, 0 warnings.
- `git diff --check`: exit 0.

### Mutation 8.1-mut

Applied the temporary mutation `trajectory.toolUseCount >= thresholds.prefilterMinToolUses`, then ran:

`$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns=session-work-evidence --runInBand`

Expected failure, exit 1:

```text
● hasSessionWorkEvidence › rejects an MCP-only session
Expected: false
Received: true

● hasSessionWorkEvidence › rejects one non-MCP tool mixed with ten MCP tools
Expected: false
Received: true

Test Suites: 1 failed, 1 total
Tests:       2 failed, 9 passed, 11 total
```

Restored `trajectory.nonMcpToolUseCount >= thresholds.prefilterMinToolUses` and re-ran the same spec:

```text
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
NX Successfully ran target test for project @ptah-extension/skill-synthesis
```

Post-restore `git diff --stat`:

```text
.../src/content/docs/skill-synthesis/settings.md   |  2 +-
libs/backend/skill-synthesis/CLAUDE.md             |  2 +-
.../src/lib/archaeology/regex-demotion.spec.ts     |  2 ++
.../cleanup/skill-backlog-cleanup.service.spec.ts  |  2 ++
.../lib/eligibility/session-work-evidence.spec.ts  | 40 ++++++++++++++++++++--
.../src/lib/eligibility/session-work-evidence.ts   |  7 ++--
.../lib/gates/cluster-holdout-end-to-end.spec.ts   |  1 +
.../src/lib/gates/replay-validator.service.spec.ts |  1 +
.../src/lib/gates/verdict-fallback.spec.ts         |  1 +
.../src/lib/prefilter-corpus-measurement.spec.ts   | 18 +++++++++-
.../lib/skill-synthesis.service.enqueue.spec.ts    |  2 ++
.../src/lib/skill-synthesis.service.spec.ts        | 15 +++++++-
.../src/lib/skill-synthesis.stage-handlers.spec.ts |  1 +
.../src/lib/skill-synthesizer.service.spec.ts      |  1 +
.../src/lib/trajectory-extractor.spec.ts           | 39 +++++++++++++++++++++
.../src/lib/trajectory-extractor.ts                | 14 ++++++--
16 files changed, 135 insertions(+), 13 deletions(-)
```

The mutation is not present in the final worktree.

### Risk handling

- R-TL10: added `nonMcpToolUseCount` to every `ExtractedTrajectory` fixture found under `libs/backend/skill-synthesis/src`; tool-dependent fixtures carry the same value as `toolUseCount`. Full project typecheck and all 1,517 active tests passed. The similarly named helper in `subagent-metrics-extractor.spec.ts` is a distinct transcript-builder option, not an `ExtractedTrajectory`, so it was correctly left unchanged.
- R-TL11: the reachability transcript still has independent Edit and Bash test-command evidence. The production reachability proof passed 5/5 with zero skipped tests under both SQLite bindings.

### Stack observed

Nx 22.6.5 / TypeScript 5.9.3 on Node 24; the product backend uses tsyringe wiring, while this change is an internal extracted-trajectory contract and evidence predicate with no new external boundary or dependency registration. Sources: root `package.json`, `libs/backend/skill-synthesis/project.json`, and `libs/backend/skill-synthesis/CLAUDE.md`.

### Plan deviations and out-of-scope observations

- Plan deviations: none. No settings key/schema/UI change, no synthesizer production change, no cleanup production change, and no corpus measurement run.
- Out-of-scope observations: none requiring action. Existing lint/docs warnings were recorded but not modified.

## Task 8.2

Status: DONE — backlog cleanup now rejects a candidate as transcript-unreadable only after at least one resolved workspace root caused `TrajectoryExtractor.extract` to be called and every attempted read returned no trajectory. Candidates for which no source session resolves a root are kept, counted in the per-run `keptRootUnknown` counter, and passed by the durable cursor without adding a rejection row.

### Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts` — added the root-unknown disposition and per-run progress counter, tracked whether extraction was attempted, and left persisted counters/rejection batching unchanged.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts` — added and documented `keptRootUnknown` as a non-persisted run counter, including the persisted-counter sum invariant.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts` — pinned all four required branches: no root, attempted unreadable read, mixed unknown/resolved roots, and empty source-session ids.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.integration.spec.ts` — added a real-SQLite candidate with NULL `workspace_root`, no queue fallback, and no verdict; it remains a candidate and increments `keptRootUnknown`.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` — appended the root-unknown per-run count to the cleanup summary without changing the persisted kept sum.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.spec.ts` — added the report field and pinned the new summary text.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts` — added `keptRootUnknown: 0` to the typed cleanup report fixture.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\CLAUDE.md` — documented that root-unknown candidates are kept and counted per run, not persisted.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\CLAUDE.md` — documented the root-unknown summary counter.

Migration `0045` and `SkillBacklogCleanupStore` were not changed.

### Verification

Before every test, run-many, and degradation-audit invocation, the process preflight returned `NO_ACTIVE_JEST_OR_NX_RUN_MANY`.

- Focused cleanup, Node `node:sqlite` binding:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns=skill-backlog-cleanup --runInBand`
  - Header: `NX Running target test for project @ptah-extension/skill-synthesis`
  - `Test Suites: 3 passed, 3 total`
  - `Tests: 22 passed, 22 total`
  - 0 skipped; exit 0.
- Focused cleanup, Electron `better-sqlite3` binding:
  - Command: `$env:ELECTRON_RUN_AS_NODE='1'; D:\projects\ptah-extension\node_modules\.bin\electron.cmd D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup"' --runInBand`
  - `Test Suites: 3 passed, 3 total`
  - `Tests: 22 passed, 22 total`
  - 0 skipped; exit 0.
- Restored service + integration mutation target:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns='"skill-backlog-cleanup.service.spec|skill-backlog-cleanup.integration.spec"' --runInBand`
  - Header: `NX Running target test for project @ptah-extension/skill-synthesis`
  - `Test Suites: 2 passed, 2 total`
  - `Tests: 17 passed, 17 total`
  - 0 skipped; exit 0.
- Full tests:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  - Header: `NX Running target test for 3 projects`
  - skill-synthesis: `Test Suites: 6 skipped, 75 passed, 75 of 81 total`; `Tests: 37 skipped, 1519 passed, 1556 total`.
  - cli-engine: `Test Suites: 19 passed, 19 total`; `Tests: 190 passed, 190 total`.
  - thoth-runtime: `Test Suites: 6 passed, 6 total`; `Tests: 100 passed, 100 total`.
  - Header confirmed 3 projects; target successful; exit 0. The skill-synthesis skips are the repository's existing opt-in suites.
- Typecheck:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  - Header: `NX Running target typecheck for 3 projects`
  - `NX Successfully ran target typecheck for 3 projects`; exit 0.
- Lint:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t lint -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine`
  - Header: `NX Running target lint for 3 projects`
  - thoth-runtime: all files pass.
  - cli-engine: 1 existing warning, 0 errors.
  - skill-synthesis: 35 existing warnings, 0 errors.
  - `NX Successfully ran target lint for 3 projects`; exit 0.
- Degradation audit:
  - Command: `$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run degradation-audit:lint`
  - Header: `nx run degradation-audit:lint`
  - `libs/backend/skill-synthesis: 6 ok (baseline 6)`
  - `libs/backend/cli-engine: 12 ok (baseline 12)`
  - `libs/backend/thoth-runtime` is absent from the nonzero per-directory totals, therefore 0.
  - `degradation-audit: TOTAL 303 unsuppressed site(s)`; target successful; exit 0. No new catch was added, no audit marker was needed, and `--update-baseline` was not run.

One initial mutation command used an unescaped PowerShell `|`; it exited before Nx started with `'skill-backlog-cleanup.integration.spec' is not recognized as an internal or external command`. It was immediately retried with the HANDOFF-required `\'"a|b"\'` argument shown below. No orphaned Nx/Jest process remained.

### Mutation 8.2-mut

Temporarily replaced the final disposition with:

```ts
return readable ? 'reject-no-evidence' : 'reject-unreadable';
```

Then ran:

`$env:NX_DAEMON='false'; D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns='"skill-backlog-cleanup.service.spec|skill-backlog-cleanup.integration.spec"' --runInBand`

Header: `NX Running target test for project @ptah-extension/skill-synthesis`.

Expected failure, exit 1:

```text
FAIL skill-backlog-cleanup.integration.spec.ts
Expected keptRootUnknown: 1; Received: 0
Expected rejectedTranscriptUnreadable: 1; Received: 2

FAIL skill-backlog-cleanup.service.spec.ts
SkillBacklogCleanupService › keeps a candidate when no source session resolves a workspace root
Expected keptRootUnknown: 1; Received: 0
Expected rejectedTranscriptUnreadable: 0; Received: 1

SkillBacklogCleanupService › warns once with only the candidate id when no source session is usable
Expected keptRootUnknown: 1; Received: 0
Expected rejectedTranscriptUnreadable: 0; Received: 1

Test Suites: 2 failed, 2 total
Tests:       3 failed, 14 passed, 17 total
```

Restored the attempted-read-aware ternary and re-ran the same command:

```text
Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total
NX Successfully ran target test for project @ptah-extension/skill-synthesis
```

The mutation is not present: the final source contains the `attempted` branch and the restored focused, both-binding, full-test, typecheck, lint, and degradation-audit runs all passed.

The requested post-restore `git diff --stat` was not executed because the backend-developer executor contract prohibits running git. As a non-git substitute, the nine absolute changed files are enumerated above; the restored source was verified by direct source inspection and the green mutation-target rerun. No staging, commit, branch, merge, push, history mutation, `nx reset`, or `--update-baseline` command was run.

### Decision and risk handling

- A7: `attempted` becomes true immediately before each `extractor.extract` call. No resolved root across all sessions, including an empty session list, yields `kept-root-unknown`; any resolved root followed by a null extraction yields `reject-unreadable`; a readable trajectory without evidence still yields `reject-no-evidence`; any verdict still returns before root inspection. All required branches are pinned by service specs.
- R-TL12: `keptRootUnknown` is intentionally excluded from `BacklogCleanupCounters` and `countDisposition`. The type documentation records that persisted kept + rejected counters equal `examined` minus run-summed `keptRootUnknown` and `deferredOnError`.
- R-TL13: `keptRootUnknown` lives only in `RunProgress`/`BacklogCleanupRunCounters`, starts at zero per invocation, and is emitted by `runCounters`; migration 0045 and the cleanup store remain frozen.
- Cursor behavior: root-unknown candidates still increment `examined` and `processed`, so the existing cursor advances past them while `rejectBatch` receives no row for that disposition.
- XB2: no catch was added, so no new `// degradation-audit:` marker was necessary. The audit stayed at the required ceilings.

### Stack observed

Nx 22.6.5 / TypeScript 5.9.3 on Node 24. Product-side dependency injection is tsyringe; the cleanup service depends on platform-core interfaces, existing stores, and the existing trajectory extractor. External boundary validation remains unchanged because this task adds no new boundary. Sources: root `package.json`, `libs/backend/skill-synthesis/CLAUDE.md`, and the existing cleanup service constructor/imports.

### Plan deviations and out-of-scope observations

- Plan deviations: no production-design deviation. The only verification deviation is the omitted git command required by the higher-priority executor contract, documented above.
- Existing full-suite worker teardown and lint warnings were observed and not changed. No out-of-scope production issue was modified.

## Task 8.3

Status: DONE — senior-tester re-verification and re-measurement. No production file changed
by this task. Pre-flight (`Get-CimInstance Win32_Process`) confirmed no live `jest-worker` /
`nx run-executor` before every heavy run; only Nx daemons, MCP helper processes, and an
unrelated Electron e2e instance from a different worktree (`task-453-tile-open-long-tasks`)
were present throughout.

### 1. Full re-verification (same project sets as Task 7.1)

**Test (8 projects)** — `npx nx.cmd run-many -t test -p @ptah-extension/skill-synthesis
@ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine
@ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared
@ptah-extension/skill-synthesis-ui`

Header: `NX Running target test for 8 projects:`, concluding `NX Successfully ran target test
for 8 projects` — confirmed N = 8. Zero failures across every suite:

| Project | Suites | Tests |
| --- | --- | --- |
| shared | 59 passed | 1521 passed |
| platform-core | 41 passed | 785 total, 4 todo, 781 passed |
| persistence-sqlite | 32 passed, 9 skipped (41 total) | 438 passed, 80 skipped (518 total) — local `node:sqlite` fallback; native-probe skips, covered by XB1 below |
| skill-synthesis | 75 passed, 6 skipped (81 total) | 1519 passed, 37 skipped (1556 total) — skips are the repo's existing opt-in suites |
| thoth-runtime | 6 passed | 100 passed |
| cli-engine | 19 passed | 190 passed |
| rpc-handlers | 101 passed | 3016 passed, 33 skipped |

**Typecheck (12 projects)** — `run-many -t typecheck -p` the same 8 +
`@ptah-extension/webview-e2e-harness ptah-electron-e2e ptah-electron ptah-cli`.
Header: `NX Running target typecheck for 12 projects:` → `NX Successfully ran target
typecheck for 12 projects` — confirmed N = 12. 0 errors.

**Lint (10 projects)** — `run-many -t lint -p` the same 8 +
`@ptah-extension/webview-e2e-harness ptah-electron-e2e`.
Header: `NX Running target lint for 10 projects:` → `NX Successfully ran target lint for 10
projects` — confirmed N = 10. 0 errors; warnings only (pre-existing `Unused eslint-disable
directive` / `no-non-null-assertion`-class warnings; none in files this batch touched).

**`degradation-audit:lint`** — `npx nx.cmd run degradation-audit:lint`, exit 0 (target
`Successfully ran target lint for project degradation-audit`). Requested lines, all at or
below baseline, identical to Batch 7:

```
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/backend/cli-engine: 12 ok (baseline 12)
```

`thoth-runtime` absent from the per-directory totals (stays 0, as required); `TOTAL 303
unsuppressed site(s)` — same total as Batch 7. `--update-baseline` never run.

**XB1 — better-sqlite3 via Electron-as-Node vs node:sqlite** (PowerShell, `'"a|b"'`
quoting):

skill-synthesis:
```
--config libs/backend/skill-synthesis/jest.config.ts
--testPathPatterns "skill-synthesis.reachability|skill-backlog-cleanup|skill-candidate.store|skill-synthesis.stage-handlers|judge-panel.service|cluster-holdout-end-to-end"
--runInBand
```
better-sqlite3 (Electron-as-Node): `Test Suites: 8 passed, 8 total`, `Tests: 184 passed, 184
total`. node:sqlite (`run-many -t test`, identical pattern): `Test Suites: 8 passed, 8 total`,
`Tests: 184 passed, 184 total` — identical to the better-sqlite3 run. (184 vs Batch 7's 182:
8.1/8.2 added 2 net cases to `skill-backlog-cleanup.service.spec.ts` /
`.integration.spec.ts`.)

persistence-sqlite:
```
--config libs/backend/persistence-sqlite/jest.config.ts
--testPathPatterns "0028_|0030_|0038_|0039_|0040_|0041_|0042_|0043_|0044_|0045_"
--runInBand
```
better-sqlite3 (Electron-as-Node): `Test Suites: 10 passed, 10 total`, `Tests: 83 passed, 83
total`. node:sqlite (same pattern, `run-many -t test`): `Test Suites: 10 passed, 10 total`,
`Tests: 9 skipped, 74 passed, 83 total` — the 9 skips are the native-`better-sqlite3`-probe
specs, identical shape to Batch 7. Both results match Batch 7 exactly.

**Greps:**

(a) `CandidateNamer|setDisplayName|nameCandidate|depthOk|eligibilityMinTurns|prefilterMinChars`
over `libs`/`apps` (`*.ts`,`*.md`) — only the opt-in corpus harness's inline "old" predicate in
`prefilter-corpus-measurement.spec.ts` (5 lines), unchanged shape from Batch 7.

(b) A3 — `recordInvocation` over `libs/backend/skill-synthesis/src`: the SQLite-store method
(`skill-candidate.store.ts:908`), test-only call sites, and
`SkillInvocationTracker.recordInvocation` (a different method that calls
`store.recordSkillEvent`, never `store.recordInvocation`). Zero production callers of
`SkillCandidateStore.recordInvocation` — confirmed clean, unchanged from Batch 7.

(c) `cron-scheduler` over `libs/backend/skill-synthesis/src` — one hit, the explanatory
comment in `queue/skill-drain.service.ts:6` (no import). Confirmed clean.

(d) `mcp__` in skill-synthesis production files (extractor + predicate only, no spec):
```
libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts:11: ... MCP tools (`mcp__*`) do
libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:93:  /** Count of tool_use blocks whose name does not start with `mcp__`. */
libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:360:      if (!toolName.startsWith('mcp__')) nonMcpToolUseCount++;
```
Only the documented non-MCP predicate and its doc comments — matches the expected result.

(e) `keptRootUnknown` over `libs` — present in exactly the 8.2 file set:
`skill-backlog-cleanup.service.ts`, `.types.ts`, `.service.spec.ts`, `.integration.spec.ts`,
`skill-synthesis/CLAUDE.md`, `thoth-runtime/skill-backlog-cleanup-job.ts`, `.spec.ts`, and
`cli-engine/bootstrap/thoth-runtime.spec.ts`. No stray hit outside the 8.2 file list.

### 2. Corpus re-measurement

Command (opt-in harness, from `W`):
```
PTAH_PREFILTER_CORPUS=1 D:/projects/ptah-extension/node_modules/.bin/jest.cmd \
  --config libs/backend/skill-synthesis/jest.config.ts -t 'prefilter evidence narrowing' \
  --runTestsByPath libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts
```
Result: `Test Suites: 1 passed, 1 total`, `Tests: 1 passed, 1 total`. Wall time: 19.7 s.

| Metric | Batch 7 | Batch 8 |
| --- | --- | --- |
| Sessions scanned | 1,710 | 1,691 |
| Null trajectory | 15 | 15 |
| Extracted | 1,695 | 1,676 |
| Phase-2 (old, depth-inclusive) eligible | 1,641 | 1,622 |
| Phase-3 UNTIGHTENED eligible (Batch 7's rule) | 1,639 | 1,620 |
| Phase-3 eligible (real, tightened, non-MCP only) | 1,639 (not yet tightened) | **1,609** |
| `mcpOnlyRejected` (passes untightened, fails tightened) | not measured | **11** |
| Phase-2 rate | 96.8% | 96.8% |
| Phase-3 rate | — | 96.0% |

The corpus is `~/.claude/projects` on the live workstation, so it has moved between Batch 7
(2026-09-16 run) and today (2026-09-17): fewer sessions scanned/extracted overall (live corpus
churn, not a defect), but the phase-2/phase-3-untightened pair (1,622 / 1,620, retained
0.999) tracks Batch 7's ratio (1,641 / 1,639, retained 0.999) closely. The NEW number this
batch adds is the real tightened predicate: 1,609 of 1,622 phase-2-eligible sessions remain
eligible once MCP-only tool use stops counting as evidence — 11 sessions
(`mcpOnlyRejected`) lose eligibility purely because their tool evidence was MCP calls only,
confirming decision 1 has a measurable, non-zero effect (unlike the untightened predicate,
which removed only 2 of 1,641 via the depth branch in Batch 7).

### 3. Byte-copy re-measurement

Procedure followed verbatim (HANDOFF rule 5 / R-TL9): source snapshot re-listed via
`fs.readdirSync` + `fs.statSync` only (never opened directly); newest
`ptah.pre-migration-*.sqlite` unchanged from Batch 7 (`1,178,537,984` bytes,
`2026-09-09T23:06:09.256Z`); fresh fail-if-exists temp dir
`skill-cleanup-measure-<4 hex>` (`fs.mkdirSync`, no `{recursive:true}`); byte copy via
`fs.copyFileSync(..., COPYFILE_EXCL)`; only the copy ever opened; real
`SqliteConnectionService` constructed directly (not through DI), `.configure({
vecPathResolver: null, vecPathPlatformResolver: null, vecPathFallbackResolver: null })`, no
backup service registered; `openAndMigrate()` run under Electron-as-Node (the production
`better-sqlite3` binding); the real cleanup service stack built by hand in the same
constructor order as `cleanup/skill-backlog-cleanup.service.ts` (`SkillCandidateStore`,
`SkillQueueStore`, `SessionVerdictStore`, `SkillBacklogCleanupStore`, a real
`TrajectoryExtractor` wrapping a real `JsonlReaderService` in a timing proxy,
`ForegroundActivityTracker`, a fake `IWorkspaceProvider` zeroing `bootDeferralMs`); `run()`
looped until `{status:'skipped', reason:'complete'}`. Harness:
`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.byte-copy-measurement.spec.ts`,
a temporary opt-in spec (`PTAH_BACKLOG_BYTE_COPY=1`), deleted immediately after its one run.

Command:
```
$env:ELECTRON_RUN_AS_NODE='1'; $env:PTAH_BACKLOG_BYTE_COPY='1'
electron.cmd jest.js --config libs/backend/skill-synthesis/jest.config.ts \
  --testPathPatterns '"skill-backlog-cleanup.byte-copy-measurement"' --runInBand
```
Result: `Test Suites: 1 passed, 1 total`, `Tests: 1 passed, 1 total`. Time: 13.985 s.

- Pragma read-back (all six match production): `journal_mode=wal`, `foreign_keys=1`,
  `synchronous=1`, `temp_store=2`, `mmap_size=268435456`, `busy_timeout=5000`.
- Schema before 41 (unchanged source), after 45. Migration wall time this run: 5,154 ms
  (one-time boot cost on the 1.1 GB file; Batch 7 measured 1,221 ms and 7,612 ms on two runs —
  host-variance range, not a regression signal).
- Examined: **2,418** (identical to Batch 7 — source snapshot unchanged).
- Ticks to completion: **13** (identical count to Batch 7); the 14th call returned
  `{status:'skipped', reason:'complete'}`, not counted as a tick.
- Wall time per tick: min 16 ms, median 25 ms, max 916 ms.
- Largest single transcript read: **147 ms**.
- Final counters (state row, cumulative): kept-evidence 109, kept-verdict 174,
  kept-degraded-verdict 265, rejected-no-evidence 0, rejected-transcript-unreadable **317**,
  invocations-deleted 2,424.
- `keptRootUnknown` (per-run, summed across all 13 ticks): **1,553**.
- `deferredOnError` (per-run, summed): **0**.
- Sum check: `examined - (keptEvidence + keptVerdict + keptDegradedVerdict +
  rejectedNoEvidence + rejectedTranscriptUnreadable + summedKeptRootUnknown +
  summedDeferredOnError)` = `2,418 - (109+174+265+0+317+1,553+0)` = **0**. Holds exactly.
- Cross-check against `SkillBacklogCleanupStore.readState()`: the persisted counters read
  back from the state row after completion match the `run()` cumulative report field-for-field
  (`examined 2418`, `invocationsDeleted 2424`, etc. — identical values used above).
- Independent, read-only recomputation (mirrors `evaluateCandidate`'s own branch order — no
  verdict on any source session AND no source session resolves a workspace root — without
  touching production code): 1,553 rows recomputed as root-unknown (matches
  `summedKeptRootUnknown` exactly) and 317 rows recomputed as rejected-unreadable (matches
  `rejectedTranscriptUnreadable` exactly).

**Accepted-risk check (Batch 4 finding 2, re-run under the new predicate):**

| Metric | Batch 7 | Batch 8 |
| --- | --- | --- |
| Rejected-transcript-unreadable candidates | 1,859 | **317** |
| ...of which have >=1 session file present on disk | 13 | **0** |
| Kept-root-unknown candidates | (did not exist) | 1,553 |
| ...of which have >=1 session file present on disk | — | **13** |

All 13 of Batch 7's "unreadable but a transcript file exists" candidates are, by id match
inside this harness (ids not printed), now classified `kept-root-unknown` rather than
rejected — decision 2 closed exactly the accepted-risk gap it targeted. The remaining 317
true-unreadable candidates (root resolved, read attempted, extractor returned nothing) have
**zero** with a file present on disk in this run, i.e. the EBUSY-vs-ENOENT ambiguity Batch 4
accepted as a risk no longer has any observable false-positive on this snapshot.

**Safety proofs:**
- Source never opened with SQLite; only `fs.statSync`/`fs.readdirSync`.
- Fail-if-exists temp dir name did not start with `ptah`; no `{recursive:true}`.
- Byte copy via `COPYFILE_EXCL`; only the copy opened.
- Six production pragmas read back and matched (above).
- Connection closed, then `fs.rmSync(tmpDir, {recursive:true})`; `fs.existsSync(tmpDir)`
  asserted `false` by the harness itself (test passed).
- Source re-`statSync`-ed after the run: size `1,178,537,984` bytes (unchanged), mtime
  `2026-09-09T23:06:09.256Z` (unchanged) — asserted by the harness (test passed).
- Harness deleted immediately after its one run
  (`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.byte-copy-measurement.spec.ts`).
- `git status --short -- libs/backend/skill-synthesis` after deletion shows only the 8.1/8.2
  files (`CLAUDE.md`, `archaeology/regex-demotion.spec.ts`, `cleanup/*.ts`/`*.spec.ts` (4),
  `eligibility/session-work-evidence.{ts,spec.ts}`, `gates/*.spec.ts` (3),
  `prefilter-corpus-measurement.spec.ts`, `skill-synthesis.service*.spec.ts`,
  `skill-synthesis.stage-handlers.spec.ts`, `skill-synthesizer.service.spec.ts`,
  `trajectory-extractor.{ts,spec.ts}`) — no harness file remains.

### Execution

- Commands run: every command listed above, verbatim, from `W`, `NX_DAEMON=false` for every
  `nx.cmd` invocation. Live-process preflight (`Get-CimInstance Win32_Process`) run before
  every heavy command; no live `jest`/`nx run-executor` at any point.
- Result: zero failures across every command in Task 8.3.
- Not executed: none of the assigned Task 8.3 commands.
- One operator error, corrected before any measurement: an initial attempt to run the corpus
  harness accidentally launched `electron.cmd` with no arguments (the full Electron GUI
  app, not the jest binary) in the background; it was killed
  (`taskkill /F /T` on the spawned tree) before any test ran, and the process list was
  re-verified clean before proceeding. No measurement command was affected.

### Verdict

- Criteria proven: all Task 8.3 verification headers confirmed with the requested N (8/12/10
  projects); degradation-audit exits 0 at every requested ceiling, identical to Batch 7's
  baselines; XB1 both-binding counts identical between bindings; all five greps clean; corpus
  re-measurement shows the tightened predicate removing 11 MCP-only-evidence sessions
  (`mcpOnlyRejected`) that the untightened predicate kept; byte-copy re-measurement shows the
  sum-check holding exactly, `keptRootUnknown` and `deferredOnError` correctly summed across
  ticks and cross-checked by independent recomputation, and the Batch 4 accepted-risk gap
  (13 unreadable-rejected candidates with a transcript on disk) fully closed by decision 2.
- Criteria not proven: none identified as missing from this batch's scope.
- Risks a reader should know about: the corpus is live and changes daily, so the raw
  scanned/extracted/eligible counts are not directly comparable in absolute terms across days
  — the retained-fraction and `mcpOnlyRejected` figures are the load-bearing comparisons, and
  both behave as decision 1 predicts. The migration wall-time range (1.2 s–7.6 s across three
  independent runs on this shared machine) remains host-variance, not a regression signal.
