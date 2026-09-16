# Batch 5 report — TASK_2026_461_639c

## Backend implementation — `TASK_2026_461_639c`, batch 5

**Tasks completed**: 5.1 cleanup DI; 5.2 cleanup cron job in both hosts; 5.3 candidate namer deletion and documentation corrections.

## Task 5.1 — cleanup DI token and registration

Files:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\di\tokens.ts` — added globally interned cleanup store/service tokens and removed the namer token.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\di\register.ts` — registered cleanup store/service singletons and token aliases; removed namer wiring.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\di\register.spec.ts` — resolves both cleanup tokens and pins their singleton aliases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\index.ts` — exports the cleanup store/service, all cleanup types, and the `BacklogCleanupReport` union; removes namer exports.

Result: `SKILL_BACKLOG_CLEANUP_STORE` and `SKILL_BACKLOG_CLEANUP_SERVICE` use `Symbol.for(...)`, are registered as singletons, and resolve through the public token registry.

## Task 5.2 — cleanup cron job and host reachability

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.ts` — shared job spec and per-run handler.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\skill-backlog-cleanup-job.spec.ts` — pins schedule, live inputs, skip/failure mapping, exact success summary, and `deferredOnError`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\start-thoth-cron.ts` — guarded Electron/shared-runtime registration with activity wrapping.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts` — reachability and absent-token assertions.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\src\index.ts` — exports the shared job definition, handler, and spec type.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts` — guarded CLI registration.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts` — CLI reachability and absent-token assertions.

Result: both hosts upsert `@ptah/skills-backlog-cleanup` and register `skills:backlog-cleanup` only when `SKILL_BACKLOG_CLEANUP_SERVICE` is registered. The handler maps skips directly, throws only the failed reason token, and summarizes `examined N, rejected N, kept N, invocations deleted N, deferred on error N`.

## Task 5.3 — namer deletion and documentation

Files:

- DELETED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\naming\candidate-namer.service.ts`.
- DELETED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\naming\candidate-namer.service.spec.ts`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts` — removed `setDisplayName`; retained `display_name` mapping.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-candidate.store.spec.ts` — removed the deleted method's specs.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\CLAUDE.md` — removed the namer and false depth-setting statement; documented evidence-only prefiltering, manual promotion, fake-invocation removal, and cleanup semantics/job.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\thoth-runtime\CLAUDE.md` — documented the fourth built-in job and shared handler contract.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\apps\ptah-docs\src\content\docs\skill-synthesis\settings.md` — removed the two deleted settings and reworded evidence thresholds; no prohibited trademarked names were added.
- The Task 5.1 barrel/DI files listed above also carry the namer removals.

Preserved by direct source check: migration column `display_name`, `SkillCandidateRow.displayName`, store row mapping, and readers in `skill-gap-curator.service.ts` and `trigger-eval.service.ts`.

## Stack observed

- Nx 22.6.5 monorepo; Node 24 from `package.json` / `.nvmrc`; TypeScript 5.9 strict project configs.
- Backend DI is tsyringe with `Symbol.for(...)` tokens and `register.ts` aliases (`CLAUDE.md`, skill-synthesis DI siblings).
- Host cron wiring is `IJobStore.upsert` plus guarded `IHandlerRegistry.register`; `memory-retention-job.ts` is the sibling implementation followed.
- Cleanup inputs are internal typed contracts; existing Zod validation remains at external RPC/file boundaries.

## Required verification

All commands ran from `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock` with `NX_DAEMON=false` and binaries from `D:\projects\ptah-extension\node_modules`. Before every test command, process inspection found no active Jest/Nx run process; persistent Nx daemon processes were excluded, and two short-lived plugin workers were allowed to exit before continuing.

### Tests — required run-many

Command:

```text
nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine
```

Header and totals:

```text
NX   Running target test for 3 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine

skill-synthesis: Test Suites: 6 skipped, 74 passed, 74 of 80 total
skill-synthesis: Tests: 37 skipped, 1507 passed, 1544 total
cli-engine: Test Suites: 19 passed, 19 total
cli-engine: Tests: 190 passed, 190 total
thoth-runtime: Test Suites: 6 passed, 6 total
thoth-runtime: Tests: 99 passed, 99 total
NX   Successfully ran target test for 3 projects
```

Jest printed its existing worker-force-exit teardown warning for all three projects, but every suite passed; this was not one of HANDOFF rule 8's named load failures, so no `--parallel=1` failure rerun was required.

