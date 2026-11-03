# Code Logic Review — `TASK_2026_870_session-stats-ledger`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Critical issues | 1 |
| Major issues | 8 |
| Minor issues | 4 |
| Failure modes found | 13 |
| Confidence | HIGH |

The ordinary SDK delta path is coherent. The migration is atomic. The repository uses parameterized SQL and rolls back failed writes. Unknown cost remains `NULL` on the ordinary path. Electron and CLI registrations are present.

The change is not ready for approval. Range stats can cross workspace boundaries. Codex and lane usage can be duplicated or omitted. Several valid revision and failure paths lose or inflate usage.

### Scope and verification

- Reviewed `git diff main -- libs apps` and all six untracked source files.
- Read the implementation plan and both Phase 1 reports.
- Ignored `task-tracking/landing-live-demo/HANDOFF.md` as requested.
- Did not run verify, build, or tests.
- Scoped `ptah_get_diagnostics` covered eight central files. It returned unavailable after 45 seconds. This is not a typecheck pass.
- The Phase 1 report also states that lint, test, and typecheck completion is not established.

## Five logic questions

### 1. How does this fail silently?

- An empty SQL ledger reports `claude-ledger: complete`. Existing users can see a complete zero summary even though no JSONL backfill exists (`usage-summary.service.ts:88-90`).
- A full sink queue drops the oldest accepted contribution. Later SQL reads cannot distinguish that loss from real usage (`sqlite-session-usage-sink.ts:65-71`).
- A lane row without a matching `sessions` row disappears from every workspace analytics query because the queries use an inner join (`session-stats-repository.ts:268-269`).
- Some Codex pricing transitions produce no contribution. The metadata total advances, but the ledger does not (`session-metadata-store.ts:284-301`).

### 2. What user action produces unexpected behaviour?

- Opening analytics after an upgrade can remove all historical Ptah usage while reporting complete status.
- Running a Ptah Codex session or Codex CLI lane can count the same native usage once from SQL and once from `CodexSource`.
- Requesting range stats with a session UUID from another workspace returns that session's usage under an authorized but unrelated workspace path.
- Resuming a run whose first accepted result equals its restored base can add a zero-usage message row.

### 3. What input data produces a wrong answer?

- Two successive Codex price corrections with the same revision and same positive delta reuse one event key. The second correction is ignored.
- A newer revision with fewer model rows leaves the old model or residual rows in the aggregate.
- An accepted SDK result with a lower rate-card cost cannot emit a negative correction. The additive ledger retains the old cost.
- A CLI lane with no matching session record produces valid rows that analytics never returns.

### 4. What happens when a dependency fails?

- Producer `try/catch` and promise handlers protect the agent stream. This part is correct (`session-stats-owner.service.ts:697-718`, `session-metadata-store.ts:1432-1457`).
- The sink retains a failed queue head and retries it when a later event arrives. This part is correct (`sqlite-session-usage-sink.ts:75-96`).
- The sink has no shutdown flush. A final failed write can be lost. Queue overflow also discards accepted data.
- A ledger read failure returns an explicit error or unavailable status. It does not silently become a successful zero (`session-rpc.handlers.ts:1317-1325`, `usage-summary.service.ts:91-94`).
- Migration failure rolls back S0002 through the existing migration runner (`migration-runner.ts:267-292`).

### 5. What is missing that the requirements never mentioned?

- Range reads need a session-to-workspace authorization check, not only a workspace-path check.
- Ptah and external Codex records need a canonical native-session identity for deduplication.
- The ledger needs durable capture coverage metadata before it can claim complete analytics.
- The sink needs a durable outbox or shutdown drain for accepted final events.
- SDK ingestion needs the real provider identity. `unknown` is not sufficient for provider analytics.

## Failure modes

### Critical — Range stats bypass workspace isolation

