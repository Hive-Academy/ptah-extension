Review type: CLI-to-CLI (codex reviews grok), pinned by the user

## Verdict: REVISE — 4/10

This is below 5 because two required safety properties fail on reachable runtime paths; it is above 3 because normal complete runs do sort, count the cap accurately, scope SQL by `workspace_root`, and use a real SQLite transaction when the production adapter is present. It would reach 5+ after cancellation cannot purge and vector/symbol deletion is consistent regardless of temporary vector availability.

1. **Blocking — cancellation of the final (or only) batch still purges.** `code-symbol-indexer.service.ts:897-918` checks `signal.aborted` only when another batch follows. A user can cancel during a one-batch run, or during its last batch: the loop finishes, then `run.census === 'complete'` calls `purgeMissing`. This violates the explicit requirement that cancelled runs never purge, and reports a success-looking completed index after cancellation. The test at `code-symbol-indexer.service.spec.ts:1172-1191` cancels before a non-final boundary only, so it misses this path. Check cancellation before starting work and after every batch, including the last, before any purge.

2. **Blocking — a temporary vector outage leaves stale/orphan vector rows.** `code-symbol.store.ts:167-181` only prepares vector deletion when `vecStatus.available`; both `replaceFileSymbols` (`:207-215`) and `purgeMissing` (`:277-302`) consequently delete `code_symbols` while retaining `code_symbols_vec` when it is false. Once vec becomes available again, an old rowid can be reused for a different symbol (wrong semantic hit), or a purged row remains orphaned. This breaches the required FTS/vector co-deletion and makes recovery return wrong answers rather than an error. The native tests at `code-symbol.store.spec.ts:1459-1609` exercise only vector-available cleanup.

3. **Moderate — atomic replacement is optional at the declared sink boundary.** `code-symbol-indexer.service.ts:180-187,1037-1053` adds methods only through a local optional duck type, while `memory-contracts/src/lib/symbol-sink.port.ts:19-33` still promises only delete/insert. Any valid non-`MemoryStoreSymbolSink` implementation silently takes the old delete-then-insert fallback, so an insert failure erases its prior symbols. The grep audit found other `ISymbolSink` implementations in `language-honesty.contract.spec.ts:1282-1490`; production adapter wiring is correct at `symbol-sink.adapter.ts:42-56`, but the interface does not enforce the Batch 12 atomicity contract across hosts. Add the operations to the port (or make the indexer depend on a required transactional port) and update implementations.

4. **Moderate — purge safety and batching tests do not cover the stated boundary cases.** `code-symbol.store.ts:127,308-314` batches at 200 files, but the new test uses one missing path (`code-symbol.store.spec.ts:1548-1605`), so it does not prove the 200/201 boundary or rollback of a later batch. `code-symbol-indexer.service.spec.ts:1193-1203` covers truncation and `:1172-1191` only an intermediate abort; neither proves governor-abort, final-batch abort, or path casing/trailing-separator behavior on Windows. Those omissions leave the destructive paths above undetected.

## Five logic questions

1. **Silent failure:** the optional sink fallback reports a handled per-file failure after it has already deleted old rows; final-batch cancellation proceeds to purge as if successful.
2. **Unexpected user action:** cancelling a small/final-batch reindex can still mutate and purge the index.
3. **Wrong-answer input:** replacing or purging while vec is temporarily unavailable leaves stale embeddings that later map to no row or a reused rowid.
4. **Dependency failure/shape:** vector availability is treated as permission to skip cleanup; a legacy sink lacking optional methods falls back to non-atomic writes.
5. **Unspecified/missing:** there is no enforced cross-host transactional sink contract, nor tests for final cancellation, governor cancellation, SQLite batch boundary, or Windows canonical-path cases.

## Round 2 (after revision 1)

### Verdict: REVISE — 5/10

Findings 1, 3 and 4 are fixed: abort checks now precede writes, follow every batch and precede purge (`code-symbol-indexer.service.ts:857-860,896,903,915-918`), the port requires both operations (`symbol-sink.port.ts:37-49`), and the 201-path/rollback/root-scope cases are exercised (`code-symbol.store.spec.ts:1731-1839`). The production adapter forwards both operations (`symbol-sink.adapter.ts:42-55`); repo-wide `ISymbolSink` implementations are either that adapter or non-production test/null sinks. The score rises above 4 because those destructive paths are now guarded, but remains below 6 because a normal vec outage can silently attach an old embedding to a new symbol. It would reach 6+ once recovery cannot retain a rowid-reuse embedding and a purge failure is observable to the caller.

1. **Blocking — rowid reuse during a vec outage still returns wrong semantic results.** `replaceFileSymbols` deliberately leaves vec rows when vec is unavailable (`code-symbol.store.ts:233-247,273-281`), then deletes/inserts `code_symbols` in one transaction (`:281-295`). Because `code_symbols.id` is TEXT rather than `INTEGER PRIMARY KEY` (`0013_code_symbols.ts:14-25`), SQLite can reuse the deleted implicit rowid. Once vec returns, `reconcileOrphanVecRows` only deletes rowids absent from `code_symbols` (`code-symbol.store.ts:174-203`), so the stale embedding is *not* an orphan; it is joined to the replacement symbol. The delete-before-insert protection (`:296-308`) applies only if that new symbol is subsequently written again while vec is available. A search immediately after recovery can therefore rank a changed file using its previous content. The new test masks this by calling `insertBatch([second])` after recovery (`code-symbol.store.spec.ts:1691-1705`), rather than searching the replacement already committed during the outage. Reconcile rows whose vectors need regeneration, or prevent rowid reuse / remove vectors for all rows replaced while vec was unavailable.

2. **Moderate — a failed purge is reported as a completed index.** `purgeAbsentPaths` catches and only logs any `purgeMissing` failure (`code-symbol-indexer.service.ts:1055-1067`), then `indexWorkspace` logs completion and returns `complete: true` (`:920-935`). A mid-batch SQLite failure thus leaves stale paths while callers receive a success-looking full index. Propagate the failure or return an incomplete result so a retry can be scheduled. No revised test asserts the caller-visible outcome of a purge failure.

### Round-2 logic answers and scope

1. **Silent failure:** vec recovery and purge failure both yield a usable/successful-looking index with stale results.
2. **Unexpected action:** edit/reindex a file while sqlite-vec is down, then search after it returns.
3. **Wrong-answer input:** a replacement that reuses its old SQLite rowid retains the old embedding.
4. **Dependency failure:** vec unavailability is deferred but not fully repaired; a purge write error is swallowed.
5. **Missing requirement:** recovery needs an authoritative way to invalidate/rebuild vectors changed during an outage.

Read the complete changed production paths, Revision 1 report, required Batch 12 requirements, changed tests, migration, adapter/port/null sink, and grep-visible sink users. I accepted the orchestrator's targeted typecheck/lint/Jest evidence and did not run tests or the benchmark. `code_symbols_vec_rowids` is a sqlite-vec shadow table, maintained by the direct vec `DELETE`/`INSERT` writes, not an application mapping; reconciliation is a one-time full-table scan per availability stretch (`code-symbol.store.ts:174-215`), a potentially material startup/recovery cost but not the correctness defect above.

Read the five changed files and their relevant specs, Batch 12 requirements (`batches.md:1613-1647`), context, executor report, sink port, and all grep-visible sink call sites. The production write path is indexer → adapter → store; reads remain scoped by root, and store transactions keep symbol/FTS rows consistent when vectors are available. `ptah_get_diagnostics` was unavailable after 45 seconds (five files unchecked); author-reported targeted typecheck/lint/tests were not re-run because the benchmark is active.
