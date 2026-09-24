# Code Logic Review (Round 2) — `TASK_2026_535`

## Verdict

PASS: All serious and major logic gaps from Round 1 (F1, F2, F3, F5, F6) are cleanly resolved with rigorous test coverage, the F4 skip is acceptable as pre-existing adapter behavior, and no new regressions were introduced.

## Prior findings

### F1: Non-zero exit code cached permanently as `false`
- **Status**: RESOLVED
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:510-514`
- **Details**: `supportsStandalone` now explicitly checks `if (outcome.exitCode !== 0 || outcome.timedOut || outcome.errored)`. On any abnormal exit, it deletes `binary` from `this.standaloneSupport` and returns `undefined` (unknown). Only exit code 0 parses and caches a boolean. Verified by test `omits --standalone and says so when the help probe exits non-zero` where re-probing on subsequent runs is confirmed (`mockHelpProbe` called twice).

### F2: Unhandled rejection risk in probe promise chain
- **Status**: RESOLVED
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:516-520`
- **Details**: Added `.catch(() => { this.standaloneSupport.delete(binary); return undefined; })` to the probe chain. Synchronous or asynchronous exceptions from the spawner or probe are cleanly caught, cleared from the cache, and resolved as `undefined`. Verified by test `probes again when the probe spawn throws`.

### F3: Silent MCP drop on probe timeout without observability
- **Status**: RESOLVED
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:598-605`
- **Details**: When `standalone === undefined`, `runSdk` emits an `info` segment:
  `opencode run --help did not answer, so this run omits --standalone. On opencode 2.x the lane may then have no Ptah MCP tools.`
  Because `createBufferedEmitter` buffers all emitted segments until a subscriber attaches, the segment is guaranteed to be received by the handle consumer. Verified by assertion in unit tests.

### F4: Orphaned process risk on Windows `.cmd` probe timeout
- **Status**: SKIP ACCEPTED
- **Details**: `probeCommandOnce`'s `child.kill()` on timeout is pre-existing shared logic across all probes in this adapter (`probeModels`, `probeAuthList`). Changing process tree killing across all probes is outside the scope of the `--standalone` fix and warrants a separate adapter-wide review.

### F5: Inability to invalidate probe cache on CLI upgrade
- **Status**: RESOLVED
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:254`
- **Details**: `this.standaloneSupport.clear()` was added to `detect()`. When `CliDetectionService` re-detects CLIs (e.g. after an upgrade from 1.x to 2.x), the cached probe results are cleared. Verified by test `does not reuse a cached answer after detect() (CLI upgrade)`.

### F6: Incomplete test coverage for timeout and concurrency
- **Status**: RESOLVED
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:533-603`
- **Details**: Added 4 new targeted tests covering: non-zero exit with warning segment emission and re-probe; concurrent `runSdk()` calls awaiting the same in-flight probe; throwing probe spawn; and cache invalidation on `detect()`. Total suite grew from 43 to 45 passing tests.

## New findings

none

## Checks run

1. `git show a75cd0660`
   - Reviewed diff for `opencode-cli.adapter.ts` and `opencode-cli.adapter.spec.ts`.
2. Verified `createBufferedEmitter` buffering semantics (`cli-adapter.utils.ts:36-57`)
   - Confirmed items emitted before subscription are queued in `buffer` and replayed on `subscribe()`.
3. Verified concurrent execution safety during `detect().clear()`
   - Confirmed in-flight promises remain valid and settle independently of map clearance.
4. `npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns=opencode-cli.adapter --skip-nx-cache`
   - Test Suites: 1 passed, 1 total. Tests: 45 passed, 45 total. Time: 6.743 s.

## Lane-introduced constraints

none