- Trigger: A caller supplies another workspace's session UUID and any authorized workspace path.
- Symptom: `session:stats-batch` returns model, token, cost, and message statistics for the other session.
- Evidence: The handler authorizes only `workspacePath` (`session-rpc.handlers.ts:1296-1302`). It then calls the ledger without that path (`session-rpc.handlers.ts:1311-1316`). The reader queries only `sessionId` (`session-stats-ledger-reader.ts:13-17`). The repository methods have no workspace predicate (`session-stats-repository.ts:205-243`).
- Current handling: Session IDs are validated syntactically, but their workspace ownership is not checked.
- Recommendation: Pass the authorized normalized workspace key into every ledger range-read method. Join `sessions` and require `s.session_id = ? AND s.workspace_key = ?` for the stats existence check, model rows, and event count. Return not found or a coded authorization error when the binding does not match. Add a two-workspace RPC regression test.

### Major — A newer event revision leaves stale rows behind

- Trigger: Revision 1 writes a model row plus `__session_residual__`. Revision 2 for the same event updates the model and no longer needs the residual.
- Symptom: The old residual remains. Aggregate recomputation counts it again.
- Evidence: Residual creation is conditional (`sqlite-session-usage-sink.ts:146-170`). `recordEvent` only inserts or updates the supplied rows (`session-stats-repository.ts:122-161`). It never deletes rows absent from the newer event. The aggregate sums every stored row (`session-stats-repository.ts:173-180`).
- Current handling: The primary key and revision guard work per model row, not per complete event.
- Recommendation: Replace the complete row set for `(session_id, producer, event_key)` in one transaction when a newer revision arrives. Track event-level revision separately if necessary. Delete obsolete model and residual rows before aggregate recomputation. Test residual removal and model removal.

### Major — Codex same-revision price corrections do not converge

- Trigger: Pricing becomes known at an unchanged revision, or two corrections at one revision increase cost by the same delta.
- Symptom: The first known price can be absent. Repeated equal deltas collide, so later corrections are ignored. Old unpriced markers can remain.
- Evidence: A transition from `previousCost === null` produces `costDeltaUsd === null` (`session-metadata-store.ts:284-298`). An event with no token delta and null cost returns `null` (`session-metadata-store.ts:299-301`). The correction key contains the delta, not the accepted absolute total (`session-metadata-store.ts:302-312`). Equal-revision, equal-authority conflicts do not update (`session-stats-repository.ts:135-138`).
- Current handling: The code treats corrections as additive delta events. The key does not uniquely identify each accepted correction.
- Recommendation: Store an authoritative producer snapshot per native revision and derive deltas from a stable pre-revision base, or persist unique signed corrections with explicit retraction of unknown-cost state. Do not key a correction by its delta. Test unknown-to-known, two equal increases, replay, and restart.

### Major — Ptah Codex usage overlaps the external Codex source

- Trigger: A Ptah Codex session writes to the default Codex home and also has ledger rows.
- Symptom: Facts, session count, message count, and top sessions can include the same native usage twice.
- Evidence: SQL facts use source `claude-ledger` (`usage-summary.service.ts:61-69`). `CodexSource` remains enabled when the repository exists (`usage-summary.service.ts:31-33`). It reads `~/.codex/sessions` and emits the native session ID (`codex.source.ts:15-18`, `codex.source.ts:52-64`). External deduplication is source-scoped, and session keys are also source-scoped (`usage-summary.service.ts:109-124`). Final counts add both collections (`usage-summary.service.ts:191-196`).
- Current handling: The implementation report names this overlap as unproven. The code does not suppress or reconcile it.
- Recommendation: Record normalized Codex home and native session identity with ledger rows. Exclude matching external contributions by native identity and event identity, independent of source label. Add a fixture that reads the same rollout through both paths.

### Major — Lane rows without session records vanish from analytics

- Trigger: A lane finishes with `cliSessionId` or lane ID that has no row in `sessions`.
- Symptom: Capture appears successful, but workspace facts and counts omit the usage.
- Evidence: The producer chooses `info.cliSessionId ?? runId` (`lane-completion-outcome.ts:141-148`). Workspace groups, top sessions, and counts all require an inner join to `sessions` (`session-stats-repository.ts:268-269`, `:290-292`, `:336-338`, `:352-354`). No foreign key or reconciliation creates the missing record.
- Current handling: The write commits an orphan usage row. The SQL read silently filters it out.
- Recommendation: Persist lane workspace and host identity in S0002 and use it for lane reads, or create and reconcile a canonical session record before capture. Expose orphan counts as partial source status. Test a lane without a chat parent.

