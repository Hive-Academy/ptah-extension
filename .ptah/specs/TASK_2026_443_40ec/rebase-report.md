# TASK_2026_443_40ec — rebase report (phase 2 onto PR #513 head)

## Verdict

Rebase complete: 7 commits replayed onto `bd149c305`. One text conflict (docs), resolved as a union.
One semantic conflict (specs only): two #513-added spec harnesses still passed the `SalienceScorer`
argument that Batch 3 removes. It is fixed in the working tree, UNCOMMITTED (see Decisions). With that
fix, typecheck, tests, lint, the Electron-Node SQLite suites and the removed-symbol grep are all green.

## SHAs

- Old head: `90537344f` (reflog `HEAD@{2}` before rebase start; old base `5e34e39cc`)
- New base: `bd149c305` (PR #513 head)
- New head: `de44ecec036cee97f377b0bbb39cb685d134d934`

```
git log --oneline bd149c305..HEAD
de44ecec0 docs(task-specs): record TASK_2026_443 batch 3 revision and completion
2e09de37e feat(memory-curator): batch 3 - rank by salience at query time and record memory use explicitly
07475e316 docs(task-specs): record TASK_2026_443 batch 1-4 reports, reviews and batch state
5b40b025b feat(agent-sdk,vscode-lm-tools): batch 4 - record memory use for injected and MCP search hits
49708b9c3 feat(persistence-sqlite): batch 1 - migration 0044 memory lifecycle column, indexes and salience rebase
3ff57abd6 feat(memory-contracts,platform-core): batch 2 - memory usage recorder port and lifecycle settings keys
91ee6d9af docs(task-specs): open TASK_2026_443 phase 2 memory lifecycle and its follow-ups
```

The subjects match `git log 5e34e39cc..90537344f` one for one (7/7).
`git range-diff`: commits 1, 3, 4, 5 and 7 are `=`. Commits 2 and 6 are `!`, with context-only
differences: the CLAUDE.md union below, and the `CuratorCallOptions` import/constructor context from
#513 in `memory-curator.service.ts`. No phase 2 hunk was dropped.

Hooks ran on each commit. None failed, and no `--no-verify` was used.

## Migration numbering

`git ls-tree bd149c305` has migrations up to `0042_db_integrity_check_state` (main) and
`0043_memory_retention` (phase 1). It has no `0044`. The only `0044` is phase 2's
`0044_memory_lifecycle.{ts,spec.ts}`. There is no collision.

`nx reset`: not run. `git diff 5e34e39cc 90537344f -- '**/project.json'` is empty, and no reset was needed.

## Conflicts

### 1. `libs/backend/memory-contracts/CLAUDE.md` (commit 2/7, `0ecab63b3`), text conflict

- **HEAD (#513 / TASK_2026_437 C14):** `ICuratorLLM` gains `(+ CuratorCallOptions)`. The
  `curator-llm.port.ts` line documents `CuratorStallReason` (`provider-cooling-down` /
  `provider-unreachable`) and `CuratorCallOptions { userInitiated? }`.
- **Phase 2 (Batch 2):** adds `IMemoryUsageRecorder` to Interfaces, adds `MEMORY_USAGE_RECORDER` to Tokens,
  and adds a `memory-usage-recorder.port.ts` structure line.
- **Resolution:** a union. The Interfaces list has `IMemoryUsageRecorder` and `ICuratorLLM (+ CuratorCallOptions)`.
  The Tokens line keeps phase 2's `(including MEMORY_USAGE_RECORDER)`. The structure list has the
  phase 2 recorder-port line, followed by #513's full `curator-llm.port.ts` line.

### 2. Semantic conflict: specs added by #513 construct `MemoryCuratorService` with the removed scorer

The textual merge was clean, and `typecheck` passed because it excludes specs. The first full test run then failed:

```
FAIL memory-curator libs/backend/memory-curator/src/lib/memory-curator.admission.spec.ts
  ● Test suite failed to run
    memory-curator.admission.spec.ts:32:37 - error TS2307: Cannot find module './salience-scorer' or its corresponding type declarations.
    memory-curator.admission.spec.ts:99:5 - error TS2554: Expected 5-10 arguments, but got 11.
FAIL memory-curator libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
  ● Test suite failed to run
    memory-curator.service.spec.ts:1836:52 - error TS2304: Cannot find name 'SalienceScorer'.
    memory-curator.service.spec.ts:1837:7 - error TS2345: Argument of type 'ITranscriptReader' is not assignable to parameter of type 'ICuratorLLM'.
Test Suites: 2 failed, 2 skipped, 36 passed, 38 of 40 total
```

- **#513 intent:** `memory-curator.admission.spec.ts` (governor admission, FU-16b-a) and the
  `userInitiated reaches every curator LLM call` describe block in `memory-curator.service.spec.ts` (C14).
  Both were written against the pre-phase-2 constructor
  `(logger, registry, store, scorer, transcriptReader, llm, ...)`.
- **Phase 2 intent:** Batch 3 deletes `salience-scorer.ts` and removes the `scorer` constructor parameter
  and `MemoryStore.updateSalience`. In its own commit it removed exactly these three things from every
  existing harness: the `SalienceScorer` import, the `scorer` argument, and the `updateSalience: jest.fn()` mock.
- **Resolution:** I applied Batch 3's same mechanical edit to the two harnesses that #513 added. The
  change has 5 deleted lines and no added lines:
  - `memory-curator.admission.spec.ts`: removed the `SalienceScorer` import, the `updateSalience` mock, and the
    `{ score: ... } as unknown as SalienceScorer` argument. The governor stays in position 10 of the new
    10-parameter list: logger, registry, store, reader, llm, null, null, null, undefined, governor.
  - `memory-curator.service.spec.ts` (~L1834-1836): removed the `updateSalience` mock and the scorer argument.
  - No test was removed and no assertion was changed.

## Decisions for the orchestrator

1. **Where the conflict 2 fix goes in the history (it is uncommitted now).** The two spec edits are in the
   working tree and are not staged. The brief authorises only resolving conflicts during the rebase, and
   this problem was found after `rebase --continue` finished. The logically correct home is Batch 3
   (`2e09de37e`), because that commit is the one that breaks these harnesses. The options are:
   - (a) a `fixup!` commit for `2e09de37e`, then a non-interactive autosquash. This keeps each commit's tests green.
   - (b) a separate commit on top, for example `test(memory-curator): drop removed salience scorer from #513 curator harnesses`.

   Until one is done, commit `2e09de37e` on its own does not compile its specs.
2. No design decision was needed for either conflict. Neither conflict needed new behaviour.

## Intent spot-checks (post-rebase)

- `memory-curator.service.ts` still injects `TOKENS.BACKGROUND_WORK_GOVERNOR` (optional) into
  `CuratorPassAdmission` (L169-197). It still has the background-pass governor wait (L320) and the
  promote path (L354). It also imports `baseSalience` from `./salience-ranking` (phase 2).
- The retention governor wait is covered by `memory-retention.service.spec.ts` (`FakeGovernor`) and
  `memory-retention.integration.spec.ts` ("waits on governor before purging rows from real SQLite").
  Both passed under Electron Node (see below).

## Verification

### Typecheck (7 projects)

```
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite @ptah-extension/memory-contracts @ptah-extension/platform-core @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools @ptah-extension/thoth-runtime
 NX   Running target typecheck for 7 projects:
 NX   Successfully ran target typecheck for 7 projects
```

This passed both before and after the spec fix. The spec files are not in the typecheck scope.

### Test (7 projects). `ptah-electron` is the `name` in `apps/ptah-electron/project.json`

Run 1 was before the spec fix and failed:

```
 NX   Running target test for 7 projects and 6 tasks they depend on:
platform-core:  FAIL src/file-settings-manager.bench.spec.ts (47.54 s)  thrown: "Exceeded timeout of 30000 ms for a test."
                Test Suites: 1 failed, 40 passed, 41 total
                Tests:       1 failed, 4 todo, 780 passed, 785 total
memory-curator: 2 suites failed to run (conflict 2 above)
                Test Suites: 2 failed, 2 skipped, 36 passed, 38 of 40 total
 NX   Running target test for 7 projects and 6 tasks they depend on failed
```

Run 2 was after the spec fix, with `--skip-nx-cache` and default parallelism. It passed:

```
 NX   Running target test for 7 projects and 6 tasks they depend on:
@ptah-extension/platform-core       Test Suites: 41 passed, 41 total            Tests: 4 todo, 781 passed, 785 total
@ptah-extension/persistence-sqlite  Test Suites: 9 skipped, 31 passed, 31 of 40 Tests: 80 skipped, 430 passed, 510 total
@ptah-extension/vscode-lm-tools     Test Suites: 50 passed, 50 total            Tests: 1161 passed, 1161 total
@ptah-extension/agent-sdk           Test Suites: 2 skipped, 110 passed, 110 of 112 Tests: 3 skipped, 1955 passed, 1958 total
@ptah-extension/thoth-runtime       Test Suites: 5 passed, 5 total              Tests: 90 passed, 90 total
@ptah-extension/memory-curator      Test Suites: 2 skipped, 38 passed, 38 of 40 Tests: 59 skipped, 589 passed, 648 total
ptah-electron                       Test Suites: 2 skipped, 45 passed, 45 of 47 Tests: 7 skipped, 631 passed, 638 total
 NX   Successfully ran target test for 7 projects and 6 tasks they depend on
```

The platform-core bench timeout in run 1 was a parallel-load flake. It passed in run 2 without
`--parallel=1`, so no separate rerun was needed. The skipped suites under plain Node are the native
better-sqlite3 suites ("native probe failed; suite skipped"). The Electron-Node runs below cover them.

### Lint

```
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite @ptah-extension/memory-contracts @ptah-extension/platform-core @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools
 NX   Running target lint for 5 projects:
✖ 9 problems (0 errors, 9 warnings)
✖ 42 problems (0 errors, 42 warnings)
✖ 21 problems (0 errors, 21 warnings)
✖ 5 problems (0 errors, 5 warnings)
 NX   Successfully ran target lint for 5 projects
```

The header says 5 because `@ptah-extension/memory-contracts` has no `lint` target. Its targets are
`eslint:lint, build, typecheck`. I ran it separately:

```
npx nx run @ptah-extension/memory-contracts:eslint:lint
 NX   Successfully ran target eslint:lint for project @ptah-extension/memory-contracts
```

The lint run happened after the spec fix, so the edited specs were linted. It reported 0 errors.

### Removed-symbol grep (`recordHit|updateSalience|SalienceScorer|scoreMemory`)

Production code in `libs/` and `apps/`, excluding specs and markdown, has **no hits**.

With specs included, the only hits are the two token-name strings that phase 2's original head also
had (identical at `90537344f`):

- `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts:41` — `MEMORY_SALIENCE_SCORER: Symbol.for('PtahMemorySalienceScorer')`
- `libs/backend/memory-curator/src/lib/di/register.spec.ts:100` — asserts that the scorer token is NOT registered

`MemoryDecayJob` is still present until Batch 9. It is referenced in:
`libs/backend/memory-curator/src/index.ts`, `src/lib/di/register.ts`, `src/lib/di/tokens.ts`,
`src/lib/diagnostics.service.ts`, `src/lib/memory-curator.service.ts`, `src/lib/memory-decay.job.ts`,
the specs `memory-decay.job.spec.ts`, `diagnostics.service.spec.ts` and
`apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`, and `libs/backend/memory-curator/CLAUDE.md`.

### better-sqlite3 under Electron's Node

memory-curator, pattern `src/lib/retention|di/register|memory.store.spec|salience-ranking|memory-search.service.spec`, `--runInBand`.
It matched 7 suites: retention integration, retention service, observation-retention store, register, memory.store,
salience-ranking and memory-search.service.

```
Test Suites: 7 passed, 7 total
Tests:       152 passed, 152 total
```

persistence-sqlite, pattern `0044_memory_lifecycle`, `--runInBand`:

```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

## Working tree state

```
 M libs/backend/memory-curator/src/lib/memory-curator.admission.spec.ts   (conflict 2 fix, uncommitted)
 M libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts     (conflict 2 fix, uncommitted)
?? .ptah/specs/TASK_2026_450_8383/                                        (unrelated, untouched)
?? .ptah/specs/TASK_2026_443_40ec/rebase-report.md                        (this report)
```

Nothing was pushed or stashed, and main was not touched.

## Out-of-scope observations

- `libs/backend/memory-curator/CLAUDE.md` still names `SalienceScorer` and `src/lib/salience-scorer.ts` (L32, L42, L80).
  This text is the same at the original phase 2 head `90537344f`, so the rebase did not cause it. It is
  stale documentation for a later docs batch.
