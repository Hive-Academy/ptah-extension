# CI fix report — TASK_2026_440_834c

## Headline

Confirmed and fixed the cross-binding SQLite query-plan failure: the retention
plan helper now supplies derived bindings for every named and positional SQL
parameter, while preserving every existing query-plan assertion unchanged.

## Root cause

Confirmed as reported. `planOf` prepared `EXPLAIN QUERY PLAN ${sql}` and called
`.all()` without arguments. The production statements exposed through
`OBSERVATION_RETENTION_SQL` use named parameters such as `@after`, `@sid`,
`@cutoff`, `@ids`, and `@now`.

Under Electron's Node runtime the repository's `better-sqlite3` native module
loads successfully, and `better-sqlite3` rejects a statement with unbound named
parameters even when the statement is prefixed with `EXPLAIN QUERY PLAN`.
Plain Node cannot construct that Electron-ABI native module and the shared test
opener falls back to `node:sqlite`, which tolerated the missing values. This
explains the local/CI difference.

No production SQL defect was found. Production SQL was not changed, and the
assertions requiring index searches, forbidding a bare `SCAN observation_queue`,
and forbidding `ANALYZE` remain exactly as strict as before.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts`
  — `planOf` now derives unique named parameter names from `@name`, `:name`, and
  `$name` placeholders and passes one object containing zero-valued bindings;
  it also counts positional `?` placeholders and passes one zero-valued
  positional argument per placeholder. Mixed named/positional statements are
  handled by passing the named object followed by positional values. There is
  no catch or fallback that could hide a planning failure.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\.ptah\specs\TASK_2026_440_834c\ci-fix-report.md`
  — this verification report.

## Same-hazard audit

Searched all `prepare()` calls and all imports of
`retention-sqlite.test-support.ts` in the requested scope.

### `retention/observation-retention.store.spec.ts`

- `planOf`: found unbound named parameters; fixed as described above. The helper
  now also binds positional `?` parameters explicitly.
- `count`: accepts rest parameters and every parameterized call supplies its
  single `id`; calls without parameters use SQL without placeholders.
- `sqlite_stat1` count, quarantine ledger read, ordered ledger read, and
  `PRAGMA busy_timeout`: no placeholders.
- Processed-row lookup: one `?`, one supplied id.
- Quarantine-ledger insert helper: three `?` placeholders, three supplied values.

### `retention/memory-retention.integration.spec.ts`

- Snapshot, ledger, retention-state, processed-count, and total-count reads:
  no placeholders.
- Quarantine-ledger insert statement: five `?` placeholders and five positional
  values at each of its two call sites.
- No `EXPLAIN` statement exists in this file.

### `retention/memory-retention.service.spec.ts`

- Checked the entire file. It uses mocked stores and contains no raw SQLite
  `prepare()` call or import of the shared SQLite opener.

### `di/register.spec.ts`

- Checked the entire file. It has no direct `prepare()` call. Its only raw data
  insertion goes through `seedObservations`, whose five `?` placeholders receive
  five positional values for every row.

### `retention/retention-sqlite.test-support.ts`

- `adaptSqliteDatabase` PRAGMA execution, WAL journal-mode setup, and
  `pragmaNumber`: no placeholders.
- `seedObservations`: five `?` placeholders, five positional values per row.
- Import search confirmed that only the store spec, integration spec, and DI
  registration spec use this shared opener.

No additional unbound-parameter hazard was found, so no other test/support file
needed modification.

## better-sqlite3 reproduction

The repository Electron launcher exists at
`D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\node_modules\.bin\electron.cmd`.

Before the fix, an Electron-as-Node probe successfully constructed
`better-sqlite3` and reported:

```text
runtime: electron-node
Electron: 40.10.1
Node: 24.15.0
NODE_MODULE_VERSION: 143
SQLite: 3.53.1
driver: better-sqlite3
```

The pre-fix Electron Jest run then reproduced the CI failure exactly:

```text
FAIL observation-retention.store.spec.ts
TypeError: Missing named parameters
Test Suites: 1 failed, 1 total
Tests: 2 failed, 21 passed, 23 total
```

After the fix, the same Electron runtime and shared opener continued to select
`better-sqlite3`; the targeted result was:

```text
Test Suites: 1 passed, 1 total
Tests: 23 passed, 23 total
Snapshots: 0 total
```

An additional Electron-hosted Jest run using the requested `retention` pattern
also passed:

```text
Test Suites: 37 passed, 37 total
Tests: 610 passed, 610 total
Snapshots: 0 total
```

## Required verification

### Test

Command:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator
```

Nx header and result:

```text
NX   Running target test for project @ptah-extension/memory-curator:

- @ptah-extension/memory-curator

Test Suites: 2 skipped, 35 passed, 35 of 37 total
Tests:       59 skipped, 551 passed, 610 total
Snapshots:   0 total

NX   Successfully ran target test for project @ptah-extension/memory-curator
```

The header lists exactly one project. The skipped tests/suites are the existing
platform-conditional set; the Electron run above executed all 610 tests with no
skips.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
```

Nx header and result:

```text
NX   Running target typecheck for project @ptah-extension/memory-curator:

- @ptah-extension/memory-curator

> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/memory-curator
```

The header lists exactly one project.

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/memory-curator
```

Nx header and result:

```text
NX   Running target lint for project @ptah-extension/memory-curator:

- @ptah-extension/memory-curator

✖ 6 problems (0 errors, 6 warnings)

NX   Successfully ran target lint for project @ptah-extension/memory-curator
```

The header lists exactly one project. All six warnings are pre-existing and
outside the changed file: unused test imports in `memory-decay.job.spec.ts` and
`memory-trigger.coalesce.spec.ts`, a non-null assertion in
`memory-search.service.spec.ts`, and max-line warnings in
`memory-search.service.ts` and `memory-trigger.service.ts`.

## Plan deviations

None. The change is confined to the requested spec scope, does not alter
production SQL, and does not weaken the plan assertions.