### Major — Queue overflow and shutdown lose accepted usage

- Trigger: More than 64 contributions arrive while the head cannot write, or the host exits after a failed final write.
- Symptom: Accepted usage disappears. Subsequent summaries remain plausible but incomplete.
- Evidence: Capacity overflow shifts the oldest item (`sqlite-session-usage-sink.ts:65-71`). A failed head stops the drain (`sqlite-session-usage-sink.ts:82-92`). The class has no close, flush, timer, or durable outbox (`sqlite-session-usage-sink.ts:50-97`). The Phase 1 report also confirms the missing shutdown flush.
- Current handling: A later event retries the current head. Capacity eviction permanently drops older events.
- Recommendation: Never evict accepted usage silently. Use a bounded durable outbox, backpressure with explicit partial status, or a shutdown drain with a bounded deadline. Move a permanently invalid head to a dead-letter record so it does not block unrelated sessions. Test overflow, poison head, and exit after metadata commit.

### Major — Empty historical coverage is reported as complete

- Trigger: An existing user opens a range with no captured live rows.
- Symptom: Ptah facts and counts are zero, while the source status says complete.
- Evidence: The SQL path disables `ClaudeLedgerSource` whenever the repository exists (`usage-summary.service.ts:31-33`). No backfill exists by decision. Empty groups select complete status (`usage-summary.service.ts:88-90`).
- Current handling: Only nonempty results are marked partial, and that reason covers subagent counts only.
- Recommendation: Persist a capture-coverage epoch or range watermark. Mark the source partial whenever the requested range predates proven live coverage, including the empty case. Do not claim complete status from an empty query alone.

### Major — Accepted SDK cost decreases cannot update the additive ledger

- Trigger: A rate-card change lowers total cost while token counters continue to grow.
- Symptom: The in-memory snapshot accepts the lower cost. The ledger retains earlier known costs and adds new unpriced rows. `knownCost` can exceed the current authoritative value.
- Evidence: The owner accepts rate decreases on unreported runs (`run-result-monotonicity.ts:56-64`). A negative total delta becomes `turnCost: null` (`session-stats-owner.service.ts:1175-1181`). Negative per-model deltas also become null through `usdToMicroUsd` (`session-stats-owner.service.ts:1224-1233`, `session-usage-sink.ts:181-185`). SQL only sums nonnegative stored values (`session-stats-repository.ts:173-178`).
- Current handling: The event is marked unpriced, but no correction removes or offsets the stale known amount.
- Recommendation: Store absolute per-run priced snapshots and compute event deltas during aggregate replacement, or support signed adjustment rows with checked totals. Test a rate decrease with increasing tokens and mixed per-model price changes.

### Major — SDK provider attribution is always `unknown`

- Trigger: Any accepted SDK-owner contribution reaches analytics.
- Symptom: Claude and custom-route usage lose their provider dimension in SQL facts and top sessions.
- Evidence: The owner hardcodes `providerId: null` (`session-stats-owner.service.ts:1266-1275`). The adapter converts null to `unknown` (`sqlite-session-usage-sink.ts:106-124`). Analytics returns that value directly (`usage-summary.service.ts:61-66`).
- Current handling: Model identity survives, but provider identity does not.
- Recommendation: Pass the resolved provider identity from the query execution boundary into the owner run and contribution. Preserve distinct named routes where they affect billing.

### Minor — Restored zero-delta results create usage events

- Trigger: The first accepted result equals the restored base, with zero net tokens and zero net cost.
- Symptom: A zero row contributes to message count and session activity.
- Evidence: The owner suppresses a contribution only when cost is null, not when cost is zero (`session-stats-owner.service.ts:1263-1265`). The adapter creates an unattributed zero row for an empty model list (`sqlite-session-usage-sink.ts:125-145`). Event count includes that row (`session-stats-repository.ts:241-244`).
- Recommendation: Return null when there are no model rows and `(totalCostMicroUsd ?? 0) === 0`. Add a restored-base test.

### Minor — Codex checkpoint count is not assistant message count

