## Verdict: REVISE — 6/10

The revision closes the original replacement/insert/delete/purge recovery path and makes a purge failure caller-visible. It remains below 7 because `purgeJunk` (and the public `purgeWorkspace`) can commit symbol deletions during a sqlite-vec outage without the persisted stale marker that the recovery protocol relies on. This is a real mutation path exposed by the memory RPC, not a test-only helper.

## Round-2 findings

1. **PARTIAL — BLOCKING: rowid-reuse recovery.** `replaceFileSymbols`, `purgeMissing`, `deleteFileRows`, and `insertBatch` write `code-symbols-vec-stale` inside their respective SQLite transactions whenever vec is unavailable (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:337-385`, `:435-465`, `:487-510`, `:545-584`). On the first vec-available operation, the persisted marker selects full vector deletion and marker removal in one transaction (`:190-215`, `:231-246`), including after a process restart; the regression test exercises the exact reused-rowid replacement and search recovery (`code-symbol.store.spec.ts:1731-1804`). The marker is not, however, written by `purgeJunk`, which directly deletes `code_symbols` rows (`code-symbol.store.ts:958-990`), nor by `purgeWorkspace` (`:993-997`). Thus a vec-outage deletion can commit without the marker; this fails the required all-outage-write atomicity condition. The current reconciliation can remove resulting orphan rows after vec returns, but the durable invariant is incomplete and a future rowid reuse before that reconciliation has no persisted recovery signal.

   The marker does not collide with workspace state: the only non-spec reader uses an equality lookup for a caller-supplied fingerprint (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:510-516`), while the marker lookup is also exact (`code-symbol.store.ts:199-205`). No non-spec enumeration of `indexing_state` was found.

2. **FIXED — MODERATE: purge failure reported as completion.** `purgeAbsentPaths` now logs and rethrows a `purgeMissing` error (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:1054-1068`), so control cannot reach the success log or `complete: true` return (`:919-938`). `indexWorkspace` starts as `incomplete` and only settles `current` after a complete run returns (`:498-510`); the revised test proves rejection and incomplete coverage (`code-symbol-indexer.service.spec.ts:1285-1300`). The non-awaited startup and lazy callers attach rejection handlers (`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:207-214`, `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts:265-278`); the user-initiated runner rethrows to its RPC caller (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:483-523`).

## New findings

1. **BLOCKING — destructive purge paths bypass the vec-outage transaction marker.** `purgeJunk` issues raw deletes with no vec availability check, vector delete, or `markVecStale()` call (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:958-990`) despite being reachable from the authorized RPC (`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:507-529`). `purgeWorkspace` has the same omission (`code-symbol.store.ts:993-997`). Make these paths use the same transaction/marker protocol as `deleteFileRows` (`:487-506`) so every committed outage mutation carries recovery state.

## Five logic questions

1. **Silent failure:** `purgeJunk` can report a successful deletion while leaving the vec recovery marker absent during an outage (`code-symbol.store.ts:958-990`), so later recovery lacks the durable fact that symbol rows changed.
2. **Unexpected user action:** invoking the UI/RPC junk purge while sqlite-vec is unloaded takes the unmarked destructive path (`memory-rpc.handlers.ts:520-529`).
3. **Wrong-answer input:** a deleted rowid subsequently reused before an unmarked recovery pass can associate an old vector with a new symbol; the guarded write paths avoid this, but the raw purge paths do not establish the same invariant (`code-symbol.store.ts:337-385`, `:958-997`).
4. **Dependency failure/shape:** vec unavailability is safely persisted for the four transactional paths, and purge persistence errors now reject the index run; the two raw deletion paths still do not record vec unavailability (`code-symbol.store.ts:435-465`, `code-symbol-indexer.service.ts:1059-1067`).
5. **Missing requirement:** the recovery design needs one enforced rule for every public `code_symbols` mutation, including maintenance purges, rather than only indexer-driven writes.

## Decisions

- Marker recovery after a prior-process outage is correct for marker-producing writes: availability is checked against SQLite state rather than only the in-memory `vecOrphansReconciled` flag (`code-symbol.store.ts:190-214`).
- I accepted the supplied scoped Jest/typecheck/lint/prettier evidence and ran no checks. Review scope included the changed store/indexer paths, their cited tests, all non-spec `indexing_state` references, and all grep-visible `CodeSymbolIndexer.indexWorkspace` callers.
