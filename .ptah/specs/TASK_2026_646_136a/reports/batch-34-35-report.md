# Batches 34–35: atomic outcome stores and report effects

## Files written

All paths below are absolute. `W` is `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`.

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\store.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\report-effect.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\report-effect.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-34-35-report.md`

The pre-existing uncommitted `libs/backend/lane-outcomes/src/index.ts` was left untouched; Task 15.3 owns its exports (`batches.md:693`).

## Task 34.1 evidence

- Port v2: `store/lane-outcome.store.ts:8-100` defines `LaneOutcomeRow`, effect resolver, atomic methods, budget marker, non-destructive list, and expiry return type. The old `recordReceipt` and `takeHeldReports` are absent.
- In-memory transactional staging: `store/in-memory-lane-outcome.store.ts:29-79`; report application and budget marker: `:81-128`; read and expiry behavior: `:182-212`.
- KV: one serialized `storage.update` per changed call and rollback on rejection at `store/key-value-lane-outcome.store.ts:55-75`; snapshot and eviction at `:78-116`; atomic method wrappers at `:128-155`.
- SQLite: `budget_stopped` decode at `store/sqlite-lane-outcome.store.ts:62-73`; synchronous transaction join at `:154-205`, receipt application at `:114-152`, budget marker at `:218-241`, hold list/expiry at `:339-364`.
- Test payload includes bytes at `store/store.test-support.ts:44`.

## Task 35.1 evidence

- Strict payload schemas and pure verdict/effect resolver: `write/report-effect.ts:8-78`. Invalid JSON or schema returns `null`.
- Verdict parity and invalid payloads: `write/report-effect.spec.ts:6-25`.

| Required fixture | Spec name and line |
| --- | --- |
| Verdict parity: no checks, all delivered, zero bytes, missing file, old mtime, null mtime, null startedAt | `reportEffectOf` / `%s verdict parity`, `write/report-effect.spec.ts:6` |
| Invalid JSON or `paths` key | `rejects bad JSON and extra paths without throwing`, `write/report-effect.spec.ts:18` |
| Join order, receipts, invalid held report and replay no-op | `joins deliverables then revise in held order, receipts once, replay no-op`, in-memory spec `:6`; `joins in held order in one update and replays without a write`, KV spec `:39`; `joins in held order with receipts and replay no-op`, SQLite spec `:52` |
| Join rollback | `rolls back a resolver throw mid-join`, in-memory spec `:47`; `restores row, holds and receipts when the join update rejects`, KV spec `:84`; `rolls back insert and held walk when resolver throws midway`, SQLite spec `:95` |
| `duplicate`, `missing`, `invalid` without write; `revise` once | `returns duplicate, missing and invalid without writing; revise once`, in-memory spec `:68`; `returns duplicate, missing and invalid without an update; revises once`, KV spec `:104`; `returns missing, invalid and duplicate without writes; revise once`, SQLite spec `:120` |
| Budget stop before and after insert; markers excluded | `applies budget stops before and after insert, excluding markers from hold views`, in-memory spec `:97`; `persists markers, flags, rows, receipts and holds across restart`, KV spec `:139`; `applies budget marker before insert and flag after insert, excluding markers`, SQLite spec `:153` |
| Non-destructive held list and expiry return including marker | `lists holds without deleting and returns expired reports including markers`, in-memory spec `:120`; `expires holds including markers and keeps the 497 plus one capacity case`, KV spec `:170`; `lists non-destructively, expires reports with markers and keeps 497 plus one`, SQLite spec `:182` |
| KV restart, SQLite reopen with holds | `persists markers, flags, rows, receipts and holds across restart`, KV spec `:139`; `reopens a file with held reports and a budget marker`, SQLite spec `:207` |
| KV >2,000 rows evicts oldest receipt and flag | `evicts the oldest row with its receipt and flag above 2000 rows`, KV spec `:187` |
| Existing 497 + 1 live hold case | `keeps the 497 plus one live-hold capacity case`, in-memory spec `:136`; `expires holds including markers and keeps the 497 plus one capacity case`, KV spec `:170`; `lists non-destructively, expires reports with markers and keeps 497 plus one`, SQLite spec `:182` |

## Assumptions and source evidence

- `budget_stopped` is already part of migration 0054, and the held table has unconstrained `kind TEXT`: `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts:52,83-91`. No migration or shared schema edit was needed.
- Verdict parity follows `sessionChildVerdictOf` at `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:132-145` and the explicit null-mtime/null-start clarification in `batches.md:155`. The resolver recomputes at apply time using the row's `startedAt` (`write/report-effect.ts:37-51`).
- The source search for `LaneOutcomeStore` / `LaneOutcomeRecord` under `libs` and `apps` found the shared type declaration, the lane-outcomes store implementations/specs, and the lane-outcomes pipeline consumer (`libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:6,77`); no other library or app consumer appeared. The pipeline is owned by Task 15.3 (`batches.md:684-705`).
- KV `budgetStopped` defaults to `[]` for old snapshots at `store/key-value-lane-outcome.store.ts:31`, as required by `batches.md:759`.

## Decisions

- Used a shared pure `applyOutcomeEffect` in the store port (`store/lane-outcome.store.ts:45`) so in-memory and SQLite apply the same deliverables/review field rules. SQLite uses its required SQL increment for `revise_rounds` (`store/sqlite-lane-outcome.store.ts:137-146`).
- KV skips `storage.update` for an unchanged snapshot (`store/key-value-lane-outcome.store.ts:62-69`), preserving no-write outcomes for `duplicate`, `missing`, `invalid` and replay.
- Kept `report-effect` internal until Task 15.3 exports it through the public index (`batches.md:693`).

## Verification and remaining work

- Ran Prettier only on the ten scoped source/spec files; `git diff --check` for the store directory reported no whitespace errors. No Nx, Jest, build, serve or e2e command was run, per decision #53 and `batches.md:767,807`.
- Task 15.3 must update the pipeline to the v2 methods; until then its calls to removed methods are expected to fail compilation (`batches.md:763,684-705`). Joint Mode 2 verification is pending (`batches.md:156,765-767`).

## Degradation-audit follow-up (orchestrator note)

- Changed `libs/backend/lane-outcomes/src/lib/write/report-effect.ts:58-61`: the JSON catch now binds `error: unknown`, narrows `SyntaxError`, and marks the intentional `null` result with `// degradation-audit: reported - ...`. Unexpected non-syntax errors propagate instead of being swallowed.
- Changed `libs/backend/lane-outcomes/src/lib/store/key-value-lane-outcome.store.ts:65-67`: the rollback catch now binds `error: unknown`, restores the snapshot, and rethrows. No sentinel is returned.
- A source search found no other catches in the Batch 34/35 files (`report-effect.ts:58`, `key-value-lane-outcome.store.ts:65`).
- Ran the permitted audit command once. Filtered output showed `degradation-audit: per-directory totals` and `TOTAL 296 unsuppressed site(s)` workspace-wide; it showed **no `lane-outcomes` line**, so the lane-outcomes directory has 0 reported sites. The audit ran before the final narrowing line was added; the marker and sentinel remained unchanged.
- Ran ESLint once on the ten Batch 34/35 source/spec files: 0 errors and one unused `error` warning in `report-effect.ts:58`. The final `SyntaxError` narrowing uses that variable; ESLint was not rerun because the orchestrator allowed one run.
- Caller warning remains Task 15.3 work: the current `write/outcome-write-pipeline.ts:269-318` is still the old pipeline and has no v2 `invalid` handling. Task 15.3 explicitly requires one warn per invalid joined report (`batches.md:698`) and invalid direct reports to be dead-lettered (`batches.md:699`). That file is outside this agent's scope (`batches.md:687-694`). The marker indicates a reported invalid result at the resolver boundary; the actual per-report warning must be verified in the joint Mode 2 after Task 15.3 lands.