- Trigger: One native revision contains several thread turns, or several checkpoints describe one assistant message.
- Symptom: Range `messageCount` follows checkpoint frequency rather than the DTO's assistant-message meaning.
- Evidence: A checkpoint deliberately has no single turn ID because it can span turns (`session-metadata-store.ts:303-307`). The SQL counts distinct producer/event keys as messages (`session-stats-repository.ts:241-244`, `:352-355`). The shared contract defines assistant messages (`rpc-session.types.ts:393-394`).
- Recommendation: Persist accepted turn identity and parent assistant count separately from checkpoint identity. Until then, leave the count unavailable rather than relabel checkpoint count.

### Minor — SQL facts bypass the response fact limit

- Trigger: The ledger returns more than 100,000 groups.
- Symptom: The response is unbounded during construction, then final Zod validation can fail the whole summary instead of returning partial data.
- Evidence: The SQL group query has no limit (`session-stats-repository.ts:257-274`). The ledger loop inserts every group (`usage-summary.service.ts:57-70`). `MAX_FACTS` is enforced only for external contributions (`usage-summary.service.ts:114-116`). Final validation enforces the schema maximum (`usage-summary.service.ts:200`).
- Recommendation: Apply a deterministic SQL limit of `MAX_FACTS + 1`, truncate before response construction, and mark the Ptah source partial with `fact-limit`.

### Minor — Model-priced SQL facts report unavailable pricing

- Trigger: All Ptah cost rows are model-priced and external sources return no pricing metadata.
- Symptom: Facts contain model-priced cost, but summary pricing says `unavailable`.
- Evidence: `priceSource` starts as unavailable (`usage-summary.service.ts:53`). The SQL branch never updates it (`usage-summary.service.ts:54-95`). Only external contributions update it (`usage-summary.service.ts:157`). The response uses that unchanged value (`usage-summary.service.ts:198`).
- Recommendation: Select pricing provenance in the SQL group projection and derive a truthful summary source and timestamp. Do not infer OpenRouter from a catalog version alone.

## Data flow

1. **SDK accepted result → normalized delta: OK with gaps.** Cumulative results become per-turn deltas. Restored base subtraction prevents ordinary double counting. Cost decreases and provider identity are gaps.
2. **Codex accepted checkpoint → normalized delta: PARTIAL.** Non-regressing counters become deltas. Same-revision pricing does not converge.
3. **CLI terminal outcome → normalized turn total: PARTIAL.** Only declared turn totals enter. Canonical session and workspace identity are not guaranteed.
4. **Contribution → Zod boundary: OK.** Producers parse strict contributions. The SQLite adapter validates again. Invalid input is rejected without breaking streams.
5. **Sink queue: PARTIAL.** The queue is bounded and has no unbounded timer. Overflow and shutdown can lose accepted events.
6. **SQLite transaction: PARTIAL.** `BEGIN IMMEDIATE`, rollback, safe-integer validation, and aggregate recomputation are present. Event-level replacement is incomplete.
7. **S0002 migration: OK by inspection.** The existing runner applies each migration atomically. Existing sessions remain untouched.
8. **Workspace analytics SQL: PARTIAL.** Workspace predicates and UTC `[from, until)` bounds are present. Orphan lane rows disappear. SQL fact count is unbounded.
9. **Ptah plus external merge: FAIL for overlapping Codex identity.** Source-scoped deduplication cannot remove cross-source duplicates.
10. **Range stats RPC: FAIL for workspace isolation.** Fallback only for absent ledger IDs avoids ordinary double counting. The direct ledger path lacks workspace ownership checks.
11. **Electron and CLI DI: OK by inspection.** Both existing registration calls bind the same repository and sink. VS Code retains fallback behavior through optional injection.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Persist accepted live per-turn usage | PARTIAL | Queue overflow, shutdown, and orphan identities lose usage. |
| Avoid cumulative-frame double counting | PARTIAL | Ordinary SDK deltas work. Event revisions and external Codex overlap do not. |
| Idempotent upsert and aggregate recomputation | PARTIAL | Duplicate rows converge. Complete event replacement does not. |
| Atomic transactions and safe migration | COMPLETE by inspection | Runtime verification remains pending. |
| Preserve NULL versus zero cost | PARTIAL | Ordinary unknown costs remain null. Repricing transitions do not converge. |
| Safe integer micro-USD accounting | COMPLETE by inspection | Inputs and aggregates use safe-integer checks. Overflow rolls back. |
| Workspace isolation | PARTIAL | Summary SQL is scoped. Range session reads are not. |
| UTC day bucketing | COMPLETE by inspection | SQL uses `unixepoch` and half-open epoch ranges. |
| Sink failure never breaks streams | COMPLETE by inspection | Producers catch synchronous and asynchronous failures. Data durability remains partial. |
| SQL `analytics:spendSummary` for Ptah sessions | PARTIAL | Historical coverage, duplicates, orphan rows, provider identity, and status semantics remain wrong. |
| `session:stats-batch` fallback | PARTIAL | Absent-ID fallback is bounded to the page. Workspace authorization and coverage semantics need fixes. |
| Electron and CLI DI | COMPLETE by inspection | No VS Code root was found or claimed. |
| Strict TypeScript and injected logging | COMPLETE by inspection | No new `any`, `@ts-ignore`, or `as unknown as` was found in the reviewed implementation. Diagnostics are unavailable. |
| Zod at boundaries | COMPLETE by inspection | RPC, producer, adapter, and repository inputs have schemas. |
| No JSONL backfill | COMPLETE | Historical coverage must therefore remain explicitly partial. |