### Typecheck — required run-many

Command:

```text
nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers
```

```text
NX   Running target typecheck for 4 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
- @ptah-extension/rpc-handlers
NX   Successfully ran target typecheck for 4 projects
```

### Lint — required run-many

Command:

```text
nx run-many -t lint -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine
```

Final run:

```text
NX   Running target lint for 3 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
thoth-runtime: All files pass linting
cli-engine: 0 errors, 1 pre-existing warning (cli-adapters.ts empty dispose)
skill-synthesis: 0 errors, 35 pre-existing warnings
NX   Successfully ran target lint for 3 projects
```

### XB1 — both SQLite bindings

Normal Node / `node:sqlite` command:

```text
nx test @ptah-extension/skill-synthesis --testPathPatterns '"skill-candidate.store"' --runInBand
Test Suites: 1 passed, 1 total
Tests: 80 passed, 80 total
```

Electron-as-Node / `better-sqlite3` command:

```text
$env:ELECTRON_RUN_AS_NODE='1'
& D:\projects\ptah-extension\node_modules\.bin\electron.cmd D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-candidate.store"' --runInBand
Test Suites: 1 passed, 1 total
Tests: 80 passed, 80 total
```

### XB2 — degradation audit

Command:

```text
nx run degradation-audit:lint
degradation-audit: scanned 2853 file(s)
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/thoth-runtime: absent from non-zero totals = 0
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

No baseline update was run.

### AC12 grep

Command and output:

```text
rg -n -g '*.ts' 'CandidateNamer|CANDIDATE_DISPLAY_NAME_MAX_CHARS|CANDIDATE_NAMING_JSON_SCHEMA|CandidateNaming|setDisplayName' libs apps
NO MATCHES
```

The retained `display_name`/`displayName` check found the expected schema/row mapping and readers only.

## Reachability mutations

### AC10-mut-E — remove the `startThothCron` registration call

Mutation: removed the production call to `registerSkillBacklogCleanupJob(...)` in `thoth-runtime/src/lib/start-thoth-cron.ts`.

Command:

```text
nx test @ptah-extension/thoth-runtime --testPathPatterns '"start-thoth-cron"' --testNamePattern 'skills backlog cleanup job' --runInBand
```

Failing output:

```text
FAIL thoth-runtime ... start-thoth-cron.spec.ts
● startThothCron › skills backlog cleanup job › upserts @ptah/skills-backlog-cleanup and registers skills:backlog-cleanup when its service is registered
Expected id: @ptah/skills-backlog-cleanup
Received id: @ptah/daily-backup
Number of calls: 1
Test Suites: 1 failed, 1 total
Tests: 1 failed, 31 skipped, 1 passed, 33 total
```

Restored output:

```text
NX   Successfully ran target test for project @ptah-extension/thoth-runtime
Test Suites: 1 passed, 1 total
Tests: 31 skipped, 2 passed, 33 total
```

### AC10-mut-C — remove the CLI registration call

Mutation: removed the production call to `registerSkillBacklogCleanupJob(container, logger)` in `cli-engine/src/lib/bootstrap/thoth-runtime.ts`.

Command:

```text
nx test @ptah-extension/cli-engine --testPathPatterns '"thoth-runtime.spec"' --testNamePattern 'skills backlog cleanup job reachability' --runInBand
```

Failing output:

```text
FAIL cli-engine ... thoth-runtime.spec.ts
● activateThoth — runtime tier › skills backlog cleanup job reachability › upserts @ptah/skills-backlog-cleanup and registers skills:backlog-cleanup when its service is registered
Expected id: @ptah/skills-backlog-cleanup
Received calls: @ptah/daily-backup, @ptah/skills-drain-frequent, @ptah/skills-drain-nightly, @ptah/skills-drain-weekly
Number of calls: 4
Test Suites: 1 failed, 1 total
Tests: 1 failed, 21 skipped, 1 passed, 23 total
```

Restored output:

```text
NX   Successfully ran target test for project @ptah-extension/cli-engine
Test Suites: 1 passed, 1 total
Tests: 21 skipped, 2 passed, 23 total
```

After both restorations, `git diff --stat` showed the intended Batch 5 files only; source grep showed both production call sites restored.

## Additional focused check

The first focused thoth-runtime compile exposed a spec-only Jest mock inference error (`'skipped'` was inferred outside the run-report mock type): 1 suite failed to compile while `start-thoth-cron.spec.ts` passed 33 tests. The mock was typed as `Promise<BacklogCleanupReport>` and the rerun passed:

```text
Test Suites: 2 passed, 2 total
Tests: 39 passed, 39 total
```

## Carried items and cross-batch rules

- Batch 4 revise: `deferredOnError` is present in the exact handler success summary and pinned by `skill-backlog-cleanup-job.spec.ts`.
- Batch 3 finding 1: removed both obsolete settings rows from the docs and reworded edit/tool thresholds as work-evidence predicates; table remains three columns.
- Batch 3 finding 2: removed the false `eligibilityMinTurns` clause from skill-synthesis documentation.
- Thoth jobs enumeration: added the backlog cleanup job to `thoth-runtime/CLAUDE.md` and its public API list.
- XB1: changed SQLite store spec passed under both bindings.
- XB2: no new degradation count and no baseline rewrite.
- XB3: every required multi-project gate used `run-many` and showed the requested 3/4/3 project header.
- XB4: no tracker, invocation-event promotion, extractor field, generalization shortcut, or cross-session clustering change.
- Registration performs no cleanup SQL; the service resolves and runs only when the scheduled handler fires.
- Completion ticks remain registered; the service's `skipped: complete` result maps directly to a skipped cron outcome.

## Plan deviations

None. The source matched the selected implementation plan and existing memory-retention registration pattern.

## Out-of-scope observations

- Existing lint warnings remain in skill-synthesis and `cli-adapters.ts`; no new warning remains in a changed file.
- The full Jest runs report existing force-exit teardown warnings despite passing all suites.

## Revise round 1

Addresses the three minor findings in `code-logic-review-batch-5.md`. All earlier Batch 5 changes are kept. Before any run, no jest or nx test process was alive: only idle nx daemons and unrelated MCP node processes were present.

### Fix 1: separate skip reasons for the service and the power monitor

- `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:36-57`: the single try/catch is now two. The service resolve failure returns `backlog-cleanup-service-unavailable` (`:45`). The power-monitor resolve failure returns `backlog-cleanup-power-monitor-unavailable` (`:55`). The service is resolved first, so a run that is missing both reports the service.
- Degradation-audit markers: the file had no markers before and needs none now. A catch that returns an object literal is not flagged (same as the `memory-retention-job.ts` sibling). Audit total for `thoth-runtime` is still 0. No marker was added, because a marker with no flagged site would be reported as an orphaned suppression.
- `libs/backend/thoth-runtime/src/lib/skill-backlog-cleanup-job.spec.ts`: the old single case was replaced by one case per token. `:136` covers a container with only the power monitor → `backlog-cleanup-service-unavailable`. `:149` covers a container with only the service → `backlog-cleanup-power-monitor-unavailable`, and `service.run` is not called.
- `libs/backend/thoth-runtime/CLAUDE.md`: not changed. It does not name the token (grep: the only `*-service-unavailable` token there is `retention-service-unavailable`).

### Fix 2: the singleton test now checks identity through the real registration

- `libs/backend/skill-synthesis/src/lib/di/register.spec.ts:44-70`: the `registerInstance` overwrite is gone. The test registers only the host tokens the constructor chain injects (`TOKENS.LOGGER`, `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `SDK_TOKENS.SDK_JSONL_READER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`), calls `registerSkillSynthesisServices`, resolves `SKILL_BACKLOG_CLEANUP_STORE` and `SKILL_BACKLOG_CLEANUP_SERVICE` twice each, and asserts `toBeInstanceOf` plus `toBe` identity. The constructors only store their arguments, so inert `{}` stubs are enough. The imports were added at the top of the spec (`:12-15`).
- Mutation: in `register.ts:67`, `container.registerSingleton(SkillBacklogCleanupStore)` was changed to `container.register(SkillBacklogCleanupStore, SkillBacklogCleanupStore)` (transient).

