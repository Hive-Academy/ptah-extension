## Backend implementation — `TASK_2026_372`, minimal bugfix

**Tasks completed**: Clear each provider timeout after its `Promise.race` settles; classify null, undefined, empty, and whitespace-only stored API keys as `missing-api-key`; add both requested regression specs.

**Files**:

- MODIFIED `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts` — `runProvider` captures the timer created by `createTimeoutPromise` and clears it in `finally`; blank-after-trim keys use the existing missing-key failure and unchanged guidance message.
- MODIFIED `D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.spec.ts` — proves a successful fake-timer search leaves `jest.getTimerCount()` at zero and an empty-string Serper key is reported as `missing-api-key` without constructing the provider.

**Changed behavior**:

- Successful or failed provider searches no longer leave their timeout scheduled after the race settles.
- A stored key that is null, undefined, empty, or whitespace-only is treated exactly like an absent key. `WebSearchTimeoutError` classification and the existing missing-key message are preserved.
- `Promise.allSettled`, provider outcomes, URL de-duplication, partial-success behavior, and total-failure throwing are unchanged.

**Stack observed**: Node 24.x; TypeScript 5.9.3; Nx 22.6.5; Jest 30.0.2. This backend library is platform-agnostic, uses constructor-supplied dependencies (`ISecretStorage`, `IWorkspaceProvider`, `Logger`), and follows the repository's strict `catch (error: unknown)` narrowing convention. Sources: root `package.json`, `package-lock.json`, root `CLAUDE.md`, and `libs/backend/vscode-lm-tools/CLAUDE.md`.

**Verification**:

- `npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools` — PASS, 1 project; TypeScript completed with no errors.
- `npx nx run-many -t test -p @ptah-extension/vscode-lm-tools` — PASS, 46/46 suites and 992/992 tests; 0 snapshots.
- `npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools` — PASS, 0 errors and 21 warnings. All warnings are in files outside this batch's ownership.

**Plan deviations**: None.

**Caveats**: Jest printed existing environment/config warnings (`NO_COLOR` versus `FORCE_COLOR`, Jest config ESM loading) and reported one worker that required force-exit after the full successful run. The lint warnings are pre-existing `no-explicit-any` and `max-lines`/empty-function warnings in unrelated files. No out-of-scope files were changed.

**Out-of-scope observations**: None beyond the verification warnings noted above.
