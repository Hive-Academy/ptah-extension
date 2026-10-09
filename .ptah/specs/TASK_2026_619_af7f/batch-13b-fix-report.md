# Batch 13b correction report

## 1. Lifecycle retries another caller's abort

Changed `libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts:166,388-393`.

- `isAbort` now recognises the indexer's DOMException-shaped `AbortError`, not only `Error` instances.
- A catch is clean only when this lifecycle was disposed or its own controller was aborted. Any other failure is reported. An externally owned abort also sets the existing boolean `followUp`; the existing `finally` consumes that latch once and starts one replacement census.

The externally cancelled starter can therefore no longer leave the lifecycle census silently incomplete. A storm cannot create a second replacement because it uses the same boolean latch.

## 2. Active-census join upgrades

Changed `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:302-315,544-552,687-756,972-1112`.

- `ActiveCensus` now owns a mutable progress-listener set and a monotonic `userInitiated` flag.
- A joining callback is registered for later batches, removed on the joiner's abort and on census settlement, and isolated behind `try/catch`; a faulty callback warns once per census and cannot interrupt indexing.
- A user-initiated join flips the census flag; every subsequent batch reads that flag before deciding whether to wait for the governor. Starter-owned cap, batch size, and signal remain unchanged.
- `indexWorkspace` JSDoc documents the precise joiner contract.

Thus a user click can receive subsequent progress and bypass background admission at the next batch boundary without reopening follow-up queuing or copying starter options.

## 3. Regression tests

Added focused tests:

- `workspace-index-lifecycle.spec.ts:156`: externally owned abort reports and starts one replacement.
- `workspace-index-lifecycle.spec.ts:179`: the same abort with an already-latched storm still starts exactly one replacement.
- `workspace-index-lifecycle.spec.ts:203`: lifecycle disposal plus a namespace-style shared-promise join settles the join rejection without an unhandled rejection or replacement. These lifecycle cases use the permitted shared-promise lifecycle double; it models the other caller's active census directly.
- `code-symbol-indexer.service.spec.ts:356`: a real `CodeSymbolIndexer` user join disables the next governor wait.
- `code-symbol-indexer.service.spec.ts:1068`: a real indexer joins one discovery and delivers joiner progress.
- `code-symbol-indexer.service.spec.ts:1101`: an aborted joiner removes its progress listener before the starter resumes.

## Verification

- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c libs/backend/workspace-intelligence/jest.config.ts code-symbol-indexer --coverage=false --maxWorkers=2 --moduleNameMapper=...` — PASS: 2 suites, 61 tests.
- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c libs/backend/thoth-runtime/jest.config.ts --coverage=false --maxWorkers=2 --moduleNameMapper=...` — PASS: 7 suites, 123 tests. (Initial run found the DOMException predicate issue; corrected, then rerun once.)
- `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c libs/backend/vscode-lm-tools/jest.config.ts code-namespace.builder --coverage=false --maxWorkers=2 --moduleNameMapper=...` — PASS: 1 suite, 44 tests.
- `npx nx typecheck workspace-intelligence --parallel=1` — PASS.
- `npx nx typecheck thoth-runtime --parallel=1` — PASS.
- `npx nx typecheck vscode-lm-tools --parallel=1` — PASS.
- `npx nx lint workspace-intelligence --parallel=1` — PASS: 0 errors, 74 existing warnings.
- `npx nx lint thoth-runtime --parallel=1` — PASS: all files pass.
- `npx prettier --check libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.spec.ts` — PASS.

Nx reported its disabled-cloud 401 after successful local targets; it did not affect target results.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat only own-controller/disposal aborts as clean | Swallow all aborts; report/retry foreign aborts | A joined census may be owned by `indexing:start`; its signal is distinct from lifecycle's signal. | Yes; contained catch policy. |
| Keep exactly one lifecycle replacement latch | Add an indexer queue; reuse lifecycle `followUp` | Batch 13b explicitly assigns trailing work to lifecycle and the boolean already coalesces storms. | Yes; no public API change. |
| Keep only dynamic join attributes in the census record | Copy all joiner options; progress/governor only | Caps, batch size and signal are starter-owned by required contract; progress and foreground priority must affect an active run. | Yes; private record fields. |

## Clarifications Needed

None.
