# Code Logic Review — `TASK_2026_440_834c` (Batch 4: diagnostics contract)

Scope reviewed: `libs/backend/memory-curator/src/lib/diagnostics.types.ts`,
`diagnostics.service.ts`, `diagnostics.service.spec.ts`;
`libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (`storage` field only);
`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts` + `.spec.ts`. Read in
full, not only the diff. Cross-checked against the committed `memory-retention.service.ts`
and `observation-retention.store.ts` (Batch 3) for the `storageHealth()` call graph. Ran
`npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers --parallel=1`
myself: 35/35 memory-curator suites pass (547 passed, 59 skipped, pre-existing native-gated
suites), 99/99 rpc-handlers suites pass (2993 passed, 33 skipped). No source was modified.

## Summary

| Metric              | Value                    |
| -------------------- | ------------------------ |
| Overall score         | 6/10                      |
| Assessment            | APPROVED WITH FIXES       |
| Blocking issues       | 0                         |
| Serious issues        | 1                         |
| Moderate issues       | 1                         |
| Failure modes found   | 1                         |

## Five logic questions

### 1. How does this fail silently?

It does not, for the paths this batch owns. `storageHealth()` is a total function: `readPageStats`
returns `ZERO_STATS` instead of throwing (`sqlite-page-reclaimer.ts:86-97`), `readLiveStorage` wraps
every read in a local `try/catch` and reports failures as `readErrors` entries rather than
propagating them (`observation-retention.store.ts:432-443`), `readState()` is wrapped by
`memory-retention.service.ts:213-218`, and `readSettings()` in the same service degrades to
`MEMORY_RETENTION_DEFAULTS` on a config-read failure (`memory-retention.service.ts:645-654`). The
RPC handler's own `try/catch` (`memory-rpc.handlers.ts:517-590`) is therefore a second line of
defence that should never trigger from `storage` specifically — verified, not merely assumed.

### 2. What user action produces unexpected behaviour?

Opening the Memory diagnostics tab while the observation queue carries a large unprocessed
backlog (the exact condition retention exists to relieve) makes every 30 s poll
(`DIAGNOSTICS_POLL_MS`, `memory-diagnostics-state.service.ts:19,138`) pay for a table scan
proportional to backlog size on the same synchronous SQLite connection Electron's main thread
uses for everything else. See Failure modes below.

### 3. What input data produces a wrong answer?

None found in the reviewed files. `storage` is passed through by reference
(`storage: snapshot.storage` at `diagnostics.service.ts:61`, `storage: snapshot.storage` at
`memory-rpc.handlers.ts:562`) with no re-derivation, so there is no second place for a mapping
bug to hide. `memory-rpc.handlers.spec.ts:672-687` pins object identity end to end.

### 4. What happens when a dependency fails?

`MemoryDiagnosticsService.getSnapshot` calls `this.retention.storageHealth()` unconditionally,
with no local `try/catch` around that one call (`diagnostics.service.ts:43-64`). This is safe only
because `storageHealth()` itself is documented and implemented as never-throwing. If a future
change to `MemoryRetentionService.storageHealth()` introduces a throw (e.g. a new field computed
outside the existing guarded reads), `getSnapshot` has no defence of its own — the RPC handler's
catch would turn it into a generic `PERSISTENCE_UNAVAILABLE` for the whole diagnostics payload,
not just the storage panel, since `storage` is not independently optional on the snapshot type.
That is an acceptable trade today (the plan explicitly made `storage` required), but it is a
single point of failure the reviewed code does not defend beyond trusting the callee's contract.

### 5. What is missing that the requirements never mentioned?

The Batch 4 quality requirement ("diagnostics poll issues no unfiltered `COUNT(*) FROM
observation_queue`") and the batch report's evidence trail only checked that `pendingBytes` shares
the same `WHERE processed_at IS NULL` predicate as `pendingRows`. Neither the requirement nor the
report distinguishes a predicate-only scan (cheap: the predicate columns are the index's own
key columns) from a predicate-plus-payload scan (costly: the payload columns are not in the index,
so every matching row needs a base-table lookup). See Failure modes.

## Failure modes

### `PENDING_BYTES_SQL` is an unbounded per-poll scan over backlog payload size

- Trigger: the observation queue has a non-trivial unprocessed backlog (curator behind, boot
  scan not yet drained, or retention itself deferred by a gate — `boot-deferred`, `on-battery`,
  `foreground-active` are all documented skip paths in `memory-retention.service.ts:11-21`) at the
  moment the diagnostics tab is open and polling.
- Symptom: every 30 s poll (`DIAGNOSTICS_POLL_MS`) blocks the shared synchronous SQLite connection
  — and, per `observation-retention.store.ts:9-11`'s own docblock ("better-sqlite3 runs on the
  calling thread, which in Electron owns every window"), the whole Electron main process — for the
  duration of the scan. The codebase has already paid for exactly this class of bug: the same
  CLAUDE.md documents a 766 ms/batch full scan measured on the live file for a bare
  `processed_at < ?` without statistics, and a since-deleted unbatched DELETE of ~174k rows that
  used to run on the main thread. A recent commit on this branch (`c5caa7c8c`) opened
  TASK_2026_437 for "the Electron main-process freeze," which is the same failure shape.
- Evidence: `observation-retention.store.ts:99-104` (`PENDING_BYTES_SQL`) sums
  `octet_length(tool_response_text) + octet_length(tool_input_json) + octet_length(assistant_message)
  + octet_length(user_prompt) + octet_length(file_path)` over every row matching
  `processed_at IS NULL`, with **no `LIMIT`**. `idx_obs_queue_drain` is defined as
  `(processed_at, captured_at) WHERE processed_at IS NULL` (`migrations/0016_observation_queue.ts:33`)
  — it covers the predicate and the `pendingRows`/`oldestPendingAt` read (`PENDING_SUMMARY_SQL`,
  `observation-retention.store.ts:95-97`, index-only, O(1)-ish per matching key) and the
  `stuckEligibleRows` count (`STUCK_ELIGIBLE_COUNT_SQL:106-108`, also index-only), but **not**
  the five payload columns `PENDING_BYTES_SQL` reads. Those live in the base table, so the query
  plan is an index range scan for row identification followed by a base-table lookup per row —
  cost scales with the number of pending rows, unlike its two index-only siblings in the same
  function. `readLiveStorage` (`:416-481`) calls all four reads unconditionally on every
  `storageHealth()` call, which `MemoryDiagnosticsService.getSnapshot` calls on every
  `memory:diagnostics` RPC (`diagnostics.service.ts:61`), which the frontend calls every 30 s
  while the tab is open (`memory-diagnostics-state.service.ts:138`).
- Current handling: none — no `LIMIT`, no sampling, no caching of the result between polls, and no
  cost note anywhere in this batch's changed files. Batch 4's own report
  (`batch-4-report.md:24-27`) treats "same predicate as pendingRows" as sufficient evidence of
  safety; it is not, because the predicate is not what makes the other two reads cheap — the
  index covering the SELECTed columns is.
- Recommendation: either (a) bound `PENDING_BYTES_SQL` the same way `STUCK_PAYLOAD_BYTES_SQL`
  is bounded during a retention batch (a `LIMIT` plus reporting "at least N bytes" or "unknown
  above N rows"), or (b) drop live per-poll byte measurement and report `pendingBytes` from the
  last retention run's estimate the way `processedBytesEstimate` already does
  (`memory-retention.service.ts:236-240`), or (c) add an explicit row-count gate before running
  the byte sum (skip it and report `null` when `pendingRows` exceeds a threshold, matching the
  `readErrors`-degrades-gracefully pattern the rest of the module already uses). This is a
  regression risk specifically because the feature that is supposed to relieve backlog cannot be
  observed cheaply while the backlog it targets is large — the exact moment the diagnostics panel
  is most likely to be open.

## Blocking issues

None.

## Serious issues

### `PENDING_BYTES_SQL` per-poll cost is unbounded and unmeasured

- File: `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts:99-104`
- Scenario: large unprocessed backlog + diagnostics tab open (see Failure modes above for the
  full trace).
- Impact: repeated main-thread stalls every 30 s for as long as the tab stays open and the
  backlog stays large — a UI freeze pattern this codebase has already logged as a defect class
  (TASK_2026_380, TASK_2026_437) and is actively working through on this branch.
- Fix: see the three options above; (a) or (c) keep the number live and useful while bounding
  worst-case cost, (b) is simplest but trades liveness for safety. Whichever is chosen, add a
  regression spec against a large synthetic backlog asserting the query plan does not scan
  unboundedly (mirroring the existing "no bare SCAN observation_queue" style assertions already
  used elsewhere in this store's spec suite), and a timing note in `observation-retention.store.ts`'s
  own docblock next to the other measured numbers it already carries (766 ms, 72 ms/1.4 s).

## Moderate and minor issues

### `getSnapshot` has no local guard around `storageHealth()`

- File: `libs/backend/memory-curator/src/lib/diagnostics.service.ts:61`
- A future change to `MemoryRetentionService.storageHealth()` that introduces a throw would take
  down the entire `memory:diagnostics` payload (dbHealth, triggers, recent events — everything),
  not just the storage panel, because `storage` is required and there is no per-field isolation.
  Not a defect today (the callee is verified never-throwing), but worth a one-line defensive
  `try/catch` at the call site or a comment recording the invariant the caller is relying on, so
  a later change to the callee does not silently create this coupling.

## Data flow

1. `MemoryRetentionService.storageHealth()` — reads page stats, live backlog counts/bytes, and
   the last recorded run, never throws. **OK**, verified against the actual implementation, not
   the docstring alone — except for the unbounded `pendingBytes` cost noted above.
2. `MemoryDiagnosticsService.getSnapshot` — calls `storageHealth()` and assigns it verbatim to
   `snapshot.storage` (`diagnostics.service.ts:61`). **OK** — no second mapping, no transformation
   that could drift from the source.
3. `MemoryRpcHandlers['memory:diagnostics']` — assigns `snapshot.storage` verbatim to the wire
   result (`memory-rpc.handlers.ts:562`), inside a `try/catch` that turns any thrown error into
   `PERSISTENCE_UNAVAILABLE` (`:583-589`). **OK** for correctness; the failure-mode coupling noted
   above means this catch is now doing more implicit work than its neighbours, since a storage
   failure and a dbHealth failure both funnel through the same generic error.
4. Wire contract — `MemoryDiagnosticsResult.storage: MemoryStorageHealthDto` is required
   (`rpc-curator-diagnostics.types.ts:179`), the same type `MemoryRetentionService.storageHealth()`
   already returns and the same type `MemoryDiagnosticsSnapshot.storage` already carries
   internally (`diagnostics.types.ts:62`) — one DTO, no shadow type, deliberately (this mirrors
   the "no second mapping" requirement the team-leader wrote into Batch 4's verification). **OK**.
5. Frontend consumers — `memory-diagnostics-rpc.service.ts` and
   `memory-diagnostics-state.service.ts` pass the RPC result through without constructing a
   literal against the interface, so the new required field does not fail their compile (matches
   the plan's own "Plan validation" note, verified independently: their `.spec.ts` fixtures at
   `memory-diagnostics-state.service.spec.ts:41-52` and
   `memory-diagnostics-rpc.service.spec.ts:35-57,71-94` are untyped object literals passed to
   `jest.fn()`/`mockResolvedValue`, so TypeScript never checks them against
   `MemoryDiagnosticsResult`). **OK for compile; incomplete for behaviour** — see Requirements
   fulfilment below. `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx` reads fields off the
   RPC result without a literal construction either, so it also compiles unchanged, but it also
   does not surface `storage` to the TUI user — it silently has no code path for the new field
   yet, which is fine only because Batch 6 is explicitly scoped to add it.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `storage` required end to end with no second mapping | COMPLETE | Verified by direct read of all four hops; `.toBe()` identity assertion in `memory-rpc.handlers.spec.ts:685` pins it. |
| RPC handler diff exactly one line | COMPLETE | `git diff --stat` on the four production files: `memory-rpc.handlers.ts` is `1 +`, `0 -`; matches `batch-4-report.md:37-38`. |
| No new RPC method / prefix | COMPLETE | `MemoryRpcHandlers.METHODS` unchanged (still 15 entries, `memory:diagnostics` pre-existing); no `ALLOWED_METHOD_PREFIXES` touched. |
| `storageHealth()` is index-bounded and cannot throw into the handler | PARTIAL | Cannot-throw: COMPLETE, verified against Batch 3 code. Index-bounded: `pendingRows`, `oldestPendingAt`, `stuckEligibleRows` are index-only; `pendingBytes` is not — it is a full backlog scan of five TEXT columns with no `LIMIT`. This is the batch's one real gap. |
| DI injection correct, no resolution cycle | COMPLETE | `MemoryRetentionService`'s constructor (`memory-retention.service.ts:143-155`) does not depend on `MemoryDiagnosticsService` or `MEMORY_TOKENS.MEMORY_DIAGNOSTICS_SERVICE`; the dependency is one-directional. `register.ts:152` already registers `MEMORY_RETENTION_SERVICE` per the batch report. |
| Specs fail on regression | COMPLETE | `diagnostics.service.spec.ts:217-232` asserts `snap.storage` is the exact object the retention mock returned; `memory-rpc.handlers.spec.ts:672-687` asserts the same through the RPC boundary via `toMatchObject`. Both would fail if the `storage:` line were deleted at either hop. |
| List every other consumer that now breaks or lacks `storage` | COMPLETE (this review) | See Data flow item 5 and the table below — nothing breaks; two frontend spec fixtures and the TUI panel simply do not yet exercise the field, which is Batch 6's scope per `batches.md:558-598`. |

Implicit requirements not addressed: a cost bound or measurement for the new per-poll live query
(`PENDING_BYTES_SQL`), matching the precedent this same lib already sets for every other
non-trivial query (`observation-retention.store.ts` carries measured timings for its purge and
total-row queries; this one carries none).

## Consumers of `MemoryDiagnosticsResult` / `MemoryDiagnosticsSnapshot`

| Consumer | File | Breaks? | Notes |
| --- | --- | --- | --- |
| `MemoryDiagnosticsService` (producer) | `diagnostics.service.ts` | No | In scope, complete. |
| `MemoryRpcHandlers` (producer) | `memory-rpc.handlers.ts` | No | In scope, complete. |
| `memory-diagnostics-rpc.service.ts` | frontend, Electron/VS Code webview | No | Pass-through typed return; no literal construction, compiles. Does not read `storage` yet. |
| `memory-diagnostics-rpc.service.spec.ts` | frontend spec | No (compiles) | Fixtures at `:35-57,71-94` lack `storage`; untyped literal, so no compile break, but the spec cannot regress-test the new field until Batch 6 types it. |
| `memory-diagnostics-state.service.ts` | frontend state | No | Same pass-through pattern; Batch 6 scope per `batches.md:558-598` (Wave 4, "needs 4"). |
| `memory-diagnostics-state.service.spec.ts` | frontend spec | No (compiles) | `snapshot` literal at `:41-52` lacks `storage`; untyped, no break. R-TL3 in `batches.md:102` already flags the follow-on risk for `memory-curator-tab.component.spec.ts`'s stub. |
| `memory-diagnostics-accordion.component.ts` | frontend UI | No | Not inspected in depth (out of this batch's file list); does not read `storage` today per the plan's Batch 6 scoping. |
| `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx` | CLI TUI | No | Reads fields off the result without a literal; no reference to `storage` found — the TUI simply has no UI for it yet. Confirm whether a TUI batch is planned; if not, this is a silent feature gap (TUI users get no retention visibility) rather than a compile or runtime break. |
| e2e harness (`webview-e2e-harness`, `ptah-electron-e2e`) | — | Not found | No grep match for `MemoryDiagnosticsResult`/`MemoryDiagnosticsSnapshot` in `apps/*-e2e`; nothing to break. |

None of these consumers throw, crash, or silently corrupt data from this change. The gap is
purely a missing-feature one (no UI yet for `storage`), already tracked as Batch 6, plus the one
frontend risk (`R-TL3`) the team-leader already recorded in `batches.md`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `storageHealth()` returns all-null fields (fresh DB, never ran) | YES | Every field in `MemoryStorageHealthDto` is nullable except `retention.enabled/processedDays/stuckDays`; `storage` itself is still a well-formed object. | None. |
| Diagnostics called before `MemoryRetentionService` construction settles (`bootDeferralMs`) | YES | `storageHealth()` does not gate on the boot-deferral timer — it always attempts a live read, independent of whether a *run* would be allowed. | None; this is correct, since diagnostics is a read, not a run. |
| Large unprocessed backlog at poll time | NO | No bound on `PENDING_BYTES_SQL`. | Primary finding above. |
| `sqlite.db` getter throws mid-poll (connection closing) | YES | `readLiveStorage` catches the `connection.db` access itself (`observation-retention.store.ts:419-430`) and returns an all-null reading with a `readErrors` entry. | None. |
| Storage DTO passed through two hops without transformation | YES | Verified identity by reference at both hops; a spec pins each. | None. |
| Frontend receiving the new required field without reading it | YES (compiles) | Structural typing / untyped test fixtures. | Feature gap tracked in Batch 6, not a defect of this batch. |

## Verdict

- Recommendation: APPROVE WITH FIXES
- Confidence: HIGH
- Top risk: `PENDING_BYTES_SQL` (`observation-retention.store.ts:99-104`) is an unbounded,
  unmeasured scan over every unprocessed row's payload size, called on every 30 s diagnostics
  poll, on the same synchronous main-thread connection this codebase has already logged main-thread
  freezes against (TASK_2026_380, TASK_2026_437). It fires hardest exactly when the backlog
  retention exists to fix is largest.
- What a robust implementation would add: (1) a `LIMIT`/sampling bound or a cached/last-run
  estimate for `pendingBytes`, matching the precedent `processedBytesEstimate` already sets; (2) a
  regression spec asserting the query plan or an explicit row-count cap, mirroring this store's
  existing "no bare SCAN" assertions; (3) a one-line defensive boundary (or at minimum a comment)
  at `diagnostics.service.ts:61` recording that `getSnapshot` trusts `storageHealth()`'s
  never-throws contract with no local fallback of its own.