Mutated (`nx run-many -t test -p @ptah-extension/skill-synthesis --skip-nx-cache --testPathPatterns="register.spec"`):

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
● registerSkillSynthesisServices › resolves the backlog cleanup store and service tokens as singletons
  expect(received).toBe(expected) // Object.is equality
  Expected: {"connection": {}}
  Received: serializes to the same string
Test Suites: 1 failed, 1 total
Tests:       1 failed, 8 passed, 9 total
NX   Running target test for project @ptah-extension/skill-synthesis failed
```

Restored (same command):

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

### Fix 3: correct docs key count

- `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md:8`: "All 74" is now "All 78 `skillSynthesis.*` keys (46 named keys plus 8 fields for each of the 4 lanes)". No trademarked names were added.
- Count method, from `libs/backend/platform-core/src/file-settings-keys.ts`:
  - Explicit strings: a PowerShell scan of every line that matches `^\s*'(skillSynthesis\.[^']+)',\s*$` found 46 matches, all unique. They run from line 217 to line 361, which is inside the `FILE_BASED_SETTINGS_KEYS` `Set` that opens at `:154`. The defaults map uses `'key': value` lines, which the pattern does not match.
  - Generated keys: `...Object.keys(SKILL_LANE_SETTINGS_DEFAULTS)` (`:314`) expands `SKILL_LANE_DEFAULTS_FOR_FILE_ROUTING` (`:85-129`). That is 4 lanes (`archaeologist`, `synthesis`, `judge`, `replay`) × 8 fields (`provider`, `model`, `defaultTier`, `structuredOutput`, `toolUse`, `timeoutMs`, `maxInputChars`, `maxPasses`) = 32 keys.
  - Overlap: none. The lane sub-trees are `skillSynthesis.<lane>.<field>`, and no explicit key uses a lane id as its second segment (`replayValidation` is not `replay`).
  - Total: 46 + 32 = **78**, which matches the reviewer's independent count.

