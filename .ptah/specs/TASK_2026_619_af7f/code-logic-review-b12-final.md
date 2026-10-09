## Verdict: APPROVED — 8/10

The bounded correction closes the final persisted-recovery gap. This is an 8 rather than 9–10 because the native SQLite assertions remain environment-gated and the review was intentionally limited to this correction; no logical defect was found in the reviewed scope.

## Round-3 finding

1. **FIXED — BLOCKING: destructive purge paths now preserve vec-outage recovery state.** `purgeJunk` reconciles vec state before preparing its operations, selects each affected rowid and deletes its vec row before the matching symbol delete when vec is available, and does all pattern passes in one transaction (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:976-1018`). When vec is unavailable, it writes the stale marker only after at least one symbol delete, within that same transaction (`code-symbol.store.ts:999-1014`). `purgeWorkspace` applies the identical order and transactional marker rule (`code-symbol.store.ts:1025-1055`). A failed statement rolls back both the symbol writes and marker; a committed outage mutation therefore cannot lack recovery state. The available-path and outage-path regression cases cover the intended symbol/vector preservation and marker conditions (`libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts:1844-1940`, `:1942-2043`).

## Other mutation paths

The complete store grep for `DELETE FROM code_symbols`, `INSERT INTO code_symbols`, and `UPDATE code_symbols` found no additional public mutation path outside the following protocol-bearing methods:

- `replaceFileSymbols` reconciles before the write and marks outage mutations inside its transaction (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:298-385`).
- `purgeMissing` reconciles before its batched transactions and marks every non-empty outage batch (`code-symbol.store.ts:404-465`).
- `deleteByFile` delegates to `deleteFileRows`, which deletes vec rows first when available and marks an outage delete in the transaction (`code-symbol.store.ts:282-283`, `:468-510`).
- `insertBatch` reconciles before upserting and creates the marker in the transaction when vec is unavailable (`code-symbol.store.ts:513-584`).
- `purgeJunk` and `purgeWorkspace` now use the repaired protocol (`code-symbol.store.ts:958-1059`).

The correction does not double-count symbols matching more than one junk segment: each segment's symbol delete is performed before the next segment is selected, so later overlapping patterns see no already-deleted rows (`code-symbol.store.ts:999-1012`). It retains the tri-state scope contract: `null` is `IS NULL`, a string is an equality predicate, and only `undefined` is unscoped (`code-symbol.store.ts:68-76`, `:978-981`). The SQL-shape tests deliberately set vec unavailable, so the newly conditional vec statements do not precede the asserted symbol delete (`libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts:76-111`, `:231-249`).

## New findings

None found in the bounded correction.