Implicit requirements not addressed: canonical external-session deduplication, durable capture coverage, range-read workspace ownership, and final-event shutdown durability.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Exact duplicate contribution | YES | Primary-key conflict with no aggregate change | No complete-event replacement |
| Older revision | YES | Upsert `WHERE` rejects it | Tested only per model row |
| Newer revision with fewer rows | NO | Old rows remain | Residual can double count |
| Codex unknown-to-known price | NO | Null delta yields no contribution | Metadata and ledger diverge |
| Repeated equal Codex price delta | NO | Same event key and revision | Second correction is ignored |
| SDK cumulative result | YES | Previous accepted result is subtracted | Provider ID is lost |
| SDK restored base | PARTIAL | Base tokens are subtracted | Zero event is still written |
| SDK rate decrease | NO | Negative deltas become null | Old cost remains additive |
| Parent and subagent SDK usage | PARTIAL | Owner aggregates model usage into the parent contribution | Exact subagent counts remain unavailable |
| NULL cost | YES | SQL `SUM` ignores null and flags unpriced rows | Mixed groups intentionally have null total cost |
| Known zero cost | YES | Zero is distinct from null | Zero-only no-op events should not be written |
| Unsafe integer or sum | YES | Zod and checked sums reject; transaction rolls back | Runtime tests not established |
| Workspace summary filtering | YES | Inner join uses normalized workspace key | Orphan rows vanish |
| Cross-workspace range session ID | NO | Queries use session ID only | Usage metadata crosses isolation |
| UTC boundary | YES | `strftime(..., 'unixepoch')` and half-open range | Uses ingestion time for live events |
| Migration on existing DB | YES by inspection | Atomic migration runner preserves S0001 data | No successful runtime verification |
| SQLite write failure | PARTIAL | Rollback and queue-head retry work | No shutdown flush; overflow drops data |
| Invalid sink payload | YES | Zod rejects and logger reports | A persistent valid-but-unwritable head blocks later events |
| Empty historical ledger | NO | Status becomes complete | Existing usage looks like measured zero |
| SQL result overflow | NO | No ledger fact cap | Final schema validation can fail the request |

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH.
- Top risk: The new direct SQL reads break workspace isolation, while Codex merge and revision paths can return materially wrong usage totals.
- Score rationale: The score exceeds the 1–2 band because the schema, transaction boundary, ordinary SDK delta logic, null handling, UTC ranges, and host registrations are substantive. It remains below 5 because one security defect and eight major wrong-result or data-loss paths block acceptance.
- Required before approval: Fix range-read authorization, event-level revision replacement, Codex source deduplication, lane identity reconciliation, and queue durability. Correct coverage status and repricing behavior. Add focused regression tests for every scenario above, then run the coordinator's scoped verification.
