# Batch 36 implementation report

Workspace: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. No commit, Nx, Jest, build, or project tsc was run. The task folder's concurrently modified `batches.md` and `decisions.md`, and the separate lane-routing changes, were not edited by this lane.

## Files written

All paths below are absolute and under the assigned lane-outcomes library, except this declared report.

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\start.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\subagent-join.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\subagent-join.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.durability.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\pipeline.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-36-report.md`

## Decisions and assumptions

- Journal hand-off uses queue ownership before an await, following the existing `accept` pattern (`write/outcome-write-pipeline.ts:326`, `:394`). This is reversible and preserves the current journal format.
- Failed admission is a result, distinct from capacity, because the report tool expects a resolved result (`write/outcome-write-pipeline.ts:230`, `:340`). Waiting ops remain queued. This is reversible.
- Persisted envelopes require arrays, while their individual members are validated and retained independently (`store/key-value-lane-outcome.store.ts:28`, `:71`; `write/key-value-outcome-journal.ts:74`, `:107`). This follows TL-38 and is reversible with a future quarantine key.
- The host logger is already passed to the registration function (`di/register.ts:25`), so both stores can take it as a required argument (`di/register.ts:33`, `:39`). No token or registration was added.
- The valid non-subagent executor kinds are `cli` and `ptah-cli` (`lane-outcome.schema.ts:36`); regression rows use `cli`. The SQLite connection exposes synchronous transactions already used in the same store (`store/sqlite-lane-outcome.store.ts:186`).
- The existing barrel export names were preserved; `isSubagentRunId` remains an internal export from `subagent-join.ts:12`.

## Tasks and finding closure

### 36.1 — P2-F1, P2-F2, P2-F3

- `drain` takes `this.queue.splice(0)` before the journal await, restores `moved` at the front on failure, and no longer splices by count afterward (`write/outcome-write-pipeline.ts:394-405`). The acknowledgment still filters by sequence and keeps current journal entries (`:440-451`).
- `accept` restores waiting operations, warns with run ID and code, and returns `write-failed`; `submit` maps that to the fixed `outcome journal write failed` text (`write/outcome-write-pipeline.ts:230-235`, `:323-356`). The recovery spec checks a resolved failure, one relevant warning, then successful waiting-op application (`write/outcome-write-pipeline.spec.ts:147`).
- The single capacity and sequence rule is `appendEntries` (`write/key-value-outcome-journal.ts:47`), called by journal `append` (`:156`), pipeline `accept` (`write/outcome-write-pipeline.ts:335`), `drain` (`:397`), and `dispose` (`:707`). The helper spec checks individual refusal counts and consecutive sequence numbers (`write/key-value-outcome-journal.spec.ts:28`). Named constants are at `write/outcome-write-pipeline.ts:90-94`. The three run-ID checks use `isSubagentRunId` (`subagent-join.ts:12`, `write/outcome-write-pipeline.ts:272`, `:306`, `:634`), with spec coverage (`subagent-join.spec.ts:38`). The requested grep for `5000` or `startsWith('subagent:')` in the pipeline returned no matches.
- `GatedMemoryState` blocks the first journal storage update (`write/pipeline.test-support.ts:33`); the regression spec starts `drain(a)`, submits a report while storage is blocked, enqueues `c`, releases the gate, and checks the three distinct journal sequences, all store effects, and an empty journal (`write/outcome-write-pipeline.spec.ts:114`). Before the fix, `drain` copies `a` without removing it. `accept` then removes and journals `a` with the report. `enqueue(c)` adds `c`. When the first update resolves, the old `drain` splices one queue item, removing `c`; `a` has two sequence numbers and `c` has none. Those assertions fail on the old code.

### 36.2 — P2-F4, P2-F5

- SQLite `update` now reads, decodes, patches, and writes inside one synchronous transaction with no await (`store/sqlite-lane-outcome.store.ts:269-282`). The `Promise.all` patch/revise spec also checks the receipt (`store/sqlite-lane-outcome.store.spec.ts:90`). Before the fix, `update` pauses at `await get`, then the revise transaction increments `reviseRounds` and writes its receipt. The paused update resumes with its stale row and writes all columns, restoring `reviseRounds: 0`. The spec expects `1`, so it fails on the old code.
- SQLite `decodeMany` skips malformed rows and emits one count/code warning per read (`store/sqlite-lane-outcome.store.ts:83-101`); `listByRoles` collects raw rows before decoding once (`:313-329`). Single-row `decode` remains strict (`:69-80`). The raw-SQL invalid-verdict spec covers both lane and role reads (`store/sqlite-lane-outcome.store.spec.ts:58`).
- The KV store validates the envelope and each row, receipt, hold, and budget-stop ID, retaining valid members and warning with counts (`store/key-value-lane-outcome.store.ts:28-88`). Specs cover a mixed snapshot and a non-object envelope (`store/key-value-lane-outcome.store.spec.ts:40`, `:63`). The journal validates its envelope, entries, and held-run indexes, exposing `droppedOnRead`; the pipeline emits the recovery warning (`write/key-value-outcome-journal.ts:74-122`, `write/outcome-write-pipeline.ts:174`; spec `write/key-value-outcome-journal.spec.ts:51`). The rejected ledger is validated at construction and rejection (`write/outcome-write-pipeline.ts:190`, `:659`); the corrupt-ledger spec confirms a later permanent rejection is recorded (`write/outcome-write-pipeline.spec.ts:83`). Recovery warnings carry counts/codes only. Degradation markers are attached to the parse catches (`store/key-value-lane-outcome.store.ts:35`, `:61`; `write/key-value-outcome-journal.ts:36`, `:100`; `write/outcome-write-pipeline.ts:198`) and the SQLite decode catch (`store/sqlite-lane-outcome.store.ts:90`).
- Both stores require a logger (`store/key-value-lane-outcome.store.ts:49`, `store/sqlite-lane-outcome.store.ts:60`); registration and every library-local constructor call site were updated, including `write/pipeline.test-support.ts:138` and `write/outcome-write-pipeline.durability.spec.ts:435`.

### 36.3 — P2-F6

- Non-subagent deliverables preserve a failed verdict or any verdict with a non-null failure class, while keeping report metadata and the first declaration timestamp (`store/lane-outcome.store.ts:49-60`). In-memory specs cover failed, classified no-deliverable, unverified, receipt, metadata, and unchanged subagent behavior (`store/in-memory-lane-outcome.store.spec.ts:6-52`). SQLite covers the failed lane and receipt (`store/sqlite-lane-outcome.store.spec.ts:114`).

### 36.4 — P2-F7

- The pipeline header states the journal, queue, hold, retry, rejection, and capacity invariants (`write/outcome-write-pipeline.ts:1-10`). Each store port method documents its return state or empty/null meaning (`store/lane-outcome.store.ts:69-111`). Registration, startup, pipeline token, and each DI token have JSDoc (`di/register.ts:21-25`, `di/start.ts:13`, `di/tokens.ts:2-17`). The barrel has contracts/stores/wiring groups (`src/index.ts:1`, `:24`, `:42`). `di/start.ts`, `di/tokens.ts`, and `src/index.ts` changed only comments; exports are unchanged.

## Verification and risks

- `ptah_get_diagnostics` scoped to changed lane-outcomes files: 0 errors, 0 warnings, clean coverage. This includes spec files.
- `npx prettier --check <all 18 changed library files>`: `All matched files use Prettier code style!`
- `npx eslint <all 18 changed library files>`: exit 0, no output.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`: `degradation-audit: TOTAL 296 unsuppressed site(s)`; no FAIL. The first audit found seven orphaned/new sites while markers sat beside `safeParse` branches. Markers were moved to the actual recovery catches; the final run passes without baseline changes.
- `npx ts-node --transpile-only tools/di-lint/check-injects.ts`: `di-lint OK: 1841 @inject sites all resolve to a registered token (807 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`.
- The team leader must run the lane-outcomes Nx test, typecheck, and lint targets in Mode 2. No guard spec applies because this batch adds no DI registration, RPC method, or MCP tool.
- The concurrency risk is covered by the gated hand-off spec and sequence-based acknowledgment. The corruption risk is covered by valid-remainder recovery specs. The SQLite stale-write risk is covered by the concurrent update/revise spec. The failed-verdict risk is covered in both stores. Logs introduced here contain identifiers, counts, and codes, never storage paths or error messages.
