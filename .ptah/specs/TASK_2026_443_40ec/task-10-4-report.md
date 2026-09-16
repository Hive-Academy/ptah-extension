# Task 10.4 report — measured memory delete batch size

## Outcome

Set the production memory lifecycle delete batch size to `100`, matching the
Task 10.3 cap-eviction sweep. The source comment records the measurement:
batch size 200 reached maximum batch durations of 133–1730 ms on a 1.18 GB
file, while batch size 100 passed the 120 ms bound.

No database under `C:\Users\abdal\.ptah\state` was opened. No timing was
re-measured; this task used the completed Task 10.3 results.

## Diff

```diff
--- libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts
+++ libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts
@@
-/** Initial batch size for deletes that fan out through FTS and vec triggers. */
-export const RETENTION_MEMORY_DELETE_BATCH_SIZE = 200;
+/**
+ * Initial batch size for deletes that fan out through FTS and vec triggers.
+ * 100 from the TASK_2026_443 cap-eviction sweep: 200 reached max 133-1730 ms
+ * on a 1.18 GB file; 100 passed the 120 ms bound.
+ */
+export const RETENTION_MEMORY_DELETE_BATCH_SIZE = 100;

--- libs/backend/memory-curator/CLAUDE.md
+++ libs/backend/memory-curator/CLAUDE.md
@@
-... with delete batches initially capped at 200; ...
+... with delete batches initially capped at 100; ...

--- libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts
+++ libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts
@@
-    ).toBe(50);
+    ).toBe(150);
@@
-    ).toBe(50);
+    ).toBe(150);
@@
-      memoriesDeleted: 50,
+      memoriesDeleted: 150,
```

The integration test seeds 250 rows, commits the first production-sized delete
batch, then injects a failure in the second batch. The requested exact-token
grep did not reveal this indirect dependency on the old default; the first test
run did. With a 100-row first batch, 150 memory and chunk rows correctly remain
and are deleted by the subsequent run. No statement, predicate, transaction
shape, or production logic changed.

## Pre-edit spec grep

Command equivalent: search all `libs/**/*.spec.ts` for
`RETENTION_MEMORY_DELETE_BATCH_SIZE|memoryDeleteBatchSize`.

```text
SPEC_GREP_RESULT: EMPTY
```

No spec directly asserted either production symbol or the `200` value through
the limits property. The first memory-curator test run nevertheless exposed the
indirect count expectation described above, so that one spec was updated.

The acceptance grep `batch.*200|200.*batch` under
`libs/backend/memory-curator` produced five test-only matches: explicit local
fixture batch sizes, a simulated 200 ms cost, one historical batch-number
comment, and an unrelated `NOW + 2000` expression. None states that the
production initial delete cap is 200. The stale documentation claim was removed.

## Invariants

- `RETENTION_MIN_BATCH_SIZE` remains `50`; a slow delete batch can still halve
  to the floor of 50.
- `RETENTION_MAX_MEMORY_ROWS_PER_RUN` remains `25_000`.
- The clamp range, cap-eviction grace, all other constants, SQL statements,
  predicates, and transaction shapes are unchanged.
- No `apps/ptah-docs` page changed because this code limit has no setting key.

## Verification

### Memory-curator tests — initial run

Command:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator
```

Header:

```text
NX   Running target test for project @ptah-extension/memory-curator:
```

Result: exit 1. 39 suites passed, 1 failed, 2 skipped; 639 tests passed,
1 failed, 59 skipped. The sole failure was
`memory-retention.integration.spec.ts` expecting 50 remaining rows after the
first delete batch; 150 remained with the newly measured 100-row default. This
was a deterministic stale expectation, not a known timing flake.

### Memory-curator tests — after the expectation update

Command:

```text
npx nx run-many -t test -p @ptah-extension/memory-curator
```

Header:

```text
NX   Running target test for project @ptah-extension/memory-curator:
```

Result: exit 0. 40 suites passed, 2 skipped; 640 tests passed, 59 skipped.

### Memory-curator typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
```

Header:

```text
NX   Running target typecheck for project @ptah-extension/memory-curator:
```

Result: exit 0; target completed successfully.

### Memory-curator lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/memory-curator
```

Header:

```text
NX   Running target lint for project @ptah-extension/memory-curator:
```

Result: exit 0; 0 errors and 5 pre-existing warnings.

### Host tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine
```

Header:

```text
NX   Running target test for 2 projects:

- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
```

Result: exit 0. Thoth-runtime: 5 suites and 91 tests passed. CLI-engine:
19 suites and 188 tests passed.

### Degradation audit

Command:

```text
npx nx run degradation-audit:lint
```

Header:

```text
> nx run degradation-audit:lint
```

Result: exit 0; 2,848 files scanned, 303 baseline unsuppressed sites,
`libs/backend/memory-curator: 20 ok (baseline 20)`, and Nx reported the lint
target successful.

### Electron / better-sqlite3 retention tests

Command:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention|memory-lifecycle|retention-run-budget"' --runInBand
```

This direct Jest invocation has no Nx `Running target` header.

Result: exit 0; 42/42 suites and 699/699 tests passed, with the quoted pipe
pattern preserved as required.

No R-TL8, R-TL11, or R-TL12 timing flake reproduced. No `--parallel=1` retry
was needed.

## Stack observed

Nx 22.6.5 and TypeScript 5.9.3 are declared in `package.json`. The
memory-curator library uses the repository's Nx Jest, TypeScript, and ESLint
targets from `libs/backend/memory-curator/project.json`; its product-side DI
dependency is tsyringe. This change affects only a retention configuration
constant, its documentation, and the corresponding integration expectation.

## Plan deviations and out-of-scope observations

Plan deviation: the specified direct symbol/property spec grep was empty, but
the required test run found one indirect assertion of the former default batch
size. Updating its three outcome counts was necessary to preserve the existing
rollback/single-flight behavior test under the requested production default.

Out-of-scope observations: none. The five lint warnings and degradation-audit
baseline sites are pre-existing and unchanged.
