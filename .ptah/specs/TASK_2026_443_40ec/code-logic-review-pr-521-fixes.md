# Code Logic Review — PR #521 fixes — `TASK_2026_443_40ec`

Review target: the uncommitted diff over `memory-lifecycle.service.ts` + spec,
`memory.store.ts`, `memory-storage-health.ts`, `memory-retention.service.spec.ts`,
`memory-retention.integration.spec.ts`, `test-report.md`. The implementer report is
`pr-521-fixes-report.md`.

Score: **8/10** — Verdict: **APPROVED**

| Metric              | Value   |
| ------------------- | ------- |
| Blocking issues     | 0       |
| Serious issues      | 0       |
| Moderate issues     | 0       |
| Minor issues        | 3       |
| Failure modes found | 3       |

Verification I ran myself (read-only): full `@ptah-extension/memory-curator` jest run
(645 passed, 59 skipped, 0 failed), the real-SQLite integration suites under the
electron runner (17 passed), and `degradation-audit:lint` (exit 0, cache hit on the
current file content). Pre-fix behaviour was traced from the pre-fix source in the
diff hunks, not re-executed (reverting files is outside this review's rules).

## Per-item verification

### Item 1 — invalidation after a committed archival eviction — **CLOSED**

Fix verified at `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:171`
and `:186` (the `markChanged` callbacks) and `:255` (`if (batch.evicted > 0) markChanged();`),
inside `runEviction`. The root is added synchronously after each committed batch,
before `remaining -= batch.evicted`, `budget.consumeMemoryRows` and
`budget.yieldToEventLoop()`. A later throw, a later stop, or a later workspace cannot
lose it. The old placement — `roots.add` only after BOTH `runEviction` calls
(diff hunk, removed lines around old `:186`) — lost the root exactly as reported:
the recall `RetentionStepError` propagated to the `catch` at `:199` with
`result.evicted = 500` already committed, and the `finally` at `:207-209` saw
`roots.size === 0`.

Spec quality (`memory-lifecycle.service.spec.ts:271-295`): the fake store commits
500 archival rows (`evictions = [500]`, `archivalExcess = 1500 − 1000`) and throws
`RetentionStepError` from the recall call (`onBatch` keyed on `evict:recall`), so the
spec exercises the real defect path and asserts all three signals: `evicted: 500`,
`error.reason: 'sql-error'`, and `changed == [['/a']]`. Pre-fix this fails with
`changed == []` (traced; matches the report's pre-fix output). It also would NOT
pass under a fix that only moved the counter bump without preserving committed counts,
because it pins `evicted: 500` through the throw.

**Every loop audited — safe:**

- Delete loop: the `consume` callback adds every `batch.workspaceRoots` entry
  synchronously right after `call` returns (`memory-lifecycle.service.ts:122-129`),
  before `budget.observe` / `consumeMemoryRows` / `yieldToEventLoop`. A throw from a
  later iteration, from `beforeBatch`, or from `yieldToEventLoop` cannot un-add them.
- Archive loop: same shape at `:144-151`.
- A store call that throws never reaches `consume`, and the real store runs each
  batch inside one `inTransaction` (`memory-lifecycle.store.ts:158, 176`), so a
  thrown batch is rolled back — there are no committed rows to lose.
- The within-tier eviction case (batch 1 of archival commits, batch 2 throws) is
  covered by the same `markChanged` call at `:255`.
- The existing spec at `memory-lifecycle.service.spec.ts:231-252` already pins the
  delete-loop equivalent (10 committed batches, 11th throws, `changed == [['/delete']]`).

**No over-invalidation:** `markChanged` fires only when `batch.evicted > 0`
(`:255`), and the `finally` calls `markWorkspacesChanged` only when `roots.size > 0`
(`:208`). A workspace with zero committed rows never enters `roots`; a no-op run
bumps no cache generation.

**Batch 11 behaviour unchanged:** invalidation still in the `finally` (`:207-209`);
committed counters still accumulate on `result` before any throw (`:254`); outcome
mapping and single-flight release live in `memory-retention.service.ts`, untouched by
this diff; governor order in `beforeBatch` is untouched (`:268-286` — `hardStop` →
`memoryRowRoom` → `waitForGovernor` → batch); `markChanged` is synchronous, so no
`await` moved inside a transaction. The `for...of` gives each iteration a fresh
`workspace` binding, so the closure captures the correct root.

### Item 2 — all-workspace search generation — **CLOSED**

Fix verified at `libs/backend/memory-curator/src/lib/memory.store.ts:161-170`.
When at least one root was supplied and none of them was `null`/`''`, the method now
bumps `''` once. An existing `null`/`''` entry satisfies the unscoped bump and is
not duplicated. An empty iterable bumps nothing.

Spec quality (`memory-retention.integration.spec.ts:645-660`): the harness uses the
REAL `MemoryStore` (`:767-772`); the spec seeds one archival memory in
`/workspace-a`, runs a full lifecycle delete (`memoriesDeleted: 1`), and asserts
`getWriteCounter('')` advanced from `before` to `before + 1`. This proves the
UNSCOPED generation advanced, not the named one — pre-fix only `/workspace-a`
bumped and `''` stayed at 0 (traced; matches the reported `Expected: 1, Received: 0`).

**Ordinary-write contract preserved:** `bumpWriteCounter` is unchanged (`:173-176`)
and `markWorkspacesChanged` has exactly one production caller — the lifecycle
`finally` at `memory-lifecycle.service.ts:208`. Every ordinary write path
(`memory.store.ts:296, 448, 454, 476, 531, 569, 648`) calls `bumpWriteCounter`
directly, so inserts, merges, usage recording, `forget` and purge keep their exact
previous bumping behaviour. The existing store spec
`memory.store.spec.ts:158-160` (`['/ws/A', null, '/ws/A']` → `/ws/A` = 2,
`''` = 1) still holds under the new code, and passes in my run.

The bump is precise, not over-broad: an unscoped search cache key is
`q + '|' + '' + '|' + counter('')` (`memory-search.service.ts:209-216, 222-237`), so
deleting rows in `/workspace-a` must invalidate unscoped entries — which is what the
`''` bump does — while scoped caches for other workspaces stay valid.

### Item 3 — lifecycle-settings read error — **CLOSED**

Fix verified at
`libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:73-82`. The
existing catch now pushes `lifecycleSettings: <errorText>` into `readErrors`, and the
whole array is sanitized before it reaches the DTO at `:155-157`
(`readErrors.map(input.sanitizeError)`); production wires
`sanitizeError: sanitizeRetentionError` at `memory-retention.service.ts:225`, so the
message is routed through the path-redacting sanitizer like every other read error.
The defaults stay real: `lifecycleSettings` is initialized to
`MEMORY_LIFECYCLE_DEFAULTS` at `:72` and only overwritten on a successful read
(`:74`); `memory-lifecycle-config.ts:12-17` confirms the asserted values
(enabled true, 30, 60, 25 000).

Spec quality (`memory-retention.service.spec.ts:1065-1082`): asserts BOTH the four
default values in `health.memoryLifecycle` AND `readErrors` containing
`'lifecycleSettings: settings provider unavailable'` — the read error is the exact
thing that was missing pre-fix (`readErrors` absent → `toContain` on `undefined`;
matches the report's pre-fix matcher error).

Error-path safety: `errorText` (`:29-31`) is the same `instanceof Error` narrowing
used for the `retentionState` catch at `:93-95`; `readErrors.push` and the
`logger.warn` (pre-existing) cannot throw for any thrown value (`String(null)`
renders, it does not throw). The happy-path DTO stays clean — the full-object
equality spec at `memory-retention.service.spec.ts:1102-1150` expects no
`readErrors` key and passes, because a non-throwing provider adds no entry.

XB2: the annotation kind moved from `optional-capability` to `reported`, both valid
kinds (`tools/degradation-audit/check-degradation.ts:107`), and `reported` is now
accurate — the degradation is visible in the DTO. The audit passes (verified);
the site was already annotated, so the per-lib baseline is unchanged at 20.

### Item 4 — batch-size rule documentation — **CLOSED**

`test-report.md:297` now reads `max ≤ 120 AND p95 ≤ 100`, agreeing with the M4 table
bound at `test-report.md:287` and with the reported 200-row failure (max 133-1730 ms
over 120 at `:289-292` while p95 stayed under 100 — under the old `OR` wording the
200-row size would have wrongly read as a pass). The quoted task criterion at
`:299` ("max exceeds 120 ms OR p95 exceeds 100 ms" → fail) is equivalent to the AND
pass rule. Consistent.

## Findings

1. **Minor — item 1 spec does not pin the per-batch placement.**
   `memory-lifecycle.service.spec.ts:271-295`. The spec's recall throw happens after
   the archival call returned, so a weaker fix that only moved `roots.add` between
   the two `runEviction` calls would also pass it. The within-tier case (second
   archival batch throws after the first committed) and the stop-mid-eviction case
   (committed batch, then `beforeBatch` sets `stop` — old code broke here too,
   because the `break` at old `:173` skipped the add) are fixed in code at
   `memory-lifecycle.service.ts:255` but unpinned by any spec. The shipped behaviour
   is correct; only the regression net is looser than the fix.
2. **Minor — the lifecycleSettings read error's sanitization is never exercised.**
   `memory-retention.service.spec.ts:1065-1082` uses a message with no path
   (`'settings provider unavailable'`), and the "every read-error source"
   sanitization spec at `memory-retention.service.spec.ts:1189-1219` does not add a
   throwing settings provider. If the settings provider ever throws a Windows or
   POSIX path in its message, nothing proves `sanitizeRetentionError` redacts the
   `lifecycleSettings:` entry (the wiring at `memory-storage-health.ts:156` and
   `memory-retention.service.ts:225` makes it likely, but untested).
3. **Minor — residual, pre-existing: ordinary scoped writes still do not bump `''`.**
   `memory.store.ts:296` (`bumpWriteCounter(insert.workspaceRoot)` only). An unscoped
   search cached before an insert into `/ws/A` serves stale results for up to the LRU
   TTL (60 s, `memory-search.service.ts:187-189`). Item 2 closed the permanent,
   unbounded variant of this (lifecycle deletes never bumped `''`, so the cache key
   never changed); the insert variant is TTL-bounded and predates this PR, so it is
   out of scope — recorded here so it is not mistaken for closed.

## Five logic questions (abbreviated)

1. **Silent failure?** The one the fixes targeted is closed. Remaining silent-ish
   behaviour: a `MemoryStore` whose `evictBatch` under-reports `evicted` would skip
   `markChanged` (`:255`) — but that is a store defect outside this diff's reach.
2. **Unexpected user action?** None found; the new bump only invalidates caches, it
   does not change search results.
3. **Wrong-answer input?** A settings provider throwing a non-Error with a hostile
   `toString` could make `String(error)` throw inside `errorText`
   (`memory-storage-health.ts:29-31`) — same accepted pattern as the neighbouring
   `retentionState` catch, not a new exposure.
4. **Dependency failure?** Covered by items 1 and 3: store throw after commit,
   settings provider throw. Both now surface.
5. **Missing from requirements?** Finding 3 (unscoped generation after ordinary
   writes) and finding 1's unpinned stop-mid-eviction case.

## Data flow (eviction, post-fix)

`overCapWorkspaces` → `runEviction(archival)` → `beforeBatch` (hardStop → row-room →
governor) → `evictBatch` (one transaction) → `result.evicted +=` → `markChanged()`
→ roots — **OK** → throw in a later batch → `catch` keeps committed counters and
attaches the step error — **OK** → `finally` marks changed workspaces — **OK** →
`markWorkspacesChanged` bumps each scoped root plus `''` once — **OK**.

## Edge cases

| Case | Handled | Evidence |
| --- | --- | --- |
| Empty `roots` iterable (no-op run) | YES — no bump at all | `memory.store.ts:162-169` |
| `roots` contains `null` and/or `''` | YES — no double unscoped bump | `memory.store.ts:167-169` |
| Workspace with zero committed rows | YES — never added to `roots` | `memory-lifecycle.service.ts:255` |
| Stop set between eviction batches after a commit | YES — root already added | `memory-lifecycle.service.ts:243-258` |
| Non-`RetentionStepError` thrown mid-eviction | YES — rethrown at `:202`, `finally` still invalidates | `memory-lifecycle.service.ts:199-209` |

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: the item 1 regression net is looser than the fix (finding 1) — a future
  refactor that moves `markChanged` back to a deferred comparison would pass the new
  spec as long as the cross-tier ordering is kept.
- What a robust implementation would add: a within-tier eviction spec (first archival
  batch commits, second throws) and a stop-mid-eviction invalidation spec; a throwing
  settings-provider case inside the "every read-error source" sanitization spec.

All four items: **CLOSED**. No blocking, serious or moderate issue found; no change
outside the listed files (`git status` shows exactly the seven reviewed files plus the
implementer's own report).