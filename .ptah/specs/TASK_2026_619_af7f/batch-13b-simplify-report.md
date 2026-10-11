# Batch 13b simplification — one census per root

## Summary

`CodeSymbolIndexer` now keeps at most one full census per workspace root (`graphPathIdentity`). A second `indexWorkspace` while that census is active joins the same promise and receives the active run's stats. The joiner's options other than `signal` are ignored. A joiner abort rejects only that joiner with `DOMException('Aborted', 'AbortError')` and leaves the census running. The indexer has no follow-up queue. Trailing full runs stay on `WorkspaceIndexLifecycleService.followUp` (unchanged 13b.1 behavior).

`isIndexing(root)` is true only while that active-census record exists. It does not count a per-file `reindexFile`, and it is false in the gap after a census settles (including a rejection) before the next call starts a new census.

`ensureIndexFresh` treats `indexer.isIndexing(root)` as the only in-flight signal. The namespace-private `inFlight` set is gone. A stale, idle index still starts one background `indexWorkspace`.

## Per file

### `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`

- `ActiveCensus` (promise only) replaces `CensusSlot`: lines 299–304.
- `activeCensuses` replaces `censusQueues`: lines 466–470.
- `indexWorkspace` JSDoc states joiner rules (options ignored except `signal`, abort is `AbortError`, no follow-up): lines 532–540. Join vs start: lines 553–558.
- `isIndexing`: lines 561–572. True iff `activeCensuses` has the root identity. Not `runsInProgress` (same window, but the public flag is the census record, cleared in `finally` before the promise settles).
- `startCensus`: record stored before `beginRun` (line 683); `finally` calls `settleRun` then deletes the record only if it is still that record (lines 691–695); the returned promise resolves or rejects after that `finally` (line 697).
- `joinActiveCensus`: lines 706–738. Already-aborted signal rejects immediately (lines 711–713). A later abort rejects the joiner only (lines 716–719). The abort listener is removed when the census settles (lines 722–724, 727, 733).

### `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts`

Replaced the shared-follow-up tests (lines 1046–1168):

- two calls, one discovery, same stats object
- joiner abort mid-run rejects; starter resolves; one discovery
- already-aborted joiner rejects immediately; census continues
- after settle, the next call starts a second census
- `isIndexing` false after a rejected (starter-aborted) census

Existing per-file / rev-1 tests were left in place and stayed green.

### `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`

- Removed the `inFlight` set. `lastRunStartedAt` remains for the 24h gap (line 187).
- `runIsActive` is only `indexer.isIndexing(root)` (lines 230–237).
- `startBackgroundRun` no longer latches locally (lines 266–283). `indexWorkspace` still runs synchronously inside the executor, so `isIndexing` is true before `startBackgroundRun` returns.
- `checkFreshness` still skips `indexWorkspace` when `runIsActive` and still returns `reindexInFlight` (lines 314–329).

### `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`

- `makeIndexer` / `makeLiveIndexer` now flip `isIndexing` for a root from the synchronous `indexWorkspace` call until that run settles (`activeRoots`, lines 216–254 and 681–691). This matches the real indexer, which is what makes the removed latch redundant.
- Existing test "does not start a second indexWorkspace when the indexer already has a run for the root" (line 513) still covers: lifecycle census (`isIndexing` true) plus the first symbol query does not call `indexWorkspace`; after the census goes idle, a stale index calls it once.

### Unchanged

- `libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts` and its spec. No signature change. 13b.1 (`reindexFile` / `deleteFileSymbols` during a run; `requestFullRun` sets lifecycle `followUp`) was not edited.
- `boot-thoth-runtime.ts` and `cli-workspace-index.ts`. No compile error.

## Deleted

From the indexer:

- `CensusSlot` fields `running`, `waiters`, `settled`, `resolveSettled`, `follow`, `followCommitted`, `followOptions`, `userInitiatedWaiters`
- `censusQueues`
- `launchCensus`, `joinCensus`, `startFollowUp`, `openCensusSlot`, `rememberWaiter`, `forgetUserInitiated`

From the namespace builder:

- private `inFlight` set and the `finally` that cleared it

From the indexer spec:

- "a second call during a held run starts discovery only after the first ends" (expected two discoveries)
- "three calls during a held run share one follow-up census"
- "an aborted waiter rejects and does not start a follow-up when it was the only one"
- "a follow-up census keeps a file the older snapshot did not discover"

No shims and no unused names were left.

## Why the three review findings cannot happen

