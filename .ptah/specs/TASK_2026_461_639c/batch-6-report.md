# Batch 6 report — reachability proof

## Backend implementation — `TASK_2026_461_639c`, batch 6

**Tasks completed**: 6.1 real-container harness; 6.2 scenario groups 1–5 and mutation proofs M1–M5.

## Files created

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.reachability.integration.spec.ts` — five ordered integration groups proving production DI registration, session-end enqueue, frequent drain, evidence-only prefilter/reuse, automatic below-threshold behavior, and manual promotion.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.reachability.test-support.ts` — transcript/workspace fakes and the A1 node:sqlite lifecycle adapter for the shared `resolveOpener()` binding.

No production source remains modified. The optional test-support extraction was used because container/database/fixture setup is 176 lines; the spec is 336 lines.

## Stack observed

- TypeScript 5.9.3, Jest 30, Nx 22.6.5, and tsyringe 4.10 (`package.json`).
- Production wiring is `registerSkillSynthesisServices(container, logger)` with tsyringe symbol tokens (`src/lib/di/register.ts`).
- Persistence is the real `SqliteConnectionService.openAndMigrate()` and migrations through 0045 (`persistence-sqlite/src/lib/sqlite-connection.service.ts`, `src/lib/migrations`).
- Untrusted production boundaries use Zod; this test supplies already-shaped in-process fakes and introduces no boundary or production validation path.

## Final host token set

Only host-owned tokens were bound; every skill-synthesis class came from production registration.

- `TOKENS.LOGGER` — required by the real connection and all reachable registered services.
- `PERSISTENCE_TOKENS.SQLITE_DB_PATH` — points the real connection at the per-test temporary SQLite file.
- `PERSISTENCE_TOKENS.SQLITE_CONNECTION` — aliases the container-resolved real `SqliteConnectionService` singleton.
- `PERSISTENCE_TOKENS.VEC_STATUS` — `{ available: false }`, disabling vector-only paths while retaining relational SQLite.
- `PLATFORM_TOKENS.WORKSPACE_PROVIDER` — serves the temporary roots and settings map: enabled, active/candidate roots, judge enabled, prefilter defaults 1/2, and curator disabled to prevent an unrelated timer; no drain gate override is supplied.
- `SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY` — captures the production callback registered by `start()` and supplies its disposer.
- `SDK_TOKENS.SDK_JSONL_READER` — returns the three in-memory fixture transcripts through the real extractor API.
- `SDK_TOKENS.SDK_CURATOR_RATE_LIMIT` — required to resolve the production curator reachable from `SkillSynthesisService`; no pass runs because curator is disabled.
- `INTERNAL_QUERY_SERVICE_TOKEN` — the `makeQueryStub`-based fake internal-query lane.
- `USER_LAYER_MIRROR_SERVICE_TOKEN` — the one additional V5 resolution dependency: the registered curator resolves the registered enhancer, whose mirror dependency is non-optional; it is never invoked by this proof.

`SKILL_BACKLOG_CLEANUP_STORE` and `SKILL_BACKLOG_CLEANUP_SERVICE` were not resolved.

### Fake-lane discrimination

The fake is created with `makeQueryStub([])` and replaces that stub's `execute` implementation while preserving its call ledger. It identifies judge requests by the production judge rubric in `systemPromptAppend` (`Evaluate the synthesized skill`). Those requests receive the five-criterion scorecard with every score equal to 8; every other request is the synthesis request and receives the reusable skill draft. Group 4 snapshots calls matching that same judge rubric immediately before automatic evaluation and proves the count does not change.

## A1 result

`resolveOpener()` supports both bindings, but its deliberate queue-test surface omits members the real connection uses. better-sqlite3 already carries `pragma`, `open`, `inTransaction`, `transaction`, and statement `iterate`, so it passes through unchanged. node:sqlite required the test-only adapter in `skill-synthesis.reachability.test-support.ts`; it supplies those lifecycle members over the exact `resolveOpener()` handle. Production code was not changed. `SqliteConnectionService.configure()` receives that factory and all three vec resolvers as `null`, then `SkillSynthesisService.start()` performs the real open and all migrations.