### Reachability mutation AC10-mut-E (re-run)

The `registerSkillBacklogCleanupJob(...)` call in `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:532-540` was replaced with `void registerSkillBacklogCleanupJob;`. The `void` keeps the function referenced so the failure comes from the assertion and not from an unused-symbol error.

Mutated (`nx run-many -t test -p @ptah-extension/thoth-runtime --skip-nx-cache --testPathPatterns="start-thoth-cron.spec"`):

```text
NX   Running target test for project @ptah-extension/thoth-runtime:
● startThothCron › skills backlog cleanup job › upserts @ptah/skills-backlog-cleanup and registers skills:backlog-cleanup when its service is registered
Test Suites: 1 failed, 1 total
Tests:       1 failed, 32 passed, 33 total
NX   Running target test for project @ptah-extension/thoth-runtime failed
```

Restored (same command):

```text
NX   Running target test for project @ptah-extension/thoth-runtime:
Test Suites: 1 passed, 1 total
Tests:       33 passed, 33 total
NX   Successfully ran target test for project @ptah-extension/thoth-runtime
```

After the restores, a grep for `MUTATION` and `register(SkillBacklogCleanupStore` in both mutated files found nothing. No mutation was left in place.

### Verification

All commands used `D:\projects\ptah-extension\node_modules\.bin\nx.cmd` with `NX_DAEMON=false` and `--skip-nx-cache`.

`nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine`:

```text
NX   Running target test for 3 projects:
skill-synthesis: Test Suites: 6 skipped, 74 passed, 74 of 80 total
skill-synthesis: Tests: 37 skipped, 1507 passed, 1544 total
thoth-runtime:   Test Suites: 6 passed, 6 total
thoth-runtime:   Tests: 100 passed, 100 total
cli-engine:      Test Suites: 19 passed, 19 total
cli-engine:      Tests: 190 passed, 190 total
NX   Successfully ran target test for 3 projects
```

thoth-runtime went from 99 to 100 because one spec case became two. skill-synthesis stays at 1544 because the singleton case was replaced, not added. The existing Jest worker force-exit warning was printed again, and every suite passed.

`nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers`:

```text
NX   Running target typecheck for 4 projects:
NX   Successfully ran target typecheck for 4 projects
```

`nx run-many -t lint -p @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/cli-engine`:

```text
NX   Running target lint for 3 projects:
✖ 35 problems (0 errors, 35 warnings)   # the existing skill-synthesis warnings
NX   Successfully ran target lint for 3 projects
```

No warning names a file changed in this round.

`nx run degradation-audit:lint` (baseline not updated):

```text
degradation-audit: scanned 2853 file(s)
  libs/backend/cli-engine: 12 ok (baseline 12)
  libs/backend/skill-synthesis: 6 ok (baseline 6)
  libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

`libs/backend/thoth-runtime` does not appear in the per-directory totals, so its count is 0. No orphaned-suppression report.

### Revise round 1: plan deviations

None.