1. **Abort after a shared follow-up commits resolved as success.** There is no follow-up and no `followCommitted`. A joiner abort always rejects that promise with `AbortError` (`code-symbol-indexer.service.ts:716-719`) and the settle handler does not resolve it afterwards (`:727-728`). The listener is removed when the census settles (`:722-724`).

2. **Lifecycle `followUp` plus an indexer waiter scheduled a third census.** The indexer never starts a second census for a root that already has one (`code-symbol-indexer.service.ts:554-557`). A lifecycle `requestFullRun` during the active census only joins. After that census settles, the record is gone (`:691-695`) and the lifecycle's own `followUp` can start one new census. Nothing in the indexer queues another one behind it.

3. **The first waiter's cap and `onProgress` controlled the shared follow-up.** Joiners do not pass options into the census. `indexWorkspace` forwards only `options.signal` (`code-symbol-indexer.service.ts:556`). `startCensus` keeps the starter's options (`:686`). There is no merge.

## Tests

Indexer spec (`code-symbol-indexer.service.spec.ts`):

- two calls during an active census share that census and the same stats
- a joiner whose signal aborts mid-run rejects while the starter census completes
- a joiner with an already-aborted signal rejects immediately and leaves the census running
- after the census settles, a new call starts a new census
- isIndexing is false after a rejected census
- prior per-file tests, including reindex during a held census, kept

Namespace spec: existing "lifecycle already has a run" test plus the `isIndexing` double. No new lifecycle test (lifecycle source was not changed).

## Commands

Jest was spawned from Node so `--moduleNameMapper` kept its quotes (PowerShell stripped them on a direct invocation; that attempt exited before any test ran).

```
node C:\Users\abdal\AppData\Local\Temp\jest-619-b13b.js workspace-intelligence libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts
```

Indexer mapper: `^marked$` → marked UMD, `^vscode$` → worktree vscode mock. No wasm mapper (this project has the real `wasm-bundle-dir`).

Tail: `Test Suites: 1 passed, 1 total` / `Tests: 50 passed, 50 total` / Time 4.483 s. Pass.

```
node ...\jest-619-b13b.js vscode-lm-tools libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts wasm
```

Tail: `Tests: 44 passed, 44 total` / Time 4.819 s. Pass.

```
node ...\jest-619-b13b.js thoth-runtime libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.spec.ts wasm
```

Tail: `Tests: 18 passed, 18 total` / Time 5.429 s. Pass.

```
npx nx typecheck workspace-intelligence --parallel=1
```

Exit 0. `Successfully ran target typecheck` for `@ptah-extension/workspace-intelligence`. Duration 5.2s.

```
npx nx typecheck vscode-lm-tools --parallel=1
```

Exit 0. Duration 12.4s.

```
npx nx typecheck thoth-runtime --parallel=1
```

Exit 0. Duration 16.4s.

```
npx prettier --check <the four edited ts files>
```

First check failed on `code-namespace.builder.ts` (catch indent). `npx prettier --write` on that file, then `--check` on all four: `All matched files use Prettier code style!`

Nx Cloud printed a free-plan 401 on the typechecks. The local `tsc` targets still exited 0.

## Decisions

**Decision:** `isIndexing` reads only `activeCensuses`, not `runsInProgress`.

**Options:** (a) the census map only; (b) also `runsInProgress.size > 0`, which the previous method OR-ed in so a superseded run still counted.

**Evidence:** One census is stored before `beginRun` and removed in the same `finally` that calls `settleRun`, before the promise settles (`code-symbol-indexer.service.ts:683-697`). `runsInProgress` is non-empty only inside that window. Per-file `reindexFile` sets neither. The old extra meaning (follow-up waiters, a superseded run) no longer exists.

**Reversible:** Yes. OR `runsInProgress` back into `isIndexing` without bringing back the follow-up queue.

**Decision:** Drop the namespace `inFlight` set and have the test double's `isIndexing` track the pending `indexWorkspace` promise.

**Options:** (a) remove `inFlight` and teach the double the real synchronous contract; (b) keep `inFlight` so the old double (always `isIndexing === false`) still dedupes.

**Evidence:** `indexWorkspace` records the census before its first await, and `startBackgroundRun` calls it synchronously. After the call returns, `isIndexing` is already true, so a second `ensureIndexFresh` continuation sees the census. The 24h gap still uses `lastRunStartedAt`. Namespace spec: 44 passed.

**Reversible:** Yes. A private set can be restored if a host's `isIndexing` is not synchronous.

## Clarifications Needed

None.