## Hash-normalisation finding

`TrajectoryExtractor` compiles each workspace root once and replaces every occurrence with `<WORKSPACE>` before hashing the role-tagged canonical turns. The `s-alpha` and `s-beta` fixtures differ only in `ws-a` versus `ws-b`, including the Edit path, Bash `cd` path, and text. Group 1 calls the real extractor for both and proves the hashes are equal before firing the production session-end callback.

## Scenario evidence

1. `start()` registered stage handlers and the session-end callback, opened/migrated the real database, and all three fire-and-forget enqueues appeared under a bounded poll.
2. The real `SKILL_DRAIN_SERVICE` drained `tier: 'frequent'` in a bounded loop. Every pass with queued prefilter work had to reduce the queued count.
3. Exactly one candidate remained: `candidate`, success count 0, `source_session_ids = ["s-alpha"]`. Alpha was done; beta was done with `reused existing candidate`; chat was skipped with `no candidate from this session`; chat had no archaeology/judge-panel/trigger-eval rows; `skill_invocations` stayed empty.
4. Real automatic `evaluate` returned `below-threshold`, made zero new judge calls, and left the row a candidate.
5. Real `synthesis.promote(..., { userInitiated: true })` returned `promoted`, persisted `status='promoted'` and `judge_status='scored'`, and materialized the active `SKILL.md`.

The proof intentionally makes no automatic-promotion claim.

## Mutation evidence

Every mutation was applied to production, the focused spec was run, production was restored with `apply_patch`, the focused spec returned green, and `git diff --stat` for both production mutation targets printed no lines.

### M1 — facade calls automatic evaluate

Failing assertion:

```text
skill synthesis production reachability › 5. reaches manual promotion, scores the candidate, and writes active SKILL.md
- Expected: { "promoted": true, "reason": "promoted" }
+ Received: { "promoted": false, "reason": "below-threshold" }
Tests: 1 failed, 4 passed, 5 total
```

Restore:

```text
NX Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
--- git diff --stat (production mutation targets) ---
(empty)
```

### M2 — restore conversation-depth prefilter

Failing assertion:

```text
skill synthesis production reachability › 3. leaves one real candidate, reuses its normalized hash, and creates no chat-only work
Expected length: 1
Received length: 2
Received candidates included source_session_ids ["s-alpha"] and ["s-chat"].
Tests: 3 failed, 2 passed, 5 total (groups 4–5 cascade because group 3 intentionally stopped before assigning candidateId)
```

Restore:

```text
NX Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
--- git diff --stat (production mutation targets) ---
(empty)
```

### M3 — restore creation-time invocation/context hash

Failing assertion:

```text
skill synthesis production reachability › 3. leaves one real candidate, reuses its normalized hash, and creates no chat-only work
Expected: 0
Received: 1
at SELECT COUNT(*) FROM skill_invocations
Tests: 1 failed, 4 passed, 5 total
```

Restore:

```text
NX Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
--- git diff --stat (production mutation targets) ---
(empty)
```

### M4 — remove production stage-handler registration

Failing assertion:

```text
skill synthesis production reachability › 3. leaves one real candidate, reuses its normalized hash, and creates no chat-only work
Expected candidate length: 1
Received candidate length: 0
Tests: 3 failed, 2 passed, 5 total (groups 4–5 cascade after group 3)
```

The zero-candidate result is the observable consequence of the real drain having no prefilter handler; no alternate inline path created a candidate.

Restore:

```text
NX Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
--- git diff --stat (production mutation targets) ---
(empty)
```

### M5 — apply threshold in manual pipeline mode

Failing assertion:

```text
skill synthesis production reachability › 5. reaches manual promotion, scores the candidate, and writes active SKILL.md
- Expected: { "promoted": true, "reason": "promoted" }
+ Received: { "promoted": false, "reason": "below-threshold" }
Tests: 1 failed, 4 passed, 5 total
```

Restore:

