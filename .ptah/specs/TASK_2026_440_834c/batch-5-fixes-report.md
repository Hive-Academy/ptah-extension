# Batch 5 fixes report

Source: `code-logic-review-batch-5.md`. Finding: MODERATE — CLI reachability specs do not prove repeated-start registration idempotency.

No commit was made. `nx reset` was not run. `batches.md` was not edited. Only one file changed.

## Fix

File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`

New test at `:512`, inside `describe('memory retention job (TASK_2026_440 reachability)')`:

`activateThoth — runtime tier memory retention job (TASK_2026_440 reachability) two runtime activations register memory:retention once, upsert twice, and the handler still reaches service.run`

What the test does:
1. It replaces the non-stateful registry fake with a stateful one. `has()` reflects earlier `register()` calls, and `register()` throws on a duplicate name, as the real `HandlerRegistry` does. This follows the review recommendation. If the production `has()` guard is removed, the second activation throws inside `registerMemoryRetentionJob`, the registration count becomes wrong, and the test fails.
2. It calls `activateThoth(container, 'runtime', logger)` twice with the same container, registry and logger. The token set includes `MEMORY_TOKENS.MEMORY_RETENTION_SERVICE`.
3. It asserts that `memory:retention` is registered exactly once.
4. It asserts that the `@ptah/memory-retention` upserts equal `[job, job]`, where `job` is the exact object `{ id: '@ptah/memory-retention', name: 'Memory Retention', cronExpr: '17 * * * *', timezone: 'UTC', prompt: 'handler:memory:retention', enabled: true }`.
5. It asserts that `logger.warn` did not receive `'[CLI Thoth] Memory retention cron registration failed (non-fatal)'`.
6. It invokes the one registered handler with a fake ctx and asserts that `service.run` was called once with the same `ctx.signal`.

## Production change

None. `libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts` already satisfies the test: the `has()` guard (`:544`) and the unconditional upsert (`:550`) that the review cites.

## Verification

### `npx nx run-many -t typecheck test lint -p @ptah-extension/cli-engine --parallel=1`

- Header: `NX Running targets typecheck, test, lint for project @ptah-extension/cli-engine:` (1 project).
- Final line: `NX Successfully ran targets typecheck, test, lint for project @ptah-extension/cli-engine`.
- typecheck: passed (`tsc --noEmit --project libs/backend/cli-engine/tsconfig.lib.json`).
- test: 17 suites / 179 tests passed. Before the fix the count was 178.
- lint: 0 errors, 2 warnings. Both warnings existed before Batch 5 and the review already records them: `cli-adapters.ts:249` empty `dispose`, and `thoth-runtime.spec.ts:14` unused `ThothRefs`. Nx served lint from the cache for this run. The cache key includes the spec content, so an earlier run in this session linted the same file content.
- The existing "A worker process has failed to exit gracefully" message and the `withEngine` fixture messages are from other suites, not from the retention path.

### Jest `--json` per-file result

Command: `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts --json` (output written to `%TEMP%`).

| Spec file | Tests | Passed | Failed | Pending | Todo |
|---|---|---|---|---|---|
| `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts` | 20 | 20 | 0 | 0 | 0 |

Retention reachability tests, all `passed`:
- `... upserts @ptah/memory-retention and registers memory:retention once`
- `... the registered handler reaches service.run with the cron signal`
- `... two runtime activations register memory:retention once, upsert twice, and the handler still reaches service.run` (new)
- `... registers no retention job when the host has no retention service`
- `... the oneshot tier registers and upserts nothing`

0 skipped.
