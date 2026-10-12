# Backend implementation — `TASK_2026_623_3492`, batch 12F

**Tasks completed**: 12F.1 (fixed-text boundary over the whole response build; reject `null` params)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.spec.ts

## Fixes

### Serious #1 — malformed `agent.limits()` output (approach: wrap the response build)

- The response construction moved into a module function `buildResult(limits, now)`. It holds
  `formatPlanLimitRows(...).map(toRow)`, `lanes`, `atLimit`, `nearLimit`, `unknown` and `asOf`. The
  body is the same as before, so the shape, the cells 0-4 mapping and the counts for valid input do
  not change.
- `getLanePlanLimits` calls `buildResult` inside `try`. On any throw it runs
  `throw this.unavailable('response build failed', error)`.
- The new private `unavailable(stage, error)` logs
  `[lanePlanLimits] agent:getLanePlanLimits <stage>` with `{ errorName }` only and returns
  `new Error(UNAVAILABLE)` with no cause. The existing `lookup()` catch now uses the same helper, so
  one place owns the "name only, cause dropped" rule. Because the `Error` is created outside the
  `catch`, the old `eslint-disable-next-line preserve-caught-error` is no longer needed and was
  removed.
- These inputs all throw inside the boundary and end in the fixed text:
  - `null`: `null.flatMap`
  - a non-array such as `{}` or a string: `.flatMap is not a function`
  - a row whose field access throws
- `undefined` keeps its current path: the `no lane limit lookup` warn, then the fixed text.
- A valid `[]` still formats to `rows: []` with zero counts. The code path for it is unchanged.
- Unchanged: the lazy build cache (`this.api ??= build()`) and retry-after-throw, read semantics
  (`list()` then `limits(rows)`, no `refresh`), and the schema file.

### Moderate #2 — `null` params

- `LanePlanLimitsParamsSchema.safeParse(params === undefined ? {} : params)`. `null` now reaches the
  strict `z.object({}).strict()` schema, fails, and throws `RpcUserError(..., 'INVALID_PARAMS')`
  before `getApi()` or `list()` runs.

## Regression tests (spec)

- The spec `setup()` now also returns `send(params)`, which calls the registered handler with exactly
  `params`. The existing `call(params = {})` default parameter turns an explicit `undefined` into
  `{}`, so the old "absent payload" assertion never actually sent `undefined` to the handler.
  `call` is unchanged for the other tests.
- New tests:
  1. `rejects with fixed text when the lookup resolves null`.
  2. `rejects with fixed text when the lookup resolves the non-array {}` and `... 'not an array'`
     (`it.each`).
  3. `rejects with fixed text on a malformed row, without logging or linking its error`. It sends
     `[LIMITS[0], Proxy whose every get throws Error('SENTINEL-lane-/home/acct')]` and asserts:
     - the message is exactly the fixed text;
     - `error` has no `cause` property;
     - `logger.warn` was called;
     - the serialised info, warn, error and debug calls contain neither the sentinel nor `/home/acct`.
  4. `rejects null with INVALID_PARAMS before any lookup`: `RpcUserError` with
     `errorCode: 'INVALID_PARAMS'`, and `build` and `list` are not called.
  5. `still succeeds when params are omitted (undefined reaches the handler)`: `send(undefined)`
     resolves with `lanes: 3`.
- Against the pre-fix code, test 4 would fail (`null ?? {}` parsed as valid). Test 3 would also
  fail: the raw sentinel `Error` propagated, its message was not the fixed text, and nothing was
  logged.

## Stack observed

- tsyringe `@injectable` handler registered through `RpcHandler.registerMethod` (the existing file).
- Zod strict schema at the RPC boundary (`lane-plan-limits-rpc.schema.ts`).
- Logger: `TOKENS.LOGGER`, `warn` with a structured context, matching the existing lookup catch.

## Verification

- a. `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}' 2>&1 | tail -n 40`
  → `Test Suites: 1 passed, 1 total`, `Tests: 27 passed, 27 total`. That is 21 existing tests plus 6
  new: null, two non-array cases, malformed row, null params and undefined params.
- b. `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -n 20`
  → `Successfully ran target typecheck for project @ptah-extension/rpc-handlers`.
- c. `npx nx lint @ptah-extension/rpc-handlers --parallel=1`
  → `✖ 50 problems (0 errors, 50 warnings)`, `Successfully ran target lint`. All 50 are warnings in
  other files.
- Scoped follow-up: `npx eslint` on the two changed files printed nothing and exited 0, so neither
  file has a warning. The removed disable comment does not leave a `preserve-caught-error` warning.
- Nx Cloud printed a 401 "organization disabled" notice. It is unrelated to this change, and the
  targets ran locally.

## Plan deviations

None. Approach chosen: wrap the response build rather than validate the shape, as the batch allowed.

## Out-of-scope observations

None.