```text
NX Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests: 5 passed, 5 total
--- git diff --stat (production mutation targets) ---
(empty)
```

## Verification

All commands ran from `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock` with `NX_DAEMON=false` and the main checkout's Nx binary. Before every Jest/test invocation, the machine process list was checked for active Jest/Nx run commands; when other sessions were active, execution waited.

### Full tests

Command:

```text
D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis
```

Header and totals:

```text
NX Running target test for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
Test Suites: 6 skipped, 75 passed, 75 of 81 total
Tests:       37 skipped, 1512 passed, 1549 total
Snapshots:   0 total
NX Successfully ran target test for project @ptah-extension/skill-synthesis
```

No load flake occurred, so no `--parallel=1` retry was needed. The final changed fake-lane dispatch was subsequently re-run by both focused binding commands below.

### Typecheck

```text
NX Running target typecheck for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
NX Successfully ran target typecheck for project @ptah-extension/skill-synthesis
```

### Lint

```text
NX Running target lint for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
✖ 35 problems (0 errors, 35 warnings)
NX Successfully ran target lint for project @ptah-extension/skill-synthesis
```

The 35 warnings are existing max-lines/legacy spec warnings; neither new file is named in the lint output.

### XB1 — node:sqlite

Command:

```text
D:\projects\ptah-extension\node_modules\.bin\nx.cmd run-many -t test -p @ptah-extension/skill-synthesis --testPathPatterns '"skill-synthesis.reachability"' --runInBand
```

```text
NX Running target test for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
```

Skipped: 0.

### XB1 — better-sqlite3 under Electron-as-Node

Command:

```text
$env:ELECTRON_RUN_AS_NODE='1'
D:\projects\ptah-extension\node_modules\.bin\electron.cmd D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-synthesis.reachability"' --runInBand
```

```text
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
```

Skipped: 0.

### Degradation audit

Command:

```text
D:\projects\ptah-extension\node_modules\.bin\nx.cmd run degradation-audit:lint
```

Result:

```text
degradation-audit: scanned 2854 file(s)
libs/backend/skill-synthesis: 6 ok (baseline 6)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
```

Exit 0; `--update-baseline` was never used.

### Final source checks

```text
git diff --check
(no output)

git diff --stat -- libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts
(no output)

git status --short -- libs/backend/skill-synthesis/src/lib
?? libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts
?? libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.test-support.ts
```

Task report/marker files are intentionally outside that source-only status listing because this batch explicitly requires them.

## Batch 6 re-read notes handled

- D1a: group 4 pins automatic below-threshold without judging; group 5 pins `promoteManually`; no automatic-promotion assertion was added.
- Moved line anchors: current production symbols were read directly; M4 targeted the live registration call.
- Batch 5 cleanup tokens: neither cleanup token was resolved.
- Migrations through 45: the real connection applied the complete current migration list.
- Settings: required roots, master switch, judge, and 1/2 evidence defaults are explicit; drain gates remain at production defaults; curator is disabled to prevent unrelated timer calls.
- Reuse path: beta's equal normalized hash reaches `findByTrajectoryHash`, is marked `reused existing candidate`, and does not append beta to `source_session_ids`.
- `start()` side effects: the embedding row is outside the asserted prefilter set; curator is disabled; judge counting uses a snapshot immediately before group 4.
- Teardown: `synthesis.stop()`, connection close, child reset, and recursive temporary-directory removal all run in `afterAll`.
- Shared-machine rule: every test command was preceded by a process check; several runs waited for other sessions rather than overlapping.

## XB4 / plan deviations

XB4 is satisfied: no production file changed, including the tracker, invocation events, extractor fields, generalization shortcut, and clustering.

Plan deviation: A1 required the anticipated test-only node:sqlite adapter because `resolveOpener()` exposes the queue subset rather than the complete real-connection contract. This is exactly the plan's allowed fallback and does not alter production. No other deviation.

## Out-of-scope observations

- The full suite retains 37 existing skipped tests and lint retains 35 existing warnings. Neither was changed because Batch 6 owns only the new reachability spec and its optional support file.
